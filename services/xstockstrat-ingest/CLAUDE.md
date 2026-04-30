# xstockstrat-ingest — CLAUDE.md

## Role
Python gRPC service that orchestrates historical data backfills, normalises raw data payloads, and **persists newsletter/external signals** to TimescaleDB. Does **not** call Alpaca directly — delegates all market data fetching to xstockstrat-marketdata. Publishes job lifecycle events to xstockstrat-ledger.

As of Phase 3, ingest owns a database schema (`ingest`) and is no longer stateless — it persists newsletter signals to the `ingest.newsletter_signals` hypertable for consumption by indicators and analysis.

## Language
Python 3.12 (asyncio, grpc.aio)

## Ports

| Protocol | Port | Purpose |
|---|---|---|
| gRPC | `50055` | Internal service-to-service (protobuf) |
| HTTP (Connect-RPC) | `8055` | Connect-RPC + n8n webhooks |

## Connect-RPC

Connect-RPC HTTP server runs alongside gRPC on `HTTP_PORT=8055` via `asyncio.gather`.

- Handler: `app/main.py` — `start_connect_server(servicer)` runs uvicorn with `ConnectHandler` ASGI wrapper
- `asyncio.gather(grpc_server.wait_for_termination(), start_connect_server(servicer))` starts both concurrently
- Callers (n8n, frontends) use HTTP `8055`; internal services use gRPC `50055`

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

## Config Keys Consumed

Namespace: `ingest`

| Key | Type | Default | Description |
|---|---|---|---|
| `ingest.backfill.max_concurrent_jobs` | int | `3` | Max parallel backfill jobs |
| `ingest.backfill.default_timeframe` | string | `1d` | Default bar timeframe |
| `ingest.backfill.retry_on_failure` | bool | `true` | Auto-retry failed jobs |
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

## n8n Webhooks

| Endpoint | Method | Payload | Action |
|---|---|---|---|
| `/webhooks/n8n/trigger-backfill` | POST | `{symbols, timeframe, start, end, overwrite}` | Starts backfill job |
| `/webhooks/n8n/backfill-status` | POST | `{job_id}` | Returns job status |
| `/webhooks/n8n/ingest-signal` | POST | `{source, symbol, direction, conviction?, valid_from, valid_until?, headline?, raw_url?, tags?}` | Ingests a newsletter signal |

## Ledger Events Emitted

| Event Type | Trigger |
|---|---|
| `ingest.backfill.queued` | Job created |
| `ingest.backfill.running` | Job started |
| `ingest.backfill.completed` | Job done |
| `ingest.backfill.failed` | Job error |
| `ingest.data.normalized` | Raw data normalised |
| `ingest.signal.ingested` | Newsletter signal persisted |

## Environment Variables

```
GRPC_PORT=50055
HTTP_PORT=8055
CONFIG_ENDPOINT=xstockstrat-config:50060
MARKETDATA_ENDPOINT=xstockstrat-marketdata:50053
LEDGER_ENDPOINT=xstockstrat-ledger:50057
NOTIFY_ENDPOINT=xstockstrat-notify:50059
DATABASE_URL=postgres://xstockstrat:devpassword@timescaledb:5432/xstockstrat?sslmode=disable
APP_ENV=dev                            # dev | production
TRADING_MODE=paper                     # paper | live
```
