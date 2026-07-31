repo: davcs86/xstockstrat
branch: main
path: services/xstockstrat-ui

## Last sync
date: 2026-07-31
commit: (not recorded — read via tree/read APIs, no commit sha resolved)

### Updated in this project
- Reframed the UI around an opportunity queue (buy/sell signals from portfolio + watchlists) instead of portfolio monitoring — Alpaca/IBKR own P&L
- Unified nav shell (Decide / Discover / Engine / Book) across all screens for consistency
- Added an MCP-backed Copilot surface (queue read, concentration flags, per-signal Q&A)
- Added mobile companion frames: queue, signal detail, hold-to-submit confirm

## Screen map
| Screen | Built from |
| --- | --- |
| Opportunities (queue) | new UX — synthesizes trader/ + insights/ signals |
| Signal detail | components/trader/OrderForm.tsx, AlertStream.tsx |
| Watchlists | app/insights/screener + watchlist concepts |
| Screener | app/insights/screener/page.tsx |
| Strategies | app/insights/strategies/page.tsx |
| Backtest | BacktestDiagnostics.tsx, EquityCurveChart.tsx, useBacktest.ts, fixtures/backtests.ts |
| Backfills | app/insights/backfills/page.tsx, useBackfills.ts |
| Exposure | app/trader/positions/page.tsx (reframed to risk) |
| Portfolio | PortfolioPanel.tsx, usePortfolio.ts, fixtures/portfolios.ts (read-only broker mirror) |
| Signal sources | app/config-ui concepts |
| Orders | app/trader OrderFilters.tsx, OrderBook.tsx |
| Mobile companion | new — 1:1 parity, one phone per desktop screen |
