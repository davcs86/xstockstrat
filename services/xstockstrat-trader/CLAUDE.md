# xstockstrat-trader — CLAUDE.md

## Role
Next.js 14 frontend for trading execution and order management. Uses the App Router with server-side Route Handlers as Connect-RPC-to-HTTP adapters. Browser components communicate with Next.js API routes; API routes communicate with backend services via Connect-RPC HTTP. Receives live alerts via SSE streaming from `xstockstrat-notify`.

## Language
TypeScript / Next.js 14 (App Router)

## Dev Port
`3000`

## Architecture

```
Browser (React Client Components)
  └── SWR → /api/orders, /api/portfolio   (polling)
  └── EventSource → /api/alerts/stream     (SSE, live alerts)
        └── Next.js Route Handlers (server-side)
              ├── Connect-RPC → xstockstrat-trading:8051
              ├── Connect-RPC → xstockstrat-portfolio:8052
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
| xstockstrat-trading | Connect-RPC HTTP `8051` | Place, cancel, list orders |
| xstockstrat-portfolio | Connect-RPC HTTP `8052` | Portfolio equity, positions, P&L |
| xstockstrat-notify | Connect-RPC HTTP `8059` | Alert delivery |
| xstockstrat-identity | Connect-RPC HTTP `8058` | Token validation |

## Config Keys Consumed

No direct WatchConfig subscription (frontend does not connect to config service directly). Config values relevant to the trader UI are served through API routes that read from backend services.

## Paper vs Live Mode

The dashboard has a global **PAPER / LIVE toggle** in the header (`page.tsx`). The selected mode:
- Is passed as a prop to `OrderForm`, `OrderBook`, and `PortfolioSummary`
- Is sent in the `trading_mode` field of every `POST /api/orders` request
- Is used as a query filter on `GET /api/orders?trading_mode=paper|live`
- Is used as a query filter on `GET /api/portfolio?trading_mode=paper|live`

This ensures the order book and portfolio summary only show data for the selected mode. The API route helpers map `'paper'→1` and `'live'→2` to match the `TradingMode` proto enum.

## Key Pages

| Route | Description |
|---|---|
| `/` | Trading dashboard — mode toggle, order form, order book, portfolio summary, alerts |
| `/orders/[id]` | Order detail view |
| `/positions` | Full positions list with P&L breakdown |

## Environment Variables

```
# Connect-RPC HTTP endpoints (not raw gRPC ports)
TRADING_HTTP_ENDPOINT=http://xstockstrat-trading:8051
PORTFOLIO_HTTP_ENDPOINT=http://xstockstrat-portfolio:8052
NOTIFY_HTTP_ENDPOINT=http://xstockstrat-notify:8059
IDENTITY_HTTP_ENDPOINT=http://xstockstrat-identity:8058
APP_ENV=dev                            # dev | production
TRADING_MODE=paper                     # paper | live
```

## Running Locally

```bash
npm install
npm run dev
```
