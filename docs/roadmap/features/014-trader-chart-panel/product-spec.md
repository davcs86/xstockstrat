# Product Spec: trader-chart-panel

**Created**: 2026-05-20

---

## Problem Statement

The `xstockstrat-trader` UI has no price chart. Traders can place orders and view portfolio P&L but cannot see OHLCV price history for a symbol. The Phase 5 implementation silently dropped the chart panel specified in the roadmap (§5C). The full backend data path — `GetBars` RPC, `MarketDataService`, Alpaca REST client, `ohlcv` TimescaleDB hypertable — is already live and serving other services.

## User Story

As a trader using the xstockstrat-trader UI, I want to view a candlestick chart for any symbol at multiple timeframes, so that I can assess price action before placing an order.

## Functional Requirements

FR-1. The trader page includes a chart panel showing OHLCV candlestick bars for a selected symbol.
FR-2. A symbol selector allows the user to switch between tradable symbols (populated from `ListAssets`).
FR-3. A timeframe switcher supports: 1m, 5m, 15m, 1h, 1d.
FR-4. The chart fetches bars via the existing `GetBars` Connect-RPC endpoint on `xstockstrat-marketdata` (port 8053). No new RPCs required.
FR-5. The chart auto-refreshes on a fixed interval: 30 seconds for intraday timeframes (1m, 5m, 15m, 1h), once on load for 1d.
FR-6. The chart displays a configurable number of bars (default: last 100 bars).
FR-7. Loading and error states are handled gracefully — a spinner while fetching, an inline error message on failure.

## Out of Scope

- Real-time WebSocket streaming (`StreamBars`) — polling is sufficient for a ≥5m minimum timeframe.
- Volume bars, overlay indicators (MA, BB, RSI) — chart panel only; indicator overlays are a future feature.
- Drawing tools, annotations.
- Multi-symbol comparison.
- Crypto symbols (equity only for now).

## Affected Services

- `xstockstrat-trader` — adds the chart panel component and a `/api/chart` Next.js route that proxies `GetBars`
- `xstockstrat-marketdata` — consumed read-only via existing `GetBars` RPC; no changes to this service

## Proto Contract Changes

- [x] No proto changes required — `GetBars` / `GetBarsRequest` / `GetBarsResponse` / `Bar` are all defined in `packages/proto/marketdata/v1/marketdata.proto`

## Config Key Changes

- [x] No new config keys — poll interval is hardcoded to 30s (intraday) / on-load (daily); can be made configurable in a future follow-up

## Database Changes

- [x] No schema changes — reads from existing `marketdata.ohlcv` hypertable

## Feature Workflow Notes

Branch to create: `feature/trader-chart-panel` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (frontend-only change, no proto or DB)
- [ ] 2 service owners + platform lead — not required (no breaking proto change)
- [ ] DBA review + service owner — not required (no schema migration)

## Acceptance Criteria

1. Navigating to the trader UI shows a chart panel with a default symbol and 1d timeframe.
2. Switching timeframe updates the chart within one poll cycle.
3. Switching symbol clears and reloads the chart.
4. Chart displays correctly with ≥1 bar of data.
5. If `GetBars` returns an error, the chart shows an inline error message instead of a blank area.
6. Auto-refresh fires every 30 seconds for intraday timeframes; does not fire for 1d.
7. No direct DB queries from the frontend — all data flows through the `/api/chart` route → `GetBars` RPC.

## Open Questions

- [ ] Which charting library? Candidates: `lightweight-charts` (TradingView, MIT, ~40 kB), `recharts` (React-native, larger bundle). Recommend `lightweight-charts` — purpose-built for financial OHLCV, smaller, no D3 dependency.
- [ ] Default symbol on first load — hardcode `AAPL`, or use the first result from `ListAssets`?
- [ ] How many bars to show? 100 bars proposed; should this be user-adjustable (date range picker)?
