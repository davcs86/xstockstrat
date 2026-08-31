# Recon: strategy-performance-dashboard

**Created**: 2026-08-31
**From**: product-spec.md
**Affected services**: `xstockstrat-ui` (Next.js — all metric math in the BFF/lib), reading `xstockstrat-ledger` (closed-position P&L events) + `xstockstrat-portfolio` (`GetPnL`, optional) + `xstockstrat-trading` (`GetTradingEnvironment`) over existing RPCs. No proto/DB change.

---

## Objective

Add an `/insights` performance dashboard — equity curve (cumulative realized P&L), max drawdown ($ + %), rolling 30-day Sharpe, and summary stats — computed entirely in the `xstockstrat-ui` BFF/lib from existing ledger + portfolio reads, so a trader can judge whether paper results justify going live. Two new config keys (`ui.performance.*`) tune the Sharpe risk-free rate and the curve's start date; the "Paper Trading" label is environment-derived via the existing `GetTradingEnvironment` RPC.

## Codebase Map

- **`xstockstrat-ui`** (Next.js / Node 24, TypeScript; the only code-bearing service)
  - Segment BFF routers: `src/lib/{traderBff,insightsBff,configUiBff}.ts`; canonical plumbing (`requireSession`/`backendHeaders`/`forward`/`createBffRouter`/`createDispatch`) in `src/lib/bffShared.ts`.
  - `/insights` BFF: `src/lib/insightsBff.ts:24-127` — registers Analysis/Ingest/MarketData/Portfolio/Trading/Indicators. **No `ConfigService`, no `LedgerService`, and only `TradingService.listBrokerAccounts`** (no `getTradingEnvironment`) today — these are the gaps this feature fills.
  - Config read (one-shot) precedent: `traderBff.ts:143-149` registers `ConfigService { getConfig }` (read-only; "GetConfig is deliberately open on the backend, no admin gate"), called from `src/app/trader/positions/page.tsx:131-133` as `traderConfigClient.getConfig({ namespace: 'platform' })` then `resp.values['trading_state']?.value.case === 'stringVal' ? …`.
  - Ledger read (query) precedent: `traderBff.ts:112-141` `LedgerService.queryEvents` — **forces `stream_key` server-side from the verified session** (copilot IDOR guard, `:117-126`).
  - Paper/live label: `src/context/AccountContext.tsx:46-49` calls `tradingClient.getTradingEnvironment({})` and sets `environmentMode: 'paper'|'live'` (`TradingMode.LIVE ? 'live' : 'paper'`); badge in `src/components/shared/TradingModeBadge.tsx`, rendered e.g. `components/trader/AppShell.tsx:22`. `AccountProvider` is mounted per-page, not global; an `/insights` component already consumes it (`components/insights/SignalOrderTicket.tsx:17`).
  - Charting (insights segment): `src/components/insights/EquityCurveChart.tsx` (recharts `ComposedChart`/`Line` + `ui/chart.tsx` `ChartContainer`/`ChartTooltipContent`) — already draws cumulative-P&L / equity lines. `PortfolioEquityCurveChart` (`:225`) draws a single absolute-$ pool line. lightweight-charts v5 is **trader-OHLCV-only** (`src/hooks/useCandlestickChart.ts`, `components/trader/ChartPanel.tsx`), per `services/xstockstrat-ui/CLAUDE.md` § Styling.
  - Nav model (C-10(a)): `src/components/shared/navGroups.tsx` `NAV_GROUPS` (Decide/Discover/Engine/Book/Settings) is the live shell + the surface the reachability test walks. `PlatformHeader.tsx:72` `PLATFORM_SUBNAV` is a **retained legacy** export ("The desktop shell now renders NAV_GROUPS", `:69-70`). Reachability test: `e2e/nav-reachability.spec.ts:21-92` walks `NAV_GROUPS` groups/items and asserts `aria-current="page"`.
  - New route home would mirror `src/app/insights/{pnl-patterns,backfills}/page.tsx`.
- **`xstockstrat-ledger`** (Node, read-only reuse): `packages/proto/ledger/v1/ledger.proto:15` `QueryEvents`; `LedgerEvent` (`:20-31`) = `event_type` + `payload` (`google.protobuf.Struct`) + `occurred_at` + `stream_key` + `sequence`. Filters: `stream_key`/`event_type`/`source_service`/`time_range`/`page` (`:54-61`).
- **`xstockstrat-portfolio`** (Go, read-only reuse): producer of the equity-curve source event — `internal/service/portfolio_service.go:304-307` emits `portfolio.position.closed` on stream_key `portfolio:<userID>` with payload `{user_id, symbol, account_id, trading_mode, realized_pnl}` (contract documented in `services/xstockstrat-portfolio/CLAUDE.md` § Ledger Events Emitted). `GetPnL` RPC: `packages/proto/portfolio/v1/portfolio.proto:14`, `GetPnLRequest:176-182` (mode/time-range/account filters).
- **`xstockstrat-trading`** (Go, read-only reuse): `GetTradingEnvironment` — `packages/proto/trading/v1/trading.proto:34`.

## Patterns to REUSE

- **Config read** → one-shot `GetConfig` via a new `insightsBff.ts` `ConfigService { getConfig }` registration, mirroring `traderBff.ts:143-149`; read values with the oneof-`case` presence pattern from `positions/page.tsx:132-133` (this is the zero-vs-absent-safe read the product-spec guardrail demands).
- **Ledger query with IDOR guard** → new `insightsBff.ts` `LedgerService { queryEvents }` that forces `stream_key = "portfolio:" + claims.user_id` server-side, mirroring the copilot rewrite `traderBff.ts:117-126`. A client must not supply the stream_key.
- **Paper/live label** → reuse `AccountContext.environmentMode` + `TradingModeBadge`; requires `AccountProvider` mounted on the page (as `SignalOrderTicket` does) **and** `getTradingEnvironment` reachable from `/insights` — add it to `insightsBff.ts`'s `TradingService` registration (mirror `traderBff.ts:60`) so the page's `tradingClient` (or `AccountProvider`) can call it same-origin.
- **Equity-curve chart** → reuse the recharts + `ui/chart.tsx` idiom (`ChartContainer`/`ChartConfig`/`ChartTooltipContent`) established by `insights/EquityCurveChart.tsx`; drive series colors through `ChartConfig`→`--chart-*` tokens (C-17), not `EquityCurveChart`'s hardcoded `hsl(...)` literals (a pre-existing deviation not to clone).
- **BFF plumbing / session / headers** → `bffShared.ts` (`requireSession`, `backendHeaders`, `forward`); never re-implement per segment.
- **Deployment env** → `src/lib/deploymentEnv.ts` (`getNativeConfigEnv`) if an environment must be passed to `GetConfig` (Server-Component only; not in the client bundle).
- **Frontend fixtures (C-12/C-13)** → `e2e/fixtures/`; today "Ledger events" and "Aggregate portfolio" mocks are **inline in `e2e/mock-backend.ts`** (`INVENTORY.md` "Not yet centralized"). A second consumer (this feature's specs) triggers centralization of the `portfolio.position.closed`/`queryEvents` mock into a fixture module + `INVENTORY.md` row.

## Existing Business Rules (preserve / extend)

Durable suites read: `services/xstockstrat-ui/acceptance/*.feature`, `services/xstockstrat-{portfolio,trading}/acceptance/*.feature`, `docs/sdd/business-rules/platform.feature`. No existing `@AC-*` covers a performance dashboard, equity curve, drawdown, Sharpe, or the paper-trading label — this feature is **net-new behavior**.
- **PRESERVE** the `portfolio.position.closed` payload key-set contract (`{user_id, symbol, account_id, trading_mode, realized_pnl}`) — a consumer (`xstockstrat-analysis` P&L-patterns) already reads it (`portfolio/CLAUDE.md`). This feature only **reads** it; any additive extension (see Risks) must not drop/rename keys.
- **PRESERVE** the header-identity IDOR guard on ledger/portfolio reads (self-scoped from `x-user-id`; body `user_id` deprecated) — the new BFF reads must not reintroduce a client-supplied user/stream key.
- No CHANGE to any existing guarantee; nothing needs user sign-off on a rule change.

## Dependencies

- Proto/RPC: **none new**. Reuses `ledger QueryEvents`, `portfolio GetPnL`, `trading GetTradingEnvironment`, `config GetConfig` (all existing).
- Migration: none.
- Config keys (new, `ui` namespace): `ui.performance.risk_free_rate_annual` (float, default `0.045`), `ui.performance.equity_curve_start_date` (ISO date string, default = first closed-position date). Read via `GetConfig(namespace: 'ui')` → `values['performance.risk_free_rate_annual']` etc. (map-key slicing inferred from the `platform`/`trading_state` precedent — confirm exact keying at `/sdd-spec`). Defaults must be declared in `services/xstockstrat-ui/CLAUDE.md` (C-05).
- Inter-service edges (all read-only, all via `/insights` BFF): ui→ledger `QueryEvents`, ui→config `GetConfig`, ui→trading `GetTradingEnvironment`, (optional) ui→portfolio `GetPnL`.
- New env vars/ports: **none** — `LEDGER_ENDPOINT`/`CONFIG_ENDPOINT`/`TRADING_ENDPOINT` already in the ui env + docker-compose + `.do/app*.yaml` (the clients exist in `connectClients.ts`).

## Risks / Not-found

- **Producer gap — FR-4 avg-return-% and avg-hold-time are NOT derivable from the ledger event.** `portfolio.position.closed` payload carries `realized_pnl` but **no cost basis, no qty, no open timestamp** (`portfolio_service.go:304-307`). Total-trades / win-count / win-rate / total-realized-P&L and the equity curve / drawdown are derivable; **average return per trade (%)** (needs cost basis) and **average hold time (hours)** (needs an open timestamp — `occurred_at` is only the close time) are not. This is the 072/080 producer-completeness trap. Resolution is an operator decision (see design.md Open Risks): (a) defer the two stats to a named V2 follow-up (C-14 deferral needs a named feature); or (b) an **additive** extension of the producer emit — `cost_basis` is trivially available (`existing.CostBasis`), but hold-time needs an open-timestamp source the payload and possibly the positions schema lack — which makes the feature no longer zero-backend-change. Do not silently ship placeholder values (`fails.md` add-ikbr `user_id="default"` trap).
- **Sharpe daily-returns basis undecided.** From closed-position events we get a daily P&L (dollar) series. FR-3/AC-3 apply an annual **rate** (0.045) — dimensionally this needs percentage returns (an equity base per day) or a documented dollar-excess convention. Pin the exact reference formula (and whether `GetPnL` is needed as the equity base) before the AC-3 "hand-computed reference" is well-defined.
- **Non-finite Sharpe (ledger 072, product-spec guardrail).** Zero-variance / single-point window → `std=0` → `Infinity`/`NaN`; `JSON.stringify`→`null`, `Number.isFinite` false. Guard explicitly, render a not-available placeholder (AC-4).
- **Config zero-vs-absent (Node/JSON).** `risk_free_rate_annual = 0` is legitimate. Read via the oneof `case` check (`positions/page.tsx:132`), never `value || default`.
- **Two nav surfaces, one authoritative (C-10(a)).** The reachability test walks `NAV_GROUPS`; register the new page there (likely the **Engine** group) and extend `e2e/nav-reachability.spec.ts:21` `GROUPS`. `PLATFORM_SUBNAV.insights` is legacy — update only if a still-live consumer reads it.
- **Auto-refresh interval.** FR-5 says "configurable (default 60s)" but declares **no** config key for it — resolve as a named client constant (React-Query `refetchInterval` idiom), or add a third key if the operator wants it server-tunable.
- **Not found**: no existing "list closed trades with entry/exit/hold-time" RPC; no `WatchConfig` consumer anywhere in `xstockstrat-ui` (grep of `src` returned only `GetConfig`/`listKeys`/`setConfig` call sites) — the UI is a stateless request/response BFF and structurally cannot hold a streaming subscription.

## Recommended Scope

Advisory step boundaries for the grilling / `/sdd-spec`:
1. BFF wiring in `insightsBff.ts`: add `LedgerService { queryEvents }` (stream_key forced), `ConfigService { getConfig }`, and `TradingService.getTradingEnvironment` (+ browser clients as needed). Paired BFF-shape test.
2. Metric-math lib (`src/lib/performanceMetrics.ts` or similar, pure + vitest-unit): cumulative curve, max drawdown $/%, rolling 30-day Sharpe with the non-finite guard, summary stats — from `portfolio.position.closed` events + config. Unit tests are the AC-1..AC-5 RED home.
3. Config read helper with the oneof presence-check (zero-vs-absent).
4. Page + chart at `src/app/insights/performance/page.tsx` (recharts/`ui/chart.tsx` equity curve with zoom/pan Brush, drawdown/Sharpe/summary cards, 60s polling, date-range picker, paper-trading label). C-17 primitives.
5. `NAV_GROUPS` registration + `nav-reachability.spec.ts` extension (C-10(a)).
6. Declare the two config keys' defaults in `services/xstockstrat-ui/CLAUDE.md` (C-05); config-governance registered-keys log.
