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

This service is **gRPC-only** (`src/index.ts` runs a single `@grpc/grpc-js` server exposing
`AppendEvent`, `QueryEvents`, `GetEvent`, and `StreamEvents`). All callers connect over gRPC
`50057`. The former HTTP/Connect-RPC server on `8057` (and the `src/connect/` Connect router)
was removed.

## Critical Invariants

1. **Events are immutable.** The database enforces `NO UPDATE`, `NO DELETE` rules on `ledger.events`.
2. **All services write here.** The ledger is the system's audit trail and event replay source.
3. **stream_key** is the logical partition for event replay (`order:{id}`, `portfolio:{user_id}`, etc.)
4. **sequence** is globally monotonic — never gaps, never decreasing.

## Live Streaming Architecture (connection budget)

`StreamEvents` does **not** hold a pooled DB connection for the stream's lifetime. Instead a
single dedicated LISTEN connection — `EventNotifier` (`src/services/eventNotifier.ts`), created
outside the query pool — tails the `ledger_stream_all` channel (the DB trigger emits every insert
there in addition to the per-`stream_key` channel) and fans each event out to in-process
subscribers, filtered per-subscriber by `stream_key`/`event_type`. Each `StreamEvents` handler
replays history with a borrow-and-release pool query, then subscribes to the notifier.

This decoupling is load-bearing: `xstockstrat-portfolio` holds **three** permanent `StreamEvents`
subscriptions (`order.filled`, `account.positions.synced`, `account.balance.synced`). Under the
old per-stream design each held one of the pool's 2 connections, so the pool was permanently
exhausted and **every `AppendEvent` blocked until the caller's deadline** (`DeadlineExceeded`) —
which is why position/balance-sync ledger writes silently froze. The query pool is therefore now
`DB_POOL_MAX=1` (+ 1 dedicated listener = 2 total, unchanged budget). Subscriptions are released on
`cancelled`/`close`/`error` (leak-proof), and on listener reconnect the handler ends the call so
the client reconnects and replays the gap.

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

## Idempotent Append

`AppendEvent` accepts an optional `idempotency_key`. When set, the event is appended **at
most once** for that key: a retried call (e.g. a caller re-sending after a transient
transport failure such as a ledger-restart GOAWAY) returns the originally-stored event
instead of inserting a duplicate. An empty key preserves the prior behavior (every call
inserts). Dedup is backed by the `ledger.idempotency_keys` table — claim-key and event
insert happen in one transaction, so a key is only recorded if its event was stored.

`ledger.idempotency_keys` is a **regular table, not a hypertable**, on purpose: it needs a
real `PRIMARY KEY (idempotency_key)`, which the `ledger.events` hypertable cannot provide
(a unique index on a hypertable must include the partition column `recorded_at`, defeating
dedup).

## Database

- Schema: `ledger`
- Hypertable: `ledger.events` — partition by `recorded_at`, chunk = 1 day
- Table: `ledger.idempotency_keys` — caller-supplied `AppendEvent` dedup map (`idempotency_key` PK → `event_id`); migration `002_idempotency_keys`
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

_No webhooks. Call the gRPC RPCs on port 50057 directly._

## Environment Variables

```text
GRPC_PORT=50057
CONFIG_ENDPOINT=xstockstrat-config:50060
DATABASE_URL=postgres://xstockstrat:${POSTGRES_PASSWORD}@timescaledb:5432/xstockstrat?sslmode=disable  # constructed by docker-compose from POSTGRES_PASSWORD in .env
DB_POOL_MAX=1                          # query pool size; live streaming uses a separate dedicated LISTEN connection (1 + 1 = 2 total, see Live Streaming Architecture)
APPLICATION_ENV=development         # development | production
TRADING_MODE=paper                     # paper | live
```

## Running Locally

```bash
pnpm install
pnpm run migrate
pnpm run dev
```
