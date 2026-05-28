# xstockstrat-ledger — CLAUDE.md

## Role
Node.js gRPC service implementing an **append-only event store**. Every service in the platform writes domain events here. Events are **immutable** — no UPDATE or DELETE is permitted at the database level (enforced via PostgreSQL rules). Supports live streaming via pg LISTEN/NOTIFY.

## Language
Node.js 20 + TypeScript

## Docker Build Pattern
Backend pattern — see `docs/patterns/docker-build.md` for the base stage, proto stub timing, and `pnpm deploy` approach.

## Ports

| Protocol | Port | Purpose |
|---|---|---|
| gRPC | `50057` | Internal service-to-service (protobuf) |
| HTTP (Connect-RPC) | `8057` | Connect-RPC |

## Connect-RPC

Connect-RPC HTTP server runs alongside gRPC on `HTTP_PORT=8057`.

- Implementation: `src/connect/ledgerServiceConnect.ts` — `ServiceImpl<typeof LedgerService>` with typed `HandlerContext`; exposes `AppendEvent`, `QueryEvents`, `GetEvent` (unary) and `StreamEvents` (server-streaming async generator)
- Router: `src/connect/connectRouter.ts` — thin wiring: `router.service(LedgerService, createLedgerServiceConnectImpl(impl))`
- Entry: `src/index.ts` — HTTP server with CORS headers mounts the Connect router via `connectNodeAdapter`
- Callers (frontends, agent) use HTTP `8057`; internal services use gRPC `50057`

## Critical Invariants

1. **Events are immutable.** The database enforces `NO UPDATE`, `NO DELETE` rules on `ledger.events`.
2. **All services write here.** The ledger is the system's audit trail and event replay source.
3. **stream_key** is the logical partition for event replay (`order:{id}`, `portfolio:{user_id}`, etc.)
4. **sequence** is globally monotonic — never gaps, never decreasing.

## Dependencies

| Dependency | Type | Reason |
|---|---|---|
| xstockstrat-config | gRPC WatchConfig | Live config at startup |
| TimescaleDB | DB (schema: `ledger`) | Append-only events hypertable |

## Config Keys Consumed

Namespace: `ledger`

| Key | Type | Default | Description |
|---|---|---|---|
| `ledger.stream.notify_enabled` | bool | `true` | Enable pg NOTIFY for live streaming |
| `ledger.retention.years` | int | `2` | Event retention period |
| `ledger.compression.after_days` | int | `3` | Compress chunks after N days |
| `platform.ledger_endpoint` | string | — | Own endpoint (for health checks) |

## Database

- Schema: `ledger`
- Hypertable: `ledger.events` — partition by `recorded_at`, chunk = 1 day
- Compression: after 3 days, segmented by `source_service, event_type`
- Retention: 2 years
- Live streaming: `pg_notify('ledger_stream_{stream_key}', ...)` fires on every insert

## Stream Key Conventions

| Pattern | Used By |
|---|---|
| `order:{order_id}` | xstockstrat-trading |
| `portfolio:{user_id}` | xstockstrat-portfolio |
| `backfill:{job_id}` | xstockstrat-ingest |
| `formula:{formula_id}` | xstockstrat-indicators |
| `alert:{alert_id}` | xstockstrat-notify |
| `config:{namespace}` | xstockstrat-config |

## Webhooks

_Webhook layer removed in feature-011. Use Connect-RPC directly on port 8057._

## Environment Variables

```
GRPC_PORT=50057
HTTP_PORT=8057
CONFIG_ENDPOINT=xstockstrat-config:50060
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
