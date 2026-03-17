# xstockstrat-insights — CLAUDE.md

## Role
Next.js 14 analytics and insights dashboard. Displays strategy backtests, performance scoring, indicator charts, and historical market data. Read-heavy; no order placement.

## Language
TypeScript / Next.js 14 (App Router)

## Dev Port
`3001`

## Architecture

```
Browser (React Client Components)
  └── SWR → /api/analysis/*, /api/indicators/*, /api/marketdata/*
        └── Next.js Route Handlers (server-side gRPC clients)
              ├── gRPC → xstockstrat-analysis
              ├── gRPC → xstockstrat-indicators
              └── gRPC → xstockstrat-marketdata
```

## Dependencies

| Dependency | Type | Reason |
|---|---|---|
| xstockstrat-analysis | gRPC (server-side) | Backtests, strategy scores, reports |
| xstockstrat-indicators | gRPC (server-side) | Compute indicators for charts |
| xstockstrat-marketdata | gRPC (server-side) | Historical OHLCV chart data |
| xstockstrat-notify | gRPC stream (server-side) | Live alerts via SSE |
| xstockstrat-identity | gRPC (server-side) | Token validation |

## Key Pages

| Route | Description |
|---|---|
| `/` | Overview dashboard — strategy scores, recent alerts |
| `/strategies` | Strategy list with scores and backtest summaries |
| `/strategies/[id]` | Detailed backtest results, trade history, P&L chart |
| `/indicators` | Indicator builder — select symbol, timeframe, indicator, parameters |
| `/market/[symbol]` | Historical OHLCV candlestick chart with overlay indicators |

## Environment Variables

```
# .env.local
ANALYSIS_ENDPOINT=xstockstrat-analysis:50056
INDICATORS_ENDPOINT=xstockstrat-indicators:50054
MARKETDATA_ENDPOINT=xstockstrat-marketdata:50053
NOTIFY_ENDPOINT=xstockstrat-notify:50059
IDENTITY_ENDPOINT=xstockstrat-identity:50058
```

## Running Locally

```bash
npm install
npm run dev
```
