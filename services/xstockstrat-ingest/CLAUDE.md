# xstockstrat-ingest — CLAUDE.md

## Role

Python gRPC service that orchestrates historical data backfills, normalises raw data payloads, and **persists newsletter/external signals** to TimescaleDB. Does **not** call Alpaca directly — delegates all market data fetching to xstockstrat-marketdata. Publishes job lifecycle events to xstockstrat-ledger.

As of Phase 3, ingest owns a database schema (`ingest`) and is no longer stateless — it persists newsletter signals to the `ingest.newsletter_signals` hypertable for consumption by indicators and analysis.

## Language

Python 3.12 (asyncio, grpc.aio)

## Docker Build Pattern

Python pattern — see `docs/patterns/docker-build.md` for single-stage `uv` builds, `--frozen --no-dev` flags, and proto namespace package setup.

## Ports

| Protocol | Port | Purpose |
|---|---|---|
| gRPC | `50055` | Internal service-to-service (protobuf) |

This service is **gRPC-only** (`app/main.py` runs a single `grpc.aio` server). The MCP agent
ingests signals via the `IngestSignal` gRPC RPC. The former HTTP/Connect-RPC server on `8055`
(and its `/webhooks/{trigger-backfill,backfill-status,ingest-signal}` handlers) was removed.

## Dependencies

| Dependency | Type | Reason |
|---|---|---|
| xstockstrat-config | gRPC WatchConfig | Live config at startup |
| xstockstrat-marketdata | gRPC write | Trigger Alpaca backfill jobs |
| xstockstrat-ledger | gRPC write | Publish backfill and signal lifecycle events |
| xstockstrat-notify | gRPC write | Alert on backfill failures |
| TimescaleDB | asyncpg pool | Persist newsletter signals to `ingest.newsletter_signals` |

## Database

- Schema: `ingest`
- Table: `ingest.newsletter_signals` — TimescaleDB hypertable (7-day chunks by `ingested_at`)
- Migration: `migrations/001_newsletter_signals.up.sql`
- Table: `ingest.backfill_jobs` — durable backfill job state (plain table, **not** a hypertable);
  replaces the former in-memory `self._jobs` dict. Persists status, progress (`bars_processed` /
  `bars_total`), `failed_symbols`, and timestamps so jobs survive a restart. On startup the servicer
  reconciles any job left `RUNNING`/`QUEUED` by a previous process to `FAILED` ("interrupted by
  restart", FR-3 — no automatic resume).
- Migration: `migrations/003_backfill_jobs.up.sql`
- Table: `ingest.backfill_chunks` — per-chunk progress for resumable/chunked backfills (feature 054);
  FK to `ingest.backfill_jobs(job_id)` (cascade). A job is planned into time/symbol chunks
  (`chunk_window_days` × `chunk_max_bars`); chunks run in parallel (`max_concurrent_chunks`) and on
  restart any PENDING/FAILED chunks are re-driven (idempotent marketdata upsert makes re-fetch safe).
  `fill_mode=GAPS_ONLY` plans only the ranges marketdata's `GetDataCoverage` reports missing.
- Migration: `migrations/004_add_backfill_chunks.up.sql`

## Config Keys Consumed

Namespace: `ingest`

| Key | Type | Default | Description |
|---|---|---|---|
| `ingest.backfill.max_concurrent_jobs` | int | `3` | Max parallel backfill jobs |
| `ingest.backfill.default_timeframe` | string | `1d` | Default bar timeframe |
| `ingest.backfill.retry_on_failure` | bool | `true` | Auto-retry failed jobs |
| `ingest.backfill.max_retry_attempts` | int | `3` | Max retry attempts for transient backfill failures |
| `ingest.backfill.chunk_max_bars` | int | `200000` | Max estimated bars per backfill chunk (planner cap, feature 054) |
| `ingest.backfill.chunk_window_days` | int | `90` | Time-window size (days) the chunk planner splits a range into |
| `ingest.backfill.max_concurrent_chunks` | int | `3` | Max chunks of one job fetched in parallel |
| `ingest.signals.unusual_whales.enabled` | bool | `false` | Enable Unusual Whales signal ingestion |
| `ingest.signals.unusual_whales.default_window_days` | int | `5` | Default validity window |
| `ingest.signals.unusual_whales.default_conviction` | float | `0.5` | Default conviction if not provided |
| `ingest.signals.marketwatch.enabled` | bool | `false` | Enable MarketWatch signal ingestion |
| `ingest.signals.marketwatch.default_window_days` | int | `5` | Default validity window |
| `ingest.signals.marketwatch.default_conviction` | float | `0.5` | Default conviction if not provided |
| `ingest.signals.dividendology.enabled` | bool | `false` | Enable Dividendology signal ingestion |
| `ingest.signals.pure_power_picks.enabled` | bool | `false` | Enable Pure Power Picks signal ingestion |
| `ingest.signals.simply_wall_st.enabled` | bool | `false` | Enable Simply Wall St signal ingestion |
| `ingest.signals.dedup_window_hours` | int | `24` | Skip re-ingesting same symbol+source+direction within this window |
| `platform.ledger_endpoint` | string | — | Ledger address |

## Ledger Events Emitted

| Event Type | Trigger |
|---|---|
| `ingest.backfill.queued` | Job created |
| `ingest.backfill.running` | Job started |
| `ingest.backfill.completed` | Job done |
| `ingest.backfill.failed` | Job error |
| `ingest.data.normalized` | Raw data normalised |
| `ingest.signal.ingested` | Newsletter signal persisted |

## Running Tests

```bash
uv sync --extra dev   # install deps (including dev) from uv.lock
uv run pytest         # run all tests
uv run pytest --cov=app --cov-fail-under=40  # with coverage
```

After any change to `pyproject.toml`, run `uv lock` and commit the updated `uv.lock`.

## Environment Variables

```text
GRPC_PORT=50055
CONFIG_ENDPOINT=xstockstrat-config:50060
MARKETDATA_ENDPOINT=xstockstrat-marketdata:50053
LEDGER_ENDPOINT=xstockstrat-ledger:50057
NOTIFY_ENDPOINT=xstockstrat-notify:50059
DATABASE_URL=postgres://xstockstrat:${POSTGRES_PASSWORD}@timescaledb:5432/xstockstrat?sslmode=disable  # constructed by docker-compose from POSTGRES_PASSWORD in .env
APPLICATION_ENV=development         # development | production
TRADING_MODE=paper                     # paper | live
```
