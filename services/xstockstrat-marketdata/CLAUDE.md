# xstockstrat-marketdata — CLAUDE.md

## Role
Go gRPC service that is the **sole Alpaca integration point** for the entire platform. Responsible for:
- Streaming real-time OHLCV bars and NBBO quotes from Alpaca WebSocket
- Storing bars and quotes in TimescaleDB hypertables
- Serving historical bar queries to other services
- Triggering historical backfills (initiated by xstockstrat-ingest)

**No other service may import or call Alpaca APIs directly.**

## Language
Go 1.22

## gRPC Port
`50053`

## Dependencies

| Dependency | Type | Reason |
|---|---|---|
| xstockstrat-config | gRPC WatchConfig stream | Live config at startup |
| xstockstrat-ledger | gRPC write | Emit data ingestion events |
| xstockstrat-notify | gRPC write | Alert on feed disconnect/errors |
| Alpaca Markets API | External HTTP + WS | **Only service to use Alpaca** |
| TimescaleDB | DB (schema: `marketdata`) | OHLCV + quotes hypertables |

## Config Keys Consumed

Namespace: `marketdata`

| Key | Type | Default | Description |
|---|---|---|---|
| `marketdata.alpaca.paper` | bool | `true` | Use paper trading endpoint |
| `marketdata.stream.reconnect_delay_ms` | int | `2000` | Reconnect delay on stream drop |
| `marketdata.stream.max_reconnects` | int | `10` | Max reconnect attempts before alert |
| `marketdata.backfill.batch_size` | int | `1000` | Bars per Alpaca API request |
| `marketdata.backfill.rate_limit_rps` | int | `200` | Alpaca API rate limit |
| `marketdata.retention.quotes_days` | int | `90` | Quote data retention |
| `marketdata.retention.ohlcv_years` | int | `5` | OHLCV data retention |
| `platform.ledger_endpoint` | string | — | xstockstrat-ledger address |

## Database

- Schema: `marketdata`
- Hypertable `marketdata.ohlcv`: partition by `time`, chunk = 1 day, compress after 7 days
- Hypertable `marketdata.quotes`: partition by `time`, chunk = 1 hour, compress after 24 hours
- Continuous aggregate: `marketdata.ohlcv_1h` (auto-computed 1-hour OHLCV from 1-min bars)
- Migration tool: `golang-migrate`

## Alpaca Integration

- REST: historical bars, asset listing, latest quotes — `internal/alpaca/client.go`
- WebSocket: real-time bar stream, quote stream — same package
- Credentials sourced from env vars (never from config service — these are secrets)

## n8n Webhooks

| Endpoint | Method | Payload | Action |
|---|---|---|---|
| `/webhooks/n8n/backfill` | POST | `{symbols, timeframe, start, end}` | Triggers historical backfill job |
| `/webhooks/n8n/subscribe` | POST | `{symbols, timeframe}` | Adds symbols to live stream |

## Environment Variables

```
GRPC_PORT=50053
CONFIG_ENDPOINT=xstockstrat-config:50060
LEDGER_ENDPOINT=xstockstrat-ledger:50057
NOTIFY_ENDPOINT=xstockstrat-notify:50059
DATABASE_URL=postgres://user:pass@timescaledb:5432/xstockstrat?sslmode=disable
ALPACA_API_KEY=<secret>
ALPACA_API_SECRET=<secret>
ALPACA_BASE_URL=https://paper-api.alpaca.markets
ALPACA_DATA_URL=https://data.alpaca.markets
ALPACA_PAPER=true
```

## Ledger Events Emitted

| Event Type | Trigger |
|---|---|
| `marketdata.feed.connected` | Alpaca stream connected |
| `marketdata.feed.disconnected` | Alpaca stream dropped |
| `marketdata.backfill.started` | Backfill job begins |
| `marketdata.backfill.completed` | Backfill job done |
| `marketdata.backfill.failed` | Backfill job error |
