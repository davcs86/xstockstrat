# Recon: fix-alert-event-targeting

**Created**: 2026-11-11
**From**: product-spec.md
**Tree**: detached@c4fd48b0a ≡ origin/main-dev (no `feature/fix-alert-event-targeting` branch on origin at recon time)
**Affected services**: xstockstrat-trading, xstockstrat-portfolio

---

## Objective

Two per-account risk signals are emitted without owner attribution. In trading, the automatic-halt (`haltAccount`)
and reconciliation-mismatch (`emitReconciliationFinding`) CRITICAL alerts carry no `TargetUserId`, so since feature
242 (untargeted = admin-only push) the account owner gets no Web Push. In portfolio, `emitRiskAlert` writes every
concentration and drawdown breach as a `portfolio.risk.drawdown_breach` ledger event on the global `portfolio:risk`
stream with only a free-text `message`, so concentration breaches are mislabelled and no breach can be attributed to
a user. The fix resolves the owner at the trading emit sites, and splits the portfolio ledger event by kind with
`user_id` (plus `symbol` / `account_id`). No proto, migration or config change.

## Codebase Map

- **`xstockstrat-trading`** (Go)
  - Reconciliation alert site: `emitReconciliationFinding` — `services/xstockstrat-trading/internal/service/trading.go:2014`.
    Early-returns if `isAccountHalted` (`:2015`); appends `reconciliation.mismatch_found` with owner `""` (`:2018`);
    calls `s.haltAccount(...)` (`:2025`); then emits its own CRITICAL `reconciliation` alert with no `TargetUserId`
    (`:2026-2032`); `s.recordAlertEmit(ctx, alertKindReconciliation, err)` (`:2033`).
    Callers: `:2116`, `:2126`, `:2160`, `:2239` (all inside `reconcileTick`).
  - Halt alert site: `haltAccount` — `trading.go:2872`. In-memory already-halted early return under `haltedMu`
    (`:2875-2878`); DB write `UpdateHaltStatus` on a 5s `dbCtx` (`:2886-2890`); CRITICAL `halt` alert with no
    `TargetUserId` (`:2892-2898`); `recordAlertEmit(ctx, alertKindHalt, err)` (`:2899`).
    Callers: `emitReconciliationFinding` (`:2025`) and `flattenAndHalt` (`:3013`, with `context.Background()`).
  - Systemic alert (must stay untargeted, out of scope): `trading.go:2282-2288`, Title "Systemic broker-reconciliation
    failure — trading reduced to REDUCE_ONLY" at `:2285`, `recordAlertEmit(..., alertKindReconciliation, ...)` `:2289`.
  - Resume alert (out of scope, untargeted): `trading.go:3219-3225` (`Category: "account"`, INFO).
  - Owner sources:
    - `brokerPoolEntry.userID` — `trading.go:75-81` (pool `s.brokers[accountID]` under `s.brokersMu`).
      `reconcileTick` snapshots it into `brokerMap` (`:2046-2047`); `flattenAndHalt` reads `s.brokers[bracket.AccountID]`
      (`:3009-3011`).
    - `BrokerAccountRecord.UserID` — `internal/repository/account_repo.go:18-24`; `GetBrokerAccount` interface
      `account_repo.go:45`, impl `:100`. Existing service calls: `trading.go:490`, `:1189`, `:2668`, `:3145`, `:3185`, `:3231`.
  - Alert-kind consts: `alertKindReconciliation` / `alertKindHalt` — `trading.go:3908-3909`.
  - Targeting reference pattern: `TargetUserId: order.UserId` — `trading.go:3509`, `:3948`, `:3965`.
  - Ledger emit helper: `emitLedgerEvent(ctx, eventType, streamKey, userID, payload)` — `trading.go:3879`.
  - Last migration: `011_offline_fees_snapshot_headers.up.sql` (`services/xstockstrat-trading/migrations/`); none needed.
  - Config-read pattern: not touched by this fix.

- **`xstockstrat-portfolio`** (Go)
  - Risk check: `checkRiskLimits(ctx, userID, mode)` — `services/xstockstrat-portfolio/internal/service/portfolio_service.go:1279`;
    only caller is the fill consumer `:484` (`s.checkRiskLimits(ctx, fill.UserID, mode)`).
    - Config reads: `risk.max_drawdown_pct` / `risk.concentration_limit_pct` via `s.cfg.GetFloat` (`:1280-1281`).
    - Unpriced positions skip concentration with a WARN (`:1291-1293`); drawdown still runs.
    - Concentration call: `:1307` `s.emitRiskAlert(ctx, userID, fmt.Sprintf("concentration limit breach: %s at %.1f%%", sym, pct*100))` (`sym`, `pct` in scope).
    - Drawdown call: `:1315` `s.emitRiskAlert(ctx, userID, msg)` over `evaluateDrawdowns(drawdowns, maxDrawdownPct)`.
  - `evaluateDrawdowns(rows []repository.AccountDrawdown, limit float64) []string` — `portfolio_service.go:1263`;
    `d.AccountID` is only embedded in the message text (`:1271-1273`), so `account_id` in the payload needs this
    helper's return shape (or the call site) to change.
  - Buggy site: `emitRiskAlert` — `portfolio_service.go:1320-1335`. Ledger: `s.emitEvent(ctx, "portfolio.risk.drawdown_breach", "portfolio:risk", {"message": msg})`.
    The notify alert in the same helper already has `Category: "risk"`, WARNING, `TargetUserId: userID` — only the
    ledger event is wrong.
  - `emitEvent` — `:1337` delegates to `emitEventAs(ctx, "", ...)`; `emitEventAs(ctx, ownerUserID, eventType, streamKey, payload)` —
    `:1342` sets `AppendEventRequest.UserId` (`""` → ledger falls back to `x-user-id` metadata).
  - Last migration: `018_watchlist_signal_expiry.up.sql`; none needed.
  - Docs: `services/xstockstrat-portfolio/CLAUDE.md:149` (§ Ledger Events Emitted, `portfolio.risk.drawdown_breach | Max drawdown exceeded`);
    `services/xstockstrat-portfolio/docs/context-constitution-findings.md:63` (lists this defect).

## Patterns to REUSE

- Trading owner for the alert → reuse `brokerPoolEntry.userID` (`trading.go:75-81`) under `s.brokersMu.RLock`, the
  same owner already propagated into `account.positions.synced`; fall back to `s.accountRepo.GetBrokerAccount(...).UserID`
  (`account_repo.go:45`) only if the pool entry is absent.
- Trading `TargetUserId` field → mirror `TargetUserId: order.UserId` (`trading.go:3509`).
- Owner lookup placement in `haltAccount` → after the already-halted early return (`:2875-2878`), never before it,
  so a repeat halt does no extra work.
- Portfolio per-kind ledger event with owner → `emitEventAs` (`portfolio_service.go:1342`) with `user_id` in payload,
  mirroring the watchlist events (`portfolio_service.go:2199`, `:2317`: `"user_id": userID, ...`).
- Payload convention → hand-written map/struct as elsewhere in portfolio (`closedPositionPayload` is the model helper per digest).
- Tests:
  - Trading: `fakeNotifyClient.calls []*notifyv1.EmitAlertRequest` (`internal/service/trading_bracket_test.go:179`);
    `traceCapturingNotify` (`trading_order_state_audit_test.go:659`); `failingNotifyClient` (`trading_resume_account_test.go:353`).
    `noopAccountRepo` (`trading_reconciliation_test.go:250`) embeds the interface and only implements `UpdateHaltStatus`
    — calling `GetBrokerAccount` on it would nil-panic, so a fallback lookup needs a repo fake that implements it
    (`mockResumeAccountRepo` `trading_resume_account_test.go:25`, `offlineAccountRepo` `trading_offline_test.go:32`).
    Halt/reconcile templates: `TestReconcileTick_QuantityDiscrepancy_PastGraceWindow_HaltsAndEmits` (`trading_reconciliation_test.go:539`),
    `TestReconcileTick_MissingBrokerOrder_HaltsAndEmits` (`:576`); systemic-untargeted assertion home:
    `TestReconcileTick_SystemicThresholdCrossed_EscalatesToReduceOnly` (`:762`).
  - Portfolio: `newQuoteSvc` (`portfolio_quote_deadline_test.go:96`) already wires `fakeLedger` (`:104`) and returns it;
    `fakeLedger.reqs []*ledgerv1.AppendEventRequest` (`watchlist_service_test.go:303-315`) captures the appended event
    for AC-2. `recordingNotify` (`portfolio_quote_deadline_test.go:349`). Templates: `TestCheckRiskLimits_AC3_SumsAcrossAccounts` (`:446`),
    `TestCheckRiskLimits_AC9_UnpricedSkipsConcentrationDrawdownStillAlerts` (`:471`), `TestCheckRiskLimits_242_AC6_DrawdownTargetsOwner` (`:517`).

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-3` "A portfolio risk breach alert is targeted at the account owner" (`services/xstockstrat-portfolio/acceptance/fix-push-untargeted-broadcast.feature`, `@FR-3 @regression @feature-242`) — concentration notify alert keeps category "risk", WARNING, `target_user_id`; the fix is ledger-only.
- **PRESERVE** `@AC-6` "A portfolio drawdown breach alert is targeted at the account owner" (same file, `@feature-242`) — drawdown alert body stays byte-identical and targeted.
- **PRESERVE** `@AC-1` "An account whose equity falls below its peak by more than the configured pct alerts" (`services/xstockstrat-portfolio/acceptance/drawdown-enforcement.feature`, `@FR-1 @regression @feature-172`) — the event split must not drop or silence drawdown alerts.
- **PRESERVE** `@AC-3` "Concentration sums a symbol across accounts and alerts on the true weights" (`services/xstockstrat-portfolio/acceptance/fix-after-hours-positions-priced.feature`, `@FR-5 @feature-231`) — alert set/wording unchanged; new concentration events cover the same symbols and weights.
- **PRESERVE** `@AC-9` "Any unpriced position skips concentration but drawdown still alerts" (same file, `@feature-231`) — no concentration event when the check is skipped; drawdown event still fires.
- **PRESERVE** `@AC-2` "A genuinely foreign broker position still halts" (`services/xstockstrat-trading/acceptance/fix-reconciliation-false-halt.feature`, `@regression @feature-206`) — owner resolution must not block, delay or fail the halt or the `reconciliation.mismatch_found` event.
- **PRESERVE** `@AC-1` / `@AC-3` of the same file (`@regression @feature-206`) — no new halt path.
- **PRESERVE** `@AC-3` "ResumeAccount emits an INFO alert" and `@AC-2` (ledger `account.halt.resumed`) (`services/xstockstrat-trading/acceptance/resume-halted-account.feature`, `@feature-169`) — out of scope; untouched.
- **PRESERVE** `@AC-45` (`services/xstockstrat-trading/acceptance/signal-map-instrumentation.feature`, `@FR-1 @feature-294`) — systemic escalation path, metric and alert stay system-wide and untargeted; `@AC-4` (`trading.ledger_emit` counters) applies only if trading's ledger emit changes.
- **EXTEND** — the feature's own `@AC-1` (halt + reconciliation alerts target the owner; systemic stays empty) and `@AC-2` (concentration event is not `drawdown_breach`, carries `user_id` + `symbol`); no existing scenario covers either.
- `docs/sdd/business-rules/platform.feature`: no cross-service guarantee on per-account alert targeting or risk-breach ledger events (only `portfolio.risk.max_drawdown_pct` as a config-key example).
- No **CHANGE** identified.

## Dependencies

- Proto/RPC: none — `EmitAlertRequest.TargetUserId` already exists and is used (`trading.go:3509`); ledger event types are strings.
- Migration: none (next would be trading `012`, portfolio `019`).
- Config keys: none new; existing `portfolio.risk.max_drawdown_pct` (0.10) / `portfolio.risk.concentration_limit_pct` (0.20) unchanged.
- Inter-service edges: unchanged — trading → notify (`EmitAlert`), portfolio → ledger (`AppendEvent`), portfolio → notify.
- New env vars / ports: none.

## Risks / Not-found

- **Open question 1 (audience) — needs design decision.** Targeting the owner under feature 242 semantics may remove
  the admin push for per-account halts/reconciliation. Owner-only vs owner + admins is not answered by code.
  The review flagged a `ListAlerts` untargeted-visibility coupling with feature 312 (context.md, 2026-11-10 review).
- **Open question 2 (event naming / stream key) — needs design decision.** New concentration event type name and
  whether `portfolio:risk` moves to a per-user key. Repo-wide grep (`services`, `docs/sdd`, `scripts`, proto sources;
  `.go/.ts/.tsx/.py/.feature/.sql/.tsv`, excluding generated stubs) for `drawdown_breach|portfolio:risk` found **no
  consumer** outside `portfolio_service.go` itself; docs references are `services/xstockstrat-portfolio/CLAUDE.md:149`
  and `docs/context-constitution-findings.md:63`. Re-keying is therefore consumer-safe in-repo; external ledger readers
  (dashboards, agent queries) were not checked.
- **Owner-lookup failure** in trading is unspecified. By `@AC-2 @feature-206` the halt and finding must still happen;
  falling back to an untargeted (admin-only) alert rather than suppressing it is the digest's reading — design must decide.
- **Double CRITICAL per finding.** `emitReconciliationFinding` calls `haltAccount` (which emits a `halt` alert) and then
  emits its own `reconciliation` alert (`trading.go:2025-2032`); targeting both sends the owner two pushes per finding.
  Not a regression (admins get two today) — note for design, do not fix out of scope.
- **Test fake trap:** `noopAccountRepo` only implements `UpdateHaltStatus`; a `GetBrokerAccount` fallback in
  `haltAccount` would nil-panic existing reconcile tests unless the pool owner is used first or the fake is extended.
- `flattenAndHalt` calls `haltAccount` with `context.Background()` (`trading.go:3013`); any lookup there uses an
  un-propagated context — owner from the pool avoids a DB round-trip on that path.
- `evaluateDrawdowns` returns messages only (`portfolio_service.go:1263`); carrying `account_id` needs a shape change,
  and the drawdown alert body must remain byte-identical (`@AC-6 @feature-242`).
- Adjacent, out of scope: `reconciliation.mismatch_found` ledger event is appended with owner `""` (`trading.go:2018`).
- Ledger traps applied: fails.md 2026-08-06 fundamentals-data-source ("read a reused helper's full body before
  reusing it" — `emitRiskAlert` hard-codes the event type); fails.md 2026-10-21 fix-push-untargeted-broadcast (do not
  justify any relayed scope via mTLS; persist debate state durably before a status flip, P-05).
- Checkout of the digests was UNSTAMPED; every `path:line` above was re-grepped at `c4fd48b0a`.

## Recommended Scope

Advisory, not binding:

1. **trading service step** — resolve owner (pool `userID`, `GetBrokerAccount` fallback, untargeted on failure)
   and set `TargetUserId` on the `haltAccount` and `emitReconciliationFinding` alerts; leave the systemic and resume
   alerts untouched.
2. **trading test step** — AC-1: halt + reconciliation alerts carry the owner; systemic alert stays empty
   (extend `TestReconcileTick_SystemicThresholdCrossed_EscalatesToReduceOnly`); lookup failure still halts and alerts.
3. **portfolio service step** — split `emitRiskAlert` per kind: concentration event (new type) with `user_id` +
   `symbol`, drawdown event keeps `portfolio.risk.drawdown_breach` with `user_id` + `account_id`; via `emitEventAs`;
   alert bodies unchanged. Update `CLAUDE.md` § Ledger Events Emitted and `context-constitution-findings.md:63`.
4. **portfolio test step** — AC-2 using `newQuoteSvc`'s `fakeLedger.reqs`; preserve `@AC-9` (no concentration event
   when skipped) and `@AC-6` (drawdown body byte-identical).
