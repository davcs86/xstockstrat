# Recon: fix-ui-trader-feedback

**Created**: 2026-10-22
**From**: product-spec.md
**Affected services**: xstockstrat-ui (fix site for all four defects), xstockstrat-analysis (read-only), xstockstrat-trading (read-only)
**Severity**: SEV-2 (Track C)

---

## Objective

This feature fixes four UI defects on `/trader` and `/insights`, grouped from the 2026-10-20 debt-radar scan:

- **D-11.** Order and alert streams fail silently and never reconnect, and a stale streamed order masks a fresher poll.
- **D-17.** A `?? 'paper'` display default leaks into the order request while the environment mode is unknown.
- **D-45.** The symbol-page backtest sends `strategyIdRef` without `strategyId`, so the run is never fingerprinted and never reaches the strategy's history or grade.
- **D-64.** Snooze/Dismiss/Take, the signal-source toggle and the ledger export fail with no visible error, and there is no global mutation error fallback.

Every fix is in `xstockstrat-ui`. Analysis and trading already have the server behavior the fix depends on.

## Codebase Map

All UI paths below are under `services/xstockstrat-ui/` and were re-checked on `origin/feature/fix-ui-trader-feedback` @ bc82ae38 on 2026-10-22.

- **`xstockstrat-ui`** (Next.js / TypeScript)
  - **D-11, order stream.**
    - `src/hooks/useOrderUpdates.ts:13-31`: a `useEffect` keyed on `filterKey` opens `tradingClient.streamOrderUpdates` with an `AbortController`. The `catch {}` at `:24-26` stops silently, with no reconnect and no error state. The hook returns `Record<string, Order>`.
    - Only consumer: `src/components/trader/OrdersTable.tsx:59`. The merge at `:65-68` is `orders.map((o) => liveUpdates[o.orderId] ?? o)`, so the streamed record always wins (FR-1 target).
    - `OrdersTable` is rendered by `src/app/trader/orders/page.tsx` and by the dashboard `OrderBook`.
  - **D-11, alert stream.** `src/components/trader/AlertStream.tsx:38-48` has the same pattern, with a silent `catch {}` at `:44-46`. It is mounted in the header and already holds `useState` for alerts and `unreadCount`.
  - **D-17, environment mode.**
    - Source: `src/context/AccountContext.tsx`. `EnvironmentMode = 'paper' | 'live'` (`:11`) and `null` means unknown. `fetchEnvironment` (`:56-63`) maps any non-LIVE response to `'paper'` and leaves `null` on failure.
    - The display default `environmentMode ?? 'paper'` appears at five sites:
      - `src/app/trader/page.tsx:19`, which exports `type TradingMode = 'paper' | 'live'` at `:12`.
      - `src/app/trader/orders/page.tsx:16`, which imports that type.
      - `src/app/trader/positions/page.tsx:48`, with its own local type at `:38`.
      - `src/app/trader/positions/[symbol]/page.tsx:110`, with its own local type at `:84`.
      - `src/app/trader/portfolio/page.tsx:27`, which has no type annotation.
    - `mode` fans out beyond those five sites:
      - `OrderForm`/`OrderBook` props: `page.tsx:32,36`, `orders/page.tsx:48`, `[symbol]/page.tsx:429`.
      - Read hooks: `usePositions`, `usePortfolio`, `useOrders`.
      - Copy strings: `orders/page.tsx:59` (`No ${mode} orders`), `positions/page.tsx:509`, `[symbol]/page.tsx:580`.
  - **D-17, request mode.**
    - `src/components/trader/OrderForm.tsx:139` sends `tradingMode: mode === 'live' ? PbTradingMode.LIVE : PbTradingMode.PAPER`. The proto import is at `:13`.
    - The read-path hooks do the same mapping with a local `toPbMode`:
      - `src/hooks/useOrders.ts:31-32`, used at `:37`.
      - `src/hooks/usePortfolio.ts:8-9`, `:44-45` and `:68-69`: three copies.
    - A grep for `PbTradingMode`/`toPbMode` outside these three files finds nothing more.
  - **D-17, already safe.**
    - `src/components/shared/TradingModeBadge.tsx:13` returns `null` for `mode === null`. Its consumers `AppShell.tsx:22` and `PerformanceDashboard.tsx:116` need no change.
    - `AccountsModule.tsx:55` and `AccountManagementPanel.tsx:15` already guard on `environmentMode &&`.
    - `src/app/trader/orders/[id]/page.tsx:174` labels from the order's *own* recorded `tradingMode`, not the environment mode, so it is out of FR-3's scope.
  - **D-45, symbol-page backtest.**
    - `src/app/trader/positions/[symbol]/page.tsx:1149-1159`: `runBacktest({ strategyIdRef: strategyId, symbols: [symbol], … })` with no `strategyId`. `onSuccess` invalidates `['analysis-backtests', strategyId]`.
    - The reference runner is `src/app/insights/strategies/[id]/page.tsx:99-104`, which sends `strategyId: id` and `strategyIdRef: id`.
  - **D-64, silent failures.**
    - `src/app/insights/opportunities/page.tsx:122` declares `useSetOpportunityAction()`. `act` at `:155-156` calls `setAction.mutate(...)` with no `onError`.
    - `src/app/insights/signal-sources/page.tsx:254-263`: `handleToggle` calls `manageMutate(...)` with no callbacks.
      - Sibling calls on the same page use `onError: (e) => setWeightError(errMessage(e))` (`:226`) and `setSaveError` (`:296,332`).
      - The local `errMessage(err: unknown)` helper is at `:137`.
    - `src/app/trader/portfolio/page.tsx:106-113`: `onExportEvents` does `if (!res.ok) return;` and has no try/catch. A rejected `fetch` becomes an unhandled rejection (AC-11).
    - `src/lib/queryClient.ts:11-17`: `createQueryClient()` sets only `defaultOptions.queries: { staleTime: 5_000, retry: 1 }`, with no `mutations`. Its callers are `src/app/trader/providers.tsx:9` and `src/components/shared/QueryProviders.tsx:12`.
  - **Proto (read-only).**
    - `Order.updated_at` is `google.protobuf.Timestamp updated_at = 14;` (`packages/proto/trading/v1/trading.proto:60`).
    - `TRADING_MODE_UNSPECIFIED = 0;` (`packages/proto/common/v1/common.proto:50`).
  - Last migration: n/a (no UI DB use relevant here). Config-read pattern: n/a (no config keys touched).

- **`xstockstrat-analysis`** (Python, read-only)
  - Handler/servicer: `services/xstockstrat-analysis/app/handlers/servicer.py`.
    - `RunBacktest` is at `:785`.
    - The registered-strategy lookup is `elif request.strategy_id_ref:` at `:845`. It calls `get_by_owner_and_id(caller_user_id, request.strategy_id_ref)` at `:849-851`, and a miss aborts `PERMISSION_DENIED` at `:856-859`.
    - **Fingerprint gate** at `:862-870`: `run_fingerprint` is set only when `request.strategy_id_ref and request.strategy_id == request.strategy_id_ref and executed_row is not None`. This confirms the D-45 root cause.
  - Run writes are keyed on `request.strategy_id`:
    - In-memory store: `self._backtests[(caller_user_id, request.strategy_id)]` at `:1268`.
    - Call sites: `_persist_symbol_cells` `:1280`, `_persist_backtest_run` `:1300`, `_persist_backtest_detail` `:1314`, `_recompute_headline` `:1322`.
    - Definitions: `:2927`, `:2848`, `:2901`, `:2811`.
  - **NC-D, re-verified from code. The floor holds.**
    - `_recompute_headline` returns `None` when `get_by_owner_and_id(user_id, strategy_id)` misses (`:2823-2825`). An empty `strategy_id` therefore writes **no grade**.
    - `ListBacktests` (`:3050`) aborts `PERMISSION_DENIED` unless the caller owns `request.strategy_id` (`:3062-3071`), and only then calls `list_by_strategy` (`:3074`).
    - The analytics reader does the same at `:6277-6284` before `list_by_strategy` at `:6290`.
    - Grade evidence is read only by `(user_id, strategy_id, fingerprint)` (`fetch_eligible` / `fetch_all_for_fingerprint`, `:2784-2792`).
    - Result: past symbol-page runs left inert, unreachable `strategy_id = ""` rows with a NULL fingerprint, and no phantom grade. No analysis guard or cleanup is needed for FR-4.
  - Last migration: `027_contract_owner_dimension.up.sql` (`services/xstockstrat-analysis/migrations/`). Not used by this feature.
  - Existing fingerprint tests: `services/xstockstrat-analysis/tests/test_analysis_servicer.py`.
    - The helper `_req(self, strategy_id="s1", strategy_id_ref="", …)` is at `:1916`.
    - `:1991` covers equal ids (fingerprinted). `:2017` covers differing ids (not fingerprinted).
  - Invariant: ANALYSIS-3 (definition-fingerprint eligibility), in `services/xstockstrat-analysis/docs/context-constitution.md`.

- **`xstockstrat-trading`** (Go, read-only)
  - `resolveTradingMode` is at `services/xstockstrat-trading/internal/service/trading.go:3573-3582`.
    - Its priority is: explicit request field, then the `trading.broker.paper` config key, then the `TRADING_MODE` env default.
    - `TRADING_MODE_UNSPECIFIED` resolves to the environment's mode.
  - `PlaceOrder` calls `mode := s.resolveTradingMode(req.TradingMode)` at `:456`. The other callers are at `:768` and `:2819`.
  - `StreamOrderUpdates` is at `:1667`, with its gRPC adapter at `internal/handler/trading.go:204`. It sends an initial snapshot, then live owner-filtered updates. `broadcastOrder` was not read.
  - The server stamps `UpdatedAt = timestamppb.New(time.Now())` on order mutations (`trading.go:632, :698, :722, :825, :941, :1359, :1546`). This gives FR-1's `updatedAt` comparison a real server basis.
  - Last migration: `011_offline_fees_snapshot_headers.up.sql`. Not used by this feature.

## Patterns to REUSE

- **Error surface (FR-5).** Reuse the existing primitives. There is no toast or `sonner` library in the app (a grep for `sonner` and `toast(` found nothing), and adding one would be scope creep under C-17 and the DRY guard rail.
  - The `Alert` primitive with `variant="destructive"`: `src/components/ui/alert.tsx:12`.
  - `src/components/shared/CardNotice.tsx`.
  - `src/components/shared/QueryStateMessages.tsx`, already used by `OrdersTable.tsx:27`.
- **Per-call error state (FR-5).** Reuse the local `onError` + `errMessage` + `useState` pattern that `signal-sources/page.tsx` already uses at `:226,296,332` with `errMessage` at `:137`.
  - A duplicate `errMessage` exists at `src/app/config-ui/[namespace]/NamespaceEditor.tsx:24`.
  - If a third consumer appears (for example opportunities, or a global fallback), the DRY guard rail calls for hoisting it into `src/lib/`.
- **Global mutation fallback (FR-5 / AC-10).** Extend `createQueryClient()` `defaultOptions` in `src/lib/queryClient.ts:11-17`. Both providers pick it up through their existing call sites, with no provider rewrite.
  - Design must decide how the fallback avoids double-reporting a mutation that already has its own `onError`. Options are `MutationCache.onError` with a `meta` opt-out, or the `defaultOptions.mutations.onError` override semantics.
- **Timestamp comparison (FR-1).**
  - Reuse `timestampToMillis(ts: ProtoTimestamp | undefined)` (`src/lib/protoTime.ts:11`) for protobuf-es `{seconds: bigint, nanos}`. Its test file is `src/lib/protoTime.test.ts`.
  - A pure "newer wins" helper belongs in `src/lib/*.ts` with a sibling `*.test.ts`. That is in Vitest coverage scope (`src/lib/**`).
  - Ledger insight `insights.md:1551`: a missing Timestamp must take a neutral fallback, never epoch arithmetic. An undefined `updatedAt` must not silently win or lose.
- **Server-derived trading mode (FR-3).**
  - Send the proto zero value `PbTradingMode.UNSPECIFIED` and let `resolveTradingMode` (`trading.go:3573-3582`) derive it.
  - This mirrors the root CLAUDE.md rule "paper/live is derived from environment".
  - The null-tolerant display is already in place in `TradingModeBadge.tsx:13`.
- **Reference request shape (FR-4).** Copy the `strategyId` + `strategyIdRef` pair from `src/app/insights/strategies/[id]/page.tsx:101-103`.
- **E2E failure injection.**
  - Inject per-page failures with `page.route('**/xstockstrat.trading.v1.TradingService/ListOrders', …)` as in `e2e/trader/orders.spec.ts:99`.
  - Ledger insight `insights.md:1160` says stateful mocks for parallel specs must be per-page `page.route`, not module-level singletons.
  - The mock backend `e2e/mock-backend.ts` has these handlers:
    - `getTradingEnvironment` `:333`
    - `streamAlerts` `:530`, a bounded generator: 3 alerts, then the stream ends.
    - `setOpportunityAction` `:926`
    - `manageSignalSource` `:1496`
  - There is **no** `streamOrderUpdates` handler.
- **Fixtures (C-12/C-13).** Domain data (orders with `updatedAt`, alerts, opportunities, signal sources) comes from `e2e/fixtures/`, with a new `INVENTORY.md` row for any new fixture. Auth comes from `e2e/helpers/auth.ts` (`addAuthCookie`). Error payloads stay inline.

## Existing Business Rules (preserve / extend)

- **EXTEND** `@AC-9 @FR-8 @feature-031` "The "Paper Trading" label is visible when the environment-derived mode is paper" (`services/xstockstrat-ui/acceptance/strategy-performance-dashboard.feature`): the label shows for a known paper mode. FR-3 adds the unknown-mode case, which shows no Paper label.
- **EXTEND** `@AC-10 @FR-8 @feature-031` "The "Paper Trading" label is absent when the environment-derived mode is live" (same suite): the label is absent for a known live mode. The unknown mode must also show none.
- **PRESERVE** `@AC-10 @FR-5 @feature-095` "The order ticket's execution path is unchanged" (`services/xstockstrat-ui/acceptance/opportunity-live-market-enrichment.feature`): a known production mode still goes through `usePlaceOrder` as LIVE. Only the unknown mode becomes UNSPECIFIED. If design changes known-mode behavior, this becomes a **CHANGE** and needs sign-off.
- **PRESERVE** `@AC-5 @FR-5 @feature-202` "The trader form sends the TIF as a Connect-JSON NAME-string" (`services/xstockstrat-ui/acceptance/order-time-in-force-enum.feature`): enum fields go on the wire as NAME-strings, so `tradingMode` must serialize as `TRADING_MODE_UNSPECIFIED`.
- **PRESERVE** `@AC-5 @FR-3 @feature-110` / `@AC-6 @FR-3 @feature-110`, plain-form blank-quantity rejection (`services/xstockstrat-ui/acceptance/wire-signal-confidence-to-position-sizing.feature`): FR-3 touches OrderForm.
- **PRESERVE** `@AC-4 @FR-1 @feature-110` / `@AC-7 @FR-4 @feature-110`, symbol-page ticket confidence and explicit quantity (same suite): FR-3 touches OrderForm.
- **PRESERVE** `@AC-3 @FR-2 @feature-110` "A blank quantity on the symbol-page ticket triggers the auto-sizing path" and `@AC-8 @FR-5 @feature-110` "The symbol-page OrderForm reaches PlaceOrder while the plain /trader form's blank-qty path does not auto-size" (`docs/sdd/business-rules/platform.feature`): the mode change must not alter the qty <= 0 auto-size routing.
- **PRESERVE** `@AC-1 @FR-1 @feature-159` "an offline account cannot place a broker-routed order through the order ticket" (`services/xstockstrat-ui/acceptance/fix-offline-account-ui-gaps.feature`): this feature touches OrderForm and AccountContext.
- **PRESERVE** `@AC-2 @FR-3 @feature-159 @feature-240` / `@AC-3 @FR-4 @feature-159` / `@AC-4 @FR-4 @feature-159 @feature-240`, the offline portfolio-card and combined-view rules (same suite): removing the default touches `portfolio/page.tsx`.
- **PRESERVE** `@AC-14` / `@AC-15` / `@AC-16` / `@AC-30` / `@AC-31` / `@AC-32` (`@FR-6 @feature-240`), the offline full-P&L surfaces (`services/xstockstrat-ui/acceptance/offline-account-full-pnl.feature`): D-17 edits the dashboard, portfolio, positions and symbol pages.
- **EXTEND** `@AC-9 @FR-8 @feature-021` "The UI download button exports the last 90 days of all event types" (`services/xstockstrat-ui/acceptance/ledger-event-export.feature`): FR-5 (AC-7 and AC-11) adds the failed-export error display alongside the success path.
- **PRESERVE** `@AC-6 @FR-5 @feature-021` "An unauthenticated request is rejected" (same suite): the export BFF route is unchanged.
- **PRESERVE** `@AC-1 @FR-1 @FR-2 @feature-021` / `@AC-2 @FR-2 @feature-021` / `@AC-7 @FR-6 @feature-021`, export as NDJSON and CSV with streaming (`docs/sdd/business-rules/platform.feature`): the success path is unchanged.
- **PRESERVE** `@AC-4 @FR-3 @feature-161` / `@AC-5 @FR-4 @feature-161`, the signal-sources create form and inline editor guidance (`services/xstockstrat-ui/acceptance/surface-signal-weight-decay-config.feature`): `handleToggle` is on the same page.
- **PRESERVE** `@AC-6 @FR-5 @FR-6 @feature-203` "The notifications inbox shows level, module, body, and unread state" (`services/xstockstrat-ui/acceptance/alert-read-unread-persistence.feature`): this notify surface is shared with AlertStream. Reconnect must not change unread-count semantics, and the bell badge is fetched once on mount.
- **PRESERVE** `@AC-21 @FR-10 @feature-224` "Same strategy_id for two users does not share scores or backtests" (`services/xstockstrat-analysis/acceptance/private-by-default-templates.feature`): FR-4's history visibility relies on the owner-scoped `ListBacktests`.
- **PRESERVE** `@AC-3 @FR-3 @feature-225` "Ownerless backtest runs are backfilled, then the column is NOT NULL" (`services/xstockstrat-analysis/acceptance/private-by-default-enforce-contract.feature`): analysis is read-only here, and the orphan `strategy_id=""` rows are not cleaned up.
- **PRESERVE** `@AC-4 @FR-3 @feature-150` / `@AC-5 @FR-4 @feature-150`, the run's recorded sizing mode and unchanged grade (`services/xstockstrat-analysis/acceptance/backtest-portfolio-sizing.feature`): the fingerprinted symbol-page run feeds evidence through the unchanged analysis path.
- **PRESERVE** `@AC-9 @FR-5 @regression @feature-196` "request-only dead fields stay server-ignored" (`docs/sdd/business-rules/platform.feature`): the server resolves identity and behavior from headers and environment, which is consistent with FR-3's server-side mode. The scenario names `user_id`, `is_paper` and `operation`, not `tradingMode`, so `resolveTradingMode` honoring an explicit request mode does not contradict it.
- No existing acceptance scenario for xstockstrat-trading covers `PlaceOrder` `tradingMode` or `resolveTradingMode`.
- No scenario in any suite covers:
  - `StreamOrderUpdates` or `OrdersTable` freshness.
  - Stream reconnect or `AlertStream` disconnect.
  - `SetOpportunityAction`, signal-source toggle or `queryClient` mutation errors.
  - `RunBacktest` `strategyId`/`strategyIdRef` from the symbol page.

  D-11, D-45 and D-64 are new ground, and their only guards are this feature's AC-1, AC-2, AC-4..AC-11.
- **No CHANGE flagged**, so no `context.md` sign-off is required on the evidence read.

## Dependencies

- **Proto/RPC.** No change. The feature reads existing fields:
  - `Order.updated_at` (field 14, `packages/proto/trading/v1/trading.proto:60`).
  - `TradingMode.TRADING_MODE_UNSPECIFIED = 0` (`packages/proto/common/v1/common.proto:50`).
  - `RunBacktestRequest.strategy_id` / `strategy_id_ref` (unchanged; field numbers not read).
- **Migration:** none.
  - Analysis: highest is `027`. Its CLAUDE.md also names a feature-184 seed `028`, so verify before assigning any number.
  - Trading: highest is `011`.
- **Config keys:** none.
- **Inter-service edges:** none new. Existing: UI to trading (`StreamOrderUpdates`, `PlaceOrder`, `GetTradingEnvironment`), UI to analysis (`RunBacktest`, `SetOpportunityAction`), UI to ingest (`ManageSignalSource`) and the UI BFF to ledger (export).
- **New env vars / ports:** none.
- **x-trace-id (operator standing decision, 2026-10-21).** Every touched call is a browser to BFF to backend request, so the trace id is carried by the existing `src/middleware.ts` injection.
  - A reconnecting stream must go through the same `tradingClient` / BFF path as the first subscribe. It must not open a side channel that bypasses the middleware.
  - No backend emit or write is added, so C-03 is untouched, and no waiver is needed or taken.

## Risks / Not-found

- **No `StreamOrderUpdates` mock handler** exists in `e2e/mock-backend.ts`. AC-2 needs a handler or a `page.route` that errors once and then serves a new stream. AC-9 needs `streamAlerts` (`:530`) to error, rather than end normally, and then recover.
  - Mocking a server-stream reconnect through Connect over `page.route` is unproven in this repo. Design or spec must pick the injection mechanism, and per `insights.md:1160` it must be request-scoped.
- **No reconnect or backoff helper** exists in `src/hooks/` or `src/lib/`. (This rests on a targeted grep, not an exhaustive one.) The two streams (order and alert) are the second consumer, so a shared helper is DRY-justified. Design decides whether that is a hook or a pure backoff function.
- **Normal stream end vs error.** The mock `streamAlerts` ends normally after 3 alerts. Design must decide whether a normal end also counts as "disconnected" and triggers a reconnect.
  - If it does, today's e2e (`e2e/trader/alert-stream.spec.ts`) could see a reconnect loop.
  - Unmount and abort (`ctrl.abort()`) must never trigger a reconnect.
- **Unknown-mode fan-out (D-17) is wider than the five `?? 'paper'` sites.**
  - The read hooks `useOrders`, `usePortfolio` and `usePositions` and their `toPbMode` copies take `'paper' | 'live'`. If `mode` becomes nullable, they must send UNSPECIFIED too, or wait until the mode is known.
  - Design must pick one. Today a failed `GetTradingEnvironment` makes the reads query PAPER, a second leak that FR-3 names only for `PlaceOrder`.
  - The copy strings `No ${mode} orders` (`orders/page.tsx:59`, `positions/page.tsx:509`, `[symbol]/page.tsx:580`) would render "No null orders" if they are not handled.
- **`AccountContext.tsx:59` maps any non-LIVE response to `'paper'`.** That includes a server-returned `UNSPECIFIED`. A known-unknown response therefore still asserts Paper.
  - Whether to map UNSPECIFIED to `null` is a design fork.
  - It is low-risk, because the server always resolves a concrete mode for `GetTradingEnvironment`. The handler was not located, so this is unverified.
- **`usePortfolio.ts` has three copies of `toPbMode`** (`:8`, `:44`, `:68`), and `useOrders.ts:31` has a fourth. Any change must touch all four, or hoist the mapping into one helper (DRY guard rail, one `src/lib` home).
- **Freshness with an equal timestamp (AC-8)** keeps the streamed record. An absent `updatedAt` on either side needs a defined rule. Recommended: treat absent as oldest, so an absent poll never displaces a streamed record. This follows `insights.md:1551`.
- **Global `onError` double-report.** A mutation with a per-call `onError` (for example `signal-sources/page.tsx:226`) must not also fire the global fallback, or the error shows twice. The mechanism is a design fork.
- **Fallback error surface location** is undecided: AC-5..AC-7, AC-10 and AC-11 say only "an error message is shown". There is no toast library. The global fallback needs *some* mounted surface, probably a provider-level `Alert`/`CardNotice` region in both `providers.tsx` and `QueryProviders.tsx`. It must satisfy C-17 (design-role tokens, canonical state primitives, accessible name / `role="alert"`).
- **Optional analysis guard test.** No existing analysis test covers an empty `strategy_id` with a set `strategy_id_ref` (no fingerprint, no grade). `test_analysis_servicer.py:2017` covers *differing* ids, not an empty one. FR-4 is UI-only, so a test pinning the inert-row behavior is optional.
- **Not verified:** the `broadcastOrder` body, the `GetTradingEnvironment` handler, and the field numbers of `RunBacktestRequest.strategy_id`/`strategy_id_ref`. None of these is needed for a UI-only fix.
- **Overlaps (rebase-only, from the review):**
  - `positions/[symbol]/page.tsx`: 215-block-fundamentals-strategy-on-etf (in-progress) and 245-fix-screener-symbol-isolation.
  - `insights/opportunities/page.tsx`: 215 and 246-fix-fundsignal-neutral-score.
  - `src/lib/traderBff.ts`: 263-fix-edge-owner-scope. A candidate only, since 270 names no BFF edit.
- **Applicable `fails.md` traps:**
  - `fails.md:116-132`: a silent `catch {}` is the root of D-11, and the rule says "a graceful-skip guard must never be silent". The new error and reconnect path must surface, not swallow.
  - `fails.md:358`: an impl-spec once prescribed forwarding `trading_mode` into a proto request with no such field. `/sdd-spec` must cite the actual `tradingMode` field on each request message it touches (`PlaceOrderRequest`, `ListOrdersRequest`, the portfolio requests) before changing the read hooks.
  - C-15: AC-1..AC-12 each need a test step or RED assertion. The product spec says D-11 needs a Playwright e2e.

## Recommended Scope

Advisory, not binding. It is input to the grilling and to `/sdd-spec`. All steps are in `xstockstrat-ui`.

1. **D-45 (FR-4, AC-4).** In `positions/[symbol]/page.tsx:1149-1155`, add `strategyId: strategyId` next to `strategyIdRef`. Add an e2e that asserts the RunBacktest request body carries both. This is the smallest and most isolated step, so it lands first.
2. **D-64 per-site (FR-5, AC-5, AC-6, AC-7, AC-11).**
   - Add `onError` handlers that set local error state, shown via `Alert`/`CardNotice`, on opportunities `act`, signal-sources `handleToggle` (reusing `errMessage` and the page's error state) and `onExportEvents` (try/catch plus non-ok handling).
   - Hoist `errMessage` into `src/lib/` if a third consumer appears.
   - Add e2e failure injection via `page.route`.
3. **D-64 global fallback (FR-5, AC-10).** Add the mutation `onError` fallback in `createQueryClient`, with a no-double-report rule and a mounted error surface in both providers. Add a Vitest unit test for the pure part.
4. **D-17 (FR-3, AC-3, AC-12).**
   - Make `mode` nullable through the five pages.
   - OrderForm sends `PbTradingMode.UNSPECIFIED` when the mode is `null`.
   - Decide the read-hook behavior (send UNSPECIFIED, or gate on a known mode) and collapse the four `toPbMode` copies into one helper.
   - Fix the `${mode}` copy strings.
   - Add e2e coverage with `GetTradingEnvironment` failing, checking for no Paper label on all five pages and the request mode NAME-string.
5. **D-11 freshness (FR-1, AC-1, AC-8).** Add a pure `src/lib` "newer `updatedAt` wins, ties keep the streamed record" helper with a Vitest test, and wire it into `OrdersTable.tsx:65-68`.
6. **D-11 stream recovery (FR-2, AC-2, AC-9).**
   - Add a shared reconnect-with-backoff helper used by `useOrderUpdates` and `AlertStream`. It exposes a `disconnected` state, never reconnects on abort or unmount, and goes through the same client path so x-trace-id propagates.
   - Add the disconnected indicator.
   - Add the e2e mock or route for an erroring then recovering stream.
   - This is the riskiest step (mock mechanics), so it lands last.

Design depth: the operator may run `quick`. All forks are UI-local, NC-D is closed at the floor, and no proto, config, migration or backend change is in scope.
