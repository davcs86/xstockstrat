# Recon: fix-trading-reconcile-reads

**Created**: 2026-11-17
**From**: product-spec.md
**Tree**: feature/fix-trading-reconcile-reads@13f1c719 (`services/xstockstrat-trading` identical to origin/main-dev@149351de; feature 353's merge `4c87ea83` (#1568) is an ancestor). The digests arrived UNSTAMPED; every `path:line` below was re-grepped at this tree.
**Affected services**: xstockstrat-trading (upstream, unchanged: xstockstrat-portfolio `ListPositions`)

---

## Objective

`reconcileTick` reads an account's platform positions with one `ListPositions` call (`PageSize: 500`) and
ignores `next_page_token`. On an account with more than 500 positions, every symbol past page 1 reads as
qty 0, diverges from the broker, and (unless `NetFilledQtyBySymbol` explains it) halts the account after the
grace ticks. The fix drains the cursor and fails closed. A page error, a deadline, or a repeated token skips
the account's position-side check for the tick. It never compares against a truncated set and never halts.

## Codebase Map

- **`xstockstrat-trading`** (Go)
  - Entry point: the poller calls `s.reconcileTick(ctx, int(s.cfgW.GetInt("reconciliation.grace_ticks", 1)), …)` at `services/xstockstrat-trading/internal/service/trading.go:2021`
  - Handler: `func (s *TradingService) reconcileTick(ctx, graceTicks, systemicThresholdPct) (systemicCount, totalAccounts int)` at `trading.go:2089`
  - **Defect site**: `trading.go:2231-2239`. `listPosCtx` is a fresh `context.WithTimeout(ctx, timeout)` with `x-user-id` injected (:2234). The single call `s.portfolio.ListPositions(… AccountId: &accountID, TradingMode: tradingMode, Page: &commonv1.PageRequest{PageSize: 500})` is at :2235-2238, and `next_page_token` is never read.
  - Existing skip path (the FR-2 model): `trading.go:2240-2243`, `slog.WarnContext(… "reconcileTick: portfolio ListPositions failed" …)` then `continue // not counted toward systemic`. This `continue` also skips `s.resolveUnknownIntents(ctx, accountID, entry, brokerOrders)` at :2292. The order-side checks have already run earlier in the loop body.
  - Truncated-set consumer: `platformBySymbol` is built at `trading.go:2244-2247`. It feeds `divergingSymbols` (:2254-2259) and the compare/record/emit loop (:2275-2288).
  - Candidate/finding path (AC-2/AC-3 must show it is not reached): key `accountID + ":pos:" + bp.Symbol` (:2277), `clearReconciliationCandidate` (:2281), `recordReconciliationCandidate(key, graceTicks)` (:2284), `emitReconciliationFinding(… mismatchClassQuantityDiscrepancy …)` (:2285). Definitions are at `trading.go:2038`, `:2051` and `:2060`. State lives in `halted map[string]bool` (`trading.go:178`) and `reconcileCandidates map[string]int` (`trading.go:191`).
  - DB-grounding seam: `positionQtyLookup.NetFilledQtyBySymbol` interface at `trading.go:66-72`, called at :2263. A lookup error sets `skipPositionCheck` (:2261, :2270), the same fail-safe posture this fix needs.
  - Per-call timeout: `timeout := brokerCallTimeout(s.cfgW)` at `trading.go:2109` (`func brokerCallTimeout` at :2585). There is no overall budget across calls in the loop.
  - Offline skip (FR-4): `trading.go:2095` (`BROKER_TYPE_OFFLINE` → `continue` while building `brokerMap`).
  - Systemic accounting: `systemicCount++` only at `trading.go:2135` and `:2224` (broker-side failures), and escalation at :2299-2300 → `escalateSystemic` (:2310). The `ppErr` skip does **not** increment it (comment at :2242).
  - Last migration: `011_offline_fees_snapshot_headers.up.sql` (`services/xstockstrat-trading/migrations/`). Not touched.
  - Config-read pattern: `s.cfgW.GetInt("reconciliation.grace_ticks", 1)` at `trading.go:2021`. No new key.
  - Only production `ListPositions` call site in trading: `trading.go:2235` (grep of `services/xstockstrat-trading/internal` excluding tests).

## Patterns to REUSE

- **Fail-closed token drain loop** → mirror `PortfolioService.collectFills` at `services/xstockstrat-portfolio/internal/service/portfolio_service.go:1111-1167`. It sends `PageRequest{PageSize, PageToken: token}` (:1119), returns an error on an RPC error (:1121-1123), rejects an empty page that still carries a token (:1124), reads `resp.GetPage().GetNextPageToken()` (:1159), returns on `""` and **errors on `next == token`** (:1160-1165). Shape it as a small trading-local helper or inline loop returning `(positions, error)`. The caller keeps the existing `ppErr` WARN + `continue`.
- **Skip-the-tick on incomplete read** → reuse the existing `ppErr` branch at `trading.go:2240-2243` unchanged. Any page error, deadline, or repeated token routes into it, so candidates are untouched, there is no halt, and nothing is counted toward systemic.
- **Per-page timeout** → reuse `timeout` from `trading.go:2109` and the `x-user-id` injection at :2234. Open for design: one `WithTimeout` per page, or one context across all pages.
- **Ignore-token RED fake + call cap** → mirror `services/xstockstrat-portfolio/internal/service/portfolio_pnl_paging_test.go:27-28` (`pagingCallCap = 100`), `:34` (`ignoreToken bool`), `:43` (cap check), `:49` (token honoured unless `ignoreToken`), `:146` (usage).
- **Test harness** (`services/xstockstrat-trading/internal/service/trading_reconciliation_test.go`):
  - `fakeReconciliationPortfolioClient` (:122) with the `listPositionsFn` hook (:124, dispatched at :128-129). Existing per-call usages are at :617 and :655 and can be extended to count calls and serve pages by `req.GetPage().GetPageToken()`.
  - `fakeReconciliationBroker` (:79), whose `getPositionsFn` (:81) returns 501 `broker.BrokerPosition`.
  - `fakePositionQtyLookup` (:228). Leave it empty so "SYM501" is not explained.
  - `recordingLedgerClient` (:137), to assert no `reconciliation.mismatch_found`.
  - `newTestReconciliationService(...)` (:168) and `noopAccountRepo` (:250). `fakeNotifyClient` is declared in `trading_bracket_test.go:180`.
  - Multi-tick grace pattern: `svc.reconcileTick(context.Background(), 1, 1.1)` twice at :554-555.

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-1 @regression @feature-206` "A broker position explained by the platform's own filled orders does not halt" (`services/xstockstrat-trading/acceptance/fix-reconciliation-false-halt.feature`). `NetFilledQtyBySymbol` must still explain a broker qty that the portfolio read shows as 0. After the fix, "0" means absent from the **full** drained set.
- **PRESERVE** `@AC-2 @regression @feature-206` "A genuinely foreign broker position still halts" (same file). A real quantity_discrepancy past the grace window still emits `reconciliation.mismatch_found` and halts, now evaluated against the full drained set. Draining must not suppress true findings.
- **PRESERVE** `@AC-3 @regression @feature-206` "A net-filled-qty lookup error never causes a false halt" (same file). This is the same fail-closed posture the new page-error skip follows.
- **PRESERVE** `@AC-9 @FR-4 @feature-249 @regression` "A credential-rejected IBKR broker call is not counted as systemic" (`services/xstockstrat-trading/acceptance/fix-ibkr-request-signing.feature`). The broker-side `ListOrders`/`GetPositions` skip and the systemic accounting stay unchanged.
- **PRESERVE** `@AC-45 @FR-1 @feature-294` "Repeated systemic escalation is countable and the broker label covers IBKR" (`services/xstockstrat-trading/acceptance/signal-map-instrumentation.feature`). `escalateSystemic` and the `trading.escalation.systemic` counter stay unchanged. A portfolio page failure must stay out of `systemicCount`, as `ppErr` is today (`trading.go:2242`).
- **PRESERVE** `@AC-7 @FR-2 @feature-169` "Reconciliation poller resumes ticking after ResumeAccount" (`services/xstockstrat-trading/acceptance/resume-halted-account.feature`).
- **PRESERVE** `@AC-1 @FR-1 @FR-2 @feature-169` "ResumeAccount clears persistent and in-memory halt state" (same file). `HALT_SOURCE_RECONCILIATION` semantics stay unchanged.
- **EXTEND** (additive, no conflict): 358's `@AC-1`, `@AC-2` and `@AC-3` add new cases alongside 206 `@AC-1`..`@AC-3` without contradicting their Then clauses. No **CHANGE** is proposed.
- `docs/sdd/business-rules/platform.feature`: no reconciliation or `ListPositions`-paging guarantee. Lines 1-796 were read; the rest was grep-only for reconcil/next_page_token/ListPositions/page_token/HALT_SOURCE/halted. No existing suite covers `ListPositions` paging.

## Dependencies

- Proto/RPC: none changed. Consumed as-is: `ListPositionsRequest{ page = 2, trading_mode = 3, optional account_id = 4 }` and `ListPositionsResponse{ positions = 1, page = 2 }` (`packages/proto/portfolio/v1/portfolio.proto:194-207`); `PageRequest{ page_size = 1, page_token = 2 }` and `PageResponse{ next_page_token = 1, total_count = 2 }` (`packages/proto/common/v1/common.proto:10-17`).
- Migration: none.
- Config keys: none new. This reuses `reconciliation.grace_ticks` and the broker call timeout via `brokerCallTimeout` (`trading.go:2585`).
- Inter-service edges: existing trading → portfolio `ListPositions` (gRPC), now 1..N calls per account per tick.
- New env vars / ports: none.

## Risks / Not-found

- **Upstream dependency (feature 353)**: `status.md` is `code-completed`. Its PR `4c87ea83` (#1568) is on origin/main-dev and is an ancestor of this tree, so the server-side token fix is present. 358 still must not merge ahead of 353's lifecycle. Merge-order tracking is outside this feature dir.
- **fails.md:3312 trap** (257 `fix-ledger-query-pagination`): a consumer that treats a page error as end-of-data, or loops on a repeated token, hides the defect. Requirements: fail closed, reject `next == sent`, and RED against a fake that ignores the token, with a call cap so the unfixed loop cannot hang the test.
- **fails.md:2534 trap** (206 false halt): a safety-gate comparator against a lagging or partial projection false-fires. This is the same class, a truncated projection. The DB-grounding path must keep seeing the full set.
- **Timeout budget (design question)**: today there is one `WithTimeout(timeout)` for one call. If draining uses a fresh per-page timeout, worst-case tick time grows with page count. A single shared context bounds it but may deadline on big accounts, which skips safely. Design picks one; both are fail-closed.
- **Systemic accounting (design question, answered by code)**: `ppErr` does not count toward `systemicCount` (`trading.go:2242`). If a portfolio outage skips every account, there is no `REDUCE_ONLY` escalation, as today. The design should state that this is kept deliberately (AC-45 preserve).
- **`resolveUnknownIntents` skip**: the existing `continue` also skips intent resolution (:2292) for that account and tick. Keeping it matches today's `ppErr` behaviour. Changing it is out of scope.
- **Empty page with a token**: portfolio's precedent rejects it (:1124). FR-3 covers only `next == sent`. Design should decide whether to also fail closed on an empty page that carries a non-empty token (an advisory hardening that stays within FR-2's "incomplete read").
- **Duplicate symbol across pages**: `platformBySymbol` assignment overwrites, so a duplicated symbol would silently keep the last qty. 353 guarantees exactly-once. Design may decide whether to reject repeats, as `collectFills` rejects repeated event ids.
- **Doc touch**: `services/xstockstrat-trading/docs/reconciliation.md:57` describes the `ListPositions` projection compare. Design should decide whether a paging line belongs there.
- **Other `reconcileTick` tests** route through the portfolio fake (`trading_ibkr_auth_test.go`, `trading_telemetry_test.go`). Their default single-page empty response must stay valid, so re-run them after the change.
- Defect report `docs/reports/2026-11-17-trading-reconcile-reads-first-500-positions-defect.md`: not re-opened in recon. product-spec.md carries its content.

## Recommended Scope

Advisory, single step pair (quick depth):

1. **test (RED first)**: add AC-1/AC-2/AC-3 tests in `trading_reconciliation_test.go` with a paging `listPositionsFn` (token-honouring, page-2 `Unavailable`, ignore-token plus call cap and per-tick call count ≤ 2). Confirm AC-1 and AC-3 fail on the current single-call code. AC-2 may pass vacuously before the fix because page 2 is never requested; record that and make the RED meaningful (e.g. assert a page-2 request was made). Optionally add a deadline variant of FR-2.
2. **service**: replace the single call at `trading.go:2231-2239` with a fail-closed drain (the `collectFills` shape) feeding the unchanged `ppErr` skip at :2240-2243. No other production file changes. Run `GOWORK=off go test ./...` from `services/xstockstrat-trading`.
