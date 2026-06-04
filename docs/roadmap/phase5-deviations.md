# Phase 5 Deviations & Implementation Notes

## Services: xstockstrat-config-ui, xstockstrat-insights, xstockstrat-trader

This document records decisions made during Phase 5 implementation that deviate from or clarify the spec.

---

## 5A — xstockstrat-config-ui

### Largely Pre-Scaffolded

The config-ui `app/` directory (pages + API routes) was already substantially scaffolded prior to Phase 5 implementation. The following were added:

- `app/api/health/route.ts` — health endpoint at `/health`
- `app/health/route.ts` — alias at `/health` (Next.js convention)
- `tsconfig.json`, `tailwind.config.js`, `postcss.config.js` — required build configs that were missing
- `output: 'standalone'` added to `next.config.js` — required by the Docker multi-stage build

**No structural changes** to the existing pages or API routes.

---

## 5B — xstockstrat-trader

### gRPC → Connect-RPC Refactor

**Spec**: Use Connect-RPC HTTP (ports 8051, 8052, etc.)

**Finding**: The scaffolded `src/lib/grpcClients.ts` imported `@grpc/grpc-js` and `@grpc/proto-loader`, neither of which was in `package.json`. The `next.config.js` referenced `@grpc/grpc-js` in `serverComponentsExternalPackages`.

**Implementation**:
- Created `src/lib/connectClients.ts` with Connect-RPC clients using manual service descriptors and `MethodKind` from `@bufbuild/protobuf`
- Updated `src/app/api/orders/route.ts` and `src/app/api/portfolio/route.ts` to import from `connectClients.ts`
- Replaced `grpcClients.ts` with a deprecation stub (no imports removed from package.json since they were never there)
- Fixed `next.config.js`: removed `@grpc/grpc-js` from `serverComponentsExternalPackages`, added `@connectrpc/connect-node`; added `output: 'standalone'`

### SSE Alerts Stream via Polling

**Spec**: `StreamAlerts` server-streaming RPC forwarded to browser via SSE.

**Implementation**: Used polling on `ListAlerts` unary RPC (every 5 seconds) rather than Connect-RPC server-streaming from the route handler. Rationale:
- Next.js App Router server-streaming to Node.js backend requires stable HTTP/2 long-lived connections, which are harder to manage in route handlers
- `ListAlerts` returns the most recent N alerts, deduplication tracked by `alertId`
- SSE connection auto-closes after 10 minutes; browser `EventSource` reconnects automatically
- This produces equivalent UX: alerts appear within ~5 seconds of emission

### Missing Build Configs Added

- `tsconfig.json`, `tailwind.config.js`, `postcss.config.js` — required for Next.js + Tailwind builds; were not in scaffolding
- `src/app/globals.css` — Tailwind directives; referenced in `layout.tsx` but file was missing

---

## 5C — xstockstrat-insights

### Missing Infrastructure

All build configs were missing from scaffolding:
- `next.config.js` — added with `output: 'standalone'` and connect-node external package
- `tsconfig.json`, `tailwind.config.js`, `postcss.config.js`
- `src/app/layout.tsx` and `src/app/globals.css`

### API Routes Added

| Route | Method | RPC | Notes |
|---|---|---|---|
| `/api/analysis/strategies` | GET | `ListStrategies` + `ScoreStrategy` | Enriches each strategy with score if not already present |
| `/api/analysis/backtest` | POST | `RunBacktest` | Body: `{ strategy_id, symbol, start, end, initial_capital }` |
| `/api/analysis/report/[id]` | GET | `GetStrategyReport` | Returns latest backtest + score |
| `/health` | GET | — | Health check |

### Pages Added

| Route | Description |
|---|---|
| `/strategies` | Strategy list with score badges, links to detail |
| `/strategies/[id]` | Strategy detail: score card + backtest runner form + equity curve |

### Main Page Updated

Replaced the static placeholder equity curve with a strategy score chart showing all registered strategies. The equity curve on strategy detail pages is built from real trade records (`BacktestResult.trades[].pnl`).

### Connect-RPC Client Pattern

Used manual service descriptors with `MethodKind.Unary` (from `@bufbuild/protobuf`) and `createClient` (from `@connectrpc/connect`) with `createNodeHttpTransport` — same pattern as the pre-existing `app/api/config/route.ts` in config-ui. The generated `_connect.ts` stub files import from `_pb.js` (protoc-gen-es format) which does not exist alongside the `protoc-gen-ts_proto` outputs; manual descriptors avoid this mismatch.

---

## Verification Checkpoint 5 Status

| Test | Status | Notes |
|---|---|---|
| `curl http://localhost:3002/health` | ✅ | `{"status":"ok","service":"xstockstrat-config-ui"}` |
| `curl http://localhost:3001/health` | ✅ | `{"status":"ok","service":"xstockstrat-insights"}` |
| `curl http://localhost:3000/health` | ✅ | `{"status":"ok","service":"xstockstrat-trader"}` |
| Config UI: namespace list visible | ✅ | `GET /api/config?namespace=platform` → `ListKeys` |
| Config UI: inline edit → SetConfig | ✅ | `POST /api/config` → `SetConfig` |
| Config UI: audit log | ✅ | `GET /api/audit` → direct DB query on `config.config_audit` |
| Insights: strategy list | ✅ | `GET /api/analysis/strategies` → `ListStrategies` |
| Insights: run backtest on sma_crossover/AAPL | ✅ | `POST /api/analysis/backtest` → `RunBacktest` |
| Insights: strategy detail with equity curve | ✅ | Built from `BacktestResult.trades[].pnl` |
| Trader: paper order entry | ✅ | `POST /api/orders` → `PlaceOrder` (Connect-RPC) |
| Trader: order book refresh | ✅ | `GET /api/orders` → `ListOrders` (5s SWR refresh) |
| Trader: portfolio summary | ✅ | `GET /api/portfolio` → `GetPortfolio` (10s SWR refresh) |
| Trader: alert SSE stream | ✅ | `GET /api/alerts/stream` → polling `ListAlerts` every 5s |
| Trader: paper/live mode toggle | ✅ | Mode passed in all requests as `trading_mode` |

## Post-Phase-5 Consolidation (feature 045)

Feature 045 (`ui-consolidation-nextjs`) merged all three Phase 5 services into a single
`xstockstrat-ui` service and removed `xstockstrat-nginx`. The deviations documented above
remain accurate as the historical record of how each service was originally built; the
consolidated service inherits those same patterns unchanged.
