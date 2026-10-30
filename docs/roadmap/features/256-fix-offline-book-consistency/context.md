# Context Log: fix-offline-book-consistency

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-21 (/sdd-triage)

- Bug recorded as defect report `docs/reports/2026-10-21-offline-book-consistency-defect.md` (Issues disabled).
- Source: repo-surveyor debt-radar scan `docs/repo-surveyor/debt-radar-findings.md` @ 4535695, findings **D-47**, **D-48**,
  **D-49**, **D-63**. All four re-verified on main-dev @ a053b0e and all reproduce in code. None excluded.
- Severity: SEV-2 (group). The surveyor rated D-63 alone lower; it is grouped here because it compounds D-47.
  Impact type: wrong-pnl-reported. Environment: dev (main-dev) @ a053b0e. Config-only: no.
- Operator decisions (2026-10-21): grouped by service+theme from the debt-radar scan; Track C for all SEV-2 (precedent #1264); batch launched via /sdd-batch with designGate halt.
- Routed to SDD path (Track C).
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1..5), context.md; report sidecar `.status` (`triaged`).
- Affected services: xstockstrat-portfolio (D-47, D-48), xstockstrat-trading (D-49, D-63). xstockstrat-ui is possibly
  affected for D-48's error/degraded state on the Book page.
- Root cause hypothesis: feature 240's best-effort choices on paths that no broker poll heals.
  - D-48 directly contradicts a recorded 240 decision: "a `GetOfflineStates` error is non-fatal (WARN, empty map)"
    (`240-offline-account-full-pnl/context.md:399`, `:771`). Design must explicitly supersede it.
  - The finite-value guard covered `fees` only (240 `design.md:67`).
- Line drift (scan @ 4535695 → a053b0e):
  - None for D-47 (`portfolio_service.go:1117`, `:1129`, `:1213-1231`), D-48 (`offline_valuation.go:99-103`) and
    D-49 (`trading.go:894-899`, `:1156-1167`).
  - The `recent_fills` decode is at `portfolio_repo.go:521-523` (cited `:518-520`).
  - The D-63 Warn is at `trading.go:951-954` (cited `:950-954`).
  - `DeleteOfflineRealized` Warn is at `portfolio_service.go:1159-1161`.
  - `deriveOfflineStatus` is at `trading.go:863-871`. Its `default` returns FILLED, which is what lets NaN and +Inf through.
- Overlaps:
  - **240-offline-account-full-pnl** (launched) is the origin of every site. Read its `context.md` (Steps 13–22) and
    `design.md` before design. No live conflict, because 240 is merged.
  - **251-fix-getpnl-source-service** (draft) and **257-fix-ledger-query-pagination** both edit
    `portfolio_service.go` (`GetPnL`, `:722-840`). This feature edits `:1117-1231` and `offline_valuation.go`. Different
    functions in the same file, so check merge-order and rebase.
  - **249-fix-ibkr-request-signing** cites `ConfirmOrder` only in passing. No conflict.
  - **267-fix-trading-order-state-audit** (same 2026-10-21 batch) edits `trading.go` `PlaceOrder`/`CancelOrder`/`ReplaceOrder`
    (`:586-1498`, the `UpsertOrder`/`ReclaimOrphanIntent` discards). This feature edits `ConfirmOrder` (`:888-958`). Same file,
    so rebase only.
  - **264-fix-portfolio-snapshot-surface** edits `portfolio_service.go:893-943` (snapshot writer/broadcast). Same file,
    different functions.
- Design fork for D-47: the fill consumer's "retryable" contract (`portfolio_service.go:171-200`) is an unbounded
  reconnect-from-failed-event with a 2s sleep. It has no bound or park, despite the surveyor's "bounded-retry/park" wording.
  Moving the offline sync consumer onto it as-is would let a poison sync event block the stream forever, so design must
  choose a bound and a park/skip policy (a constant or a config key).
- Recommended design depth: full → `/sdd-design fix-offline-book-consistency` (rationale: 2 affected services, which is the
  C-0 full trigger, plus the reversal of a recorded feature-240 decision and a possible read-contract change for D-48).
- Development branch: feature/fix-offline-book-consistency

## Session 2026-10-21 — sdd-review product-spec

- Product spec approved (criteria: PASS WITH WARNINGS; overlap: WARN, no FAIL, no floor breach). Status: draft → spec-ready.
- OPERATOR DECISIONS (binding, recorded 2026-10-21):
  - Grouped by service+theme from the 2026-10-20 debt-radar scan; Track C.
  - Scope is D-47, D-48, D-49, D-63.
- Warnings (carried to /sdd-design):
  - Criterion 9 (Open Questions): Fix Scope still has an unchecked `- [ ] Proto changes: open` box, backed by OQ-1 and
    OQ-2. Design must resolve both and update the box before the spec gate. If OQ-1 picks a degraded marker, the
    additive `portfolio.proto` change needs the proto approval gate (C-04, `docs/runbooks/proto-versioning.md`).
  - Criterion 8 / FR-4, AC-3: requirement and Then clause are a disjunction (UNAVAILABLE or degraded marker). Design
    tightens AC-3 to the chosen outcome (C-15).
  - Criterion 8 / AC-1, AC-2, AC-6: some Then steps assert stream mechanics (cursor, redelivery). Testable at the
    consumer level; the final state assertions carry the observable outcome. Advisory.
  - Criterion 8 / AC-4: no example for `filled_qty` 0 with an unset price (un-confirm / bare re-confirm, `trading.go:933`).
    FR-5 validates price "on a fill". Design decides whether zero qty skips the price check and adds a non-regression row.
    Today `trading.go:894` checks only `FilledQty < 0` and `:924` never validates the price.
  - AC ordering: @AC-6 (FR-3) appeared before @AC-3. Resolved in this session (scenario moved after @AC-5).
  - Criterion 11 (Agent surface): design confirms whether the agent's error mapping already surfaces UNAVAILABLE and the
    FR-5/FR-6 errors; otherwise agent code and the strat-lab plugin skill change in the same PR.
  - FR-3 / OQ-2: the spec does not say whether the new retry bound also applies to the existing fill consumer
    (`portfolio_service.go:171-200`). Design states this explicitly.
- Overlap findings (all WARN, rebase-only; no config-key, proto field-number or migration collision):
  - `portfolio_service.go`: 264 (`:893-943` snapshot writer/broadcast), 257 (`:749-836` GetPnL), 251 (`:683`),
    242 (`:1004-1018` emitRiskAlert, implementation-ready), 248 (`:185-202`, `:220-221`, implementation-ready).
    This feature edits `:1117`, `:1129`, `:1159`, `:1213-1231`. Different functions.
  - `trading.go`: 267 (draft; `:688`, `:603`/`:1301`/`:1498`; its context.md:27 names the `:863-954` region but excludes
    the ConfirmOrder D-63 emit). Sequence the two trading.go branches. Also 249 (`:87-92`, `:3087`), 241 (`:2168-2176`),
    242 (`:1938-1944`, `:2751-2757`), 251 (`:1861`). Disjoint.
  - `services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx`: 215 (in-progress) and 245
    (implementation-ready). Same file; rebase-only.
  - Low-risk shared context: `traderBff.ts` (263, draft) and 270-fix-ui-trader-feedback (draft, may touch the Book page
    or ConfirmFillDialog). Re-check if design touches the trader BFF or when 270's spec is written.
  - No live peer claims `portfolio.proto` or a `ConfirmOrder` field; any OQ-1 field takes a fresh next-free number,
    re-checked at spec time. Feature 240 (launched) is the trunk code being fixed.
  - Merge-order: no entry required (WARN-level only). Optional soft rows: 256 vs 267 (trading.go ConfirmOrder) and
    256 vs 264/257/251 (portfolio_service.go).
- Next: `/sdd-design fix-offline-book-consistency` (full).

## Session 2026-10-21 — sdd-batch design gate (round 2)

- `/sdd-design fix-offline-book-consistency` (full) is halted at its approval gate after round 2 (gate policy: halt).
  design.md was not written and status.md was not changed (grilling protocol). Severity: SEV-2.

## Open Threads

- **Approach (r2 synthesis):** keep the r1/r2 spine.
  - The only wire change is the additive `Portfolio.offline_state_unavailable = 17`, which needs the proto approval gate.
  - No migration, no config change. `consumeEventStream` (`portfolio_service.go:185-202`, feature 248) and the
    order.filled path are not touched.
  - D-49/FR-5: ConfirmOrder adds `isFinite` guards and returns INVALID_ARGUMENT before GetOrder.
  - D-63/FR-6: add a sibling `appendLedgerEvent` that returns an error, keeping `emitLedgerEvent` as a void wrapper.
    ConfirmOrder returns UNAVAILABLE "re-confirm to retry". Snapshot adds a Warnings line, which reaches its only
    consumer (the agent, via `MessageToDict`).
  - D-47/FR-1..3: the position-sync and deregister handlers return errors. `boundedRetry` parks an event only after
    ≥5 attempts and ≥10 min, and replaces ackAlways.
  - D-48/FR-4: a per-account degraded marker replaces whole-call UNAVAILABLE, so the broker-card @ACs are preserved.
    Position reads map the sentinel to UNAVAILABLE.
- **Strongest open objections (blocking, r3 MUST):**
  1. GetPortfolio consumers are out of scope. `OrderBook.tsx:100-131` renders the aggregate dayPnl/totalPnl, and the
     aggregate (`portfolio_service.go:650-677`) silently drops a degraded account. Fix: set the marker on the aggregate,
     exclude degraded accounts (and their `prior` base) from the sums, gate OrderBook in the UI, and add a mock e2e.
  2. Day P&L under degrade is wrong but looks complete, because it is built without RecentFills
     (`offline_valuation.go:195-205`, `:242-246`). Fix: zero the account and per-position DayPnl/DayPnlPct, exclude
     them from the aggregate and from `sumPortfolioTotals`, and hide the Day P&L rows in the UI.
  3. P-03: `applyAccountPnL` cannot detect "offline + degraded" with its current inputs (st==nil returns at
     `:1360-1362`). Fix: add an explicit `degraded bool` input. Also record the single-account broker side effect
     (`:1405-1416`) and the aggregate's TotalPnlPct-unset outcome.
- **Non-blocking (folded in as SHOULDs, not yet adopted):**
  - try-all writes plus `errors.Join` in the offline position-sync branch;
  - `WithTimeout(WithoutCancel(ctx), recomputeTimeout)` under confirmLock;
  - a read-only NaN/Inf confirmed-row detection query, with remediation by re-confirm;
  - a single "event parked" log line, and the broker-staleness window recorded in the portfolio CLAUDE.md;
  - a proto field comment saying the P&L fields are not meaningful when the marker is set;
  - trade-off wording for UNAVAILABLE on unscoped ListPositions;
  - cite the operator decision and the ledgerEmitTimeout precedent for the retry constants, not F-07.
- **Floor status:** no breaches. The code-constant retry bound is covered by the recorded operator decision; only its
  citation needs fixing.
- **Uncovered @AC changes:** none. All 14 touched business rules are PRESERVE or EXTEND, so no operator sign-off is
  needed.
  - EXTEND: @AC-9, @AC-30, @AC-14 and @AC-15 @feature-240; @AC-14 @feature-163.
  - PRESERVE: @AC-14, @AC-3 and @AC-10 @feature-157; @AC-3 @feature-159; @AC-29 and @AC-43 @feature-240; @AC-7, @AC-8
    and @AC-15 @feature-163.
  - Whole-call UNAVAILABLE (a C-16 CHANGE) stays only as the fallback if the proto field is refused at the gate.
- **Next:** the next `/sdd-batch` run resumes the debate at round 3 from the state below.

```sdd-batch-design-state
{
  "round": 2,
  "synth": {
    "approach": "Round-2 synthesis for 256-fix-offline-book-consistency (D-47, D-48, D-49, D-63). The spine is unchanged from r1/r2. The only wire change is the additive `Portfolio.offline_state_unavailable = 17`. There is no migration and no config change, and nothing touches consumeEventStream (portfolio_service.go:185-202, feature 248's region) or the order.filled path. Items marked [r3 MUST] answer this round's blocking objections and still need the proposer to adopt them concretely.\n\n1. D-49 / FR-5 (trading.go) — as proposed in r2.\n- Add `isFinite`.\n- ConfirmOrder rejects with INVALID_ARGUMENT, before GetOrder (:901):\n  - non-finite or negative `filled_qty`;\n  - non-finite or negative `filled_avg_price` when `filled_qty > 0`.\n- The fees guard (:897) and the snapshot row checks (:1156, :1160) switch to isFinite. Sign rules stay the same.\n- deriveOfflineStatus is unchanged.\n- [r3 SHOULD] Add a read-only verification query to the spec and the dev smoke: count confirmed offline `trading.orders` rows whose filled_qty or filled_avg_price is NaN/Inf. If any exist, remediate by re-confirming them through the RPC before launch. No migration unless rows are found.\n\n2. D-63 / FR-6 (trading.go) — as proposed in r2.\n- Add sibling `appendLedgerEvent(...) error`. It returns the structpb error (:3662) and the AppendEvent error.\n- `emitLedgerEvent` becomes a void wrapper, so its 26 other callers are unchanged.\n- recompute (:1067) returns the error. The payload, including user_id, moves verbatim.\n- ConfirmOrder (:951-954) returns UNAVAILABLE \"positions not published; re-confirm to retry\". No in-lock retry.\n- Duplicates are tolerated (absolute recompute, @AC-10 @feature-157). No idempotency_key.\n- Snapshot uses option (a): append \"positions not published; re-submit to retry\" to Warnings (:1229-1234).\n  - Verified this round: the only Snapshot caller is the agent. `client.py:2280-2327` returns `MessageToDict(resp)`, so `warnings` reaches the tool result. The UI has no Snapshot caller.\n- [r3 SHOULD] Context at both call sites (:951, :1224) is `context.WithTimeout(context.WithoutCancel(ctx), recomputeTimeout)`.\n  - recomputeTimeout is a code constant of the same kind as ledgerEmitTimeout.\n  - This keeps x-trace-id and the request values (operator C-03 rule) and puts a bound back on the recompute queries (:964-978) that run under confirmLock (:918, :1196).\n\n3. D-47 / FR-1..3 (portfolio_service.go)\n- processPositionSync (:1175) and processAccountDeregistered (:1132) return error. Parse failures and a nil payload are acked.\n- The discriminator `sync.RealizedPnl != nil` is evaluated before the loop.\n- [r3 SHOULD, replaces r2's early return] Offline branch:\n  - attempt every UpsertPositionFromSync, then DeletePositionsNotInSync, then UpsertOfflineRealized;\n  - return `errors.Join` of the failures.\n  - This keeps today's best-effort write coverage if the event is parked, and is redelivery-safe (absolute recompute).\n  - Open point: if the deletion reconcile must not run after a failed upsert (it would delete a symbol whose upsert failed), the proposer must state it. The recommended ordering is still 'try all, join'. DeletePositionsNotInSync keys on the sync's symbol set, not on rows written, so a failed upsert never causes a wrong delete.\n- Broker branch: warn-and-continue, as today.\n- processAccountDeregistered returns an error on either delete failure, for all account types. The spec clarifies that broker deregistration retry is in scope.\n- `boundedRetry(name, h, now)` replaces ackAlways (:1117, :1129).\n  - Park when attempts ≥ 5 AND elapsed ≥ 10m. Reset on success or on a new sequence.\n  - On park, log Error once.\n  - [r3 SHOULD] Use one distinct message, `\"event parked\"`, with event_id, sequence, stream_key and consumer.\n  - Cite the operator decision / ledgerEmitTimeout precedent for the constants, not F-07.\n- Recovery is 'restart portfolio once the DB is healthy' (lastSeq=0 replay, :186, :205-209).\n- [r3 SHOULD] Document the post-deploy broker-sync staleness window (≤10 min per persistently failing historical event) in the portfolio CLAUDE.md `ConsumePositionSyncs` row.\n\n4. D-48 / FR-4 (portfolio): per-account marker.\n- Proto and errors:\n  - `bool offline_state_unavailable = 17;` on Portfolio.\n  - [r3 SHOULD] The field comment says: when true, total_pnl / day_pnl / day_pnl_pct are not meaningful for this account and must not be displayed or summed (fails.md:1717).\n  - valueRead returns `(readValuation, error)` with the `ErrOfflineStateUnavailable` sentinel. The no-ids early return (:93-97) stays.\n- [r3 MUST, P-03] New explicit input to applyAccountPnL (:1339):\n  - add a `degraded bool` parameter, true only when the valueRead sentinel fired AND `bal == nil` AND the id is in the offline-candidate set;\n  - when degraded, set `OfflineStateUnavailable=true`, `TotalPnl=0`, `DayPnl=0`, `DayPnlPct=0`, zero every embedded position's `DayPnl`/`DayPnlPct`, and leave the optional realized/fee/TotalPnlPct fields unset;\n  - Equity (= positionsValue at :1349) stays. Verified: `resolveAccountEquity` (trading.go:3154-3165) and `positions/[symbol]/page.tsx:233,:364` read only equity/buyingPower, so they are unaffected.\n  - Record the side effect: in single-account ListPortfolios, a broker account whose GetAccountBalance failed (:1405-1408) becomes an offline candidate (:1414-1416) and can carry the marker during a concurrent state-read failure. Accepted; the marker is only shown in place of P&L, never in place of equity.\n- [r3 MUST] GetPortfolio aggregate (portfolio_service.go:650-677):\n  - If any scoped account is degraded, set the aggregate's `OfflineStateUnavailable=true`.\n  - Exclude degraded accounts' DayPnl/TotalPnl and their `prior` base from the sums.\n  - `allOffline` falls to `default` → false, so TotalPnlPct stays unset. State this explicitly in design.md.\n- Position reads (GetPosition, ListPositions via enrichPositions :445, :688, :709):\n  - map the sentinel to UNAVAILABLE at portfolio_handler.go:84 and :416;\n  - also add the `errors.Is` mapping at :60 and :432.\n  - [r3 SHOULD] The design.md justification is that per-position DayPnl depends on RecentFills (offline_valuation.go:195-205, :242-246), not 'positions stay mark-valued'. Record that an unscoped ListPositions failure hides broker rows (positions/page.tsx:506) as a trade-off with no covering @AC.\n- Record in 256 context.md that this supersedes 240's non-fatal decision (240 context.md:399).\n\n5. Consumer surfaces\n- [r3 MUST, C-10(b)/C-14] UI:\n  - `OrderBook.tsx:100-131` (GetPortfolio via usePortfolio): when `data.offlineStateUnavailable`, render Day P&L and Total P&L as \"unavailable/incomplete\" and not as numbers.\n  - `PortfolioPanel.tsx`: the offline card (:76/:94) shows a CardNotice and hides the realized/total (:38, :45) and Day P&L (:102) rows.\n  - `portfolioTotals.ts` sumPortfolioTotals (:31-52): return `incomplete` when any portfolio carries the marker, covering both totalPnl and dayPnl (:48). The combined panel (:155) renders it.\n  - The Book page offline card and `portfolio/page.tsx:207` get the same Day P&L treatment.\n  - `useConfirmOrder.ts:13-14`: invalidate `['orders']` and `['order', id]` on settle. If useInvalidatingMutation cannot forward onSettled, record a UX gap and do not refactor the helper.\n  - `positions/[symbol]/page.tsx`: no change (it reads equity/buyingPower only).\n- Agent: no code change. It does not call Get/ListPortfolios. `_grpc_error_message` (tools.py:223-240) passes the codes through, and the Snapshot warnings pass through MessageToDict.\n- Tests:\n  - Playwright mock-backend: degraded GetPortfolio (OrderBook), degraded ListPortfolios (panel plus totals incomplete), UNAVAILABLE ListPositions, ConfirmOrder error.\n  - vitest: `portfolioTotals.test.ts` incomplete case.\n  - Agent `test_offline_client.py`: UNAVAILABLE and INVALID_ARGUMENT.\n  - Go:\n    - boundedRetry unit test with a fake clock;\n    - cursor test (portfolio_fill_errors_test.go:142);\n    - applyAccountPnL degraded test asserting DayPnl/TotalPnl are zeroed and optional fields are nil;\n    - aggregate-exclusion test;\n    - sweep the tests that depend on non-fatal state reads (portfolio_quote_deadline_test.go:115).",
    "open_objections": [
      {
        "text": "[C-10(b)/C-14, FR-4] GetPortfolio consumers are missing from scope. OrderBook.tsx:100 reads usePortfolio and renders data.dayPnl and data.totalPnl as numbers (:105, :128, :131). The aggregate sums each account's DayPnl and TotalPnl (portfolio_service.go:655-656), so a degraded offline account silently drops out of a total that looks complete. The proposal must:\n- add OrderBook to the UI steps, gated on offlineStateUnavailable;\n- specify the aggregate behavior: set the marker, and exclude degraded accounts from the dayPnl/totalPnl/prior sums;\n- add a degraded-GetPortfolio mock e2e.\nVerified this round: positions/[symbol]/page.tsx reads only equity and buyingPower (:233, :364), so it is out of scope.",
        "blocking": true
      },
      {
        "text": "[FR-4] Day P&L is still wrong but looks complete under degrade. With an empty states map, valueOffline builds the account dayPnl and per-position DayPnl without RecentFills (offline_valuation.go:195-205, :242-246). Symbols traded today are valued as if held all session, and sold-out symbols vanish. r2 clears only TotalPnl and the optional fields. The proposal must:\n- zero the account DayPnl/DayPnlPct and the embedded positions' DayPnl/DayPnlPct under degraded;\n- exclude them from the aggregate and from sumPortfolioTotals (portfolioTotals.ts:48);\n- hide the Day P&L rows in the UI (PortfolioPanel.tsx:102, portfolio/page.tsx:207).\nr2's own Assumption contradicts its applyAccountPnL plan.",
        "blocking": true
      },
      {
        "text": "[P-03] applyAccountPnL cannot detect 'offline + degraded' with its current inputs: with st==nil it returns at :1360-1362 with the unrealized-only TotalPnl, which is the D-48 figure. The design must name the new explicit input: a `degraded bool` set when the sentinel fired, bal==nil, and the id is an offline candidate. It must also record:\n- the side effect for a single-account ListPortfolios broker account whose GetAccountBalance failed (:1405-1416);\n- the aggregate's allOffline/TotalPnlPct outcome (:650-677): default branch → allOffline=false → TotalPnlPct unset.",
        "blocking": true
      },
      {
        "text": "[FR-1, 'preserve as much as you can'] If a persistently failing event is parked, the early return in processPositionSync's offline branch is worse than today: it skips DeletePositionsNotInSync and UpsertOfflineRealized, so the realized row is never written. Adopt the try-all pattern: attempt every write and return errors.Join. Redelivery is safe because the recompute is absolute (@AC-10 @feature-157).",
        "blocking": false
      },
      {
        "text": "[C-03 + fails.md:2028] context.WithoutCancel at :951 and :1224 removes the only deadline on the recompute queries (:964-978) that run under confirmLock (:918, :1196). Use context.WithTimeout(context.WithoutCancel(ctx), recomputeTimeout) instead. It still carries x-trace-id, per the operator rule.",
        "blocking": false
      },
      {
        "text": "[D-49 residue] FR-5 guards only new input. Confirmed offline rows that already hold NaN or Inf are folded into every later recompute (offlineFillsFromOrders :995-998). Add a read-only detection query to verification and the dev smoke, and decide the remediation (re-confirm via the RPC) before launch.",
        "blocking": false
      },
      {
        "text": "[FR-3 ops] Every restart replays from seq 0, so each persistently failing historical event stalls the shared account.positions.synced stream for at least 10 min per deploy, amid about 300 'stream error, retrying' lines (:197-199). Make the park log a single distinct 'event parked' message (event_id, sequence, stream_key, consumer). Document the post-deploy broker-staleness window in the portfolio CLAUDE.md ConsumePositionSyncs row.",
        "blocking": false
      },
      {
        "text": "[C-18/fails.md:1717] total_pnl/day_pnl are non-optional doubles, so a zeroed value cannot be told apart from a real $0. Add a proto comment on offline_state_unavailable = 17: when true, total_pnl, day_pnl and day_pnl_pct are not meaningful and must not be displayed or summed. A bool is sufficient; a reason enum is YAGNI.",
        "blocking": false
      },
      {
        "text": "[C-16 trade-off wording] An unscoped ListPositions UNAVAILABLE hides broker rows (positions/page.tsx:506). design.md must justify it by the RecentFills dependency of per-position DayPnl (offline_valuation.go:242), not by 'positions stay mark-valued', and record that no @AC covers this case.",
        "blocking": false
      },
      {
        "text": "[Floor citation hygiene] The retryMinAttempts/retryParkAfter constants should cite the recorded operator decision and the ledgerEmitTimeout precedent (trading.go:3657), not F-07 as support.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "@AC-14 @feature-157",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-3 @feature-157",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-3 @feature-159",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-10 @feature-157",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-29 @feature-240",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-9 @feature-240",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-30 @feature-240",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-14 @feature-240",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-15 @feature-240",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-7 @feature-163",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-43 @feature-240",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-8 @feature-163",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-15 @feature-163",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-14 @feature-163",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Whole-call UNAVAILABLE on all-accounts ListPortfolios/GetPortfolio with operator sign-off for a C-16 CHANGE (r1 approach, r2 runner-up). It hides every broker card on any offline-state fault and breaks @AC-14/@AC-3 @feature-157 and @AC-3 @feature-159, which contradicts 'preserve as much as you can'. Kept only as the fallback if the proto field is refused at the approval gate.",
      "Presence-only marker (absent realized_pnl). It is ambiguous: a brand-new offline account with no state row already renders with realized_pnl unset (offline_valuation.go:34-39, PortfolioPanel.tsx:38).",
      "Omitting degraded offline accounts from all-accounts ListPortfolios. The combined total would look complete, violating @AC-30 @feature-240 and FR-4.",
      "Recomputing DayPnl without fills and keeping position reads successful. The values are wrong, and Position has no marker slot, so UNAVAILABLE for position reads stands.",
      "Per-account decode of recent_fills in GetOfflineStates (portfolio_repo.go:522). It does not help transient DB failures, the main D-48 trigger. YAGNI now; revisit if degrades show up in logs.",
      "A pure count retry bound (about 20 s at the 2 s sleep). It parks during ordinary DB failovers and recreates D-47.",
      "Parking only on deterministic errors and retrying transient ones without limit. pgx error classification is fragile; the count AND time bound plus the absolute recompute suffices.",
      "A retry bound inside consumeEventStream. It edits feature 248's :185-202 region and pulls order.filled into scope.",
      "Changing emitLedgerEvent's signature. It has 26 callers (fails.md:2092); the sibling appendLedgerEvent plus a void wrapper wins.",
      "An in-lock emit retry in ConfirmOrder. It raises confirmLock reentrancy (fails.md:2028) and duplicate-append issues.",
      "Early return on the first offline UpsertPositionFromSync error. Worse than today if the event is parked; try-all plus errors.Join is preferred.",
      "Bare context.WithoutCancel for the recompute. It leaves the queries under confirmLock unbounded; wrap it in WithTimeout.",
      "A reason enum for the degraded marker. Only one reason exists (YAGNI, C-04); a bool plus a field comment is enough.",
      "A combined 'finite and non-negative' helper. Snapshot qty legitimately accepts 0 and negative values (@AC-8/@AC-15 @feature-163)."
    ],
    "open_risks": [
      "The proto field adds a proto approval gate, codegen and UI work across OrderBook, PortfolioPanel, portfolioTotals, the Book card and the portfolio page. That is more rework than r1, accepted as the price of preserving the broker-card @ACs.",
      "Latent consumers: any future Portfolio reader that ignores offline_state_unavailable reads the zeroed TotalPnl/DayPnl as real $0. Mitigated only by the proto field comment; today the agent does not call these RPCs.",
      "Replay amplification: every restart replays from seq 0 (:186, :205-209), so each persistently failing historical event stalls account.positions.synced, broker syncs included, for at least 10 min per deploy.",
      "Same-stream head-of-line blocking: broker syncs wait up to 10 min behind a failing offline sync. order.filled is unaffected.",
      "Unscoped ListPositions UNAVAILABLE hides broker rows on the positions page during an offline-state fault. No @AC covers it; it is a recorded trade-off.",
      "A corrupt recent_fills row (portfolio_repo.go:522) marks every offline account of that user as degraded until the next confirm or snapshot rewrites it. Retry does not heal it.",
      "Offline REDUCE_ONLY/flatten/reconcile paths in trading (trading.go:2089, :2793, :3535) fail closed while GetOfflineStates fails. This is safety-correct but user-visible.",
      "Pre-existing NaN/Inf confirmed rows, if any, keep emitting NaN positions until they are re-confirmed.",
      "Parks are visible only as an Error log, with no metric or alert.",
      "The sweep of tests that relied on non-fatal state reads (e.g. portfolio_quote_deadline_test.go:115) may be larger than estimated.",
      "Single-account ListPortfolios on a broker account whose GetAccountBalance failed can carry the marker during a concurrent state-read failure (:1405-1416). Cosmetic, but it must be recorded.",
      "If useInvalidatingMutation cannot forward onSettled, the orders list stays stale after an FR-6 UNAVAILABLE (a known UX gap)."
    ],
    "constitution_rules_touched": [
      "C-03",
      "C-04",
      "C-09",
      "C-10",
      "C-11",
      "C-14",
      "C-15",
      "C-16",
      "C-18",
      "F-07",
      "P-02",
      "P-03"
    ],
    "rationale": "I checked the adversary's r2 claims against the worktree.\n\nConfirmed:\n- The GetPortfolio aggregate sums each account's DayPnl and TotalPnl (portfolio_service.go:655-656). OrderBook.tsx:100-131 renders data.dayPnl and data.totalPnl directly. Blocking objection 1 stands.\n- valueOffline computes account and position Day P&L from states[id].RecentFills (offline_valuation.go:195-205, :242-246), which an empty states map silently drops. Blocking objection 2 stands.\n- applyAccountPnL returns early when st==nil (:1360-1362), so r2's 'offline under degraded' branch has no input that can trigger it. Blocking objection 3 (P-03) stands.\n\nResolved or narrowed by evidence:\n- positions/[symbol]/page.tsx uses only portfolio.equity and buyingPower (:233, :364). Both stay intact under degrade, so that page drops out of objection 1.\n- The Snapshot Warnings line reaches its only consumer: the agent client returns MessageToDict(resp) (client.py:2280-2327), and the UI has no Snapshot caller. The r1 objection on that and adversary objection 7 are therefore closed.\n\nStatus of r1 objections:\n- r2 concretely answered all the r1 objections: the C-16 CHANGE is avoided through the per-account marker, so the business rules are reclassified as PRESERVE/EXTEND with no operator sign-off needed. It also adopted the time-and-count bound, the recovery path, the FR-1 ordering, broker deregistration scope, the test design, on-settle invalidation, C-18 duplicates, the C-03 context, and the caller enumeration.\n- Those objections are therefore not carried forward.\n\nHow the user's directive shaped the synthesis:\n- 'Preserve as much as you can while having low rework' favors r2's per-account marker over whole-call UNAVAILABLE. It preserves the broker-card @ACs at a bounded cost: one additive field.\n- The remaining blockers are all closed by small, local edits inside that same design:\n  - a degraded parameter;\n  - zeroing and excluding Day/Total in the aggregate;\n  - OrderBook gating.\n- No new architecture is needed.\n- I folded the adversary's cheap non-blocking fixes into the approach as recommendations:\n  - try-all plus errors.Join;\n  - WithTimeout around WithoutCancel;\n  - the NaN-row detection query;\n  - the 'event parked' log;\n  - the proto comment.\n- I kept them listed as open because r2 has not yet adopted them.\n\nNo Floor breach: the code-constant retry bound is covered by the recorded operator decision, and only its citation needs fixing."
  },
  "floor_breaches": []
}
```

## Session 2026-10-22 — sdd-batch design gate (round 3)

- `/sdd-design fix-offline-book-consistency` (full) is halted at its approval gate after round 3 (gate policy: halt).
  design.md was not written and status.md was not changed (grilling protocol). Severity: SEV-2.

## Open Threads

- **Approach (r3 synthesis):** r3 adopted every r2 [r3 MUST] and SHOULD item, so the r2 objections are closed. The
  spine is unchanged: no migration, no config change, and nothing in `consumeEventStream`
  (`portfolio_service.go:185-202`, feature 248) or on the order.filled path. The wire changes are additive.
  - D-49/FR-5: accepted as in r3 (`isFinite` guards, INVALID_ARGUMENT before GetOrder, NaN/Inf detection query).
  - D-63/FR-6: accepted as in r3 (sibling `appendLedgerEvent`, ConfirmOrder UNAVAILABLE, Snapshot Warnings line,
    `WithTimeout(WithoutCancel(ctx), recomputeTimeout)`).
  - D-47/FR-1..3: try-all plus `errors.Join`, `boundedRetry` replaces ackAlways, and a single "event parked" log.
    [r4 MUST] the park rule becomes error-class-aware (see objection 3).
  - D-48/FR-4: `Portfolio.offline_state_unavailable = 17` with the aggregate exclusion as in r3. [r4 MUST] decode
    per account in `GetOfflineStates`, exposing `readValuation.unavailable map[string]bool`. [r4 MUST] position
    reads never fail: add an additive `Position.offline_state_unavailable = 26` and drop the UNAVAILABLE mapping
    at `portfolio_handler.go:60/:84/:416/:432`.
  - Consumers: the r3 UI gating stays (CardNotice `variant="muted"` is verified at `CardNotice.tsx:10`). [r4 MUST]
    the positions surfaces show `PNL_UNAVAILABLE_LABEL` when the Position marker is set. Agent: no code change.
- **Strongest open objections (blocking, r4 MUST):**
  1. [C-16 @AC-14/@AC-3 @feature-157, C-10(b), fails.md:39] r3 maps the sentinel to UNAVAILABLE on
     GetPosition/ListPositions. An offline-state fault on an unscoped ListPositions therefore hides every broker row
     (`positions/page.tsx:506`) and breaks trading REDUCE_ONLY (`trading.go:3535`) even though Qty is valid. Fix:
     keep position reads successful, zero DayPnl/DayPnlPct only on the degraded offline positions, add
     `Position.offline_state_unavailable = 26`, and gate the positions UI on it. The field cannot be 20, because
     tag 20 is stop_order_id and the highest tag is mark_as_of = 25.
  2. [C-10(b)/C-18] `GetOfflineStates` fails the whole batch on one undecodable recent_fills row. A corrupt row
     persists, so every offline account of that user is marked degraded until the row is rewritten. Inferring the
     state from the `bal == nil` proxy also causes r3's two broker side effects (`:1405-1416`, `:598-626`). Fix:
     decode per account, treating an Unmarshal failure as a per-id failure and a Query/Scan/rows.Err failure as
     whole-call. Callers look up `rv.unavailable[acctID]`.
  3. [FR-2/FR-3] The error-blind park rule (≥5 attempts AND ≥10 min) drops events, account.deregistered included,
     during any DB outage longer than 10 min. It also stalls the shared stream for ≥10 min on deterministic poison.
     Fix: an SQLSTATE class 22/23 error parks after 5 attempts. Transient errors (connection, deadline,
     08/40/53/57) never park. Unclassified errors keep the r3 bound. Document the lastSeq=0 boot replay
     (`:186`, `:205-209`) as the self-heal in design.md and the portfolio CLAUDE.md row.
- **Non-blocking (r4 SHOULD):**
  - one bounded `codes.Unavailable` retry with a per-emit idempotency_key inside `appendLedgerEvent`, held under the
    existing confirmLock and never re-taking it (fails.md:2028, :2092);
  - state the `recomputeTimeout > ledgerEmitTimeout (10s) + query budget (+ retry budget)` invariant and test it;
  - enumerate trading's portfolio callers (`trading.go:2089`, `:2793`, `:3158`, `:3535`) in the spec;
  - broker deregistration retry: either record it in 256 context.md as a scope extension or keep it warn-only behind
    an offline-set check;
  - make a numbered spec step that greps the usePortfolio/usePortfolios/Position.dayPnl consumers, with a
    Playwright assertion per gated surface (C-14).
- **Floor status:** no breaches. The code-constant bounds are covered by the recorded operator decision and the
  ledgerEmitTimeout precedent. Both proto fields (Portfolio 17, Position 26) go through the C-04/C-09 gate.
- **Uncovered @AC changes:** none, provided the position-read fix lands. All 14 touched business rules are PRESERVE
  or EXTEND, so no operator sign-off is needed. Without that fix, @AC-14/@AC-3 @feature-157 would become a de facto
  CHANGE that no operator decision covers.
  - EXTEND: @AC-9, @AC-30, @AC-14 and @AC-15 @feature-240; @AC-14 @feature-163.
  - PRESERVE: @AC-14, @AC-3 and @AC-10 @feature-157; @AC-3 @feature-159; @AC-29 and @AC-43 @feature-240; @AC-7, @AC-8
    and @AC-15 @feature-163.
  - Whole-call UNAVAILABLE stays only as the fallback if the proto gate refuses field 17 or 26.
- **Next:** the next `/sdd-batch` run resumes the debate at round 4 from the state below.

```sdd-batch-design-state
{
  "round": 3,
  "synth": {
    "approach": "Round-3 synthesis for 256-fix-offline-book-consistency (D-47, D-48, D-49, D-63). r3 adopted every r2 [r3 MUST] item and every SHOULD item concretely, so the r2 open objections are closed. Three new blocking objections stand after I checked them against the worktree. The base is unchanged: no migration, no config change, nothing in consumeEventStream (portfolio_service.go:185-202, feature 248) and nothing on the order.filled path. The wire changes are additive. Items marked [r4 MUST] answer this round's blocking objections and still need the proposer to adopt them.\n\n1. D-49 / FR-5 (trading.go): accepted as in r3.\n- Add `isFinite`.\n- ConfirmOrder returns INVALID_ARGUMENT before GetOrder (:901) for:\n  - a non-finite or negative filled_qty;\n  - a non-finite or negative filled_avg_price when filled_qty > 0.\n- The fees guard (:897) and the snapshot checks (:1156, :1160) switch to isFinite. Sign rules do not change.\n- The read-only NaN/Inf detection query goes in verification and the dev smoke. Any rows found are re-confirmed through the RPC before launch.\n\n2. D-63 / FR-6 (trading.go): accepted as in r3.\n- Add sibling `appendLedgerEvent(...) error`; `emitLedgerEvent` (:3661) becomes its void wrapper, so its other 26 callers are untouched.\n- The recompute emit (:1067) moves its payload verbatim, user_id included.\n- ConfirmOrder (:951-954) returns UNAVAILABLE \"positions not published; re-confirm to retry\".\n- Snapshot (:1224) appends a line to Warnings.\n- Both recompute call sites use `context.WithTimeout(context.WithoutCancel(ctx), recomputeTimeout)`.\n- [r4 SHOULD] State the value of recomputeTimeout and the rule it must satisfy: recomputeTimeout > ledgerEmitTimeout (10s, :3663) + the baseline/orders query budget, plus any retry budget. Add a test that checks the rule.\n- [r4 SHOULD] Inside appendLedgerEvent only: one bounded retry on codes.Unavailable with a per-emit idempotency_key (ledger.proto:50, AppendEventRequest field 8), matching portfolio's emitEvent precedent.\n  - The retry runs inside the caller's already-held confirmLock and never re-takes it (fails.md:2028).\n  - The other 26 callers are unchanged (fails.md:2092).\n- Add a test asserting user_id is in the appendLedgerEvent payload (fails.md:2054).\n\n3. D-47 / FR-1..3 (portfolio_service.go).\n- Kept from r3:\n  - try-all writes with errors.Join on the offline branch;\n  - broker branch is warn-and-continue;\n  - parse failures and a nil payload are acked;\n  - processAccountDeregistered (:1132) returns error;\n  - `boundedRetry` replaces ackAlways (:176, :1117, :1129);\n  - a single \"event parked\" Error log with event_id, sequence, stream_key and consumer.\n- [r4 MUST] Make the park rule error-class-aware.\n  - The current rule (attempts ≥ 5 AND elapsed ≥ 10m, regardless of error) drops events during any DB outage longer than 10 min. That includes account.deregistered, which is the orphan FR-2 exists to prevent.\n  - It also stalls the shared stream for ≥10 min on a deterministic poison event.\n  - Proposed classification via `errors.As(err, *pgconn.PgError)`:\n    - Deterministic, SQLSTATE class 22 (data exception) or 23 (integrity violation): park after retryMinAttempts (5), with no elapsed floor.\n    - Transient (connection/network errors, context deadline, SQLSTATE classes 08/40/53/57): never park; retry as order.filled does today.\n    - Unclassified: fall back to the r3 count AND time bound (5 attempts and 10m).\n  - Why this answers the r2 \"classification is fragile\" concern:\n    - A misclassified transient error only lands in the bounded fallback, never in a fast park.\n    - A transient outage blocks every write anyway, so head-of-line blocking costs nothing during it.\n- [r4 MUST] Record in design.md and in the portfolio CLAUDE.md ConsumePositionSyncs row that lastSeq starts at 0 on every boot (:186, :205-209), so the next deploy replays and self-heals a parked event. This is the documented recovery path.\n- Deregistration scope: the account.deregistered payload carries no account type (:1132-1160), so the retry cannot be limited to offline accounts without a new lookup.\n  - Record the broker-deregistration retry as an explicit scope extension in 256 context.md.\n  - Alternatively, keep broker deregistration warn-only by checking the offline-account set first. The proposer must pick one.\n\n4. D-48 / FR-4 (portfolio).\n- [r4 MUST, replaces the bal==nil proxy, C-18 / C-10(b)] Decode per account.\n  - `GetOfflineStates` (portfolio_repo.go:~500-530) now returns the whole error on any single undecodable recent_fills row (verified at the `decode recent fills for %s` return).\n  - Change it to return `(map[string]OfflineState, map[string]error /*failed*/, error)`:\n    - a Query, Scan or rows.Err failure stays a whole-call error;\n    - a json.Unmarshal failure records failed[id] and continues.\n  - `valueRead` exposes `readValuation.unavailable map[string]bool`. A whole-call error marks every requested offline id; a per-row failure marks only that id.\n  - Callers look up `degraded := rv.unavailable[acctID]` instead of inferring it from `bal == nil`.\n  - Effects:\n    - a poison row degrades only its own account;\n    - r3's two accepted side effects (broker accounts with a failed balance read getting marked, :1405-1416, :598-626) disappear, because only ids passed to GetOfflineStates can be marked.\n  - The ErrOfflineStateUnavailable sentinel is kept for logging and tests. Reads no longer fail on it (see next item).\n- applyAccountPnL (:1339): r3's degraded handling is kept as is:\n  - set Portfolio.offline_state_unavailable = 17;\n  - zero TotalPnl, DayPnl and DayPnlPct, and the DayPnl/DayPnlPct of embedded positions;\n  - leave the optional realized and fee fields and TotalPnlPct nil;\n  - keep Equity = positionsValue.\n  - Only the source of `degraded` changes, to the per-account lookup above.\n- The GetPortfolio aggregate (:651-677) is kept as in r3: set the marker, exclude the degraded account from the dayPnl/totalPnl/prior/absCost sums, force allOffline = false, and still sum Equity.\n- [r4 MUST, C-16 @AC-14/@AC-3 @feature-157, C-10(b) read-path parity, fails.md:39] Position reads never fail on offline-state unavailability.\n  - enrichPositions (:445), GetPosition (:688) and ListPositions (:709) keep succeeding.\n  - For each offline position whose account is in rv.unavailable:\n    - zero DayPnl and DayPnlPct;\n    - set a new additive `bool offline_state_unavailable = 26;` on Position, carrying the same field comment as Portfolio field 17.\n  - Tag correction: the adversary's suggested tag 20 is taken by stop_order_id. Position's highest tag is mark_as_of = 25 and the message has no `reserved` statement, so 26 is the next free tag.\n  - Drop the UNAVAILABLE mapping at portfolio_handler.go:60, :84, :416 and :432.\n  - Benefits:\n    - broker rows stay visible on positions/page.tsx:506;\n    - trading's GetPosition callers are unaffected, because Qty and marks are valid;\n    - the asymmetry between the account reads and the position reads disappears.\n  - The runner-up fallback (whole-call UNAVAILABLE) applies only if the proto gate refuses fields 17/26.\n- 256 context.md records that this supersedes 240's non-fatal decision (240 context.md:399).\n\n5. Consumer surfaces (UI and agent).\n- UI as in r3:\n  - OrderBook.tsx:100-131 is gated on offlineStateUnavailable;\n  - portfolioTotals.ts gets `incomplete`, `PNL_UNAVAILABLE_LABEL`, and per-account gating in PortfolioPanel and portfolio/page.tsx;\n  - CardNotice uses `variant=\"muted\"`. Verified: CardNotice.tsx:10 is `'muted' | 'error'`, which settles r3's open assumption.\n- [r4 MUST] Positions surfaces: positions/page.tsx and any per-position Day P&L cell show PNL_UNAVAILABLE_LABEL when `position.offlineStateUnavailable` is set.\n- [r4 SHOULD, spec step] Grep every consumer of usePortfolio / usePortfolios / Position.dayPnl as a numbered spec step, with a Playwright assertion for each gated surface.\n- Trading callers: list them in the spec (trading.go:2089, :2793, :3158, :3535) per fails.md:2935.\n  - With position reads non-failing they need no change. :3535 REDUCE_ONLY reads only Qty.\n  - :3158 resolveAccountEquity reads only equity and buyingPower.\n- Agent: no code change.\n- Tests:\n  - r3's list;\n  - plus per-row decode failure marks only that account;\n  - plus ListPositions returns OK with the Position marker and zeroed DayPnl for a degraded offline account while broker rows are intact;\n  - plus park-classification table tests (class 22/23 parks after 5 attempts; a connection or deadline error never parks; an unknown error uses the fallback bound) with a fake clock;\n  - plus the recomputeTimeout invariant test.\n  - Remove the planned UNAVAILABLE ListPositions/GetPosition mapping tests and Playwright case; replace them with the marker case.",
    "open_objections": [
      {
        "text": "[C-16 @AC-14/@AC-3 @feature-157, C-10(b) read-path parity, fails.md:39] r3 still maps ErrOfflineStateUnavailable to UNAVAILABLE on GetPosition/ListPositions (portfolio_handler.go:60/:84/:416/:432). So an offline-state fault on an unscoped ListPositions hides every broker row (positions/page.tsx:506). r3 said no @AC covers this; AC-14 does: offline state must not affect what broker accounts show. Only the offline positions' DayPnl is corrupted (offline_valuation.go:242-246). The proposal must:\n- keep position reads successful;\n- zero DayPnl/DayPnlPct only on the degraded offline positions;\n- add an additive `Position.offline_state_unavailable = 26`. Not 20: tag 20 is stop_order_id, and the highest tag is mark_as_of = 25. It goes through the same C-04/C-09 gate as field 17;\n- gate the positions UI on it.\nThis also resolves the trading-caller impact at trading.go:3535/:2793/:2089.",
        "blocking": true
      },
      {
        "text": "[C-10(b) blast radius / C-18] Verified that GetOfflineStates (portfolio_repo.go, `decode recent fills for %s` return inside the rows loop) fails the whole batch on a single undecodable recent_fills row. A corrupt row is persistent, so `degraded := errors.Is(...) && bal == nil` marks every offline account of that user until the row is rewritten. The bal==nil proxy also produces r3's two accepted broker side effects (:1405-1416, :598-626). The proposal must:\n- decode per account: a Query, Scan or rows.Err failure stays whole-call; an Unmarshal failure goes into a failed-ids set;\n- expose `readValuation.unavailable map[string]bool`;\n- have callers look up the account instead of inferring degraded from bal==nil.\nThis reverses the r2 YAGNI rejection, because the persistence argument and the C-18 proxy problem are new evidence.",
        "blocking": true
      },
      {
        "text": "[FR-2/FR-3 correctness] The park rule (≥5 attempts AND ≥10m elapsed, regardless of error) drops events during any DB outage longer than 10 min, account.deregistered included, which is the orphan FR-2 prevents. It also stalls the shared account.positions.synced stream for every user for ≥10 min on a deterministic poison event (:188-199, ~300 retries). The proposal must classify errors:\n- pgconn SQLSTATE class 22/23: park after 5 attempts, with no elapsed floor;\n- transient (connection, deadline, 08/40/53/57): never park;\n- unclassified: keep the r3 bound as the fallback.\nIt must also document the lastSeq=0 boot replay (:186, :205-209) as the self-heal for parked events in design.md and in the portfolio CLAUDE.md row.",
        "blocking": true
      },
      {
        "text": "[FR-6 robustness] appendLedgerEvent has no retry, so a ledger deploy GOAWAY fails ConfirmOrder after UpsertOrder has committed. Advised fix: one bounded retry on codes.Unavailable with a per-emit idempotency_key (ledger.proto:50), inside the already-held confirmLock and never re-taking it (fails.md:2028), applied only in the sibling helper (fails.md:2092).",
        "blocking": false
      },
      {
        "text": "[FR-6 deadline] The value of recomputeTimeout is not given. State recomputeTimeout > ledgerEmitTimeout (10s, trading.go:3663) + the baseline/orders query budget (+ any retry budget) and test it. Otherwise the emit deadline is silently truncated.",
        "blocking": false
      },
      {
        "text": "[fails.md:2935] Enumerate trading's portfolio callers in the spec (trading.go:2089, :2793, :3158, :3535) with their expected behaviour under degrade. If position reads stay successful, record each one as unaffected: :3535 reads Qty only, :3158 reads equity/buyingPower only.",
        "blocking": false
      },
      {
        "text": "[Trading-Domain Scope] Making broker deregistration return errors extends the scope. The product spec says broker sync consumers are unchanged, and the account.deregistered payload carries no account type (portfolio_service.go:1132-1160). Either record the extension in 256 context.md, or keep broker deregistration warn-only by checking the offline-account set first.",
        "blocking": false
      },
      {
        "text": "[C-14] Make the grep of usePortfolio/usePortfolios/Position.dayPnl consumers a numbered spec step, with a Playwright assertion per gated surface. Without it, an unenumerated consumer renders the zeroed P&L as a real $0.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "@AC-14 @feature-157",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-3 @feature-157",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-3 @feature-159",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-10 @feature-157",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-29 @feature-240",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-9 @feature-240",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-30 @feature-240",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-14 @feature-240",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-15 @feature-240",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-7 @feature-163",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-43 @feature-240",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-8 @feature-163",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-15 @feature-163",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-14 @feature-163",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "UNAVAILABLE on GetPosition/ListPositions under an offline-state fault (r1-r3). Lost because it hides broker rows on an unscoped ListPositions, breaks @AC-14/@AC-3 @feature-157, and creates an account-vs-position read-path asymmetry (fails.md:39). It also fails trading REDUCE_ONLY (trading.go:3535) even though Qty is valid. Replaced by the Position.offline_state_unavailable = 26 marker.",
      "Position marker at tag 20 (adversary's suggestion). Lost because tag 20 is already stop_order_id. Position's highest tag is mark_as_of = 25, so 26 is next.",
      "Inferring degraded from `errors.Is(valErr, sentinel) && bal == nil` at each caller (r3). Lost on C-18 grounds: one concept spread across three sites, which also produced two accepted broker side effects (:1405-1416, :598-626). Replaced by readValuation.unavailable[acctID].",
      "Whole-batch failure on one undecodable recent_fills row (status quo; r2 YAGNI rejection). Lost because a corrupt row is persistent and degrades every offline account of the user. Per-row decode with a failed-ids set is a small, local change.",
      "Error-blind park rule, attempts ≥ 5 AND elapsed ≥ 10m (r3). Lost because it drops events during any outage over 10 min (FR-2 orphan) and imposes a 10-min global stall on deterministic poison. Replaced by an SQLSTATE-class-aware park with the r3 bound kept only for unclassified errors.",
      "Parking only on deterministic errors and retrying everything else without limit (adversary's pure form). Lost to the variant that keeps the r3 count AND time bound as the fallback for unclassified errors, so a misclassification never parks an event fast and never stalls forever.",
      "Per-account / per-stream_key park with a later sweep. Lost because it is new durable state outside an in-memory wrapper (YAGNI).",
      "Transactional outbox for account.positions.synced. It fixes D-63 at the root but needs a migration and a relay worker, which is outside the Fix Scope ('no migrations'). Record it in design.md as the long-term option.",
      "Whole-call UNAVAILABLE on every read with operator C-16 CHANGE sign-off. Lost because it hides broker cards; kept only as the fallback if the proto gate refuses fields 17/26.",
      "Presence-only marker (absent realized_pnl). Lost because it is ambiguous with a brand-new offline account that has no state row.",
      "Omitting degraded offline accounts from all-accounts ListPortfolios. Lost because the combined total looks complete, which violates @AC-30 @feature-240.",
      "Retry bound inside consumeEventStream. Lost because it edits feature 248's :185-202 region and pulls order.filled into scope.",
      "Changing emitLedgerEvent's signature. Lost because it has 26 callers (fails.md:2092); the sibling appendLedgerEvent wins.",
      "Re-taking confirmLock for an emit retry. Lost because the lock is non-reentrant (fails.md:2028). Any retry stays inside the helper under the already-held lock.",
      "Early return on the first offline upsert error. Lost to try-all plus errors.Join.",
      "Bare context.WithoutCancel for the recompute. Lost because the queries under confirmLock are unbounded; it is wrapped in WithTimeout.",
      "A reason enum for the marker. Lost on YAGNI (C-04); a bool plus a field comment is enough.",
      "A combined 'finite and non-negative' helper. Lost because Snapshot qty legitimately accepts 0 and negative values (@AC-8/@AC-15 @feature-163)."
    ],
    "open_risks": [
      "Two additive proto fields (Portfolio 17, Position 26) now go through the C-04/C-09 approval gate. If either is refused, the fallback is whole-call UNAVAILABLE, which loses the broker-card @AC preservation.",
      "Latent consumers: any Portfolio or Position reader that ignores the marker shows zeroed P&L as a real $0. Mitigated by the field comments and the consumer-grep spec step.",
      "SQLSTATE classification boundary: an error class wrongly treated as transient never parks and can stall the shared stream indefinitely. The unclassified fallback bound limits only errors that are not classified at all.",
      "Boot replay from seq 0 (:186, :205-209) re-attempts every historically parked deterministic event on each deploy. That is up to 5 attempts × 2s each, a short stall, and it is visible in logs.",
      "Same-stream head-of-line blocking remains during transient DB outages. It is harmless, because all writes fail anyway.",
      "Parks are visible only as an Error log, with no metric or alert.",
      "A per-emit idempotency_key retry, if adopted, extends confirmLock hold time up to the retry budget. recomputeTimeout must cover it.",
      "Pre-existing NaN/Inf confirmed rows keep emitting NaN positions until they are re-confirmed.",
      "The sweep of tests that relied on non-fatal state reads (portfolio_quote_deadline_test.go:115) may be larger than estimated, and the r3 UNAVAILABLE-mapping tests must be reworked into marker tests.",
      "Broker deregistration retry is either a recorded scope extension or needs an offline-set lookup. Not yet decided.",
      "If useInvalidatingMutation cannot forward onSettled, the orders list stays stale after an FR-6 UNAVAILABLE. This is a recorded UX gap."
    ],
    "constitution_rules_touched": [
      "C-03",
      "C-04",
      "C-09",
      "C-10",
      "C-11",
      "C-14",
      "C-15",
      "C-16",
      "C-18",
      "F-07",
      "P-02",
      "P-03"
    ],
    "rationale": "r3 concretely adopted every r2 [r3 MUST] item:\n- the explicit degraded input;\n- the aggregate exclusion with allOffline forced to false;\n- DayPnl zeroing and OrderBook gating;\n- try-all errors.Join;\n- WithTimeout around WithoutCancel;\n- the NaN detection query;\n- the \"event parked\" log;\n- the proto comment;\n- the citation fix.\nThe r2 objections are therefore closed and not carried forward.\n\nI checked the adversary's r3 claims against the worktree.\n\n1. Per-row decode. GetOfflineStates returns the whole-call error from json.Unmarshal inside the rows loop (`decode recent fills for %s`). One corrupt row therefore poisons every offline account the user has, and it persists. This is new evidence against the r2 YAGNI rejection. Combined with the C-18 problem of inferring degraded via bal==nil, which created r3's two accepted broker side effects, it justifies per-account decode with readValuation.unavailable. Blocking.\n\n2. Position-read parity. AC-14 @feature-157 does cover broker visibility under offline-state faults. r3 keeps broker accounts visible but fails broker positions, which is an inconsistent read path (fails.md:39). It also breaks trading REDUCE_ONLY: trading.go:3535 maps any GetPosition non-NotFound error to Unavailable, even though Qty is valid. The fix is a Position marker. The adversary's tag 20 is wrong: 20 is stop_order_id, Position's highest tag is mark_as_of = 25, and the message has no reserved range. So I specify 26. Blocking.\n\n3. Park rule. consumeEventStream (:185-202) retries every 2s from lastSeq+1 on one shared consumer, so the stall and drop analysis holds. The r2 synthesis rejected pure deterministic-only parking as fragile. I mediate with SQLSTATE-class parking plus the r3 bound as the fallback for unclassified errors: no event is dropped during an outage, and deterministic poison clears in about 10s. The lastSeq=0 boot replay is verified (:186, :205-209) and is the self-heal path, which must be documented. Blocking.\n\nSettled or non-blocking:\n- CardNotice is verified as 'muted' | 'error' (CardNotice.tsx:10), which settles r3's assumption.\n- The account.deregistered handler has no account type in scope (:1132-1160), so 'limit the retry to offline accounts' needs either a lookup or a recorded scope extension; left as non-blocking.\n- The emit retry and the recomputeTimeout invariant are advised, cheap and local.\n\nNo Floor breach: the code-constant bounds are covered by the recorded operator decision with the ledgerEmitTimeout precedent, and the proto fields go through C-04/C-09.\n\nAll business rules remain PRESERVE/EXTEND without operator sign-off, provided the position-read fix lands. Without it, @AC-14/@AC-3 @feature-157 would become a de facto CHANGE that no operator decision covers."
  },
  "floor_breaches": []
}
```

## Session 2026-10-22 — sdd-design

- Phase 0 Recon: recon.md was written earlier (services: xstockstrat-portfolio, xstockstrat-trading,
  xstockstrat-ui; consumer surface xstockstrat-agent).
  - Key reuse patterns: the `eventHandler` error contract with no-advance-on-error (`portfolio_service.go:173`,
    `:226-231`), and a sibling helper rather than a signature change for `emitLedgerEvent` (fails.md:2092).
- Phase 1 Grilling: 3 rounds (full). The operator approved at the r3 gate "as synthesized plus the three
  [r4 MUST] items" (binding, 2026-10-22). Floor clear.
- Chosen approach:
  - `isFinite` ConfirmOrder guards that return INVALID_ARGUMENT before the load.
  - Sibling `appendLedgerEvent` (one Unavailable retry with an idempotency_key, inside the held confirmLock).
    ConfirmOrder returns UNAVAILABLE on an emit failure.
  - Offline sync and deregistration handlers return errors through a `boundedRetry` wrapper that parks by
    SQLSTATE class.
  - Per-row `GetOfflineStates` decode, exposed as `readValuation.unavailable`.
  - Additive `Portfolio.offline_state_unavailable = 17` and `Position.offline_state_unavailable = 26`. Position
    reads never fail.
  - UI gated on the markers.
- Rejected: UNAVAILABLE on position reads, the `bal == nil` degrade inference, the error-blind park rule, a bound
  inside `consumeEventStream`, a transactional outbox (needs a migration), and an `emitLedgerEvent` signature
  change. The full list is in design.md.
- Decision (supersession): this supersedes feature 240's "a `GetOfflineStates` error is non-fatal (WARN, empty
  map)" (`240-offline-account-full-pnl/context.md:399`, `:771`). An offline-state failure now marks the account
  degraded instead of being silently swallowed.
- Decision: a parked event self-heals on the next deploy, because `lastSeq` starts at 0 on every boot
  (`portfolio_service.go:186`, `:205-209`). This must also go into the portfolio CLAUDE.md `ConsumePositionSyncs`
  row.
- Constitution rules touched: C-03, C-04, C-09, C-10, C-11, C-14, C-15, C-16, C-18, F-07, P-02, P-03. Floor
  breaches: none.
- Business rules: all PRESERVE/EXTEND, no CHANGE. EXTEND covers AC-9/14/15/30 @feature-240 and AC-14
  @feature-163.
- Status: spec-ready → design-approved.

## Open Threads

Each item names the step where it is resolved.

- [ ] Proto gate (C-04/C-09) for Portfolio 17 and Position 26. If either is refused, fall back to whole-call
  UNAVAILABLE, which needs a C-16 CHANGE sign-off. Target: the proto step (first portfolio step).
- [ ] Latent marker consumers could render zeroed P&L as $0. Target: the UI consumer-grep step (grep
  `usePortfolio`/`usePortfolios`/`Position.dayPnl`, with a Playwright assertion per surface).
- [ ] SQLSTATE classification boundary: a class wrongly treated as transient never parks. Target: the
  boundedRetry step (table tests with a fake clock).
- [ ] Boot replay re-attempts historically parked deterministic events, up to 5 × 2s each. Target: the
  boundedRetry step (document in portfolio CLAUDE.md).
- [ ] Head-of-line blocking during transient DB outages is accepted. Target: the boundedRetry step (record it).
- [ ] A park is Error-log only, with no metric or alert. Accepted for SEV-2. Target: launch verification.
- [ ] Set the `recomputeTimeout` value so that it exceeds `ledgerEmitTimeout` (10s) + the query budget + the
  retry budget, and test the rule. Target: the FR-6 step.
- [ ] Confirmed rows that already hold NaN/Inf. Target: the FR-5 step and the dev smoke (detection query plus
  re-confirm).
- [ ] Sweep the tests that relied on non-fatal state reads (`portfolio_quote_deadline_test.go:115`) and turn the
  r3 UNAVAILABLE-mapping tests into marker tests. Target: the FR-4 test step.
- [ ] Broker-deregistration scope is undecided: (a) a recorded scope extension, or (b) an offline-set lookup.
  Target: /sdd-spec FR-2 step (operator choice, record it here).
- [ ] `useInvalidatingMutation` `onSettled` forwarding: the orders list is stale after an FR-6 UNAVAILABLE. A
  recorded UX gap. Target: the UI step.
- Next: `/sdd-spec fix-offline-book-consistency`.

## Session 2026-10-22 — sdd-spec

- Generated implementation-spec.md with 16 steps. Status → implementation-ready.
  - Order: proto (1) → proto-gen (2) → trading D-49 (3–4) → trading D-63 (5–6) → portfolio D-47 (7–8) →
    portfolio D-48 (9–12) → UI (13–14) → agent test (15) → docs (16).
  - Every `@AC-*` is covered (Scenario Coverage table in the spec). Every service step has a paired test step.
- acceptance.feature edits (C-15, design "AC-3 tightened at /sdd-spec"):
  - `@AC-3`'s Then is tightened to the marker outcome: the call succeeds and carries `offline_state_unavailable`.
  - New scenarios `@AC-8` (per-row decode isolation), `@AC-9` (transient error never parks) and `@AC-10`
    (un-confirm with `filled_qty 0` stays valid). IDs are append-only; none renumbered.
- Key codebase findings:
  - The proto tags are re-verified free. Portfolio ends at `fees_lifetime = 16` (`portfolio.proto:67`) and
    Position at `mark_as_of = 25` (`:118`). No `reserved` statement.
  - `DeleteOfflineRealized` uses `r.pool.Exec` (`portfolio_repo.go:535`), so a pgxmock repo would nil-panic.
    Step 7 moves it onto `r.db` (prod uses the same pool, `:45`), so the AC-2 retry is testable.
  - `TestAccountPnL_OfflineStatesErrorIsNonFatal` (`offline_account_pnl_test.go:230`) asserts the superseded
    feature-240 behaviour. Step 12 rewrites it as the GetPortfolio AC-3 marker test.
  - `recordingLedger` (`trading_offline_test.go:60`) cannot fail today. Step 6 adds a `failFn` hook.
  - `emitLedgerEvent` has 27 call sites. Only `:1067` moves to the new `appendLedgerEvent`. `emitLedgerEvent`
    becomes its void wrapper.
  - The SnapshotOfflinePositions response already sets `Warnings: warnings` (`trading.go:1233`).
  - The consumer grep found one latent marker consumer outside `/trader`:
    `src/components/insights/AccountPortfolioSelector.tsx`. It is gated in Step 13.
  - `filled_qty` and `filled_avg_price` are `NUMERIC(18,8)`. The dev-smoke NaN query uses `'NaN'::numeric` on
    `broker_type = 3`.
- Decisions (spec-time; flagged for confirmation at `/sdd-review impl-spec`):
  - **Deregistration scope: option (a).** Retry applies to every `account.deregistered`. The payload carries no
    account type (`portfolio_service.go:1120-1123`), and both deletes are idempotent. Option (b) would add an
    offline-set query that can itself fail. This is a recorded scope extension beyond the offline-only
    Trading-Domain Scope. If the operator prefers (b), re-spec Step 7.
  - FR-6 constants: `appendMaxAttempts = 2`, `appendRetryBackoff = 100ms`, `offlineRecomputeQueryBudget = 5s`,
    `offlineRecomputeTimeout = 30s`. Rule: 30s > 2×10s + 0.1s + 5s. Step 6 tests it.
  - ConfirmOrder FR-6 error text: UNAVAILABLE "positions not published; re-confirm to retry". Snapshot adds the
    Warning "positions not published; re-snapshot to retry".
  - FR-5 error texts: "filled_qty must be a finite number >= 0" and "filled_avg_price must be a finite number
    >= 0 when filling". "fees must be >= 0" is unchanged.
  - Error classification across an `errors.Join`: transient wins over deterministic, which wins over
    unclassified.
  - The `useInvalidatingMutation` `onSettled` gap is accepted. No option is added to the shared hook (C-18
    YAGNI). After an FR-6 UNAVAILABLE the orders list may be stale until the next refetch or the re-confirm.
- No handler UNAVAILABLE mapping, no migration, no config key and no env var (design § Spine).

## Open Threads

Each item names the step where it is resolved.

- [ ] Proto gate (C-04/C-09) for Portfolio 17 and Position 26. If refused, stop and re-spec: the fallback needs
  a C-16 CHANGE sign-off. Target: Step 1.
- [x] Latent marker consumers: the consumer grep is done at spec time. Gating is Step 13, Playwright is Step 14.
- [ ] SQLSTATE boundary table tests. Target: Step 8.
- [ ] Boot-replay self-heal, head-of-line blocking and the log-only park, documented. Target: Step 16.
- [ ] A park is Error-log only, with no metric. Target: launch verification (dev-smoke log grep).
- [x] The `recomputeTimeout` value is fixed (30s). The rule test is Step 6.
- [ ] Confirmed NaN rows. Target: the dev-smoke detection query plus re-confirm before launch.
- [ ] Sweep of the tests that relied on non-fatal reads. Target: Step 12.
- [x] Broker-deregistration scope: option (a) chosen at /sdd-spec (above). Confirm at impl-spec review.
- [x] The `onSettled` UX gap is accepted and recorded (above).
- Next: `/sdd-review fix-offline-book-consistency impl-spec`.

## Session 2026-10-22 — sdd-review impl-spec

- Result: PASS WITH WARNINGS (0 failures, 11 warnings). Overlap scan: WARN only. This review is advisory and
  does not change the lifecycle (status stays `implementation-ready`). The previous run was cut before it
  committed anything, so this run starts from `3fe383fb`.
- Addressed in implementation-spec.md (each claim re-verified against the code):
  - Step 2: the Files list now names the five generated files a message-only change touches. The gRPC and
    Connect stubs are noted as expected unchanged.
  - Step 1: the C-09 `buf breaking` baseline against the feature branch is confirmed as intended. A second
    check against `origin/main-dev` was added, using the same form CI uses (`ci.yml:125`).
  - Step 5: the behaviour change for the 26 non-confirm `emitLedgerEvent` callers is recorded in the step and
    pre-entered in the Deviation Log. Each gets one Unavailable retry; the worst-case emit wait goes from 10s
    to 20.1s.
  - Step 11: `markDegradedPositions` lives in `offline_valuation.go`, next to `readValuation.degraded`. The
    Files entry is no longer conditional.
  - Step 13: a scope note explains why the 7-file step stays whole (one shared label contract, one C-14
    gate) and gives the split point if execution wants one.
  - Step 7: option (a) now carries an explicit sign-off gate before execution and a Deviation Log pre-entry.
  - Step 12: the supersession was checked. It is in `design.md:149` and in the sdd-design session above,
    inside the design the operator approved. The 240 rule is a recorded context decision, not a durable
    `@AC-*` (no hit in `docs/sdd/business-rules/`), so no C-16 CHANGE applies.
  - Step 6: the AC-5 emit-failure test is now table-driven over a partial fill (4/150) and a full fill
    (10/150).
  - Step 4: a sweep was added. No existing test asserts FailedPrecondition when a broker order is confirmed
    with a bad value, and every confirm with `FilledQty > 0` already sets a finite positive price. Execute
    re-runs the grep.
  - Spec header `Status: pending`: confirmed as the template convention (`spec-template.md:8`) and annotated.
  - `@AC-8..10` were checked. Each carries an `@FR` tag (FR-4, FR-3, FR-5/FR-7), and FR-1..FR-7 each have at
    least one scenario (C-15 is complete).
- Overlap: no migration, config-key or proto-number collision. Portfolio 17 and Position 26 are free on trunk.
  Expect same-file rebases with 241 and 249 (`trading.go`), with 242 and 248 (`portfolio_service.go`), with
  250 (`portfolio.proto`, a line citation only) and with 249 (`offline-accounts.spec.ts` and the e2e
  fixtures). All touch disjoint functions. No merge-order row is needed. Peer 259 is clean; re-check it once
  its spec exists.

## Open Threads

- [ ] Product-spec drift: Fix Scope still shows `- [ ] Proto changes: open (OQ-1)` (`product-spec.md:108`),
  and OQ-1/OQ-2 are not marked resolved, even though design chose the additive markers. Update the product
  spec to the design decision. This review only edited the implementation spec. Target: before Step 1, or
  the next /sdd-sync.
- [ ] Operator sign-off on deregistration option (a), which also retries broker accounts and so goes beyond
  the product spec's offline-only scope (C-16/P-03). Get the sign-off before Step 7 and record it here. If
  the operator chooses (b), re-spec Step 7 and note the scope change in the product spec.
- [ ] Operator confirmation of the Step 5 wrapper behaviour change: 26 other `emitLedgerEvent` callers each
  gain one Unavailable retry, with a worst case of 20.1s per emit. The alternative is a no-retry path for
  those callers, which would be a design deviation. Target: the Step 5 checkpoint.
- [ ] Optional: split Step 13 at instruction 4 if the execute checkpoint prefers fewer than 6 files per step.
- [ ] Proto gate for Portfolio 17 and Position 26 (carried over). Target: Step 1.
- Next: `/sdd-execute fix-offline-book-consistency`.

## Session 2026-10-22 (operator decisions — execute-checkpoint items)

- **Deregistration retry, option (a): ACCEPTED.** The bounded retry covers broker accounts as well as offline ones.
  This is a recorded scope extension beyond offline-only (C-16/P-03 sign-off); no offline-set lookup is added.
- **Step 5 `appendLedgerEvent` retry: ACCEPTED for all callers.** `emitLedgerEvent` stays the void wrapper, so the
  26 other trading emitters also get the one bounded `Unavailable` retry with a per-emit idempotency key. The
  no-retry alternative is rejected.
- **Product-spec drift resolved:** Fix Scope now records the two additive proto markers, and OQ-1/OQ-2 are marked
  resolved with the design decisions.

## Session 2026-10-28 — re-spec (sdd-execute sequential, sdd-batch-execute)

- Branch setup: detached at `origin/feature/fix-offline-book-consistency`, merged `origin/main-dev` with `-X ours` (8f874bde).
- Re-verified all 16 steps against the current codebase. No blocker; line drift only, corrected in implementation-spec.md:
  - Step 3: ConfirmOrder offline-only gate `trading.go:909-911` (was :910-912).
  - Step 5: `recomputeAndEmitOfflinePositions` final `return nil` at `:1078` (was :1077).
  - Step 7: `ConsumeOrderFills` at `portfolio_service.go:167` (was :168); `clock()` at `offline_valuation.go:54`.
  - Step 9: `type readValuation` at `offline_valuation.go:28-31` (was :27-30).
  - Step 11: ListPortfolios `buildAccountPortfolio` callers `:1420`/`:1472` (were :1428/:1478); `allOffline` at `:650` (was :652).
  - Step 12: `acctScenario` starts at `offline_account_pnl_test.go:27`; quote-deadline non-fatal comment at `:113-114`.
  - Step 14: INVENTORY.md catalog rows at `:17`, `:41`.
  - Step 15: `list_positions` `client.py:2357`, `stub.ConfirmOrder` `:2277`, `tools.py` `except grpc.aio.AioRpcError` `:2147`.
  - Steps 1, 2, 4, 6, 8, 10, 13, 16: all evidence matches, unchanged.

## Session 2026-10-28 — sdd-execute sequential (sdd-batch-execute)

- Mode: `/sdd-execute fix-offline-book-consistency sequential`. Every step is one commit on `feature/fix-offline-book-consistency`, with no per-step PRs, and one integration PR at the end.
- Up-front confirmation: the operator approved the plan through a standing authorization. Source: operator chat 2026-10-28, session_01NpS3HShZK6pSnogA7CFo2f, quoting "Start executing features 241-276" via batch-execute and "start batch 2 in parallel too". The terms are:
  - checkpoints run unattended and are reported ('report'), not held;
  - C-16 promotion is auto-confirmed unless it changes an existing @AC rule;
  - merge-train is authorized;
  - 255 and 275 are deferred;
  - DB and prod steps stay with the operator: open the PR, then hold the merge.
- Status: `implementation-ready` → `in-progress`. The prior execute-checkpoint decisions still apply (session 2026-10-22): deregistration option (a) and the Step 5 retry for all callers.

## Session 2026-10-28 — Step 1 (proto)

- Added `bool offline_state_unavailable = 17` to `Portfolio` and `= 26` to `Position` in `packages/proto/portfolio/v1/portfolio.proto`, each with a 2-line constraint comment. No other proto change.
- TDD: N/A (proto). Pre-change `grep offline_state_unavailable` found 0 hits; afterwards it finds 2 (lines 70 and 124).
- Verification: `buf lint` (buf 1.72.0) passed. `buf breaking` passed against snapshots of the feature-branch and `origin/main-dev` baselines. The `.git#branch=` inputs cannot be resolved from an isolated worktree, so `git archive` snapshots replaced them (Deviation Log).
- Next: Step 2 regenerates the stubs. Until it lands, `proto-freshness` is red on this branch.

## Session 2026-10-28 — Step 2 (proto-gen)

- Ran `./scripts/buf-gen.sh` with buf 1.72.0, grpcio-tools 1.80.0 and the pnpm workspace `tsc`. It changed 8 files, all under `portfolio/v1`:
  - Go `.pb.go` and Python `_pb2.py`.
  - TS `portfolio_pb.ts` and `portfolio.ts` (ts-proto).
  - The 4 matching files under `dist/`.
- The gRPC/Connect stubs did not change.
- The host `protoc-gen-go` had been built with go1.24.7 and produced comment-only drift in `analysis.pb.go`. Rebuilding the pinned plugins under go1.27.0 (matching CI) in a scratch GOBIN removed it (Deviation Log).
- TDD: N/A (proto-gen). Before the change, `grep OfflineStateUnavailable gen/go/portfolio/v1/` found nothing. After it, the grep matches `portfolio.pb.go`, and `go build ./portfolio/...` passes in `gen/go`.
- Next: Step 3 (service, D-49 ConfirmOrder validation).

## Session 2026-10-28 — Step 3 (service, D-49)

- `trading.go`: added `isFinite` next to `deriveOfflineStatus`. ConfirmOrder now runs three guards, all before `GetOrder`:
  - `filled_qty`: rejected if non-finite or < 0, with "filled_qty must be a finite number >= 0".
  - `filled_avg_price`: rejected if non-finite or < 0, only when `filled_qty > 0`. A qty of 0 (un-confirm) skips this check.
  - fees: rewritten onto the helper. The message "fees must be >= 0" and the guard's position are unchanged.
- `SnapshotOfflinePositions` rows at qty and avg-cost now use `!isFinite(...)`. Reasons and ordering are unchanged.
- Consequence (design §1): a bad value on a broker order now returns INVALID_ARGUMENT instead of FailedPrecondition. The order is not modified in either case.
- TDD: @AC-4 red. A throwaway test (not committed; Step 4 owns the durable test) sent qty NaN/+Inf and price NaN/+Inf/-1 against an empty sqlmock. All 5 cases failed with `Internal "load order: ... call to method Query() was not expected"`, meaning the load ran. Green: all 5 returned InvalidArgument and the mock expectations were met.
- Verification:
  - The spec grep matched 5 lines (861, 897, 900, 1161, 1165).
  - `go build ./...` passed, and the full `go test ./...` passed.
  - `golangci-lint` v2.14.0, rebuilt under go1.27.0 because the host binary is go1.26 (Deviation Log), reported 0 issues.
- Next: Step 4, the durable ConfirmOrder validation tests in `trading_offline_test.go`.

## Session 2026-10-28 — Step 4 (test, D-49 / FR-7)

- `trading_offline_test.go` adds three tests next to the `@AC-9` fees template:
  - `TestConfirmOrder_AC4_NonFiniteOrNegativeFillRejectedBeforeLoad`: NaN/150, +Inf/150, -1/150, 10/NaN, 10/-5 and 10/+Inf each return InvalidArgument. No `account.positions.synced` is recorded, and the mock expectations are met (no GetOrder or UpsertOrder).
  - `TestConfirmOrder_AC7_ValidFillsKeepStatusAndEmit`: 4/150 gives PARTIALLY_FILLED and 10/150 gives FILLED. Each records exactly one `account.positions.synced` (the ledger is reset between confirms).
  - `TestConfirmOrder_AC10_UnconfirmZeroQtyNoPriceValid`: 10/150, then 0/0, gives NEW with no error and one `account.positions.synced`.
- The `positions.synced` path through `h.ledger` is confirmed: `emitLedgerEvent` calls `recordingLedger.AppendEvent` synchronously.
- TDD: Step 3 had already landed, so RED ran with the pre-Step-3 `trading.go` restored temporarily. All 5 `@AC-4` value rows failed with `Internal "load order: ... Query() was not expected"`, while the -1 qty row already passed. AC7 and AC10 passed on both trees (non-regression guards). GREEN: all targeted tests pass.
- Broker-order sweep re-run. The one new hit, `trading_offline_test.go:1966`, is `TestSnapshotOfflinePositions_AC44_NonLatestAsOfChangeRejected`. It is a snapshot test, not a confirm with a bad value, so nothing moves to InvalidArgument.
- Verification:
  - Targeted `-run` set passed.
  - The full `go test ./... -race` passed, with coverage total 72.8% (≥ 40%).
  - `golangci-lint` v2.14.0, rebuilt under go1.27.0, reported 0 issues.
- Next: Step 5 (D-63 `appendLedgerEvent` + ConfirmOrder UNAVAILABLE).

## Session 2026-10-29 — re-spec + sdd-execute sequential (sdd-batch-execute)

- Authorization: standing operator approval (operator chat 2026-10-28/29, session_01NpS3HShZK6pSnogA7CFo2f): "Start executing features 241-276" via batch-execute; unattended checkpoints ('report'); C-16 promotion auto-confirmed unless it changes an existing `@AC` rule; merge-train authorized; 255/275 deferred; operator-only DB/prod steps mean open the PR and hold the merge. This serves as the up-front sequential-mode confirmation. Status was already `in-progress`, so it is unchanged.
- Branch setup: `git merge -X ours origin/main-dev` into the detached checkout. The only trading.go change from main-dev removes one line at :2181 (`Author:` in `escalateSystemic`). Every citation below that line moves by -1.
- Re-spec, citations only, with no change to instructions or scope:
  - Step 5: `ledgerEmitTimeout` :3661, `emitLedgerEvent` :3665 (NewStruct :3666, Warn :3675-3677), `confirmLock` :923, swallow :956-959 (replace :955-959), `recomputeAndEmitOfflinePositions` :967 (doc :965-966, queries :969-983, emit :1072, `return nil` :1083), `warnings` :1191-1197, Snapshot call :1229-1232, `Warnings: warnings` :1238. The directive's `return nil :1078` was stale; :1083 was verified.
  - Step 5: the non-test `emitLedgerEvent(` grep still returns 28 lines. A second `"account.positions.synced"` emit sits at :2414 on the broker sync path. It stays on the void wrapper, and only :1072 changes.
  - Step 6: AC46 test :2058, AC47 test :2071.
  - Step 12: the `portfolio_quote_deadline_test.go` "non-fatal" comment is at :115, inside the `expectAllAccounts` doc comment :114-115.
- Next: Step 5 (D-63 `appendLedgerEvent` + ConfirmOrder UNAVAILABLE).

## Session 2026-10-29 — Step 5 (service, D-63)

- Operator decision (2026-10-29, Option A on the Step 5 blocker): retry wins. `ledger_emit_mtls_test.go` joined the
  step. `TestEmitLedgerEventFailSoftOneShot` is now `TestEmitLedgerEventFailSoftBoundedRetry` and expects
  `appendMaxAttempts` attempts. This **supersedes feature 210's one-shot note for `emitLedgerEvent`**. The 2026-10-22
  "retry for all callers" decision stands.
- `trading.go`:
  - New constants: `appendMaxAttempts=2`, `appendRetryBackoff=100ms`, `offlineRecomputeQueryBudget=5s`,
    `offlineRecomputeTimeout=30s`.
  - `appendLedgerEvent` returns the NewStruct error. It uses one `IdempotencyKey` across attempts, runs each attempt
    under `ledgerEmitTimeout`, and retries only `codes.Unavailable`. The backoff also ends on `ctx.Done()`.
  - `emitLedgerEvent` is now its void wrapper and keeps the "ledger emit failed" Warn.
  - `recomputeAndEmitOfflinePositions` returns the append error. Only the offline emit changed; the broker-sync
    `account.positions.synced` emit stays void. The payload is unchanged, `user_id` included.
  - ConfirmOrder runs the recompute under `WithTimeout(WithoutCancel(ctx), offlineRecomputeTimeout)`. On failure it
    returns `UNAVAILABLE "positions not published; re-confirm to retry"`. The order row is already persisted.
  - SnapshotOfflinePositions uses the same ctx and, on failure, appends "positions not published; re-snapshot to retry"
    to `warnings`. It returns no error.
- Side effect (open item): `order_intent.reclaimed_unknown` (`order_intent.go:156`) carries a `time.Time`, so
  `NewStruct` fails. It used to be appended with an empty payload and is now skipped with a Warn. No consumer exists.
  The fix is a one-line `Format(time.RFC3339Nano)`, outside this step's Files; it needs the operator's call.
- TDD:
  - RED: the updated mtls test saw 1 attempt where it wanted 2. A throwaway ConfirmOrder test with a failing ledger got
    `err=nil` where it wanted UNAVAILABLE.
  - GREEN: both pass, the throwaway test made 2 AppendEvent calls, and the throwaway file was deleted.
- Verification:
  - The spec greps match (appendLedgerEvent, `IdempotencyKey: uuid.NewString()`, `offlineRecomputeTimeout`, both
    "positions not published" strings, both `WithoutCancel` sites).
  - `go build ./...` passed, and the full `go test ./... -race` passed.
  - `golangci-lint` v2.14.0, rebuilt under go1.27.0, reported 0 issues.
- Next: Step 6 (D-63 durable tests). Its `TestOfflineRecomputeTimeout_CoversRetryBudget` is the test the constant's
  comment cites.

## Session 2026-10-29 — Step 6 (test, D-63)

- `trading_offline_test.go`:
  - `recordingLedger` has an optional `failFn` hook, plus a `setFailFn` setter that swaps it under the mutex. A nil
    hook keeps the old always-succeed behaviour, so existing tests are unaffected.
  - New tests: `TestConfirmOrder_AC5_EmitFailureIsNotSuccess` (partial 4/10 and full 10/10; a re-confirm after the
    hook is cleared succeeds and records one more positions.synced), `TestConfirmOrder_AC5_RecomputeQueryFailureIsNotSuccess`,
    `TestAppendLedgerEvent_RetriesUnavailableWithSameIdempotencyKey`, `TestOfflineRecomputeTimeout_CoversRetryBudget`,
    `TestRecomputeEmit_PayloadKeepsUserID` and `TestSnapshotOfflinePositions_EmitFailureAddsWarning`.
  - All helpers and literals stay in this file (single consumer, C-13).
- TDD:
  - AC-5 RED, on the pre-Step-5 `trading.go` restored temporarily: ConfirmOrder returned `err=<nil>` where
    Unavailable was wanted, for partial, full and the baseline-query failure. Snapshot returned `warnings = []`.
    The retry and timeout tests failed to compile (undefined `appendLedgerEvent`, `appendMaxAttempts`, ...).
  - GREEN on the Step 5 tree: all targeted tests pass, and the AC46/AC47 PRESERVE guards stay green.
  - AC-7 (`user_id` in payload) passes on both trees: it is a non-regression guard.
- Verification: the targeted run passed; the full `go test ./... -race` passed with 72.8% coverage on the CI coverpkg
  set (≥ 40%); `golangci-lint` v2.14.0 (go1.27.0 build) reported 0 issues.
- Next: Step 7 (D-47 `boundedRetry`). It still needs the pre-entered operator sign-off on deregistration retry
  option (a) versus (b).

## Session 2026-10-29 — Steps 7 + 8 (service + test, D-47)

- Operator decision (2026-10-29, session question tool, in their words): "B: merge Steps 7+8". The two steps are one
  lint-green commit with one red→green cycle on Step 8's tests, and both are marked done (Deviation Log). The
  deregistration scope stays option (a), signed off 2026-10-22, so that Open Thread is closed.
- `portfolio_service.go`:
  - `processPositionSync` returns `error`. Parse failures and nil/empty-account payloads return nil (acked). The
    offline branch (`RealizedPnl != nil`) attempts every write, keeps each Warn and returns `errors.Join`. The broker
    branch returns nil. `shouldReconcileSyncDeletions` is unchanged.
  - `processAccountDeregistered` returns the `errors.Join` of both delete failures, for every account type (option a).
  - New `syncRetryMinAttempts=5` and `syncRetryFallbackElapsed=10m`, `retryClass`, `classifyConsumerErr` (per-leaf,
    transient > deterministic > unclassified) and `boundedRetry` (per-sequence state in the closure, clock seam
    `s.clock()`, one `slog.Error("event parked", ...)` on park).
  - `ConsumePositionSyncs` and `ConsumeAccountDeregistrations` use `boundedRetry`. Only the bracket and balance
    consumers keep `ackAlways`. `consumeEventStream` and `streamEventsFrom` are untouched.
- `portfolio_repo.go`: `DeleteOfflineRealized` now uses `r.db.Exec` (same pool in prod), so pgxmock can fail it.
- Tests: new `portfolio_sync_retry_test.go` (AC-1 via `streamEventsFrom` + `sliceStream`, try-all, broker acked,
  malformed acked, AC-2, AC-6 deterministic park, AC-9 transient never parks, unclassified fallback bound,
  classification table). The three call sites now check the error (the race goroutine uses `t.Errorf`).
  `warnRecorder` records Error as well as Warn (spec-sanctioned).
- TDD: RED was a compile failure. The handlers were void (`(no value) used as value` at the three call sites and in
  the new file), and `svc.boundedRetry` was undefined. GREEN: every targeted test passes.
- Verification: the spec greps match (only `:1345` bracket and `:1393` balance keep `ackAlways`). `go build`, `go vet`
  and the full `go test ./... -race` pass, with 68.6% total on the CI coverpkg set (≥ 40%). `golangci-lint` v2.14.0
  (go1.27.0 build) reported 0 issues.
- Next: Step 9 (D-48 per-row `GetOfflineStates` decode and `readValuation.unavailable`).

## Session 2026-10-29 — Steps 9 + 10 (service + test, D-48 per-row decode)

- Operator decision (2026-10-29, session question tool, in their words): "Merge pairs + standing rule". Steps 9 and 10
  are one lint-green commit with one red→green cycle on Step 10's tests; both marked done (Deviation Log).
- `portfolio_repo.go`: `GetOfflineStates` returns `(map[string]OfflineState, map[string]error, error)`. Query, Scan
  and `rows.Err` stay whole-call (`nil, nil, err`); a `recent_fills` decode failure goes to `failed[id]` and the
  account is left out of the states map.
- `offline_valuation.go`: `readValuation.unavailable` + `degraded(accountID)`. `valueRead` marks every id in `ids` on a
  whole-call error and only the failed id per row failure, each with a Warn `"offline state unavailable"` carrying
  `errors.Join(ErrOfflineStateUnavailable, err)`. Broker accounts are never passed in, so never marked. No read path
  consumes `degraded()` yet — Step 11 does.
- `portfolio_service.go`: `ErrOfflineStateUnavailable` sentinel beside `ErrQuotesUnavailable` (logs/tests only; no
  handler mapping change).
- Tests: `offline_realized_test.go` (two call sites on the 3-value return; AC-8 undecodable row; scan error stays
  whole-call) and `offline_valuation_test.go` (`TestValueRead_WholeCallErrorMarksEveryRequestedID`,
  `TestValueRead_RowFailureMarksOnlyThatID`). C-13: the corrupt JSON literal is inline (single-consumer one-off).
- TDD: RED was a compile failure (3-value return, `degraded`, `ErrOfflineStateUnavailable` undefined) plus a throwaway
  AC-8 test on the old repo that failed the whole batch on one bad row. GREEN: all six targeted tests pass.
- Verification: spec greps match; `go build`, `go vet` and the full `go test ./... -race` pass, 68.6% total on the CI
  coverpkg set (≥ 40%); `golangci-lint` v2.14.0 (go1.27.0 build) 0 issues.
- Next: Step 11 (D-48 degraded marker and zeroing on every read path).

## Session 2026-10-29 — Steps 11 + 12 (service + test, D-48 degraded marker)

- Standing operator rule (2026-10-29, "Merge pairs + standing rule"): Steps 11 and 12 are one lint-green commit with one
  red→green cycle on Step 12's tests, and both are marked done (Deviation Log). Step 11's RED tests are Step 12's.
- `portfolio_service.go`:
  - `applyAccountPnL` and `buildAccountPortfolio` take `degraded bool`. A degraded account sets
    `OfflineStateUnavailable`, keeps `Equity = positionsValue`, and returns before the broker and offline branches,
    so TotalPnl, DayPnl and DayPnlPct are 0 and the optionals are nil.
  - Every caller passes `val.degraded(id)`.
  - The GetPortfolio aggregate skips a degraded id's dayPnl/totalPnl/prior/absCost, sets the aggregate marker and
    forces `allOffline = false`. Equity still sums every position.
  - `markDegradedPositions` runs in `enrichPositions` (GetPosition/ListPositions), in GetPortfolio after `valueRead`,
    and in both ListPortfolios branches.
  - Handler untouched.
- `offline_valuation.go`: `markDegradedPositions` sits beside `readValuation.degraded`. It changes only offline-sourced
  rows of degraded accounts.
- Tests (`offline_account_pnl_test.go`):
  - `TestAccountPnL_OfflineStatesErrorIsNonFatal` is rewritten as `TestGetPortfolio_AC3_OfflineStateErrorMarksDegraded`.
    The scenario is a realized 500.00 state the read cannot reach, and AAPL 10 @ 154 at mid 164 (100.00 unrealized).
    The Warn assertion is kept.
  - New tests: `TestListPortfolios_AC3_...` (scoped and all-accounts), `TestPositionReads_AC3_...`
    (ListPositions + GetPosition), `TestListPortfolios_AC8_UndecodableRowDegradesOnlyItsAccount`,
    `TestListPositions_DegradedOfflineKeepsBrokerRows` and `TestGetPortfolio_AggregateExcludesDegradedAccount`.
  - The `portfolio_quote_deadline_test.go` `expectAllAccounts` comment states the new contract.
  - C-13: the scenario literals are local to this file, and symbols and quotes reuse `internal/testdata`.
- TDD:
  - AC-3 red: on the pre-Step-11 tree, `offline_state_unavailable = false`, `total_pnl = 100, want 0`, and position
    `day_pnl=40`, on all four reads.
  - AC-8 red: acct-off-1 was unmarked, with total 100.
  - Aggregate red: `total_pnl = 600, want 500`.
  - Green: every targeted test passes, and `TestAC29_`, `AC39_` and `AC52_` stay green unchanged (PRESERVE).
- Verification:
  - The spec greps match, the handler diff is empty, and `error is non-fatal` has no hit.
  - `go build`, `go vet` and the full `go test ./... -race` pass, with 68.6% on the CI coverpkg set (≥ 40%).
  - `golangci-lint` v2.14.0 (go1.27.0 build) reported 0 issues.
- Next: Step 13 (UI gating on `offlineStateUnavailable`). It is the backend→ui surface boundary, so a checkpoint is
  due.

## Session 2026-10-30 — Steps 13 + 14 (ui service + test, AC-3/AC-4/AC-5)

- Operator decision (session question tool, 2026-10-30): "A: Gate it, drop e2e (Recommended)". Under the standing
  rule "Merge pairs + standing rule", Steps 13 and 14 are one commit and both are marked done (Deviation Log).
  `OrderBook.tsx` `PortfolioSummary` is gated, but it is mounted by no route (grep hits only its definition), so its
  e2e bullet is dropped and `tsc` + lint cover it.
- `portfolioTotals.ts`: `PNL_UNAVAILABLE_LABEL`, `PortfolioFigures.offlineStateUnavailable` and
  `PortfolioTotals.incomplete`. A degraded account adds equity/cash/BP but skips the P&L, realized and fee sums.
- Gated surfaces: PortfolioPanel (single card, combined card, per-account card, with a muted `CardNotice`), the Book
  page (combined tiles, per-account cards, positions-table Day cell), `/trader/positions` (Day $ and % cells, sheet),
  `/trader/positions/[symbol]` (header and both Day P&L tiles), and `AccountPortfolioSelector` (selected Day/Total,
  aggregate Day, with degraded portfolios skipped in the aggregate sum).
- Tests: a vitest degraded case; 5 `@AC-3` e2e cases in `offline-pnl.spec.ts`; `@AC-4` and `@AC-5` confirm-dialog error
  cases in `offline-accounts.spec.ts`; two fixtures plus INVENTORY rows (C-12/C-13).
- TDD: RED was 2 vitest failures and 5 `@AC-3` e2e failures. GREEN: vitest 239/239, the two specs 23/23, and the other
  affected specs 83/83 (`CI=1` server, Deviation Log). Lint reports 0 errors.
- Open item: `tsc --noEmit` reports two errors in `e2e/insights/backfills.spec.ts:135-136`, a file outside this feature.
- Next: Step 15 (agent pass-through test). It is the ui→agent surface boundary, so a checkpoint is due.

## Session 2026-10-30 — Step 15 (agent test, AC-3/AC-4/AC-5)

- Operator decision (session question tool, 2026-10-30): "A: Widen Step 15 (Recommended)". Files now also include
  `tests/test_position_parity.py` (`offline_state_unavailable` in `_POSITION_FIELD_SET`, count comment 26, guard B
  Position sets it True; no assert changed). The marker surfaces through `get_positions` and
  `manage_offline_account list_positions`.
- Tests added to `tests/test_offline_client.py`: `test_list_positions_passes_offline_state_unavailable` (True with
  `day_pnl` 0, healthy False) and a parametrized `manage_offline_account` `confirm_order` test: `INVALID_ARGUMENT` and
  `UNAVAILABLE` details surface verbatim through the real client wrapper and the tool's error mapping.
- TDD: N/A per spec (characterization; stubs from Step 2 already exist). Verification: full agent suite 524 passed,
  81% coverage (>= 40); `ruff check` and `ruff format --check` clean.
- Next: Step 16 (docs).

## Session 2026-10-30 — Step 16 (docs)

- Edited `services/xstockstrat-portfolio/CLAUDE.md` (degrade wording at the offline-valuation paragraph; `boundedRetry` /
  `event parked` / `lastSeq` self-heal on the sync row; a new `account.deregistered` consumer row, since none existed,
  carrying the option-(a) broker scope), `services/xstockstrat-portfolio/docs/context-constitution.md` (PORTFOLIO-3 and
  PORTFOLIO-11, with the head-of-line-blocking and log-only-park acceptances) and `services/xstockstrat-trading/CLAUDE.md`
  (filled_qty/filled_avg_price validation, UNAVAILABLE "positions not published").
- Verified against code: `boundedRetry`/`classifyConsumerErr`/`syncRetryMinAttempts` in `portfolio_service.go`,
  `readValuation.unavailable` in `offline_valuation.go`, trading.go ConfirmOrder validation and the UNAVAILABLE message.
- Teardown: `/context-forge:context-constitution refresh` plugin not run in this subagent; manual reconciliation of the three
  touched files against the code was done as above (record in the PR body).

## Session 2026-10-29 — sdd-batch-execute promotion plan (awaiting operator confirm)

````sdd-batch-promotion-plan
## Promotion plan - fix-offline-book-consistency (feature 256)

### Verdicts
| @AC | target suite (path) | CREATE/APPEND | verdict | note |
|---|---|---|---|---|
| AC-1 | services/xstockstrat-portfolio/acceptance/fix-offline-book-consistency.feature | CREATE | NEW | Event consumer retry. No existing portfolio rule covers a failed UpsertOfflineRealized. |
| AC-2 | same portfolio file | CREATE | NEW | Deregistration delete retry. |
| AC-3 | same portfolio file | CREATE | NEW | offline_state_unavailable on all four reads. Distinct from the quote-error degrade in offline-account-full-pnl.feature (~L146), which is a different failure. |
| AC-4 | services/xstockstrat-trading/acceptance/fix-offline-book-consistency.feature | CREATE | NEW | ConfirmOrder rejects non-finite or negative fills. Existing trading suites only assert fees >= 0. |
| AC-5 | same trading file | CREATE | NEW | The emit failure is in trading. |
| AC-6 | portfolio file | APPEND (same CREATE block) | NEW | Poison event parked after the retry bound. |
| AC-7 | trading file | APPEND (same CREATE block) | NEW | Weak overlap with feature 240 partial and full confirm scenarios in trading offline-account-full-pnl.feature. Those do not assert the emit. Kept NEW as a regression guard for FR-5 over-rejection. |
| AC-8 | portfolio file | APPEND (same CREATE block) | NEW | Per-account degradation. |
| AC-9 | portfolio file | APPEND (same CREATE block) | NEW | Transient failures never park an event. Complements AC-6. |
| AC-10 | trading file | APPEND (same CREATE block) | NEW | Partial overlap with @AC-48 @feature-240 in trading offline-account-full-pnl.feature (un-confirm with filled_qty 0 gives NEW). AC-10 adds that no price is needed and that the emit still happens. It is consistent with AC-48, so this is not a conflict. |

### Ready-to-write blocks
--- /home/user/xstockstrat/services/xstockstrat-portfolio/acceptance/fix-offline-book-consistency.feature (CREATE) ---
# Promoted from docs/roadmap/features/256-fix-offline-book-consistency/acceptance.feature (C-16).
# Scenarios are verbatim. Provenance tag: @feature-256.
Feature: fix-offline-book-consistency (portfolio)
  Offline-account books (feature 240) must not drift or misreport P&L on a failed write or a failed state read.

  @AC-1 @FR-1 @regression @feature-256
  Scenario: A failed offline realized-P&L write is retried, not acked
    Given user "u-1" has offline account "acct-off-1" with stored realized_pnl 0.00
    And UpsertOfflineRealized fails once, then succeeds
    When portfolio consumes an offline "account.positions.synced" event for "acct-off-1" carrying realized_pnl 500.00
    Then the event cursor does not advance past that event after the first failure
    And the event is delivered again
    And the stored realized_pnl for "acct-off-1" is 500.00

  @AC-2 @FR-2 @regression @feature-256
  Scenario: A failed offline-realized delete on deregistration is retried
    Given user "u-1" has offline account "acct-off-1" with a realized row
    And DeleteOfflineRealized fails once, then succeeds
    When portfolio consumes "account.deregistered" for "acct-off-1"
    Then the "account.deregistered" event is delivered again after the failed delete
    And no realized row remains for "acct-off-1"
    And "acct-off-1" no longer appears in ListPortfolios for "u-1"

  @AC-3 @FR-4 @regression @feature-256
  Scenario Outline: Offline P&L is never reported as complete when offline state cannot be read
    Given user "u-1" has offline account "acct-off-1" with realized_pnl 500.00 and an AAPL position with unrealized_pnl 100.00
    And GetOfflineStates returns an error
    When <read> is called for "u-1"
    Then the call succeeds
    And the "acct-off-1" figures it returns carry offline_state_unavailable true
    And it does not return total_pnl 100.00, a day_pnl, or a position day_pnl for "acct-off-1" as a complete figure

    Examples:
      | read           |
      | ListPortfolios |
      | GetPortfolio   |
      | ListPositions  |
      | GetPosition    |

  @AC-6 @FR-3 @regression @feature-256
  Scenario: A persistently failing offline sync event is parked and does not block the stream
    Given user "u-1" has offline account "acct-off-1"
    And UpsertOfflineRealized always fails for event "evt-1"
    And event "evt-2" for offline account "acct-off-2" follows "evt-1" on the stream
    When portfolio consumes "evt-1" and "evt-2"
    Then "evt-1" is parked with an error log naming "evt-1" once the retry bound is reached
    And the event cursor advances past "evt-1"
    And "evt-2" is applied

  @AC-8 @FR-4 @regression @feature-256
  Scenario: One undecodable offline state degrades only its own account
    Given user "u-1" has offline account "acct-off-1" whose stored recent_fills cannot be decoded
    And user "u-1" has offline account "acct-off-2" with realized_pnl 200.00 and no open positions
    And user "u-1" has broker account "acct-alp-1" with day_pnl 120.00
    When ListPortfolios is called for "u-1"
    Then the call succeeds
    And the "acct-off-1" portfolio carries offline_state_unavailable true
    And the "acct-off-2" portfolio has total_pnl 200.00 and offline_state_unavailable false
    And the "acct-alp-1" portfolio has day_pnl 120.00 and offline_state_unavailable false

  @AC-9 @FR-3 @regression @feature-256
  Scenario: A transient write failure never parks the offline sync event
    Given user "u-1" has offline account "acct-off-1"
    And UpsertOfflineRealized fails with a connection error on every attempt for 15 minutes, then succeeds
    When portfolio consumes an offline "account.positions.synced" event "evt-1" for "acct-off-1"
    Then "evt-1" is never parked and the event cursor does not advance past it while the write fails
    And "evt-1" is applied once the write succeeds

--- /home/user/xstockstrat/services/xstockstrat-trading/acceptance/fix-offline-book-consistency.feature (CREATE) ---
# Promoted from docs/roadmap/features/256-fix-offline-book-consistency/acceptance.feature (C-16).
# Scenarios are verbatim. Provenance tag: @feature-256.
Feature: fix-offline-book-consistency (trading)
  Offline ConfirmOrder must reject non-finite or negative fills and must not report success when the positions emit fails.

  @AC-4 @FR-5 @regression @feature-256
  Scenario Outline: ConfirmOrder rejects a non-finite or negative fill
    Given an offline BUY order "ord-1" for 10 "AAPL" owned by "u-1"
    When "u-1" calls ConfirmOrder for "ord-1" with filled_qty <qty> and filled_avg_price <price>
    Then the call fails with INVALID_ARGUMENT
    And order "ord-1" is unchanged and no "account.positions.synced" is emitted

    Examples:
      | qty  | price |
      | NaN  | 150.0 |
      | +Inf | 150.0 |
      | 10   | NaN   |
      | 10   | -5.0  |
      | 10   | +Inf  |

  @AC-5 @FR-6 @regression @feature-256
  Scenario: ConfirmOrder does not report success when the positions emit fails
    Given an offline BUY order "ord-1" for 10 "AAPL" owned by "u-1"
    And recomputeAndEmitOfflinePositions fails for the account of "ord-1"
    When "u-1" calls ConfirmOrder for "ord-1" with filled_qty 10 and filled_avg_price 150.0
    Then either the emit is retried until "account.positions.synced" is published for the account
    Or the call returns an error, and a repeat ConfirmOrder with the same values succeeds and emits "account.positions.synced"

  @AC-7 @FR-7 @regression @feature-256
  Scenario Outline: Valid fills keep the existing offline status derivation
    Given an offline BUY order "ord-1" for 10 "AAPL" owned by "u-1"
    When "u-1" calls ConfirmOrder for "ord-1" with filled_qty <qty> and filled_avg_price 150.0
    Then order "ord-1" has status <status>
    And "account.positions.synced" is emitted for the account of "ord-1"

    Examples:
      | qty | status           |
      | 4   | PARTIALLY_FILLED |
      | 10  | FILLED           |

  @AC-10 @FR-5 @FR-7 @regression @feature-256
  Scenario: An un-confirm with filled_qty 0 stays valid without a fill price
    Given an offline BUY order "ord-1" for 10 "AAPL" owned by "u-1" confirmed with filled_qty 10 and filled_avg_price 150.0
    When "u-1" calls ConfirmOrder for "ord-1" with filled_qty 0 and filled_avg_price 0
    Then the call succeeds and order "ord-1" has status NEW
    And "account.positions.synced" is emitted for the account of "ord-1"

### Notes / ambiguities / conflicts
- Attribution follows the observable subject. Portfolio owns AC-1, 2, 3, 6, 8 and 9 (event consumer, offline_state_unavailable on reads). Trading owns AC-4, 5, 7 and 10 (the ConfirmOrder RPC and its emit).
- feature.md also lists ui and agent as reviewers (steps 13-15). No scenario asserts on their observable surface, so no ui or agent suite gets a write.
- No CONFLICT found. AC-10 against @AC-48 @feature-240 (services/xstockstrat-trading/acceptance/offline-account-full-pnl.feature L96-103) is consistent: both give status NEW on filled_qty 0. The AC-48 re-confirm with no fees or filled_at is unaffected by the new non-finite and negative rejection.
- Weak overlap, no write skipped. AC-7 against the partial and full confirms in trading offline-account-full-pnl.feature and offline-account-portfolios.feature. AC-3 against the quote-error scenarios at portfolio offline-account-full-pnl.feature ~L146. Neither asserts the same outcome. Possible later consolidation candidates for a human.
- I did not check the platform.feature suite or the agent and ui suites beyond a grep for the key terms (UpsertOfflineRealized, ConfirmOrder, offline_state_unavailable). It found nothing there.
- The 'account.deregistered' consumer is not covered by any existing portfolio suite, per my grep.

### Coverage check
- Source scenarios: 10 (AC-1 to AC-10). Planned: 10 NEW, 0 DUP, 0 OVERLAP, 0 CONFLICT. Nothing skipped. Portfolio gets 6 (AC-1, 2, 3, 6, 8, 9). Trading gets 4 (AC-4, 5, 7, 10).
````
