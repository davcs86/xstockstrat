# xstockstrat-marketdata — CLAUDE.md

## Role

Go gRPC service that is the **sole integration point for Alpaca's market data APIs**. Responsible for:

- Streaming real-time OHLCV bars and NBBO quotes from Alpaca WebSocket
- Storing bars and quotes in TimescaleDB hypertables
- Serving historical bar queries to other services
- Triggering historical backfills (initiated by xstockstrat-ingest)
- Reporting stored OHLCV coverage via the `GetDataCoverage` RPC (earliest/latest/count + gaps for a symbol+timeframe), consumed by the analysis backtest path and the insights "backfill this range" action (feature 053)

**Timeframe vocabulary** (feature 053): bar intervals are stored as the canonical strings `1m`/`5m`/`1h`/`1d` in `marketdata.ohlcv.timeframe`. The shared `common.v1.Timeframe` enum is the preferred field (`timeframe_enum`) on the request messages; the legacy string `timeframe` fields are deprecated for one release. `internal/timeframe` normalizes all known aliases (e.g. `"1Day"` → `"1d"`) so callers that historically disagreed now hit the same stored bars.

**API boundary**: This service owns Alpaca's **market data APIs** (`data.alpaca.markets` — bars, quotes, streaming). No other service may call these. `xstockstrat-trading` separately owns Alpaca's **broker/order APIs** (`paper-api.alpaca.markets` / `api.alpaca.markets` — order submission and cancellation). Both services use the same `ALPACA_API_KEY` / `ALPACA_API_SECRET` credentials.

## Language

Go 1.22

## Docker Build Pattern

Go pattern — see `docs/patterns/docker-build.md` for multi-stage builder, static binary compilation (`CGO_ENABLED=0`), and distroless final images.

## Ports

| Protocol | Port | Purpose |
|---|---|---|
| gRPC | `50053` | Internal service-to-service (protobuf) |

This service is **gRPC-only**. All callers connect over gRPC `50053`. The former
HTTP/Connect-RPC server on `8053` (and its `/webhooks/n8n/{backfill,subscribe}` handlers) was removed.

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
| `marketdata.alpaca.feed` | string | `iex` | Alpaca market-data feed for bar/quote requests (`iex`/`sip`/`otc`). The free/basic (paper) data plan only permits `iex`; omitting the param defaults Alpaca to SIP, which those plans reject with HTTP 403. Read at startup. |
| `marketdata.stream.reconnect_delay_ms` | int | `2000` | Reconnect delay on stream drop |
| `marketdata.stream.max_reconnects` | int | `10` | Max reconnect attempts before alert |
| `marketdata.stream.warm_interval_ms` | int | `30000` | Interval for the warm-quote poller that refreshes the latest quote of every queried symbol into the DB cache. Read live each cycle; `0`/negative pauses it. |
| `marketdata.backfill.batch_size` | int | `1000` | Bars per Alpaca API request |
| `marketdata.backfill.rate_limit_rps` | int | `200` | Alpaca API rate limit |
| `marketdata.backfill.max_delete_days` | int | `0` | Max date-range span (days) a single scoped backfill delete may cover; `0` = no window cap. A whole-symbol delete (no range) is exempt and double-confirmed in the UI (feature 057, FR-5). |
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
- Bar/quote requests send `feed=<marketdata.alpaca.feed>` (default `iex`) — required by the free/basic data plan, which 403s the SIP default
- `GetLatestQuote` serves from the `marketdata.quotes` cache, falling back to a live Alpaca call (and caching the result). A background warm poller (`StartWarmQuotePoller`) keeps every queried symbol's latest quote fresh in the DB so per-position P&L reads avoid repeated live calls
- `GetBars` serves from the `marketdata.ohlcv` table, and on a first-page DB miss falls back to a live Alpaca historical fetch (`fetchAndCacheBars`), persists the bars, and re-reads — so a chart for a never-backfilled symbol populates on demand instead of rendering empty. A live-fetch/credential/feed failure is logged and yields an empty (but valid) response rather than an error

## Environment Variables

Source: hardcoded in docker-compose `environment:` unless noted. `APPLICATION_ENV` and `NODE_ENV` come from `.env.local` (committed). `DATABASE_URL` is constructed by docker-compose from `POSTGRES_PASSWORD` in `.env`. `ALPACA_API_KEY` and `ALPACA_API_SECRET` come from `.env` (see `.env.example`).

```text
GRPC_PORT=50053
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
