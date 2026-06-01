# xstockstrat-insights — CLAUDE.md

## Role
Next.js 15 analytics and insights dashboard. Displays strategy backtests, performance scoring, indicator charts, and historical market data. Read-heavy; no order placement. Uses gRPC (H2C) to communicate with backend services from server-side route handlers.

**Note on paper vs live**: Strategy backtests are independent simulations run by `xstockstrat-analysis` against historical market data — they are not derived from paper or live order history. No paper/live mode toggle is needed in this service. If future pages show real trade history or realized P&L from the portfolio service, a `trading_mode` filter should be added at that point.

## Language
TypeScript / Next.js 15 (App Router)

## Docker Build Pattern
Frontend pattern — see `docs/patterns/docker-build.md` for the base + deps + builder + runner stages, `--filter` usage, and `.next/standalone` optimization.

## Dev Port
`3001`

## Architecture

```
Browser (React Client Components)
  └── SWR → /api/analysis/*, /api/indicators/*, /api/marketdata/*
        └── Next.js Route Handlers (server-side gRPC clients)
              ├── gRPC (H2C) → xstockstrat-analysis:50056
              ├── gRPC (H2C) → xstockstrat-indicators:50054
              ├── gRPC (H2C) → xstockstrat-marketdata:50053
              ├── gRPC (H2C) → xstockstrat-notify:50059
              └── gRPC (H2C) → xstockstrat-identity:50058
```

## gRPC Client

- Client factory: `src/lib/connectClients.ts` — uses `createGrpcTransport` (H2C HTTP/2) with connect v2 service descriptors from `@xstockstrat/proto/*_pb` files
- All API route handlers import typed clients from this file; no `@grpc/grpc-js` dependency
- Dependencies: `@connectrpc/connect`, `@connectrpc/connect-node`, `@bufbuild/protobuf`

## Dependencies

| Dependency | Type | Reason |
|---|---|---|
| xstockstrat-analysis | gRPC `50056` | Backtests, strategy scores, reports |
| xstockstrat-indicators | gRPC `50054` | Compute indicators for charts |
| xstockstrat-marketdata | gRPC `50053` | Historical OHLCV chart data |
| xstockstrat-notify | gRPC `50059` | Live alerts |
| xstockstrat-identity | gRPC `50058` | Token validation |
| xstockstrat-trading | gRPC `50051` | Broker account list (`ListBrokerAccounts`) |
| xstockstrat-portfolio | gRPC `50052` | Per-account portfolio data (`ListPortfolios`) |

## Key Pages

| Route | Description |
|---|---|
| `/` | Overview dashboard — strategy scores, recent alerts |
| `/strategies` | Strategy list with scores and backtest summaries |
| `/strategies/[id]` | Detailed backtest results, trade history, P&L chart |
| `/market/[symbol]` | Historical OHLCV candlestick chart — timeframe switcher, last/change |
| `/indicators` | Indicator builder — reserved for feature `003-formula-management-ui` |
| `/login` | Login form |

## Environment Variables

```
# gRPC endpoints (host:port, no protocol) — consumed by server-side route handlers only
ANALYSIS_ENDPOINT=xstockstrat-analysis:50056
INDICATORS_ENDPOINT=xstockstrat-indicators:50054
MARKETDATA_ENDPOINT=xstockstrat-marketdata:50053
NOTIFY_ENDPOINT=xstockstrat-notify:50059
IDENTITY_ENDPOINT=xstockstrat-identity:50058
TRADING_ENDPOINT=xstockstrat-trading:50051
PORTFOLIO_ENDPOINT=xstockstrat-portfolio:50052
APPLICATION_ENV=development         # development | production
TRADING_MODE=paper                     # paper | live
```

## Running Locally

```bash
pnpm install
pnpm run dev
```
