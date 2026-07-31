# Recon: ui-revamp-opportunities-first

**Created**: 2026-07-31
**From**: product-spec.md
**Affected services**: `xstockstrat-ui` (Next.js) — the entire in-scope change. Backend protos
(`ingest`, `analysis`, `portfolio`, `trading`, `marketdata`, `indicators`, `notify`) were read to
**map screen fields to data sources**; no backend service is modified by the in-scope work.

---

## Objective

Re-frame `xstockstrat-ui` around a ranked **opportunity queue** (a Decide / Discover / Engine / Book
nav shell + optional MCP Copilot rail), reproducing the "Nocturne" dark design system across 12
handoff screens, CRUD editors, and a 1:1 mobile companion. The design phase's central job is to
**map every screen field to a real data source, flag the backend gaps, and recommend a slicing** —
because a large share of the differentiating screens display data no current RPC returns.

## Codebase Map

- **`xstockstrat-ui`** (Next.js / App Router)
  - Shared nav (C-10(a) surface): `PLATFORM_NAV` `src/components/shared/PlatformHeader.tsx:44-64`
    (4 items: Trader→`/trader`, Insights→`/insights`, Config→`/config-ui`,
    Accounts→`/accounts/authorized-apps`); `PLATFORM_SUBNAV` `PlatformHeader.tsx:79-101`; active-item
    logic `:103-106,148-153,169`. **No badge/count rendering exists** on nav items.
  - Route tree (`src/app/`): `trader/` (`page`, `positions`, `accounts`, `orders`, `orders/[id]`);
    `insights/` (`page`, `strategies[/new,/[id],/[id]/edit]`, `formulas*`, `screener`, `watchlists`,
    `backfills`, `market/[symbol]`); `config-ui/` (`page`, `[namespace]`, `audit`, `sources`);
    `accounts/` (`authorized-apps`, `mcp-tools`); `auth/` (`login`, `oauth-login`). Connect-RPC BFF per
    segment at `src/app/{trader,insights,config-ui}/api/[...connect]/route.ts`.
  - Theme tokens (inline, **no separate token module**): `src/app/globals.css:6-27` — single dark
    `:root`, HSL triplets (`--background: 222 47% 4%`, `--primary: 163 100% 44%` teal accent,
    `--destructive: 0 84% 60%`, `--radius: 0.5rem`). **No light theme / `.dark` / toggle / next-themes.**
    `tailwind.config.js:40-42` — `buy: hsl(163 100% 40%)` (teal), `sell: hsl(0 84% 55%)` (red),
    `paper: hsl(48 96% 53%)` (amber); accent token = `hsl(var(--accent))` = neutral dark grey. **No
    custom `fontFamily`.**
  - Auth middleware: `src/middleware.ts:10-15` — **global** negative-lookahead matcher (protects
    everything except an excludes list); injects `x-trace-id`. Not per-segment scoped; any new
    top-level route inherits protection automatically.
  - UI primitives (`src/components/ui/`): `badge, button, card, combobox, input, select, separator,
    sheet, table, utils(cn)`. `@radix-ui/react-dialog` is a dep (used only inside `sheet.tsx`).
  - Icons: `lucide-react ^0.460.0` (`package.json:45`) — **not Phosphor**.
  - Admin gate: `useIsAdmin()` `src/hooks/useLiveStrategies.ts:42` (reads `/api/auth/me`).
  - Config-read: **no app-level `useConfig`/`WatchConfig` in the UI runtime.** Config-ui CRUD uses
    `useConfigKeys → configClient.listKeys` (`src/app/config-ui/hooks/useConfigKeys.ts:1-27`).
    Account mode lives in `AccountContext` (`EnvironmentMode='paper'|'live'`, `src/context/AccountContext.tsx:11,49`)
    + `TradingModeBadge`.
  - Tests: Playwright `e2e/` (`mock-backend.ts`, `fixtures/{users,accounts,portfolios,strategies,formulas,backtests,index}.ts`
    + `INVENTORY.md`, `helpers/auth.ts`); vitest `vitest.config.ts:15-28` (coverage `src/lib/**`,
    `all:false`, threshold 40). **No central nav-reachability spec**; SSR warmup route list
    `e2e/warmup.setup.ts:14` omits `/trader/positions`.

## Patterns to REUSE

- **Nocturne token swap** → remap the **existing inline homes**, not a parallel system:
  `src/app/globals.css:6-27` `:root` vars + `tailwind.config.js:40-42` `buy`/`sell`/`paper`/accent
  (Nocturne gain `#4cc79c`→`buy`, loss `#e0787a`→`sell`, paper `#c9b47e`→`paper`, blurple `#9184d9`→accent,
  `#161826`→`--background`). Two-file value change; app is already dark-only.
- **Account mode (FR-19 `accountMode`)** → reuse `AccountContext` `paper`/`live` (`AccountContext.tsx:11,49`)
  + `TradingModeBadge.tsx`; already the PAPER/LIVE tag source.
- **Order enum maps** → reuse/extend `src/components/trader/orderShared.tsx:10` `STATUS_VARIANT`
  (7 statuses incl. `PARTIALLY_FILLED`/`FILLED`) + `:23` `TYPE_LABEL` (5 types); filter lists
  `OrderFilters.tsx:21-39`. Keeps FR-20 order-type/fill coverage intact.
- **Backtest diagnostics** → reuse `BacktestDiagnostics.tsx` (`ACTION_LABEL: Record<BarAction,…>` `:9`,
  `NO_TRADE_MESSAGE: Record<NoTradeReason,…>` `:18` — the two exhaustive maps), `EquityCurveChart.tsx`,
  `useBacktest.ts`, `e2e/fixtures/backtests.ts` (`prefixGapRange` pre-window semantics `:39-46`),
  INSUFFICIENT_DATA card `strategies/[id]/page.tsx:290-334`.
- **Backfills** → reuse `useBackfills.ts` (4s poll `:29`, terminal-stop `:40-43`, cancel `:52`, delete
  `:65`), admin gate + typed-`DELETE ALL` confirm `backfills/page.tsx:72,134-137` (UI-only).
- **Portfolio/positions/orders** → reuse `usePortfolio.ts` (`usePortfolios` 10s poll `:20-26`,
  `usePositions` `:39`), `PortfolioPanel.tsx`, `useOrders.ts` (+ streamed `useOrderUpdates.ts:20`
  `StreamOrderUpdates`).
- **Candlestick** → reuse `useCandlestickChart.ts:12` + `ChartPanel.tsx` (GetBars).
- **Screener/strategies** → reuse `useScreenSymbols.ts:9`, `screener/page.tsx`, `useStrategies.ts` /
  `useStrategyDefinitions.ts`, `useWatchlists.ts:17` (full CRUD).
- **Sparkline / equity series** → reuse `src/lib/equityCurve.ts buildEquitySeries` (from `diagnostics[].equity`).
- **Test fixtures (C-12)** → reuse `PORTFOLIO_ALPACA/IBKR/PORTFOLIOS` (`portfolios.ts:13-37`),
  `BROKER_ACCOUNTS`, `TEST_USER_*`, `helpers/auth.ts`; migrate the inline `mock-backend.ts` order/position
  mocks (`:181`) into fixtures when a second consumer appears (INVENTORY policy `:36`).

## Dependencies

- Proto/RPC: **none changed** by the in-scope UI work. Screens **consume** existing RPCs
  (`ingest.QuerySignals`/`ExternalSignal` `ingest.proto:105`, `analysis` strategy/backtest/screener,
  `portfolio.ListPortfolios`/`ListPositions` `portfolio.proto:13,17`, `trading` orders,
  `marketdata.GetBars`). Any screen needing a **new** RPC is split out (see Recommended Scope).
- Migration: none.
- Config keys: **decision deferred** — FR-19 `density`/`showCopilot`/`accountMode`. No UI `WatchConfig`
  plumbing exists; `accountMode` already has a home (`AccountContext`). Options weighed in grilling
  (env/build-time defaults vs new `ui.chrome.*` config-service keys).
- Inter-service edges: unchanged. Copilot rail would add UI→`xstockstrat-agent` MCP (new, if in scope).
- New env vars / ports: none for in-scope work.

## Risks / Not-found

**Data-source GAPs (the scope-split driver).** Each verified against the producer, not assumed
(guards `fails.md` 2026-07-30 080 / 2026-07-29 081 absence-claim traps):

- **Opportunities queue (the home screen) — NO backing RPC/hook.** No ranked, aggregated signal-queue
  exists. Closest raw material is `ExternalSignal` (`ingest.proto:105`: `direction`, `conviction` f4,
  `valid_until` f6, `headline` f7) but **no UI hook calls `QuerySignals`**, and it returns an unranked
  per-source list — not an aggregated/deduped/ranked queue. `direction` is only `buy/sell/hold/watchlist`
  (no ENTER/ADD/TRIM/EXIT distinction — needs held-position cross-ref). **Genuinely new backend.**
- **Live condition evaluation** (Signal-detail conditions value-vs-threshold-pass/soft **and** Watchlist
  readiness + blocking condition) — no RPC evaluates a strategy's conditions live per symbol.
  `entry_rule`/`exit_rule` are opaque JSON strings (`analysis.proto:238-239`); per-bar indicators exist
  only inside a *backtest* result (`BarDiagnostic.indicators` `analysis.proto:129`). **Genuinely new backend.**
- **Exposure risk framing** — `Position` (`portfolio.proto:43-63`) has **no** `stop_price`, exit rule,
  factor, or flag. Risk-at-stop/stop-distance are join-derivable off `Order.stop_price` (`trading.proto:42`)
  only when a resting stop exists (fragile); **factor model and per-row flag have no data anywhere.**
  **Genuinely new backend (risk/factor engine).**
- **Signal-source health** — `SignalSource` (`ingest.proto:135-143`) has `slug/source_type/active/has_credentials/config_json`
  only. **Health checks, freshness, feeds count, stale status, recent log lines, note, and
  "strategies that read this source" all GAP** — none exist today. **New backend.**
- **Strategy metrics** — `Expectancy`, `Signals 30d`, `Taken`, `Queue share` have no proto field
  (**new backend**); `Hit rate`/`Max DD` are per-backtest-run only (list card needs per-strategy fetch —
  derivable but N extra calls). Strategy **state has no enum** — it is `active`+`live_enabled` booleans
  (`analysis.proto:240-241`); Active/Paused/Off is **client-derivable** (no "Live/Paper" string exists
  anywhere — confirms FR-9/AC-5 concern is already safe). **No Universe field** (correct).
- **Copilot rail** — **no MCP-invocation client and no chat/thread persistence exist** in the UI (only
  the unauthenticated read-only tool **catalog** proxy `accounts/mcp-tools` + `api/mcp-tools/route.ts:23`;
  agent tools listed `services/xstockstrat-agent/app/tools.py:88`, 17 tools). "Read of the queue" needs an
  agent call (or client template), "asked earlier" thread needs **new persistence**. **New agent/backend surface.**
- **Client-derivable (no backend), buildable in-feature**: sparklines/change% (GetBars), strategy
  Active/Paused/Off tag, Notional/Position-after ticket math, Avg-hold/Trades-month (from `trades[]`),
  backfill jobs-running/completed-today/needs-attention counts, concentration flag (position weights),
  Backtest metrics already served (Sharpe, Max DD, coverage gap, day-by-day, INSUFFICIENT_DATA).
- **Screener enrichment** — `ScreenResult` (`analysis.proto:340`) returns `symbol/score/criterion_scores/passed/status/gap`;
  PE/RSI/rev-growth/ATR/held? are **not** returned (client fan-out to fundamentals/indicators/positions,
  or an enriched screener RPC — GAP).

**Screens fully served today (pure re-presentation, low risk):** Backtest, Backfills, Portfolio,
Orders. **Mostly served (basic version now, rich fields deferred):** Strategies, Screener, Signal
sources, Exposure, Signal detail (chart served; conditions deferred).

**Ledger traps carried forward:**
- `fails.md` 2026-07-01 060 / **C-10(a)** — every new screen/route must register in `PLATFORM_SUBNAV`
  with a nav-reachability test; **no central nav test exists today** → must add one (AC-1). Drives the
  `accounts`-segment placement (must not be orphaned).
- `fails.md` 2026-07-01 056 / **C-10(b)** — Portfolio (`ListPortfolios`) and Exposure (`ListPositions`)
  both carry the same `Position` message, but **producer-level valuation agreement is not verifiable
  from the UI repo** (`services/xstockstrat-portfolio` is out of scope). AC-8 parity test must assert
  against fixtures/mock-backend, not assume the producer agrees.
- `fails.md` 2026-07-21 / **C-10(a/d)** — `BacktestDiagnostics.tsx:9,18` exhaustive `Record<Enum,…>`
  maps break `tsc` on any new proto enum value; relevant only if a split-out backend feature appends one.
- `fails.md` 2026-07-30 082 — **branch-lineage**: this session runs on `claude/ui-revamp-opportunities-lwrinp`
  while `feature.md` `**Development Branch**` = `feature/ui-revamp-opportunities-first`. Design artifacts
  are branch-identical; noted so `/sdd-spec`/`/sdd-execute` reconcile the lineage (harness mandate is to
  PR the `claude/*` branch into `main-dev`, C-06-compliant).

## Recommended Scope

Advisory only — the grilling decides the split. The dominant fact: **the revamp's headline screen and
its differentiating framing are backend gaps the product spec scoped OUT.** A defensible cut:

- **In THIS feature (083, UI-only):** the Nocturne token swap + Decide/Discover/Engine/Book shell/nav
  (with `accounts` placed, C-10(a) nav test) + the mobile companion renderer + the **fully/mostly-served
  screens** re-presented from existing hooks (Backtest, Backfills, Portfolio, Orders, Strategies-basic,
  Screener-basic, Signal-sources-basic, Exposure-basic, Signal-detail-chart). Non-happy-path states
  (loading/empty/error) + FR-20 order-execution parity. Opportunities/Copilot ship as **graceful
  empty/placeholder** surfaces if their backend isn't ready.
- **Separate backend feature(s) (084+), each its own SDD cycle:** (1) ranked Opportunities-queue RPC +
  per-signal thesis/action-tag/conviction; (2) live per-symbol condition/readiness evaluation (feeds
  Signal-detail conditions + Watchlist readiness); (3) position risk/factor engine (Exposure risk fields);
  (4) signal-source health/log/linkage; (5) Copilot MCP-invocation + thread persistence; (6) per-strategy
  expectancy/queue-share aggregates. Each unblocks its screen's rich fields, which then layer onto the
  083 shell.
- **Slice 083 itself** into stacked PRs (product-spec's own recommendation): shell/nav/theme first, then
  one tab-group per `/sdd-spec` + `/sdd-execute`.
