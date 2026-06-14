# xstockstrat-marketdata — CLAUDE.md

## Role

Go gRPC service that is the **sole integration point for Alpaca's market data APIs**. Responsible for:

- Streaming real-time NBBO quotes (and Alpaca's native 1-minute bars) from Alpaca WebSocket
- Storing bars and quotes in TimescaleDB hypertables
- Serving historical bar queries to other services
- Triggering historical backfills (initiated by xstockstrat-ingest)
- Reporting stored OHLCV coverage via the `GetDataCoverage` RPC (earliest/latest/count + gaps for a symbol+timeframe), consumed by the analysis backtest path and the insights "backfill this range" action (feature 053)

**Timeframe vocabulary** (feature 053): bar intervals are stored as the canonical strings `15m`/`1h`/`1d` in `marketdata.ohlcv.timeframe`. The shared `common.v1.Timeframe` enum is the preferred field (`timeframe_enum`) on the request messages; the legacy string `timeframe` fields are deprecated for one release. `internal/timeframe` normalizes all known aliases (e.g. `"1Day"` → `"1d"`) so callers that historically disagreed now hit the same stored bars. **15 minutes is the smallest supported interval** — the free Alpaca data plan serves 15-minute-delayed data and the platform is not a real-time trader. `TIMEFRAME_1MIN`/`TIMEFRAME_5MIN` (and the `1m`/`5m` strings) are deprecated and no longer resolvable; the enum values remain in the proto for wire compatibility but are unused.

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
| `marketdata.alpaca.adjustment` | string | `all` | Corporate-action adjustment applied to historical bars (`raw`/`split`/`dividend`/`all`). Default `all` so splits/dividends do not distort backtest OHLCV. Sent as `adjustment=` on every bars request. Read at startup. |
| `marketdata.stream.reconnect_delay_ms` | int | `2000` | Reconnect delay on stream drop |
| `marketdata.stream.max_reconnects` | int | `10` | Max reconnect attempts before alert |
| `marketdata.stream.warm_interval_ms` | int | `30000` | Interval for the warm-quote poller that refreshes the latest quote of every queried symbol into the DB cache. Read live each cycle; `0`/negative pauses it. |
| `marketdata.stream.bar_ingest_interval_ms` | int | `60000` | Interval for the always-on bar ingester that upserts recent bars for every queried symbol into `marketdata.ohlcv`. Read live each cycle; `0`/negative pauses it. |
| `marketdata.stream.bar_ingest_timeframe` | string | `15m` | Bar timeframe the always-on ingester fetches each cycle. 15m is the smallest supported interval. |
| `marketdata.stream.bar_ingest_lookback_ms` | int | `900000` | Lookback window the always-on ingester re-fetches each cycle (default 15m); overlap is harmless because inserts upsert, and a window wider than the interval lets the feed self-heal after a pause/restart. |
| `marketdata.backfill.batch_size` | int | `1000` | Bars per Alpaca API request (`limit=`). Read at startup and clamped to Alpaca's spec maximum of 10000; pagination is handled transparently by the client. |
| `marketdata.backfill.rate_limit_rps` | int | `200` | Max outbound Alpaca REST calls per second. Read at startup into a token-bucket limiter the client waits on before every REST call; `0` disables rate limiting. |
| `marketdata.backfill.max_delete_days` | int | `0` | Max date-range span (days) a single scoped backfill delete may cover; `0` = no window cap. A whole-symbol delete (no range) is exempt and double-confirmed in the UI (feature 057, FR-5). |
| `marketdata.retention.quotes_days` | int | `90` | Quote data retention |
| `marketdata.retention.ohlcv_years` | int | `5` | OHLCV data retention |
| `platform.ledger_endpoint` | string | — | xstockstrat-ledger address |

## Database

- Schema: `marketdata`
- Hypertable `marketdata.ohlcv`: partition by `time`, chunk = 1 day, compress after 7 days
- Hypertable `marketdata.quotes`: partition by `time`, chunk = 1 hour, compress after 24 hours
- Continuous aggregate: `marketdata.ohlcv_1h` (auto-computed 1-hour OHLCV from 15-min bars)
- Migration tool: `golang-migrate`

## Alpaca Integration

- REST: historical bars (single + multi-symbol), asset listing, latest quotes (single + multi-symbol) — `internal/alpaca/client.go`
- WebSocket: real-time quote stream + 1-minute bar stream — `internal/alpaca/stream.go`. A single shared connection (the free plan allows only one per account) is established lazily on the first `StreamBars`/`StreamQuotes` call; it authenticates, subscribes to the union of all subscribers' symbols, fans messages out, and reconnects with backoff (`marketdata.stream.reconnect_delay_ms` / `max_reconnects`). **Alpaca only streams 1-minute bars** — there is no 15m WS granularity — so streamed bars carry the canonical `1m` timeframe and are forwarded to live subscribers **only** (not persisted); the platform's 15m/1h/1d OHLCV storage is owned by the always-on REST bar ingester.
- All outbound REST calls go through a shared rate limiter (`marketdata.backfill.rate_limit_rps`) and set the auth headers centrally
- Multi-symbol REST batching: `GetBarsMulti` / `GetLatestQuotesMulti` collapse the warm-quote poller and bar ingester's per-symbol fan-out into one request per cycle. The pollers type-assert the source to `source.MultiSymbolSource` and fall back to per-symbol calls when unsupported
- Credentials sourced from env vars (never from config service — these are secrets). At startup the service logs a WARN if `ALPACA_API_KEY`/`ALPACA_API_SECRET` is empty or still set to a DO app-spec placeholder (`YOUR_*` / `*PLACEHOLDER*`) — a placeholder makes **every** Alpaca call fail with an opaque edge `401` (nginx "Authorization Required" page, not Alpaca JSON), so the check turns that into an unambiguous boot signal rather than a later warm-poller warning. The service still starts (cached reads keep working)
- Bar/quote requests send `feed=<marketdata.alpaca.feed>` (default `iex`) — required by the free/basic data plan, which 403s the SIP default — and bars also send `adjustment=<marketdata.alpaca.adjustment>` (default `all`)
- `GetLatestQuote` serves from the `marketdata.quotes` cache, falling back to a live Alpaca call (and caching the result). A background warm poller (`StartWarmQuotePoller`) keeps every queried symbol's latest quote fresh in the DB so per-position P&L reads avoid repeated live calls. It prefers one multi-symbol fetch per cycle (`GetLatestQuotesMulti`) and falls back to per-symbol calls; per-symbol fetch errors are aggregated into a single WARN per cycle (`failed`/`fetched`/`total` + a sample error) instead of being dropped silently, so a whole-feed failure (e.g. bad credentials, where every call 401s) is visible rather than hidden
- `GetBars` serves from the `marketdata.ohlcv` table, and on a first-page DB miss falls back to a live Alpaca historical fetch (`fetchAndCacheBars`), persists the bars, and re-reads — so a chart for a never-backfilled symbol populates on demand instead of rendering empty. A live-fetch/credential/feed failure is logged and yields an empty (but valid) response rather than an error. Querying a symbol also marks it "warm"
- `StartBarIngestPoller` is an **always-on** bar ingester started at boot. Each cycle it upserts recent bars (the `bar_ingest_lookback_ms` window) for every warm symbol — the demand-driven set populated by `GetLatestQuote`/`GetBars` — so ingestion runs continuously without a client holding a `StreamBars` RPC open. The legacy `StreamBars`/`StartBarStream` path (a 60s poll that only runs for the duration of a client stream) remains for explicit subscribers

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
