# Design: fix-trading-reconcile-reads

**Created**: 2026-11-17
**Rounds**: 6 (full; termination: approved — operator approval at the design gate after round 6, Floor clear; round cap raised to 6 by operator override at the r5 gate)
**Approved by**: user @ 2026-11-17 (operator decision, design gate r6 — recorded in context.md)
**Grounded in**: recon.md
**Debate register**: debate.md (D-1..D-24, R-1..R-17, O-1..O-24)

---

## Chosen Approach

Scope (operator 2026-11-17): only `reconcileTick`'s platform-position read in xstockstrat-trading.
Portfolio's internal readers are feature 357. Features 351, 353 and 354 are not touched. No proto,
migration, config key, env var or portfolio change (recon.md:61-67). Internal-only: there is no UI
segment or Agent tool consumer surface (C-14). The behaviour change is visible only through
reconciliation findings/halts, the existing WARN, and one new OTel counter.

All code paths below are under `services/xstockstrat-trading/`.

### 1. Drain helper, fail closed (D-1, D-4, D-5, D-6, D-9, D-16, D-19, D-22)

- The defect site is the single `ListPositions` call at `internal/service/trading.go:2231-2239`
  (recon.md:23). Replace it with a trading-local helper
  `listAccountPlatformPositions(ctx, accountID, userID string, mode commonv1.TradingMode, timeout time.Duration) (map[string]float64, error)`.
  The helper mirrors the `collectFills` drain at `portfolio_service.go:1111-1167` (recon.md:37) and
  returns either the complete symbol→qty map or `nil` plus an error, never a partial set (D-1, D-16).
- Page size is `const reconcilePositionsPageSize = 500`, shared with the tests. There is no config key
  and no page cap (D-6, R-4, R-5).
- `timeout` is the single per-tick `brokerCallTimeout(s.cfgW)` read at `trading.go:2109`
  (recon.md:28), passed in as a parameter. The helper never reads config (D-19, R-14).
- Per page, in this order (D-9, R-7):
  1. Use a fresh `context.WithTimeout(ctx, timeout)` with `x-user-id` injected, as at `trading.go:2234`
     (recon.md:23, :39). Call `cancel()` after the call (D-3).
  2. On an RPC error, return `fmt.Errorf("page %d: list positions: %w", i, err)`.
  3. Run the token guards before merging the page:
     - an empty page with a non-empty `next_page_token` gives `fmt.Errorf("page %d: %w %q", i, errEmptyPageWithToken, next)`;
     - a `next_page_token` already in the seen set (a superset of `next == sent`) gives `fmt.Errorf("page %d: %w %q", i, errRepeatedPageToken, next)`.
     The seen set is defense-in-depth against portfolio's monotonic keyset cursor (D-4, O-5).
  4. Merge the page's symbols. A symbol already in the map gives
     `fmt.Errorf("page %d: %w %q", i, errDuplicateSymbol, sym)`, never sum or last-write-wins
     (D-5, D-13, R-3).
  5. Stop on an empty `next_page_token`.
- Package sentinels: `errEmptyPageWithToken = errors.New("empty page with next_page_token")`,
  `errRepeatedPageToken = errors.New("repeated next_page_token")` and
  `errDuplicateSymbol = errors.New("duplicate symbol")`. They are wrapped with `%w`, so the D-12/D-13
  error texts stay byte-identical and the cause is classified with `errors.Is`, never by matching text
  (D-22, R-17).
- `trading.go:2244-2247` (the `platformBySymbol` rebuild, recon.md:25) is deleted.
  `platformBySymbol` binds directly from the helper (D-16, R-11).

### 2. Skip-the-tick on any incomplete read (D-2, D-7, D-8)

- Every helper error routes into the existing `ppErr` branch at `trading.go:2240-2243`
  (recon.md:24, :38). That branch logs a WARN and does `continue`, so for that account and tick there
  is no candidate, no finding and no halt, and `resolveUnknownIntents` (:2292) is skipped as it is
  today. Operator 2026-11-17: skip, never halt; fails.md:3311.
- Portfolio page failures stay out of `systemicCount` (recon.md:30; D-7, R-6).
- The WARN carries the cause and page index from the wrapped error (D-8).

### 3. Counted skip (D-21, D-23, D-24; operator decisions at the r5 and r6 gates)

- In the `ppErr` branch, add exactly one line before the unchanged WARN and `continue`:
  `telemetry.RecordReconcilePositionSkip(ctx, reconcilePositionSkipCause(ppErr))` (D-21).
- `internal/telemetry/otel.go`: add one new counter,
  `reconcilePositionSkip = NewCounter("trading.reconciliation.position_check_skipped")`, in the
  counter var block (otel.go:331-338). Also add `type ReconcileSkipOutcome string` with exported
  constants and `RecordReconcilePositionSkip(ctx, outcome ReconcileSkipOutcome)`. The typed parameter
  enforces the closed label set (resolves O-23).
- The only attribute is the existing `KeyOutcome` (otel.go:312). There is no new label key and no
  `account_id`/`user_id` attribute; both are already in `forbiddenLabelKeys`. No cardinality growth.
- `trading.escalation.systemic` is **not** reused (R-15) and the counter is not unlabelled (R-16).
- **Outcome set: `rpc_error | deadline | cursor_invalid`** (operator r6 adopted the mediator's single
  `cursor_invalid`, resolving O-22). `reconcilePositionSkipCause(err) telemetry.ReconcileSkipOutcome`
  maps as follows:
  - `deadline` when `errors.Is(err, context.DeadlineExceeded) || status.Code(err) == codes.DeadlineExceeded`.
    This is a **binding operator decision, r6** that resolves O-20: a ctx-blocking fake returns a plain
    `context.DeadlineExceeded`, for which `status.Code` reports `Unknown`.
  - `cursor_invalid` when `errors.Is` matches any of the three guard sentinels. The WARN already tells
    the guards apart (D-8).
  - `rpc_error` for everything else, **including `context.Canceled`**. The operator requires every skip
    caused by a `listAccountPlatformPositions` error to be counted, so the shutdown burst on each deploy
    is counted, accepted and documented. There is no sixth label (resolves O-24).
- No `packages/otel/produced-signals.tsv` row and no alert or dashboard: the registry check
  (`scripts/check-otel-produced-signals.py:2-9`) only covers series that an alert or dashboard queries
  (D-24).

### 4. Spec trace (binding operator decision r6; resolves O-21; IDs append-only)

- `/sdd-spec` appends **FR-5** to `product-spec.md`: every position-side check skipped because of a
  `listAccountPlatformPositions` error is counted on `trading.reconciliation.position_check_skipped`
  with a bounded `outcome` label and no account or user attribute.
- `/sdd-spec` appends `@AC-4 @FR-5 @regression` to `acceptance.feature`. It asserts that the counter
  increases with the expected outcome for the AC-2 error case (`rpc_error`) and the AC-3 repeated-token
  case (`cursor_invalid`). The step style follows `signal-map-instrumentation.feature:60`, so the
  counter is promoted into the durable `services/xstockstrat-trading/acceptance/` suite.

### 5. Tests, RED first (operator: red-before-green is mandatory)

All tests go in `internal/service/trading_reconciliation_test.go` and reuse the existing harness
(recon.md:41-47): `fakeReconciliationPortfolioClient.listPositionsFn`, `fakeReconciliationBroker`,
`fakePositionQtyLookup`, `recordingLedgerClient`, `newTestReconciliationService`, and the two-tick
pattern at :554-555. The paging fake follows the ignore-token plus call-cap shape at
`portfolio_pnl_paging_test.go:27-49` (recon.md:40).

- **Fixtures**:
  - `const reconcile358Owner = "user-358-owner"`, placed in `brokerPoolEntry.userID`
    (trading.go:75-81) (D-20, O-19).
  - Every 358 `fakeReconciliationBroker` sets `isPaper: true` (D-20, O-18).
  - The paging fake records `req.GetAccountId()`, `req.GetTradingMode()`, the outgoing `x-user-id`
    and `ctx.Deadline()` at call entry (D-17, O-13). Its log is read and reset per tick via `takeLog()`
    (D-15).
- **Cases**:
  - **AC-1**: exactly 2 calls per tick with tokens `["", "p2"]`, and a pre-seeded
    `acc-1:pos:SYM501` candidate cleared. There is no finding and no halt after each tick. RED on
    today's code: a finding is emitted and the account halts at tick 1 (O-8).
  - **Positive control**: SYM501 on page 2 with an unexplained mismatch emits a finding and halts. The
    `mismatch_found` payload has `expected == 5` and `broker_reported == 10`, read only via
    `recordingLedgerClient` `e.Payload.Fields[...]` (D-10, D-14, R-9).
  - **AC-1 and the positive control**: every logged page call asserts
    `x-user-id == reconcile358Owner`, `AccountId == "acc-1"` and the literal
    `commonv1.TradingMode_TRADING_MODE_PAPER` (D-17, D-20, R-13).
  - **AC-2 error**: page 2 returns `Unavailable`, and the account is skipped (no candidate, no finding,
    no halt).
  - **AC-2 deadline**:
    - `broker.timeout_ms` is 50 ms. Page 1 uses `time.Sleep` and never observes ctx. Only `"p2"`
      blocks on `ctx.Done()` and returns `ctx.Err()`, which is a **plain `context.DeadlineExceeded`**:
      this is the form the AC-2 deadline fake returns (operator r6).
    - Page 2's recorded `Deadline()` is strictly after page 1's (D-11, D-18, R-8, R-10, R-12).
    - The broker fakes never sleep.
  - **AC-3**: the ignore-token fake with a call cap makes at most 2 calls per tick and exercises the
    repeated-token guard (D-9).
- **Counter assertions** (D-23):
  - Each test calls `installMetricReader(t)` (`trading_telemetry_test.go:285`) as its first statement.
    No test uses `t.Parallel`.
  - After two ticks, assert via `counterValue(..., attribute.String("outcome", X))` (:316):
    - AC-2 error: `rpc_error` = 2;
    - AC-2 deadline: `deadline` = 2;
    - AC-3: `cursor_invalid` = 2;
    - AC-1 and the positive control: total = 0.
- **Direct-helper hardening table** (D-12, D-13):
  - Rows assert the exact texts `page 2: repeated next_page_token "p2"`, the empty-page-with-token
    text, `page 2: duplicate symbol "SYM500"`, and an RPC error where
    `status.Code(err) == codes.Unavailable` on the wrapped error (O-14).
  - Every row also asserts `reconcilePositionSkipCause(err)`.
  - Extra mapper rows:
    - a wrapped plain `context.DeadlineExceeded` maps to `deadline`;
    - a wrapped `status.Error(codes.DeadlineExceeded, …)` maps to `deadline`;
    - a wrapped `context.Canceled` maps to `rpc_error`.
- **`telemetry_allowlist_test.go`**: add the instrument to `minInstruments` (:37-40) and one
  `RecordReconcilePositionSkip` call to `driveAllInstruments` (:44-52).
- **Re-run the other `reconcileTick` tests** (`trading_ibkr_auth_test.go`, `trading_telemetry_test.go`).
  Their default single-page empty response stays valid (recon.md:80).

### 6. Docs

- `docs/reconciliation.md:57`: add one paging sentence (recon.md:79).
- `docs/reconciliation.md:98`: add the counter, its outcome set and its meaning. One account's
  position check was skipped for one tick; a sustained non-zero rate means that account is going
  unreconciled. Note that a shutdown can produce a burst of `rpc_error`.
- The service `CLAUDE.md` "Position & Balance Sync Observability" pointer line names the counter
  (D-24).

### Build order

1. FR-5 and the @AC-4 trace.
2. RED tests (AC-1, positive control, AC-2 error, AC-2 deadline, AC-3, counter assertions) and the
   allowlist additions.
3. The counter and `ReconcileSkipOutcome`.
4. The helper with sentinels, the mapper, the `reconcileTick` change, and the hardening table.
5. `GOWORK=off go test ./...` in `services/xstockstrat-trading`.
6. Docs.

## Rejected Alternatives

- `R-1` One shared context and deadline across all pages of an account — rejected because large accounts would hit the deadline every tick and never be checked, with nobody noticing. Per-page timeouts keep the per-call semantics.
- `R-2` An inline drain loop in `reconcileTick` — rejected because `reconcileTick` is already about 215 lines. The helper gives a single return contract that can be tested.
- `R-3` Tolerating duplicate symbols across pages (sum or last-write-wins) — rejected because a duplicate can only come from a broken cursor, and tolerating it would hide page overlap.
- `R-4` A fixed page cap — rejected because it is a speculative constant (C-18). The seen-token and duplicate-symbol rules already terminate the loop.
- `R-5` A new config key for the page size — rejected because the operator Fix Scope excludes it, and the value is a paging shape, not an operator-tunable setting.
- `R-6` Counting portfolio page failures toward `systemicCount` — rejected because it would change the systemic escalation semantics.
- `R-7` Merging a page's symbols before its token checks — rejected because the duplicate-symbol guard then shadows the repeated-token guard on ignore-token fakes, leaving FR-3 untested (fails.md:3312).
- `R-8` Using "page-1 ctx still live during the call" as evidence of per-page deadlines — rejected because it holds identically under the shared deadline of R-1.
- `R-9` A local or second ledger recorder for reading finding payloads — rejected because `recordingLedgerClient` already captures the full payload, and a duplicate recorder could reintroduce a vacuous check (C-13/C-18).
- `R-10` A fake clock seam for deterministic deadline ordering — rejected because `context.WithTimeout` does not use `s.clock`, so it would need a speculative new seam (C-18).
- `R-11` The helper returning `[]*portfoliov1.Position` that `reconcileTick` reshapes into a map — rejected because the same concept would be built twice (C-18).
- `R-12` A page-1 fake that selects on `ctx.Done()` in the deadline variant — rejected because a page-1 overrun would suppress the page-2 log and flake the D-11 assertion.
- `R-13` Re-deriving the expected TradingMode in tests from `IsPaper()` — rejected because the test would mirror the mapping it checks (C-13).
- `R-14` Reading `brokerCallTimeout(s.cfgW)` per page inside the helper — rejected because a config change mid-drain could change the per-page timeout partway through, and the direct-helper tests would need a config watcher.
- `R-15` Reusing `trading.escalation.systemic` (or adding a label to it) to count skipped reads — rejected because it carries no labels and means escalation to REDUCE_ONLY (otel.go:337). Reusing it breaks @AC-45 and the R-6/D-7 split.
- `R-16` A single unlabelled skip counter — rejected because it cannot tell a persistent deadline skip on a large account from a transport outage or a cursor bug.
- `R-17` Classifying the skip cause by matching error text — rejected because a message edit would silently break classification. Sentinels wrapped with `%w` keep the texts identical and can be matched with `errors.Is`.

## Open Risks

- [ ] Shutdown bursts: when the tick ctx is cancelled, each remaining account records an `rpc_error` skip. An alert on this series needs a rate or for-duration window to avoid paging on deploys. Address in the docs step (`docs/reconciliation.md:98`) and in any future alert PR.
- [ ] Tick wall-clock time grows by up to ceil(n/500) × `broker.timeout_ms` for each large account, because accounts are processed sequentially. Portfolio's per-page `enrichPositions` makes page deadlines more likely on big accounts; those now surface as `outcome=deadline`. Accepted (D-3); revisit if the deadline rate is non-zero in production.
- [ ] `resolveUnknownIntents` stays skipped while an account's platform read is incomplete, because the `continue` at `trading.go:2240-2243` is unchanged. An extended portfolio outage therefore also delays resolving UNKNOWN intents. Out of scope; note it in the PR description.
- [ ] The duplicate-symbol and repeated-token rejections rely on portfolio's `UNIQUE(user_id, symbol, trading_mode, account_id)` (migrations/003:10) and on the keyset cursor returning each row once. A future portfolio change could cause false skips (never false halts); those would show up as `cursor_invalid`. Accepted.
- [ ] The counter assertions depend on each test installing its own MeterProvider reader before the first tick. A missed install makes the zero-count guards pass without testing anything. Mitigated by the "installMetricReader as first statement, no t.Parallel" rule (D-23); check it at the test step.
- [ ] The deadline-ordering assertion needs the monotonic clock to advance across page 1's 5 ms sleep. Equal deadlines make the test fail as a flake; it cannot pass vacuously. Watch it at the test step.
- [ ] TradingMode propagation is pinned only on the paper path. The live mapping on later pages has no per-entry assertion (accepted as out of scope, C-18).
- [ ] No alert rule or dashboard is added. "Alertable" means an operator can build one on this series; adding one later must bring its `packages/otel/produced-signals.tsv` row in the same PR.
- [ ] Merge order: 358 must not merge ahead of feature 353's lifecycle (recon.md:71). Track this at the integration PR.

## Constitution Rules Touched

- `C-11` — honored by: the recon-grounded design, with every assumption surfaced and debated over 6 rounds. The deadline mapping (O-20) and Canceled handling (O-24) are made explicit.
- `C-13` — honored by: reusing the existing test fixtures and recorders (`recordingLedgerClient`, `installMetricReader`, `counterValue`), one named owner constant, and literal-enum assertions (D-14, D-20, D-23; R-9, R-13).
- `C-15` — honored by: the 358 @AC-1..@AC-3 regression scenarios plus the appended @AC-4 @FR-5, each backed by a RED-first test.
- `C-16` — honored by: the Business Rules section below. There are only PRESERVE and EXTEND entries, no CHANGE.
- `C-18` — honored by: no page cap, no config key, no clock seam, a map return type, a typed three-value outcome set, and one counter (R-4, R-5, R-10, R-11; O-22, O-23).
- `F-04` — honored by: no proto, migration or config change. The design is a trading-local read and test change only.
- `F-07` — honored by: no new config key. The page size is a code constant (D-6, R-5).
- `P-02` — honored by: the debate register binds every round. D-8's "no new metric" clause is superseded only by the binding operator decision of the r5 gate (D-21), not by drift.
- `P-03` — honored by: there are no silent deviations. Operator overrides (round cap raised to 6; counted skip; r6 resolutions) are recorded in context.md and here.
- `PLAT-4` — honored by: `x-user-id` is injected on every page call's fresh ctx and asserted per page entry (D-17).
- `PLAT-N1` — honored by: no claim of done without `GOWORK=off go test ./...` output, and red-before-green on every new test.

No Floor (`F-*`) breach: every touched Floor item is honored (F-11 clear).

## Business Rules Touched (C-16)

- PRESERVE `@AC-1 @feature-206` "A broker position explained by the platform's own filled orders does not halt" (`services/xstockstrat-trading/acceptance/fix-reconciliation-false-halt.feature`) — not regressed by: `NetFilledQtyBySymbol` still explains broker qty against the now-complete drained set (recon.md:51).
- PRESERVE `@AC-2 @feature-206` "A genuinely foreign broker position still halts" (same file) — not regressed by: the positive-control test proves a real page-2 mismatch still emits `mismatch_found` and halts (D-10; recon.md:52).
- PRESERVE `@AC-3 @feature-206` "A net-filled-qty lookup error never causes a false halt" (same file) — not regressed by: the lookup-error skip path is unchanged, and the new page-error skip uses the same fail-closed posture (recon.md:53).
- PRESERVE `@AC-9 @FR-4 @feature-249` "A credential-rejected IBKR broker call is not counted as systemic" (`services/xstockstrat-trading/acceptance/fix-ibkr-request-signing.feature`) — not regressed by: the broker-side skip and `systemicCount` are unchanged (recon.md:54).
- PRESERVE `@AC-45 @FR-1 @feature-294` "Repeated systemic escalation is countable and the broker label covers IBKR" (`services/xstockstrat-trading/acceptance/signal-map-instrumentation.feature`) — not regressed by: `trading.escalation.systemic` and `escalateSystemic` are untouched. The skip counter is a separate instrument, and page failures stay out of `systemicCount` (D-7, R-6, R-15).
- PRESERVE `@AC-7 @FR-2 @feature-169` "Reconciliation poller resumes ticking after ResumeAccount" (`services/xstockstrat-trading/acceptance/resume-halted-account.feature`) — not regressed by: the halt/resume state machine is unchanged.
- PRESERVE `@AC-1 @FR-1 @FR-2 @feature-169` "ResumeAccount clears persistent and in-memory halt state" (same file) — not regressed by: `HALT_SOURCE_RECONCILIATION` semantics are unchanged.
- EXTEND 358 `@AC-1` "Reconcile does not flag a held position that sits past the first 500" — new case: the full cursor drain, with per-page identity and filter assertions. This is additive and contradicts no existing Then clause. It is not covered by an operator decision because it is an EXTEND, not a CHANGE, so no sign-off is required.
- EXTEND 358 `@AC-2` "A page error while reading platform positions skips the account for the tick" — new case: the deadline variant and the counted skip. Operator decision 2026-11-17 (skip, never halt) and the r5 gate decision (counted skip).
- EXTEND 358 `@AC-3` "Reconcile treats a repeated next_page_token as a failed read" — new case: the counted `cursor_invalid` skip. Operator decision 2026-11-17 (fails.md:3311: reject a repeated token) and the r5 gate decision.
- EXTEND 358 `@AC-4 @FR-5` (to be appended by `/sdd-spec`) "counted position-side skip" — operator decision 2026-11-17, design gate r6.
- No CHANGE entries.

## Rounds

6 full-mode rounds, all run by /sdd-batch on 2026-11-17. The register grew to D-1..D-24, R-1..R-17 and
O-1..O-24.

- Rounds 1-5 converged the drain helper, the guard order, the test discrimination (positive control,
  per-page deadlines, per-tick logs, identity and filter assertions) and the fixture fixes.
- At the r5 gate, the operator raised the round cap to 6 and required a counted skip.
- Round 6 added the counter (D-21..D-24, R-15..R-17) and closed O-18/O-19. It left two blocking
  objections (O-20 deadline mapping, O-21 FR/@AC trace) and three non-blocking ones (O-22..O-24).

**Termination**: approved. At the r6 gate, the operator approved the design and resolved O-20 and O-21
as binding decisions (§3, §4). The operator also adopted the single `cursor_invalid` label (O-22). This
design adopts O-23 (typed outcome) and O-24 (Canceled → `rpc_error`, documented, pinned by a hardening
row). No reopen petitions were filed. No Floor breaches.
