# xstockstrat-notify — CLAUDE.md

## Role
Node.js gRPC service providing **server-streaming alert delivery**. Services emit alerts via `EmitAlert` RPC; frontends and monitoring clients subscribe via the `StreamAlerts` server-streaming RPC and receive alerts in real time as they are emitted. Alert fan-out is in-process (no message broker required for small clusters).

## Language
Node.js 20 + TypeScript

## Docker Build Pattern
Backend pattern — see `docs/patterns/docker-build.md` for the base stage, proto stub timing, and `pnpm deploy` approach.

## Ports

| Protocol | Port | Purpose |
|---|---|---|
| gRPC | `50059` | Internal service-to-service (protobuf) |
| HTTP (Connect-RPC) | `8059` | Connect-RPC + webhooks |

## Connect-RPC

Connect-RPC HTTP server runs alongside gRPC on `HTTP_PORT=8059`.

- Implementation: `src/connect/notifyServiceConnect.ts` — `ServiceImpl<typeof NotifyService>` with typed `HandlerContext`; exposes `EmitAlert`, `AcknowledgeAlert`, `ListAlerts` (unary) and `StreamAlerts` (server-streaming async generator bridging the in-process fan-out model)
- Router: `src/connect/connectRouter.ts` — thin wiring: `router.service(NotifyService, createNotifyServiceConnectImpl(impl))`
- Entry: `src/index.ts` — HTTP server with CORS headers mounts the Connect router via `connectNodeAdapter`
- Callers (frontends, agent) use HTTP `8059`; internal services use gRPC `50059`

## Key Design

- `StreamAlerts` holds long-lived gRPC server streams per subscriber
- Fan-out is synchronous in `EmitAlert` — alerts are delivered to matching subscribers before the RPC returns
- Alerts are also persisted to `notify.alerts` for history and replay
- Alert matching: by `user_id`, `categories[]`, `severities[]`

## Dependencies

| Dependency | Type | Reason |
|---|---|---|
| xstockstrat-config | gRPC WatchConfig | Live config at startup |
| xstockstrat-ledger | gRPC write | Emit alert lifecycle events |
| PostgreSQL | DB (schema: `notify`) | Persist alert history |

## Config Keys Consumed

Namespace: `notify`

| Key | Type | Default | Description |
|---|---|---|---|
| `notify.stream.max_subscribers` | int | `1000` | Max concurrent StreamAlerts connections |
| `notify.alert.retention_days` | int | `30` | Alert history retention |
| `notify.alert.max_body_bytes` | int | `4096` | Max alert body size |

## Webhooks

| Endpoint | Method | Payload | Action |
|---|---|---|---|
| `/webhooks/emit-alert` | POST | `{severity, category, title, body, source_service, target_user_id}` | Emits alert via gRPC |
| `/webhooks/list-alerts` | POST | `{user_id, categories, limit}` | Returns recent alerts |

## Environment Variables

```
GRPC_PORT=50059
HTTP_PORT=8059
CONFIG_ENDPOINT=xstockstrat-config:50060
LEDGER_ENDPOINT=xstockstrat-ledger:50057
DATABASE_URL=postgres://xstockstrat:${POSTGRES_PASSWORD}@timescaledb:5432/xstockstrat?sslmode=disable  # constructed by docker-compose from POSTGRES_PASSWORD in .env
APPLICATION_ENV=development         # development | production
TRADING_MODE=paper                     # paper | live
```

## Running Locally

```bash
pnpm install
pnpm run migrate
pnpm run dev
```
