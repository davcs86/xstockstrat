# xstockstrat-trader — CLAUDE.md

## Role
Next.js 14 frontend for trading execution and order management. Browser Client Components call backend RPCs through a single Connect BFF using `@connectrpc/connect-web` typed clients (`src/lib/browserClients.ts`); the BFF catch-all (`src/app/api/[...connect]/route.ts` → `src/lib/connectBff.ts`) authenticates the session cookie, propagates `x-user-id`/`x-access-scope`/`x-trace-id`, and forwards to the backend gRPC services via `@connectrpc/connect-node`. Components consume the typed protobuf-es messages directly (camelCase fields, numeric enums) — no per-route JSON mapping. Live alerts stream over Connect server-streaming (`NotifyService.StreamAlerts`), replacing the former SSE bridge. This follows the platform `044-client-api-pattern`.

The only non-BFF routes are `auth/{login,refresh,logout}` and `health`.

## Language
TypeScript / Next.js 14 (App Router)

## Docker Build Pattern
Frontend pattern — see `docs/patterns/docker-build.md` for the base + deps + builder + runner stages, `--filter` usage, and `.next/standalone` optimization.

## Dev Port
`3000`

## Architecture

```
Browser (React Client Components)
  └── @connectrpc/connect-web typed clients (src/lib/browserClients.ts)
        │   SWR-wrapped unary for polling; async-iterator for StreamAlerts
        └── Connect BFF  /trader/api/[...connect]  (connectBff.ts)
              │   requireSession + backendHeaders (x-user-id/-access-scope/-trace-id)
              └── @connectrpc/connect-node gRPC (H2C) →
                    ├── xstockstrat-trading:50051
                    ├── xstockstrat-portfolio:50052
                    ├── xstockstrat-marketdata:50053
                    ├── xstockstrat-notify:50059   (StreamAlerts server-stream)
                    └── xstockstrat-identity:50058 (token verify, in middleware/auth)
```

## Connect Clients

- **Server (BFF → backend):** `src/lib/connectClients.ts` — `createGrpcTransport` (H2C HTTP/2) clients used only inside `connectBff.ts`. No `@grpc/grpc-js` dependency.
- **Browser (Client Components → BFF):** `src/lib/browserClients.ts` — `@connectrpc/connect-web` clients bound to `browserTransport` (`src/lib/connectTransport.ts`, baseUrl `/trader/api`). Components import these; never import `connectClients.ts` (server-only) into a Client Component.
- Dependencies: `@connectrpc/connect`, `@connectrpc/connect-web`, `@connectrpc/connect-node`, `@bufbuild/protobuf`

## Dependencies

| Dependency | Type | Reason |
|---|---|---|
| xstockstrat-trading | gRPC `50051` | Place, cancel, list orders |
| xstockstrat-portfolio | gRPC `50052` | Portfolio equity, positions, P&L |
| xstockstrat-notify | gRPC `50059` | Alert delivery |
| xstockstrat-identity | gRPC `50058` | Token validation |

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
| `/orders/[id]` | Order detail view — symbol, side, status, fill price, account, broker order id |
| `/positions` | Full positions list — qty, avg entry, current price, market value, unrealized P&L |
| `/login` | Login form |

## Environment Variables

```
# gRPC endpoints (host:port, no protocol) — consumed by server-side route handlers only
TRADING_ENDPOINT=xstockstrat-trading:50051
PORTFOLIO_ENDPOINT=xstockstrat-portfolio:50052
NOTIFY_ENDPOINT=xstockstrat-notify:50059
IDENTITY_ENDPOINT=xstockstrat-identity:50058
APPLICATION_ENV=development         # development | production
TRADING_MODE=paper                     # paper | live
```

## Running Locally

```bash
pnpm install
pnpm run dev
```
