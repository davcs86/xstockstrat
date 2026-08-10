# Recon: unified-symbol-page

**Created**: 2026-08-10
**From**: product-spec.md
**Affected services**: `xstockstrat-ui` (primary), `xstockstrat-analysis`, `xstockstrat-portfolio`,
`xstockstrat-ingest`, `xstockstrat-trading`, **`xstockstrat-marketdata`** (missing from
product-spec.md's original list — added here; see Risks/Not-found)

---

## Objective

Consolidate three existing per-symbol/per-order pages (`/trader/positions/[symbol]`,
`/trader/orders/[id]` — feature 096; `/insights/market/[symbol]` — feature 083) into one page under
`/trader`, adding fundamentals, single-symbol screening, backtest-by-symbol, and backfill-by-symbol
sections gated on watchlist membership — reusing existing RPCs/components wherever they exist and
adding only additive BFF wiring, never new proto or new computation (product-spec FR-1–FR-14).

## Codebase Map

- **`xstockstrat-ui`** (Next.js/TS)
  - Position source page: `services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx:1-537`
    — `usePosition`+`usePortfolio`, `useOrders`, `useCandlestickChart(260)`; derives owning strategy
    from orders (no `strategy_id` on `Position`).
  - Order source page: `services/xstockstrat-ui/src/app/trader/orders/[id]/page.tsx:1-233` —
    `useOrder`, `useCancelOrder`, `EditOrderDialog`, working-state gate via `isWorking()`.
  - Signal-detail source page: `services/xstockstrat-ui/src/app/insights/market/[symbol]/page.tsx:1-223`
    — `useCandlestickChart(480)`, `useOpportunities(0)`, `useStrategyAnalytics`; embeds
    `<SignalReadiness symbol />` and `<SignalOrderTicket symbol />` (both `Suspense`-wrapped).
  - Nav: `PLATFORM_SUBNAV` — `services/xstockstrat-ui/src/components/shared/PlatformHeader.tsx:71-93`;
    `resolveActive` special-cases `/insights/market` → Decide group at `PlatformHeader.tsx:107`.
    `NAV_GROUPS` — `services/xstockstrat-ui/src/components/shared/navGroups.tsx:33-84` (`decide` /
    `discover` / `engine` / `book` / `settings`; `book` already owns `/trader/positions`,
    `/trader/orders`).
  - Trade widget: `services/xstockstrat-ui/src/components/trader/OrderForm.tsx:41-48`
    (`OrderForm({ mode, initialSymbol })`); reuse precedent at
    `services/xstockstrat-ui/src/components/insights/SignalOrderTicket.tsx:1-28` (wraps its own
    `AccountProvider` since `/insights` has none).
  - Account context: `services/xstockstrat-ui/src/context/AccountContext.tsx:27`
    (`AccountProvider`); ambient mount only at `services/xstockstrat-ui/src/app/trader/providers.tsx:6,13`
    — confirmed absent under `src/app/insights/`.
  - BFFs: `services/xstockstrat-ui/src/lib/traderBff.ts`, `services/xstockstrat-ui/src/lib/insightsBff.ts`.
  - Watchlists: `services/xstockstrat-ui/src/hooks/useWatchlists.ts:29-39` (`useWatchlists()`).
  - Readiness: `services/xstockstrat-ui/src/components/insights/SignalReadiness.tsx:24-32`.
  - Screener: `services/xstockstrat-ui/src/app/insights/screener/page.tsx:116-176` (request builder).
  - Backtests: `services/xstockstrat-ui/src/hooks/useStrategies.ts:39-67`
    (`useBacktestHistory`/`useBacktestDetail`), `services/xstockstrat-ui/src/hooks/useBacktest.ts:9-17`
    (`useRunBacktest`).
  - Backfills: `services/xstockstrat-ui/src/app/insights/backfills/page.tsx:107-110`
    (`useBackfillJobs({ statusFilter, symbol })`).
  - Fixture inventory: `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md`.

- **`xstockstrat-analysis`** (Python)
  - Handler: `services/xstockstrat-analysis/app/handlers/servicer.py` — `RunBacktest:284-636`,
    `ListBacktests:1550-1566`, `GetBacktest:1568-1593`, `ScreenSymbols:1876-1928`,
    `RunFundamentalsScan:1930-1955`, `EvaluateReadiness:1959-1989`, `ListOpportunities:1991+`.
  - Screener engine: `services/xstockstrat-analysis/app/services/screener.py:388-416`
    (`_normalize_universe`).
  - Backtest history: `services/xstockstrat-analysis/app/repositories/backtest_runs.py:66`
    (`list_by_strategy(strategy_id, limit)` — no symbol param).
  - Per-symbol evidence table (unexposed): `services/xstockstrat-analysis/app/repositories/backtest_run_symbols.py:19-81`.
  - Last migrations: `006_backtest_runs.up.sql`, `007_backtest_run_symbols.up.sql`
    (`services/xstockstrat-analysis/migrations/`).
  - Config-read pattern: `self._cfg.get_*(...)` — e.g. `servicer.py:1905` (`analysis.screener.max_duration_seconds`).

- **`xstockstrat-portfolio`** (Go)
  - Handler: `services/xstockstrat-portfolio/internal/handler/portfolio_handler.go:45-54` (`GetPosition`),
    `:141,149` (`GetWatchlist`/`ListWatchlists`).
  - Service: `services/xstockstrat-portfolio/internal/service/portfolio_service.go:462-469`
    (`GetPosition`, **no `account_id` passthrough** — see Risks), `:481` (`ListPositions`, **does**
    pass `account_id`), `:1258-1277` (`ListWatchlists`).
  - Repo: `services/xstockstrat-portfolio/internal/repository/portfolio_repo.go:61-67` (`GetPosition`
    SQL, no `account_id` predicate), `:90-92` (`ListPositions` conditional `account_id` predicate);
    `services/xstockstrat-portfolio/internal/repository/watchlist_repo.go:31-278` (no
    membership-lookup method).
  - Config-read pattern: `services/xstockstrat-portfolio/CLAUDE.md:44-51`
    (`portfolio.watchlist.max_per_user`, `portfolio.exposure.factor_map`, etc.).

- **`xstockstrat-ingest`** (Python)
  - Handler: `services/xstockstrat-ingest/app/handlers/servicer.py:585-593` (`GetBackfillStatus`,
    single job by id), `:595-621` (`ListBackfillJobs`, **already has** `symbol_filter`).
  - Repo: `services/xstockstrat-ingest/app/repositories/backfill_jobs.py:73-113`
    (`get_job`/`list_jobs`, `= ANY(symbols)` predicate at `:100-102`).
  - Last migration: `003_backfill_jobs.up.sql` (`services/xstockstrat-ingest/migrations/`).

- **`xstockstrat-trading`** (Go)
  - Handler: `services/xstockstrat-trading/internal/handler/trading.go:31-43` (`PlaceOrder`), `:80-86`
    (`ListOrders`).
  - Service: `services/xstockstrat-trading/internal/service/trading.go:323` (`PlaceOrder`),
    `:1008,1023` (`ListOrders` symbol enforcement).
  - Repo: `services/xstockstrat-trading/internal/repository/trading_repo.go:153-155` (`ListOrders`
    symbol predicate).

- **`xstockstrat-marketdata`** (Go) — *added to Affected Services by this recon*
  - Handler: `services/xstockstrat-marketdata/internal/handler/marketdata_handler.go:162-183`
    (`GetFundamentals`, plain forward, **no scope check**).
  - Service: `services/xstockstrat-marketdata/internal/service/marketdata_service.go:846-858`
    (`GetFundamentals`), `:862-922` (`GetFundamentalsMulti`), `:924-957` (`resolveFundamentals`
    read-through-cache logic), `:294-298` (contrast: `DeleteBackfilledData` **is** admin-gated,
    proving the gate pattern exists and was deliberately not applied here).
  - Cache table: `services/xstockstrat-marketdata/migrations/002_fundamentals.up.sql:7`
    (`marketdata.fundamentals`).
  - Config-read pattern: `services/xstockstrat-marketdata/CLAUDE.md:66-70`
    (`marketdata.fmp.enabled`/`cache_ttl_hours`/`daily_request_cap`/`base_url`/`metrics`).

## Patterns to REUSE

- **Trade widget** → reuse `OrderForm` (`services/xstockstrat-ui/src/components/trader/OrderForm.tsx:41-48`)
  directly, without `SignalOrderTicket`'s own-`AccountProvider` wrapper — the page lives under
  `/trader`, which already provides `AccountProvider` ambiently
  (`services/xstockstrat-ui/src/app/trader/providers.tsx:6,13`). Simpler than either source pattern.
- **Position display** → reuse 096's existing fields/risk sidebar/chart-with-price-lines verbatim
  from `trader/positions/[symbol]/page.tsx`.
- **Orders table** → reuse 096's ticket-grammar field grid + `orderShared.tsx` badges verbatim.
- **Readiness** → reuse `SignalReadiness` (`services/xstockstrat-ui/src/components/insights/SignalReadiness.tsx:24-32`)
  as-is (strategy-scoped input, already handles the "no strategy picked" case).
- **Fundamentals** → reuse the **already-typed, already-generated** `marketDataClient.getFundamentals`
  method (`services/xstockstrat-ui/src/lib/connectClients.ts:33`) — it exists on the client today,
  simply unregistered in any BFF handler map. Register it in `traderBff.ts` (additive, same pattern
  as the existing `getBars` entry at `traderBff.ts:104`).
- **Backfill-by-symbol** → reuse `ListBackfillJobs(symbol=X)` exactly as `insights/backfills/page.tsx`
  already calls it server-side filtered (`insightsBff.ts:76-80` forwards it transparently); this
  feature only needs to register the same forward in `traderBff.ts` and reduce the returned jobs'
  `range` fields into a display summary client-side.
- **Watchlist membership** → no dedicated RPC exists; reuse `useWatchlists()` (already fetches all of
  the user's watchlists with `bindings[]` populated) and scan client-side — cheap, since the hook
  already exists and a user's watchlist count is small (`portfolio.watchlist.max_per_user`, default
  50).
- **Screening (single-symbol)** → reuse `ScreenSymbols` but **do not reuse the composite `score`
  output** for a single-symbol call (see Risks — the universe-relative normalization trap). Reuse the
  per-criterion raw `gap`/threshold fields from `ScreenResult` instead.
- **Test fixtures** → reuse `POSITION_AAPL`/`POSITION_MSFT` (`e2e/fixtures/positions.ts`),
  `ORDER_FILLED`/`ORDER_WORKING` (`e2e/fixtures/orders.ts`), `OPPORTUNITIES`
  (`e2e/fixtures/opportunities.ts`), `mockWatchlists`/`MockBinding` (`e2e/helpers/watchlistMock.ts`).
  **New fixture homes needed** (Constitution C-12): fundamentals (absent from `INVENTORY.md`
  entirely) and backfills (currently only "Not yet centralized").

## Dependencies

- Proto/RPC: **no proto changes** for Positions/Orders/Trade-widget/Opportunity/Readiness/
  Fundamentals/Backfill sections — every RPC already exists with the exact fields needed
  (`GetPosition`, `ListOrders`, `PlaceOrder`, `ListOpportunities`, `EvaluateReadiness`,
  `GetFundamentals`/`GetFundamentalsMulti`, `ListBackfillJobs`). **One additive proto field is a
  live option** for Backtesting: `ListBacktestsRequest` (`packages/proto/analysis/v1/analysis.proto:190-193`)
  has no `symbol` filter today; `analysis.backtest_runs.symbols` (TEXT[], already a DB column per
  `migrations/006_backtest_runs.up.sql:16`) could back a new optional `symbol` request field +
  `WHERE $n = ANY(symbols)` — see Recommended Scope.
- Migration: none anticipated.
- Config keys: none new. Existing keys already gate the reused RPCs (`marketdata.fmp.enabled`,
  `analysis.screener.*`, `portfolio.watchlist.max_per_user`, etc.) — this feature reads them
  transitively via the RPCs it calls, adds none of its own.
- Inter-service edges (via BFF, all pre-existing services, no new edges): `xstockstrat-ui` →
  `xstockstrat-portfolio` (`GetPosition`, `ListWatchlists`), → `xstockstrat-trading` (`ListOrders`,
  `PlaceOrder`), → `xstockstrat-analysis` (`ListOpportunities`, `EvaluateReadiness`, `ScreenSymbols`,
  `RunBacktest`/history/detail), → `xstockstrat-ingest` (`ListBackfillJobs`), →
  `xstockstrat-marketdata` (`GetBars`, `GetFundamentals`) — **all through `traderBff.ts`** now that
  the page lives under `/trader` (several of these are currently only registered in `insightsBff.ts`
  and need an additive registration in `traderBff.ts` too).
- New env vars / ports: none.

## Risks / Not-found

- **Wrong RPC named in product-spec FR-7 (corrected here).** The original product-spec cited
  `RunFundamentalsScan`/`FundamentalsScanSummary` (`xstockstrat-analysis`) for the Fundamentals
  section. That RPC is **admin-scope-gated** (`servicer.py:1930-1936`, confirmed by
  `test_requires_admin_scope`) and **side-effecting** (triggers a live FMP-backed rescan that emits
  `ExternalSignal`s to ingest) — calling it from an ordinary trader's page view would either
  `PERMISSION_DENIED` for non-admin users or, if the gate were bypassed, spam a real external-API
  rescan on every page load. The correct RPC is `GetFundamentals`/`GetFundamentalsMulti`
  (`xstockstrat-marketdata`) — a plain, ungated, read-through DB cache over the *same* underlying
  data (`analysis`'s fundamentals-signal producer itself reads through this exact RPC —
  `app/engine/fundsignal_loop.py:257-258`). **`xstockstrat-marketdata` must be added to Affected
  Services**; product-spec.md FR-7 needs this correction folded back in.
- **`ScreenSymbols` single-symbol normalization trap (confirmed live, matches an existing `fails.md`
  entry).** `_normalize_universe` (`services/xstockstrat-analysis/app/services/screener.py:388-416`)
  does direction-aware min-max normalization *across the scanned universe*. With exactly one symbol,
  every criterion's `lo == hi`, so `base = 0.5` regardless of the symbol's real reading
  (`screener.py:403-404`), and that content-free `0.5` flows into the composite `score` and the
  `min_conviction` hard-floor filter. **No guard exists.** This is the exact pattern the ledger
  already flagged: `docs/roadmap/ledger/fails.md:802-821` (2026-08-08,
  `screener-data-readiness-polling`) — "any value computed relative to a result set's full
  membership... must be recomputed from the original full set... not from the subset alone." FR-8's
  single-symbol screening section must NOT display `ScreenResult.score` as-is; it must show the raw
  per-criterion `gap`/threshold values only, or the design must find another way to avoid the
  universe-relative collapse.
- **Latent bug found, pre-existing (not introduced by this feature): `GetPosition` ignores
  `account_id`.** `GetPositionRequest.account_id` (field 4, `portfolio.proto:126`) exists on the wire
  and 096's own `usePosition` hook already relies on `GetPosition` — but the service layer
  (`portfolio_service.go:462-469`) never passes `req.GetAccountId()` to the repo, unlike
  `ListPositions` which does (`:481`, repo `:90-92`). For a multi-account user, `GetPosition` today
  silently returns whichever account's position was most-recently-opened for that user+symbol+mode,
  ignoring which account was actually asked for. This predates 125 (096 already has this gap) but
  125's own C-10(b) parity requirement (FR-14, "match Exposure and Portfolio exactly") makes it
  directly relevant — a multi-account user could see a parity mismatch that traces to this bug, not
  to anything 125 does. **Flag for the design gate**: fix it as an in-scope side-fix in 125 (small,
  same-file, same call chain 125 already touches), or file it separately via `/sdd-triage` first.
  Either way it must not ship unaddressed once 125's design.md is written.
- **`ListBacktestsRequest` has no symbol filter.** Confirmed absent (`analysis.proto:190-193`); only
  `BacktestRunSummary.symbols` (field 11, returned per-run) exists client-side to filter against. Two
  live options, not yet decided (see Recommended Scope): (a) client-side filter of the bound
  strategy's history (`ListBacktests(strategy_id)` then filter by `symbols.includes(currentSymbol)`)
  — zero backend change but only covers the ONE strategy the watchlist binding names, missing any
  other strategy's backtests that happened to include the symbol; or (b) add an optional `symbol`
  field to `ListBacktestsRequest` + a `WHERE $n = ANY(symbols)` clause against the already-existing
  `analysis.backtest_runs.symbols` column — small additive proto change, but a real backend step.
- **Fate of the three source pages (product-spec Open Question, still open post-recon).** Recon did
  not resolve this — it's an architecture decision, not a discovery question. Left for Phase 1.
- **Order-widget precedent** (`SignalOrderTicket`) is now superseded by simpler direct `AccountProvider`
  reuse once the page moves to `/trader` — not a risk, just noting the pattern the source page used
  is no longer the one to copy.
- No `git log` staleness check was possible for `PlatformHeader.tsx`/`OrderForm.tsx` against PRs
  #912/#913 (the `codebase-discovery` subagent has no Bash tool) — only current-HEAD content was
  confirmed. Re-verify immediately before `/sdd-spec` cites any line number from either file.

## Recommended Scope

Advisory only — Phase 1 decides the real architecture. A plausible step shape once the debate closes
the open forks:

1. Route/page skeleton under `/trader` (final path TBD by Phase 1) + nav registration
   (`PLATFORM_SUBNAV`/`NAV_GROUPS`) + redirects from the three source pages.
2. Position + Orders + Trade-widget sections (direct reuse, lowest risk — do first).
3. Watchlist-membership lookup (client-side `useWatchlists` scan) gating section visibility.
4. Opportunity/conviction + Readiness sections (direct reuse of `ListOpportunities`/
   `SignalReadiness`).
5. Fundamentals section — new BFF registration (`traderBff.ts` `getFundamentals`) + new display +
   new fixture.
6. Screening section — new BFF registration if `ScreenSymbols` isn't already on `traderBff.ts` + new
   single-symbol display that avoids the normalization trap (raw gaps, not composite score).
7. Backtesting section — depends on the Phase 1 decision between client-side single-strategy filter
   vs. a new `symbol` request field; either way, reuse `useRunBacktest` for triggering.
8. Backfill section — new BFF registration (`traderBff.ts` `listBackfillJobs`) + range-reduction
   display.
9. Repoint the 4 existing linker call sites found in discovery (`orders/[id]/page.tsx:191`,
   `positions/[symbol]/page.tsx:390`, `orderShared.tsx:94`, `opportunities/page.tsx:129-130`) + e2e
   coverage (new fixtures for fundamentals/backfills, parity test extending 096's existing
   Exposure↔Portfolio↔this-page check to the new route).
