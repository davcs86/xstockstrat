# xstockstrat-ingest — CLAUDE.md

## Role
Python gRPC service that orchestrates historical data backfills and normalises raw data payloads. Does **not** call Alpaca directly — delegates all market data fetching to xstockstrat-marketdata. Publishes job lifecycle events to xstockstrat-ledger.

## Language
Python 3.12 (asyncio, grpc.aio)

## gRPC Port
`50055`

## Dependencies

| Dependency | Type | Reason |
|---|---|---|
| xstockstrat-config | gRPC WatchConfig | Live config at startup |
| xstockstrat-marketdata | gRPC write | Trigger Alpaca backfill jobs |
| xstockstrat-ledger | gRPC write | Publish backfill lifecycle events |
| xstockstrat-notify | gRPC write | Alert on backfill failures |

## Config Keys Consumed

Namespace: `ingest`

| Key | Type | Default | Description |
|---|---|---|---|
| `ingest.backfill.max_concurrent_jobs` | int | `3` | Max parallel backfill jobs |
| `ingest.backfill.default_timeframe` | string | `1d` | Default bar timeframe |
| `ingest.backfill.retry_on_failure` | bool | `true` | Auto-retry failed jobs |
| `platform.ledger_endpoint` | string | — | Ledger address |

## n8n Webhooks

| Endpoint | Method | Payload | Action |
|---|---|---|---|
| `/webhooks/n8n/trigger-backfill` | POST | `{symbols, timeframe, start, end, overwrite}` | Starts backfill job |
| `/webhooks/n8n/backfill-status` | POST | `{job_id}` | Returns job status |

## Ledger Events Emitted

| Event Type | Trigger |
|---|---|
| `ingest.backfill.queued` | Job created |
| `ingest.backfill.running` | Job started |
| `ingest.backfill.completed` | Job done |
| `ingest.backfill.failed` | Job error |
| `ingest.data.normalized` | Raw data normalised |

## Environment Variables

```
GRPC_PORT=50055
CONFIG_ENDPOINT=xstockstrat-config:50060
MARKETDATA_ENDPOINT=xstockstrat-marketdata:50053
LEDGER_ENDPOINT=xstockstrat-ledger:50057
NOTIFY_ENDPOINT=xstockstrat-notify:50059
```
