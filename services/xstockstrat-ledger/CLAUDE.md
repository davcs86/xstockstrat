# xstockstrat-ledger — CLAUDE.md

<!-- context-forge:constitution-pointer:start -->
> **Constitution:** non-obvious local invariants (dedup lookup reuses the txn connection at pool=1, `StreamEvents` subscribe→replay→flush→live ordering, resume-from-sequence, global_sequence default) live in [`docs/context-constitution.md`](docs/context-constitution.md); defects (dead `migrate` npm script) in [`docs/context-constitution-findings.md`](docs/context-constitution-findings.md). Inherits the root [`PLAT-*` constitution](../../docs/context-constitution.md).
<!-- context-forge:constitution-pointer:end -->

## Role

Node.js gRPC service implementing an **append-only event store**. Every service in the platform writes domain events here. Events are **immutable** — no UPDATE or DELETE is permitted at the database level (enforced via PostgreSQL **triggers**, `deny_mutation`; rules aren't supported on hypertables). Supports live streaming via pg LISTEN/NOTIFY.

## Language

Node.js 24 + TypeScript

## Docker Build Pattern

Backend pattern — see `docs/patterns/docker-build.md` for the base stage, proto stub timing, and `pnpm deploy` approach.

## Ports

| Protocol | Port | Purpose |
|---|---|---|
| gRPC | `50057` | Internal service-to-service (protobuf) |

This service is **gRPC-only** (`src/index.ts` runs a single `@grpc/grpc-js` server exposing
`AppendEvent`, `QueryEvents`, `GetEvent`, `StreamEvents`, and the server-streaming `ExportEvents`). All callers connect over gRPC
`50057`.

## Critical Invariants

1. **Events are immutable.** The database enforces `NO UPDATE`, `NO DELETE` via `deny_mutation` **triggers** on `ledger.events` (`migrations/001_ledger_events_hypertable.up.sql:47,54,58`).
2. **All services write here.** The ledger is the system's audit trail and event replay source.
3. **stream_key** is the logical partition for event replay (bare `{order_id}` for trading `order.*`, `order:{id}` for `order_intent.*`, `portfolio:{user_id}`, etc.)
4. **sequence** is globally monotonic and may gap (`nextval`; rolled-back inserts burn values) — never decreasing.
5. **`QueryEvents.owner_only` scopes the read to `user_id = x-user-id`** (feature 263); NULL-owned rows are never returned under it. Every user-facing edge MUST set it (the trader BFF does, except on the copilot key it forces and on `account:` keys it ownership-checks); internal callers leave it false. The field defaults to false, so an edge that forgets it fails **open**.

## Live Streaming Architecture (connection budget)

`StreamEvents` does **not** hold a pooled DB connection for the stream's lifetime. Instead a
single dedicated LISTEN connection — `EventNotifier` (`src/services/eventNotifier.ts`), created
outside the query pool — tails the `ledger_stream_all` channel (the DB trigger emits every insert
there in addition to the per-`stream_key` channel) and fans each event out to in-process
subscribers, filtered per-subscriber by `stream_key`/`event_type`. Each `StreamEvents` handler
subscribes to the notifier first, then replays history in bounded pool batches (`REPLAY_BATCH_SIZE`, up to a
`max(sequence)` bound captured after subscribe, releasing the connection between batches), then flushes the
buffered live rows synchronously and goes live.

Never hold a pooled connection for a stream's lifetime: query pool = 1 + 1 dedicated LISTEN connection (the old
per-stream design froze every `AppendEvent`; consumers: LEDGER-3). Subscriptions are released on
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
| `export.enabled` | bool | `true` | Master on/off switch for `ExportEvents` (feature 021). When `false`, the RPC rejects with `FAILED_PRECONDITION` (BFF → HTTP 403). Read via `getBool` — seeded `value_type` `bool` (never `string`). |
| `export.max_window_days` | int | `365` | Maximum `ExportEvents` window span in days (feature 021). A wider start..end is rejected with `INVALID_ARGUMENT` (BFF → HTTP 400). Read via `getInt` — seeded `value_type` `int`. |
| `stream.resolve_timeout_ms` | int | `2000` | Bound on the LISTEN-connection trimmed-row resolve (statement_timeout; 2× client backstop). ≤0/non-finite → 2000. Applied per session via SET-on-change. Seeded `value_type` `int` (config migration 033). |

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
- Table: `ledger.idempotency_keys` — caller-supplied `AppendEvent` dedup map (`idempotency_key` PK → `event_id`); migration `002_idempotency_keys`
- Compression / retention: **not implemented** — no migration or script adds a Timescale compression or
  retention policy, and no config key controls either
- Live streaming: `pg_notify('ledger_stream_{stream_key}', ...)` fires on every insert

## Stream Key Conventions

| Pattern | Used By |
|---|---|
| `{order_id}` (bare; `order.*`) / `order:{order_id}` (`order_intent.*`) | xstockstrat-trading |
| `portfolio:{user_id}` | xstockstrat-portfolio |
| `backfill:{job_id}` | xstockstrat-ingest |
| `formula:{formula_id}` | xstockstrat-indicators |
| `alert:{alert_id}` | xstockstrat-notify |
| `config:{namespace}` | xstockstrat-config |
| `account:{account_id}` | xstockstrat-trading (reconciliation rows are NULL-owned) |
| `copilot:{user_id}:default` | xstockstrat-ui trader BFF (copilot note thread) |

## Observability (feature 294-signal-map-instrumentation)

- No `loop tick ok`: `EventNotifier` is a reconnect loop, not a tick loop.
- Instruments (no labels): `ledger.notify.listener_up` (1 when connected, 0 from the start of a reconnect) and `ledger.notify.listener_reconnects`. Reconnect failures log at the 1st and every 10th consecutive attempt (N=10).

## Environment Variables

> mTLS: requires `MTLS_CERT`/`MTLS_KEY`/`MTLS_CA_CERT` (fail-closed) — see root `CLAUDE.md` § Environment Variable Naming Convention.

```text
GRPC_PORT=50057
CONFIG_ENDPOINT=xstockstrat-config:50060
DATABASE_CA_CERT=<PEM>                 # required unless sslmode=disable — docs/patterns/database.md
DB_POOL_MAX=1                          # query pool size; live streaming uses a separate dedicated LISTEN connection (1 + 1 = 2 total, see Live Streaming Architecture)
APPLICATION_ENV=development         # development | production
TRADING_MODE=paper                     # paper | live
```
