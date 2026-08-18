# xstockstrat-marketdata — CLAUDE.md

<!-- context-forge:constitution-pointer:start -->
> **Constitution:** non-obvious local invariants (canonical-timeframe-string contract, live-fallback→cache→reread, `do()` chokepoint, streamed-1m-not-persisted, non-blocking fan-out) live in [`docs/context-constitution.md`](docs/context-constitution.md); defects (fictional CAGG/compression docs, dead retention keys) in [`docs/context-constitution-findings.md`](docs/context-constitution-findings.md). Inherits the root [`PLAT-*` constitution](../../docs/context-constitution.md).
<!-- context-forge:constitution-pointer:end -->

## Role

Go gRPC service that is the **sole integration point for Alpaca's market data APIs**. Responsible for:

- Streaming real-time NBBO quotes (and Alpaca's native 1-minute bars) from Alpaca WebSocket
- Storing bars and quotes in TimescaleDB hypertables
- Serving historical bar queries to other services
- Triggering historical backfills (initiated by xstockstrat-ingest)
- Reporting stored OHLCV coverage via the `GetDataCoverage` RPC (earliest/latest/count + gaps for a symbol+timeframe), consumed by the analysis backtest path and the insights "backfill this range" action (feature 053)

**Timeframe vocabulary** (feature 053): bar intervals are stored as the canonical strings `15m`/`1h`/`1d` in `marketdata.ohlcv.timeframe`. The shared `common.v1.Timeframe` enum is the preferred field (`timeframe_enum`) on the request messages; the legacy string `timeframe` fields are deprecated for one release. `internal/timeframe` normalizes all known aliases (e.g. `"1Day"` → `"1d"`) so callers that historically disagreed now hit the same stored bars. **15 minutes is the smallest supported interval** — the free Alpaca data plan serves 15-minute-delayed data and the platform is not a real-time trader. `TIMEFRAME_1MIN`/`TIMEFRAME_5MIN` (and the `1m`/`5m` strings) are deprecated and no longer resolvable for *requests* — but `TIMEFRAME_1MIN` is not unused: it is the explicit `timeframe_enum` label the Alpaca WS stream path sets on live-streamed (never-persisted) 1-minute bars, describing already-produced data without making sub-15m intervals requestable again (feature 080).

**API boundary**: This service owns Alpaca's **market data APIs** (`data.alpaca.markets` — bars, quotes, streaming). No other service may call these. `xstockstrat-trading` separately owns Alpaca's **broker/order APIs** (`paper-api.alpaca.markets` / `api.alpaca.markets` — order submission and cancellation). Both services use the same `ALPACA_API_KEY` / `ALPACA_API_SECRET` credentials.

## Language

Go 1.25

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
| `marketdata.stream.bar_ingest_interval_ms` | int | `300000` | Interval for the always-on bar ingester that upserts recent bars for every queried symbol into `marketdata.ohlcv`. Read live each cycle; `0`/negative pauses it. Default 5m (feature 140): the ingester now keeps a **daily** bar fresh, and the intraday forming-bar freshness is additionally covered by the UI's 5-min chart poll and `GetBars`' staleness fallback, so a 60s cadence is unnecessary. |
| `marketdata.stream.bar_ingest_timeframe` | string | `1d` | Bar timeframe the always-on ingester fetches each cycle. **Default `1d` (feature 140)** — every automated consumer (charts, screener, strategy evaluation, backtests, readiness) reads daily bars, and no automated consumer reads continuously-refreshed `15m`/`1h`; a human manually picking an intraday chart tab self-heals on demand via `GetBars`' live fallback. Canonicalized through `internal/timeframe` before use; an unresolvable value falls back to `1d` with a WARN each cycle. To pause ingestion, use `bar_ingest_interval_ms <= 0` — never a bogus timeframe value. |
| `marketdata.stream.bar_ingest_lookback_ms` | int | `345600000` | Lookback window the always-on ingester re-fetches each cycle (default 4 days, feature 140); overlap is harmless because inserts upsert, and a window that spans the longest routine market closure (a holiday-extended weekend) always covers the latest completed daily bar and lets the feed self-heal after a pause/restart. |
| `marketdata.backfill.batch_size` | int | `1000` | Bars per Alpaca API request (`limit=`). Read at startup and clamped to Alpaca's spec maximum of 10000; pagination is handled transparently by the client. |
| `marketdata.backfill.rate_limit_rps` | int | `200` | Max outbound Alpaca REST calls per second. Read at startup into a token-bucket limiter the client waits on before every REST call; `0` disables rate limiting. |
| `marketdata.backfill.max_delete_days` | int | `0` | Max date-range span (days) a single scoped backfill delete may cover; `0` = no window cap. A whole-symbol delete (no range) is exempt and double-confirmed in the UI (feature 057, FR-5). |
| `marketdata.fmp.enabled` | bool | `false` | Master gate for the FMP fundamentals source (feature 059). Off by default; establishes the `marketdata.<source>.enabled` convention. Read live on every `GetFundamentals`/`GetFundamentalsMulti` call (`fundamentalsEnabled()`, `internal/service/marketdata_service.go:966`) — flipping it takes effect on the very next call, no service restart required (feature 082). The FMP client itself is always constructed at boot (`cmd/server/main.go`'s `newFundamentalsSource`); this flag gates *use*, not construction. |
| `marketdata.fmp.cache_ttl_hours` | int | `24` | Hours a cached fundamentals row stays fresh before a re-fetch is attempted. |
| `marketdata.fmp.daily_request_cap` | int | `250` | Max FMP requests per UTC day (free Basic plan budget). At cap, stale rows are served (`stale=true`) or `ResourceExhausted` is returned; an 80%-of-cap crossing emits one WARNING alert/day. |
| `marketdata.fmp.base_url` | string | `https://financialmodelingprep.com` | FMP API base URL; endpoint paths (`/stable/quote`, `/stable/ratios-ttm`, `/stable/profile`) are built under it. |
| `marketdata.fmp.metrics` | string | `core,extended` | Metric tiers to fetch. `core` (batchable quote, 1 call/scan chunk); `extended` adds per-symbol ratios-ttm + profile. |
| `marketdata.finnhub.enabled` | bool | `false` | Master gate for the Finnhub fundamentals source (feature 129). Off by default; same live-per-call-read/no-restart-needed convention as `marketdata.fmp.enabled`. |
| `marketdata.finnhub.base_url` | string | `https://api.finnhub.io/api/v1` | Finnhub API base URL; endpoint paths (`/stock/metric`, `/quote`, `/stock/profile2`) are built under it. |
| `marketdata.finnhub.cache_ttl_hours` | int | `24` | Hours a cached fundamentals row stays fresh before a re-fetch is attempted. |
| `marketdata.finnhub.symbols_per_minute` | int | `20` | Max distinct symbols fetched per rolling `rate_window_seconds` window — Finnhub's real limit is per-minute (~60 calls/min ÷ 3 calls/symbol), not per-day like FMP's cap. At cap, stale rows are served (`stale=true`) or `ResourceExhausted` is returned; an 80%-of-cap crossing emits one WARNING alert per window. |
| `marketdata.finnhub.rate_window_seconds` | int | `60` | Rolling window (seconds) `symbols_per_minute` applies over. |
| `marketdata.fundamentals.provider` | string | `finnhub` | Selects the active `source.FundamentalsSource` (`finnhub` \| `fmp`). Read **once at boot** (`cmd/server/main.go`) — unlike every other fundamentals key above, changing it requires a restart; the active client object and the config-key dispatch it drives must never diverge mid-process. |
| `marketdata.retention.quotes_days` | int | `90` | **Documented, not yet implemented** — intended quote retention; no retention job reads this key yet |
| `marketdata.retention.ohlcv_years` | int | `5` | **Documented, not yet implemented** — intended OHLCV retention; no retention job reads this key yet |

## Database

- Schema: `marketdata`
- Hypertable `marketdata.ohlcv`: partition by `time`, chunk = 1 day (compression policy planned, not yet applied by any migration)
- Hypertable `marketdata.quotes`: partition by `time`, chunk = 1 hour (compression policy planned, not yet applied by any migration)
- Table `marketdata.ohlcv_remediation_003`: **plain table, not a hypertable** — an audit log created
  by migration `003_canonicalize_ohlcv_timeframe.up.sql` (feature 080 FR-14) recording every
  `ohlcv` row it deleted or relabelled, so its `.down.sql` can be a faithful reverse. Owner:
  `xstockstrat-marketdata`. Retention: kept until the remediation is confirmed in production, then
  dropped via a later numbered migration — it is deliberately **not** dropped by `003`'s own
  `.up.sql`.
- **Planned, not yet implemented:** continuous aggregate `marketdata.ohlcv_1h` (no migration creates it today)
- Migration tool: `golang-migrate`

## Fundamentals Integration (feature 059; provider made switchable by feature 129)

`xstockstrat-marketdata` is also the **single chokepoint** for fundamental metrics (the screener
060 and the fundamentals-signal producer 062 read fundamentals **only** via the cached
`GetFundamentals`/`GetFundamentalsMulti` RPCs, never a provider directly — so each provider's rate
budget is enforced in one place). There are **two** `source.FundamentalsSource` implementations —
`internal/fmp/` and `internal/finnhub/` — selected at boot by `marketdata.fundamentals.provider`
(default `finnhub`; frozen in a `fundProvider` field, never re-read live — see
`internal/service/marketdata_service.go`'s `fundProvider` doc comment for why). Both are
deliberately **NOT** registered in the OHLCV `source.Registry` — the Alpaca/OHLCV path is untouched
(FR-2).

Both providers share the **identical** read-through DB cache (`marketdata.fundamentals` table) and
RPC layer: cache hit within `cache_ttl_hours` → no provider call; miss/stale → quota-guarded fetch;
at cap → serve stale (`stale=true`) or `ResourceExhausted`; `enabled=false` → `FailedPrecondition`
with no external call. What differs per provider is the **quota-guard shape**
(`fundamentalsQuota()`, `marketdata_service.go`): FMP keeps its original fixed UTC-day cap
(`marketdata.fmp.daily_request_cap`, one batchable `quote` call per scan chunk + per-symbol
`ratios-ttm`/`profile`); Finnhub uses a rolling window (`marketdata.finnhub.symbols_per_minute` /
`.rate_window_seconds`) since its real limit is per-minute, not per-day, and none of its 3
fundamentals endpoints (`/stock/metric`, `/quote`, `/stock/profile2`) batch across symbols — every
`GetFundamentalsMulti` call costs exactly 3 HTTP requests per symbol against Finnhub.

Each provider's API key comes from its own env var — **`FMP_API_KEY`** / **`FINNHUB_API_KEY`**
(`type: SECRET` in both DO app specs, `${FMP_API_KEY:-}` / `${FINNHUB_API_KEY:-}` in
docker-compose) — and is never logged. Neither is a config key: config values are stored in
plaintext and streamed to every `WatchConfig` subscriber, so credentials use the same
secret-env-var mechanism as the Alpaca keys (feature 076). Every other knob (`enabled`, `base_url`,
cache/quota settings) remains a config key.

## Alpaca Integration

- REST: historical bars (single + multi-symbol), asset listing, latest quotes (single + multi-symbol) — `internal/alpaca/client.go`
- WebSocket: real-time quote stream + 1-minute bar stream — `internal/alpaca/stream.go`. A single shared connection (the free plan allows only one per account) is established lazily on the first `StreamBars`/`StreamQuotes` call; it authenticates, subscribes to the union of all subscribers' symbols, fans messages out, and reconnects with backoff (`marketdata.stream.reconnect_delay_ms` / `max_reconnects`). **Alpaca only streams 1-minute bars** — there is no 15m WS granularity — so streamed bars carry the canonical `1m` timeframe and are forwarded to live subscribers **only** (not persisted); the platform's 15m/1h/1d OHLCV storage is owned by the always-on REST bar ingester.
- All outbound REST calls go through a shared rate limiter (`marketdata.backfill.rate_limit_rps`) and set the auth headers centrally
- Multi-symbol REST batching: `GetBarsMulti` / `GetLatestQuotesMulti` collapse the warm-quote poller and bar ingester's per-symbol fan-out into one request per cycle. The pollers type-assert the source to `source.MultiSymbolSource` and fall back to per-symbol calls when unsupported
- Credentials sourced from env vars (never from config service — these are secrets). At startup the service logs a WARN if `ALPACA_API_KEY`/`ALPACA_API_SECRET` is empty or still set to a DO app-spec placeholder (`YOUR_*` / `*PLACEHOLDER*`) — a placeholder makes **every** Alpaca call fail with an opaque edge `401` (nginx "Authorization Required" page, not Alpaca JSON), so the check turns that into an unambiguous boot signal rather than a later warm-poller warning. The service still starts (cached reads keep working)
- Bar/quote requests send `feed=<marketdata.alpaca.feed>` (default `iex`) — required by the free/basic data plan, which 403s the SIP default — and bars also send `adjustment=<marketdata.alpaca.adjustment>` (default `all`)
- `GetLatestQuote` serves from the `marketdata.quotes` cache, falling back to a live Alpaca call (and caching the result). A background warm poller (`StartWarmQuotePoller`) keeps every queried symbol's latest quote fresh in the DB so per-position P&L reads avoid repeated live calls. It prefers one multi-symbol fetch per cycle (`GetLatestQuotesMulti`) and falls back to per-symbol calls; per-symbol fetch errors are aggregated into a single WARN per cycle (`failed`/`fetched`/`total` + a sample error) instead of being dropped silently, so a whole-feed failure (e.g. bad credentials, where every call 401s) is visible rather than hidden
- `GetBars` serves from the `marketdata.ohlcv` table. **A request with no explicit range start** (the chart/screener "latest bars" read) returns the **newest** page via `QueryRecentBars` (`ORDER BY time DESC LIMIT pageSize`, reversed to ascending) — feature 140: the older `QueryBars` returns the *oldest* page of a `pageSize × interval × 3` window, so any symbol with more stored bars than one page rendered months-old data. A request **with** an explicit range start (backtest) keeps the oldest-page-forward pagination unchanged. Two first-page live-fallbacks (both routed through `fetchAndCacheBars` → live fetch → cache → re-read): (1) a DB **miss** (no stored bars) — populates a never-backfilled symbol on demand; (2) feature 140 **staleness** — on the implicit-window path, if the newest stored bar is older than one bar interval, refetch, rate-limited to one live fetch per `(symbol,timeframe)` per interval (`staleCheckDue`) so a weekend does not refetch every poll. A live-fetch/credential/feed failure is logged and yields an empty (but valid) response rather than an error. Querying a symbol also marks it "warm"
- `StartBarIngestPoller` is an **always-on** bar ingester started at boot. Each cycle it upserts recent bars (the `bar_ingest_lookback_ms` window, default 4 days) at the `bar_ingest_timeframe` (default `1d`, feature 140) for every warm symbol — the demand-driven set populated by `GetLatestQuote`/`GetBars` — so ingestion runs continuously without a client holding a `StreamBars` RPC open. The legacy `StreamBars`/`StartBarStream` path (a poll that only runs for the duration of a client stream) remains for explicit subscribers

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
