# Design: fix-offline-book-consistency

**Created**: 2026-10-22
**Rounds**: 3 (full; termination: approved)
**Approved by**: user @ 2026-10-22. Operator approval at the round-3 design gate: approved as synthesized,
plus the three binding [r4 MUST] items. Floor clear.
**Grounded in**: recon.md
**Severity**: SEV-2 (Track C, debt-radar D-47, D-48, D-49, D-63)

---

## Chosen Approach

### Spine

- No migration and no config key. The bounds are code constants (operator decision, product-spec Fix Scope;
  recon.md:69, :232).
- Nothing changes in `consumeEventStream` (`portfolio_service.go:185-202`, feature 248's region) or on the
  `order.filled` path (`:168`) (recon.md:27-29, :241-244, :296-297).
- The only wire changes are two additive proto fields, `Portfolio.offline_state_unavailable = 17` and
  `Position.offline_state_unavailable = 26`. Both go through the proto approval gate (C-04, C-09; recon.md:225-229).
  The fields were verified free on this branch: Portfolio's highest tag is `fees_lifetime = 16`, and Position's
  highest is `mark_as_of = 25`, with no `reserved` statement. Tag 20 is `stop_order_id`.
- Trace propagation (operator 2026-10-21, standing): request-derived emits and writes use
  `context.WithoutCancel(ctx)`, never a fresh background context. No C-03 waiver.

### 1. D-49 / FR-5: ConfirmOrder input validation (trading)

- Add one `isFinite(x float64) bool` helper. It replaces the inline `math.IsNaN || math.IsInf` checks at the
  fees guard (`trading.go:897`) and the Snapshot per-row checks (`:1156`, `:1160`). Every caller keeps its own
  sign rules and error shape (recon.md:76-81, :95-97, :145-149).
- `ConfirmOrder` returns INVALID_ARGUMENT **before** `GetOrder` (`:901`) in two cases:
  - `filled_qty` is non-finite or negative;
  - `filled_avg_price` is non-finite or negative and `filled_qty > 0`.
- `filled_qty 0` skips the price check, which keeps un-confirm and bare re-confirm valid (AC-48 @feature-240;
  recon.md:194, :268).
- Because the guard runs before the load, a bad value on a broker order returns INVALID_ARGUMENT rather than
  FailedPrecondition. The order is unchanged either way (recon.md:264-267).
- `deriveOfflineStatus`'s `default → FILLED` (`:863-871`) is unreachable for NaN/Inf once the guard is in place
  (recon.md:73-74).
- Verification and the dev smoke include a read-only NaN/Inf detection query over confirmed offline orders. Any
  rows found are re-confirmed through the RPC before launch.

### 2. D-63 / FR-6: an emit failure is not success (trading)

- Add a sibling `appendLedgerEvent(...) error` that returns the `structpb.NewStruct` and `AppendEvent` errors.
  `emitLedgerEvent` (`:3661`) becomes its void wrapper, so its other 26 callers are untouched (recon.md:91-94,
  :150-156, :270-275; fails.md:2092).
- `recomputeAndEmitOfflinePositions` (`:962`) emits through `appendLedgerEvent` at `:1067` and returns its error
  instead of the unconditional `return nil` at `:1077`. The payload moves over verbatim, `user_id` included
  (fails.md:2054). A test asserts `user_id` is present.
- `ConfirmOrder` (`:951-954`) returns UNAVAILABLE "positions not published; re-confirm to retry". Confirm is
  absolute, so a re-confirm under `confirmLock` is idempotent (AC-10 @feature-157; recon.md:157-158, :189).
- `SnapshotOfflinePositions` (`:1224`) appends a line to `Warnings`. Its only consumer is the agent, through
  `MessageToDict`.
- Both recompute call sites use `context.WithTimeout(context.WithoutCancel(ctx), recomputeTimeout)`.
  - Rule: `recomputeTimeout > ledgerEmitTimeout (10s, :3657/:3663) + the baseline/orders query budget + any
    retry budget`.
  - /sdd-spec fixes the value, and a test asserts the rule.
- `appendLedgerEvent` (only there) makes one bounded retry on `codes.Unavailable` with a per-emit
  `idempotency_key` (`ledger.proto:50`, `AppendEventRequest` field 8), following portfolio's `emitEvent`
  precedent.
  - The retry runs inside the caller's already-held `confirmLock` and never takes it again. The lock is
    non-reentrant (fails.md:2028; recon.md:288-289).
- A frozen-window confirm still recomputes and emits, because there is no no-op path in `:962-1077`. It fails
  only when the ledger append fails (AC-46 @feature-240; recon.md:279-281).
- The long-term root fix is a transactional outbox for `account.positions.synced`. It is out of scope because it
  needs a migration and a relay worker (see Rejected Alternatives).

### 3. D-47 / FR-1..3: retryable offline sync and deregistration (portfolio)

- `processPositionSync` (`:1175`) and `processAccountDeregistered` (`:1132`) return `error`, following
  `processOrderFill` (`:264`) (recon.md:34-44, :129-135).
  - The offline branch is try-all. It attempts `UpsertPositionFromSync` (`:1213-1215`),
    `DeletePositionsNotInSync` (`:1219-1221`) and `UpsertOfflineRealized` (`:1229-1231`), then returns
    `errors.Join` of the failures.
  - The broker branch stays warn-and-continue.
  - Parse failures and a nil payload (`:1176-1190`) stay acked. They are poison.
  - `processAccountDeregistered` returns the `DeletePositionsNotInSync` (`:1156-1158`) and
    `DeleteOfflineRealized` (`:1159-1161`) errors.
  - The `shouldReconcileSyncDeletions` guard is unchanged (AC-4 @feature-206; recon.md:192).
- A `boundedRetry` handler wrapper replaces `ackAlways` (`:176`) at `:1117` and `:1129`. The bracket (`:1249`)
  and balance (`:1297`) consumers keep `ackAlways`.
  - The wrapper is in memory and keyed by `event.Sequence`, so its attempt state outlives one
    `streamEventsFrom` call (recon.md:136-139).
- Park rule (binding operator decision r3 (3)). The wrapper classifies the error with
  `errors.As(err, *pgconn.PgError)` and the transport/context checks:
  - **Deterministic**, SQLSTATE class 22 (data exception) or 23 (integrity violation): park after
    `retryMinAttempts = 5`, with no elapsed floor.
  - **Transient**, meaning connection/network errors, context deadline, or SQLSTATE classes 08/40/53/57: never
    park. The event retries the way order.filled does today.
  - **Unclassified**: fall back to the r3 bound, park only when attempts ≥ 5 **and** elapsed ≥ 10 min.
  - A park writes a single Error log, "event parked", with `event_id`, `sequence`, `stream_key` and
    `consumer`, then acks.
  - With this rule, no event is dropped during a DB outage of any length, `account.deregistered` included.
    Deterministic poison clears in about 10s (5 × 2s), instead of stalling the shared stream for 10 min or more.
- **Self-heal for parked events (documented recovery path).** `lastSeq` starts at 0 on every boot
  (`portfolio_service.go:186`, `streamEventsFrom` `:205-209`: "lastSeq == 0 replays full history"). So the next
  deploy replays every parked event and re-attempts it. Absolute recompute (AC-10 @feature-157) makes the
  replay safe.
  - The spec adds this sentence to the `ConsumePositionSyncs` row of `services/xstockstrat-portfolio/CLAUDE.md`
    (recon.md:334-336).
- Deregistration scope (open, see Open Risks). The `account.deregistered` payload carries no account type
  (`:1132-1160`). The spec must choose one:
  - (a) record broker-deregistration retry as an explicit scope extension in this feature's `context.md`; or
  - (b) keep broker deregistration warn-only by checking the user's offline-account set first.

### 4. D-48 / FR-4: per-account offline-state degrade (portfolio)

- **Per-row decode (binding operator decision r3 (2)).** `GetOfflineStates` (`portfolio_repo.go:499`; decode at
  `:521-523`) returns `(map[string]OfflineState, map[string]error /*failed*/, error)` (recon.md:59-61,
  :249-256).
  - A Query, Scan or `rows.Err` failure stays a whole-call error.
  - A `json.Unmarshal` failure on one row records `failed[id]` and the loop continues.
- `valueRead` (`offline_valuation.go:75`) exposes `readValuation.unavailable map[string]bool` instead of
  substituting an empty map with a Warn (`:99-103`) (recon.md:46-51).
  - A whole-call error marks every offline id that was requested.
  - A per-row failure marks only that id.
  - Only ids passed to `GetOfflineStates` can be marked, so broker accounts are never marked. This removes r3's
    two accepted broker side effects (`portfolio_service.go:1405-1416`, `:598-626`).
  - Callers read `degraded := rv.unavailable[acctID]`. Nothing infers it from `bal == nil` (C-18).
  - A sentinel `ErrOfflineStateUnavailable` (sibling of `ErrQuotesUnavailable`, `:718`) is kept for logs and
    tests. No read fails on it.
- `applyAccountPnL` (`:1339`) when the account is degraded:
  - set `Portfolio.offline_state_unavailable = true`;
  - zero `TotalPnl`, `DayPnl` and `DayPnlPct`, and the `DayPnl`/`DayPnlPct` of embedded positions;
  - leave the optional realized and fee fields and `TotalPnlPct` nil;
  - keep `Equity = positionsValue`.
  - The unrealized-only figure is never shown as a total (AC-4 @feature-240).
- GetPortfolio aggregate (`:651-677`):
  - set the marker;
  - exclude the degraded account from the `dayPnl`/`totalPnl`/`prior`/`absCost` sums;
  - force `allOffline = false`;
  - still sum `Equity`.
- **Position reads never fail on offline-state unavailability (binding operator decision r3 (1)).**
  - `enrichPositions` (`:445`), `GetPosition` (`:688`) and `ListPositions` (`:709`) keep returning OK
    (recon.md:52-56, :257-258).
  - On each offline position whose account is in `rv.unavailable`: zero `DayPnl`/`DayPnlPct` (offline Day P&L is
    built from `RecentFills`, `offline_valuation.go:195-205`, `:242-246`) and set
    `Position.offline_state_unavailable = true`.
  - Field 26 carries the same field comment as Portfolio field 17.
  - No UNAVAILABLE mapping is added at `portfolio_handler.go:60`, `:84`, `:416` or `:432`.
  - Broker rows stay visible on the positions page (`positions/page.tsx:506`).
- Trading's portfolio callers are unaffected, because position reads stay OK and Qty and marks stay valid. The
  spec lists each one (fails.md:2935):
  - `trading.go:3535` (REDUCE_ONLY) reads Qty only;
  - `:3158` (`resolveAccountEquity`) reads equity and buyingPower only;
  - `:2089` and `:2793` are enumerated with their expected behaviour.
- This supersedes feature 240's recorded decision "a `GetOfflineStates` error is non-fatal (WARN, empty map)"
  (`240-offline-account-full-pnl/context.md:399`, `:771`). The supersession is recorded in this feature's
  `context.md` (recon.md:219-221).
- Runner-up, only if the proto gate refuses field 17 or 26: whole-call UNAVAILABLE through the sentinel and the
  four handler mappings (recon.md:140-144). That fallback would turn @AC-14/@AC-3 @feature-157 into a CHANGE and
  needs operator sign-off.

### 5. Consumer surfaces (C-14)

- **UI (`xstockstrat-ui`, trader segment)**:
  - `OrderBook.tsx:100-131` gates the aggregate dayPnl/totalPnl on `offlineStateUnavailable`.
  - `portfolioTotals.ts` gains an `incomplete` flag and `PNL_UNAVAILABLE_LABEL`. `PortfolioPanel` (`:64-67`)
    and `portfolio/page.tsx` (`:147`) gate per account.
  - The notice is `CardNotice variant="muted"` (`CardNotice.tsx:10` is `'muted' | 'error'`).
  - `positions/page.tsx`, and any per-position Day P&L cell, show `PNL_UNAVAILABLE_LABEL` when
    `position.offlineStateUnavailable` is set.
  - Errors from ConfirmFillDialog keep the existing `onError` → destructive `Alert` path (`:47-49`), which
    covers the FR-5 INVALID_ARGUMENT and FR-6 UNAVAILABLE messages (recon.md:103-118).
  - The spec has a numbered step that greps every consumer of `usePortfolio`/`usePortfolios`/`Position.dayPnl`,
    with a Playwright assertion per gated surface (mock-backend; fixtures in `e2e/fixtures/INVENTORY.md`,
    C-12/C-13).
- **Agent (`xstockstrat-agent`)**: no code change. `_grpc_error_message` (`app/tools.py:223`, `:238-240`)
  already surfaces INVALID_ARGUMENT and UNAVAILABLE details. The Snapshot Warnings line arrives through
  `MessageToDict`. The new proto bools pass through `MessageToDict` (recon.md:120-125). The test is
  `tests/test_offline_client.py`.

### 6. Tests (design level; /sdd-spec enumerates)

- Trading:
  - extend `TestConfirmOrder_Validation` (`:615`), the AC9 before-load template (`:1710`), and
    `TestDeriveOfflineStatus` (`:471`);
  - an emit-failure test, followed by a successful re-confirm, using `recordingLedger` (`:60`) and
    `newConfirmHarness` (`:1598`);
  - an assertion that `user_id` is in the payload;
  - the `recomputeTimeout` rule test;
  - the Unavailable retry with idempotency_key test (recon.md:168-173).
- Portfolio:
  - handler error and ack tests built on `portfolio_fill_errors_test.go` (`errDBBlip`, `fillEvent`,
    `newFillSvc`);
  - park-classification table tests with a fake clock (class 22/23 parks after 5 attempts; a connection or
    deadline error never parks; an unknown error uses the fallback bound);
  - a per-row decode failure marks only that account;
  - ListPositions returns OK with the Position marker and zeroed DayPnl for a degraded offline account while
    broker rows stay intact;
  - aggregate exclusion;
  - sweep the tests that relied on non-fatal state reads (`portfolio_quote_deadline_test.go:115`)
    (recon.md:162-167, :261-263).
- UI: Playwright marker cases for each gated surface. There is no UNAVAILABLE-positions case.

## Rejected Alternatives

- UNAVAILABLE on GetPosition/ListPositions under an offline-state fault (r1-r3). Rejected because it hides
  broker rows on an unscoped ListPositions and breaks @AC-14/@AC-3 @feature-157. It also creates an
  account-vs-position read-path asymmetry (fails.md:39), and it fails trading REDUCE_ONLY (`trading.go:3535`)
  even though Qty is valid. Replaced by `Position.offline_state_unavailable = 26`.
- Position marker at tag 20. Rejected because tag 20 is `stop_order_id`. The highest tag is `mark_as_of = 25`.
- Inferring degraded from `errors.Is(valErr, sentinel) && bal == nil` at each caller (r3). Rejected on C-18
  grounds: one concept spread across three sites, which also produced two broker side effects. Replaced by
  `readValuation.unavailable[acctID]`.
- Whole-batch failure on one undecodable `recent_fills` row (status quo; the r2 YAGNI rejection). Rejected
  because a corrupt row is persistent and degrades every offline account the user has.
- Error-blind park rule, attempts ≥ 5 AND elapsed ≥ 10m (r3). Rejected because it drops events during an
  outage longer than 10 min (the FR-2 orphan) and stalls the stream for 10 min on deterministic poison.
- Pure deterministic-only parking that retries everything else without limit. Rejected in favour of keeping the
  r3 bound as the fallback for unclassified errors.
- Per-account or per-stream_key park with a later sweep. Rejected because it adds new durable state (YAGNI).
- Transactional outbox for `account.positions.synced`. Rejected because it needs a migration and a relay
  worker, outside the Fix Scope ("no migrations"). Kept as the long-term root fix for D-63.
- Whole-call UNAVAILABLE on every read with an operator C-16 CHANGE sign-off. Rejected because it hides broker
  cards. Kept only as the fallback if the proto gate refuses field 17 or 26.
- A presence-only marker (absent `realized_pnl`). Rejected because it is ambiguous with a new offline account
  that has no state row (AC-52 @feature-240).
- Omitting degraded offline accounts from the all-accounts ListPortfolios. Rejected because the combined total
  would look complete (@AC-30 @feature-240).
- The retry bound inside `consumeEventStream`. Rejected because it edits feature 248's `:185-202` region and
  pulls order.filled into scope.
- Changing `emitLedgerEvent`'s signature. Rejected because it has 26 other callers (fails.md:2092).
- Taking `confirmLock` again for an emit retry. Rejected because the lock is non-reentrant (fails.md:2028).
- Early return on the first offline upsert error. Rejected in favour of try-all plus `errors.Join`.
- Bare `context.WithoutCancel` for the recompute. Rejected because the queries under `confirmLock` are
  unbounded; it is wrapped in `WithTimeout`.
- A reason enum for the marker. Rejected on YAGNI (C-04): a bool plus a field comment is enough.
- A combined "finite and non-negative" helper. Rejected because Snapshot accepts qty 0 and negative qty
  (@AC-8/@AC-15 @feature-163).

## Open Risks

- [ ] The two additive proto fields (Portfolio 17, Position 26) need C-04/C-09 approval. If either is refused,
  fall back to whole-call UNAVAILABLE, which needs a C-16 CHANGE sign-off. To be addressed at the proto step
  (first portfolio step of /sdd-spec).
- [ ] Latent consumers: a Portfolio or Position reader that ignores the marker shows zeroed P&L as a real $0.
  Mitigated by the field comments and the consumer-grep step. To be addressed at the UI consumer-grep step.
- [ ] SQLSTATE classification boundary: a class wrongly listed as transient never parks and can stall the
  shared stream indefinitely. The fallback bound covers only unclassified errors. To be addressed at the
  boundedRetry step (table tests).
- [ ] The boot replay from seq 0 re-attempts every historically parked deterministic event on each deploy: up
  to 5 × 2s per event, visible in logs. To be addressed at the boundedRetry step (portfolio CLAUDE.md row).
- [ ] Same-stream head-of-line blocking remains during transient DB outages. Accepted, because every write
  fails during the outage anyway. To be recorded at the boundedRetry step.
- [ ] A park is visible only as an Error log, with no metric or alert. Accepted for SEV-2 scope. Revisit at
  launch verification.
- [ ] The idempotency_key retry extends how long `confirmLock` is held, by up to the retry budget.
  `recomputeTimeout` must cover it. To be addressed at the FR-6 step (rule test).
- [ ] Confirmed rows that already hold NaN/Inf keep emitting NaN positions until they are re-confirmed. To be
  addressed at the FR-5 step and the dev smoke (detection query plus re-confirm).
- [ ] The sweep of tests that relied on non-fatal state reads may be larger than estimated, and the r3
  UNAVAILABLE-mapping tests become marker tests. To be addressed at the FR-4 test step.
- [ ] Broker-deregistration scope is undecided: (a) a recorded scope extension or (b) an offline-set lookup.
  To be decided at /sdd-spec, on the FR-2 step, and recorded in context.md.
- [ ] If `useInvalidatingMutation` cannot forward `onSettled`, the orders list stays stale after an FR-6
  UNAVAILABLE. A recorded UX gap. To be addressed at the UI step.

## Constitution Rules Touched

- `C-03` (header/trace propagation): honored. Request-derived emits use `WithTimeout(WithoutCancel(ctx))`, which
  keeps `x-trace-id` (operator 2026-10-21, no waiver). The consumers are background loops.
- `C-04` / `C-09` (proto governance): honored. Two additive fields (Portfolio 17, Position 26) go through the
  approval gate. They are bools, not an enum, because the value set is binary.
- `C-10` (blast radius, read-path parity): honored. The degrade applies to GetPortfolio (scoped and aggregate),
  ListPortfolios (both branches), GetPosition and ListPositions. Per-row decode limits the blast radius to one
  account.
- `C-11` (design gate): honored. Three full-mode rounds, with operator approval at the gate.
- `C-14` (consumer surface): honored. UI gating plus Playwright per surface. Agent pass-through is verified
  (`tools.py:223-240`).
- `C-15` (acceptance truth): honored. AC-3 is tightened to the marker outcome at /sdd-spec, and every new case
  lands as `@AC-*` in `acceptance.feature`.
- `C-16` (business rules): honored. Every touched rule is PRESERVE or EXTEND (below); there is no CHANGE.
- `C-18` (one concept, one site): honored by `readValuation.unavailable`, which replaces the `bal == nil`
  inference.
- `F-07`: honored. No Floor breach. The code-constant bounds are covered by the recorded operator decision and
  the `ledgerEmitTimeout` precedent.
- `P-02` (mediated debate) / `P-03` (no invention): honored. Every claim cites recon.md or a line re-verified on
  this branch. The unresolved deregistration fork is left open rather than guessed.

## Business Rules Touched (C-16)

Operator decision reference for all of the following: the 2026-10-22 design-gate r3 approval ("approved as
synthesized plus the three [r4 MUST] items"). No rule is a CHANGE, so no CHANGE sign-off is required.

- PRESERVE `@AC-14 @feature-157` "A broker account's P&L is unaffected by the presence of an offline account"
  (`services/xstockstrat-portfolio/acceptance/offline-account-portfolios.feature`). Not regressed: broker
  accounts are never marked, and position reads stay OK.
- PRESERVE `@AC-3 @feature-157` "Offline accounts appear alongside broker accounts in the account selector"
  (`services/xstockstrat-ui/acceptance/offline-account-portfolios.feature`). Not regressed: no read fails
  whole-call.
- PRESERVE `@AC-3 @feature-159` (`services/xstockstrat-ui/acceptance/fix-offline-account-ui-gaps.feature`). Not
  regressed: offline balances never blend into broker aggregates, and the degraded account is excluded from the
  P&L sums only.
- PRESERVE `@AC-10 @feature-157` "Re-editing a confirmed offline fill does not double-count the position". Not
  regressed: absolute recompute makes re-confirm (FR-6) and replay (FR-1..3) idempotent.
- PRESERVE `@AC-29 @feature-240` "Every portfolio read returns the same offline P&L for the same state". Not
  regressed: one `rv.unavailable` drives every read path.
- EXTEND `@AC-9 @feature-240` "Negative fees are rejected"
  (`services/xstockstrat-trading/acceptance/offline-account-full-pnl.feature`). New cases: non-finite or
  negative `filled_qty`, and `filled_avg_price` when `filled_qty > 0`, are rejected before the load. The fees
  message and its ordering are kept.
- EXTEND `@AC-30 @feature-240` "The combined PortfolioPanel sums each account's own figures". New case: a
  degraded account marks the combined total `incomplete` and shows `PNL_UNAVAILABLE_LABEL`.
- EXTEND `@AC-14 @feature-240` "The trader account card shows full P&L for an offline account". New case: a
  degraded card shows the muted unavailable notice, not an unrealized-only total.
- EXTEND `@AC-15 @feature-240` "The Book page offline card shows the P&L summary". New case: the same degraded
  state, with OrderBook aggregate gating.
- PRESERVE `@AC-7 @feature-163` "One malformed baseline row is rejected while the valid rows commit". Not
  regressed: the shared `isFinite` keeps per-row reject-with-reason.
- PRESERVE `@AC-43 @feature-240` "A snapshot whose rows are all rejected changes nothing". Not regressed, for
  the same reason.
- PRESERVE `@AC-8 @feature-163` "A zero-qty baseline row flattens that symbol" and `@AC-15 @feature-163`. Not
  regressed: Snapshot sign rules are unchanged, and qty 0 is still accepted.
- EXTEND `@AC-14 @feature-163` "A later full-close snapshot reseats account realized P&L from 600.00 to 0.00".
  New case: the realized upsert reseats under retry, and a parked event self-heals on the boot replay.
- The other PRESERVE rules in recon.md:180-218 are carried unchanged: AC-4/6/12/13/27/28/39/46/47/48/51/52
  @feature-240, AC-5/7/9/11/12/15/18 @feature-157/163, AC-4 @feature-206, AC-1/5 @feature-229 and
  AC-2/4 @feature-159.

## Rounds

- r1-r2: established the spine.
  - Per-account marker instead of whole-call UNAVAILABLE.
  - Sibling `appendLedgerEvent`.
  - `boundedRetry` wrapper outside `consumeEventStream`.
  - The operator steered round 3 to adopt the r2 synthesis's [r3 MUST] items.
- r3: adopted every r3 MUST/SHOULD:
  - explicit degraded input;
  - aggregate exclusion;
  - DayPnl zeroing and OrderBook gating;
  - try-all `errors.Join`;
  - `WithTimeout(WithoutCancel)`;
  - NaN detection query;
  - "event parked" log;
  - proto comment.
  Three blocking objections remained: position-read parity, per-row decode, and the error-blind park rule.
- **Termination: approved.** At the r3 gate the operator approved the design as synthesized, plus the three
  [r4 MUST] items as binding: Position marker 26 with non-failing position reads, per-account decode with
  `readValuation.unavailable`, and the SQLSTATE-class park rule with the documented `lastSeq=0` self-heal.
  Those items close the three blocking objections, and no Floor breach stands.
