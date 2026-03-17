# xstockstrat-ledger — CLAUDE.md

## Role
Node.js gRPC service implementing an **append-only event store**. Every service in the platform writes domain events here. Events are **immutable** — no UPDATE or DELETE is permitted at the database level (enforced via PostgreSQL rules). Supports live streaming via pg LISTEN/NOTIFY.

## Language
Node.js 20 + TypeScript

## Ports

| Protocol | Port | Purpose |
|---|---|---|
| gRPC | `50057` | Internal service-to-service (protobuf) |
| HTTP (Connect-RPC) | `8057` | Connect-RPC + n8n webhooks |

## Connect-RPC

Connect-RPC HTTP server runs alongside gRPC on `HTTP_PORT=8057`.

- Router: `src/connect/connectRouter.ts` — exposes `AppendEvent`, `QueryEvents` via `connectNodeAdapter`
- Entry: `src/index.ts` — HTTP server with CORS headers mounts the Connect router
- Callers (n8n, frontends) use HTTP `8057`; internal services use gRPC `50057`

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

## n8n Webhooks

| Endpoint | Method | Payload | Action |
|---|---|---|---|
| `/webhooks/n8n/query-events` | POST | `{stream_key, event_type, start, end}` | Returns paginated events |
| `/webhooks/n8n/append-event` | POST | `{event_type, source_service, stream_key, payload}` | Appends event |

## Environment Variables

```
GRPC_PORT=50057
HTTP_PORT=8057
CONFIG_ENDPOINT=xstockstrat-config:50060
DATABASE_URL=postgres://user:pass@timescaledb:5432/xstockstrat?sslmode=disable
APP_ENV=dev                            # dev | production
TRADING_MODE=paper                     # paper | live
```

## Running Locally

```bash
npm install
npm run migrate
npm run dev
```
