# xstockstrat-marketdata — CLAUDE.md

## Role
Go gRPC service that is the **sole integration point for Alpaca's market data APIs**. Responsible for:
- Streaming real-time OHLCV bars and NBBO quotes from Alpaca WebSocket
- Storing bars and quotes in TimescaleDB hypertables
- Serving historical bar queries to other services
- Triggering historical backfills (initiated by xstockstrat-ingest)

**API boundary**: This service owns Alpaca's **market data APIs** (`data.alpaca.markets` — bars, quotes, streaming). No other service may call these. `xstockstrat-trading` separately owns Alpaca's **broker/order APIs** (`paper-api.alpaca.markets` / `api.alpaca.markets` — order submission and cancellation). Both services use the same `ALPACA_API_KEY` / `ALPACA_API_SECRET` credentials.

## Language
Go 1.22

## Docker Build Pattern
Go pattern — see `docs/patterns/docker-build.md` for multi-stage builder, static binary compilation (`CGO_ENABLED=0`), and distroless final images.

## Ports

| Protocol | Port | Purpose |
|---|---|---|
| gRPC | `50053` | Internal service-to-service (protobuf) |
| HTTP (Connect-RPC) | `8053` | Connect-RPC + n8n webhooks (HTTP/1.1 + HTTP/2 via h2c) |

## Connect-RPC

Connect-RPC HTTP server runs alongside gRPC on `HTTP_PORT=8053`.

- Handler registration: `cmd/server/main.go` — uses `marketdatav1connect.NewMarketDataServiceHandler` wrapped with `h2c.NewHandler`
- Callers (frontends, n8n) use HTTP `8053`; internal services use gRPC `50053`
- Transport: `golang.org/x/net/http2/h2c` supports HTTP/1.1 and HTTP/2 cleartext on same port

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

Source: hardcoded in docker-compose `environment:` unless noted. `APPLICATION_ENV` and `NODE_ENV` come from `.env.local` (committed). `DATABASE_URL` is constructed by docker-compose from `POSTGRES_PASSWORD` in `.env`. `ALPACA_API_KEY` and `ALPACA_API_SECRET` come from `.env` (see `.env.example`).

```
GRPC_PORT=50053
HTTP_PORT=8053
CONFIG_ENDPOINT=xstockstrat-config:50060
LEDGER_ENDPOINT=xstockstrat-ledger:50057
NOTIFY_ENDPOINT=xstockstrat-notify:50059
DATABASE_URL=postgres://xstockstrat:${POSTGRES_PASSWORD}@timescaledb:5432/xstockstrat?sslmode=disable  # constructed by docker-compose from POSTGRES_PASSWORD in .env
APPLICATION_ENV=development            # .env.local
TRADING_MODE=paper                     # paper | live
ALPACA_API_KEY=<secret>                # .env — alpaca.markets paper trading key
ALPACA_API_SECRET=<secret>             # .env
ALPACA_BASE_URL=https://paper-api.alpaca.markets
ALPACA_DATA_URL=https://data.alpaca.markets
```

## Ledger Events Emitted

| Event Type | Trigger |
|---|---|
| `marketdata.feed.connected` | Alpaca stream connected |
| `marketdata.feed.disconnected` | Alpaca stream dropped |
| `marketdata.backfill.started` | Backfill job begins |
| `marketdata.backfill.completed` | Backfill job done |
| `marketdata.backfill.failed` | Backfill job error |
