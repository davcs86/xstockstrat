# xstockstrat-trader — CLAUDE.md

## Role
Next.js 14 frontend for trading execution and order management. Uses the App Router with server-side Route Handlers as gRPC-to-HTTP adapters. Browser components communicate with Next.js API routes; API routes communicate with gRPC backend services. Receives live alerts via SSE streaming from `xstockstrat-notify`.

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
              ├── gRPC → xstockstrat-trading
              ├── gRPC → xstockstrat-portfolio
              └── gRPC stream → xstockstrat-notify (proxied as SSE)
```

## Dependencies

| Dependency | Type | Reason |
|---|---|---|
| xstockstrat-trading | gRPC (server-side) | Place, cancel, list orders |
| xstockstrat-portfolio | gRPC (server-side) | Portfolio equity, positions, P&L |
| xstockstrat-notify | gRPC stream (server-side) | Live alert delivery via SSE |
| xstockstrat-identity | gRPC (server-side) | Token validation |

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
# .env.local
TRADING_ENDPOINT=xstockstrat-trading:50051
PORTFOLIO_ENDPOINT=xstockstrat-portfolio:50052
NOTIFY_ENDPOINT=xstockstrat-notify:50059
IDENTITY_ENDPOINT=xstockstrat-identity:50058
NEXT_PUBLIC_APP_ENV=development
```

## Running Locally

```bash
npm install
npm run dev
```
