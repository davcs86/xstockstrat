# xstockstrat-insights — CLAUDE.md

## Role
Next.js 14 analytics and insights dashboard. Displays strategy backtests, performance scoring, indicator charts, and historical market data. Read-heavy; no order placement. Uses Connect-RPC HTTP to communicate with backend services.

**Note on paper vs live**: Strategy backtests are independent simulations run by `xstockstrat-analysis` against historical market data — they are not derived from paper or live order history. No paper/live mode toggle is needed in this service. If future pages show real trade history or realized P&L from the portfolio service, a `trading_mode` filter should be added at that point.

## Language
TypeScript / Next.js 14 (App Router)

## Docker Build Pattern
Frontend pattern — see `docs/patterns/docker-build.md` for the base + deps + builder + runner stages, `--filter` usage, and `.next/standalone` optimization.

## Dev Port
`3001`

## Architecture

```
Browser (React Client Components)
  └── SWR → /api/analysis/*, /api/indicators/*, /api/marketdata/*
        └── Next.js Route Handlers (server-side Connect-RPC clients)
              ├── Connect-RPC → xstockstrat-analysis:8056
              ├── Connect-RPC → xstockstrat-indicators:8054
              ├── Connect-RPC → xstockstrat-marketdata:8053
              ├── Connect-RPC → xstockstrat-notify:8059
              └── Connect-RPC → xstockstrat-identity:8058
```

## Connect-RPC Client

- Transport factory: `src/lib/connectTransport.ts` — `createTransport(baseUrl)` returns `createNodeHttpTransport` server-side or `createConnectTransport` browser-side
- All API routes import this factory; no `@grpc/grpc-js` dependency
- Dependencies: `@connectrpc/connect`, `@connectrpc/connect-node`, `@connectrpc/connect-web`, `@bufbuild/protobuf`

## Dependencies

| Dependency | Type | Reason |
|---|---|---|
| xstockstrat-analysis | Connect-RPC HTTP `8056` | Backtests, strategy scores, reports |
| xstockstrat-indicators | Connect-RPC HTTP `8054` | Compute indicators for charts |
| xstockstrat-marketdata | Connect-RPC HTTP `8053` | Historical OHLCV chart data |
| xstockstrat-notify | Connect-RPC HTTP `8059` | Live alerts |
| xstockstrat-identity | Connect-RPC HTTP `8058` | Token validation |
| xstockstrat-trading | Connect-RPC HTTP `8051` | Broker account list (`ListBrokerAccounts`) |
| xstockstrat-portfolio | Connect-RPC HTTP `8052` | Per-account portfolio data (`ListPortfolios`) |

## Key Pages

| Route | Description |
|---|---|
| `/` | Overview dashboard — strategy scores, recent alerts |
| `/strategies` | Strategy list with scores and backtest summaries |
| `/strategies/[id]` | Detailed backtest results, trade history, P&L chart |
| `/login` | Login form |

> `/indicators` (indicator builder) and `/market/[symbol]` (OHLCV candlestick view) are planned but not yet implemented. The `indicators` and `marketdata` Connect-RPC endpoints listed under **Dependencies** are wired but unused by any page today; add a row here when the pages land.

## Environment Variables

```
# Connect-RPC HTTP endpoints (not raw gRPC ports)
ANALYSIS_HTTP_ENDPOINT=http://xstockstrat-analysis:8056
INDICATORS_HTTP_ENDPOINT=http://xstockstrat-indicators:8054
MARKETDATA_HTTP_ENDPOINT=http://xstockstrat-marketdata:8053
NOTIFY_HTTP_ENDPOINT=http://xstockstrat-notify:8059
IDENTITY_HTTP_ENDPOINT=http://xstockstrat-identity:8058
TRADING_HTTP_ENDPOINT=http://xstockstrat-trading:8051
PORTFOLIO_HTTP_ENDPOINT=http://xstockstrat-portfolio:8052
APPLICATION_ENV=development         # development | production
TRADING_MODE=paper                     # paper | live
```

## Running Locally

```bash
pnpm install
pnpm run dev
```
