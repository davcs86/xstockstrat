# xstockstrat-marketdata — CLAUDE.md

<!-- context-forge:constitution-pointer:start -->
> **Constitution:** non-obvious local invariants (canonical-timeframe-string contract, live-fallback→cache→reread, `do()` chokepoint, streamed-1m-not-persisted, non-blocking fan-out) live in [`docs/context-constitution.md`](docs/context-constitution.md); defects (fictional CAGG/compression docs) in [`docs/context-constitution-findings.md`](docs/context-constitution-findings.md). Inherits the root [`PLAT-*` constitution](../../docs/context-constitution.md).
<!-- context-forge:constitution-pointer:end -->

## Role

Go gRPC service that is the **sole integration point for Alpaca's market data APIs**. Responsible for:

- Streaming real-time NBBO quotes (and Alpaca's native 1-minute bars) from Alpaca WebSocket
- Storing bars and quotes in TimescaleDB hypertables
- Serving historical bar queries to other services
- Triggering historical backfills (initiated by xstockstrat-ingest)
- Reporting stored OHLCV coverage via the `GetDataCoverage` RPC (earliest/latest/count + gaps for a symbol+timeframe), consumed by the analysis backtest path and the insights "backfill this range" action (feature 053)

**Timeframe vocabulary** (feature 053): bar intervals are stored as the canonical strings `15m`/`1h`/`1d` in `marketdata.ohlcv.timeframe`. The shared `common.v1.Timeframe` enum is the preferred field (`timeframe_enum`) on the request messages; the legacy string `timeframe` fields are deprecated for one release. `internal/timeframe` normalizes all known aliases (e.g. `"1Day"` → `"1d"`) so callers that historically disagreed now hit the same stored bars. `TIMEFRAME_1MIN`/`TIMEFRAME_5MIN` (and the `1m`/`5m` strings) are deprecated and no longer resolvable for *requests* — but `TIMEFRAME_1MIN` is not unused: it is the explicit `timeframe_enum` label the Alpaca WS stream path sets on live-streamed (never-persisted) 1-minute bars, describing already-produced data without making sub-15m intervals requestable again (feature 080). **Feature 143: `GetBars`/`BackfillBars` now reject any request timeframe other than `1d`** (InvalidArgument) — daily is the only requestable/fetchable interval going forward, since no trading-path consumer (live loop, screener technical criteria, default SMA strategy) evaluates anything but daily bars. `15m`/`1h` remain valid *canonical stored strings* for historical rows and for `GetDataCoverage`/`DeleteBackfilledData` (both stay deliberately permissive, so an operator can still inspect and delete those rows) — they are just no longer requestable/fetchable.

**API boundary**: This service owns Alpaca's **market data APIs** (`data.alpaca.markets` — bars, quotes, streaming). No other service may call these. `xstockstrat-trading` separately owns Alpaca's **broker/order APIs** (`paper-api.alpaca.markets` / `api.alpaca.markets` — order submission and cancellation). Both services use the same Alpaca credentials, which (feature 147) are now the encrypted config secrets `marketdata.alpaca.api_key` / `marketdata.alpaca.api_secret`, resolved at startup via the `GetSecret` RPC (`Watcher.ResolveSecret`, `x-internal-caller: marketdata`) — no longer `ALPACA_API_KEY` / `ALPACA_API_SECRET` env vars.

## Docker Build Pattern

Go pattern — see `docs/patterns/docker-build.md` for multi-stage builder, static binary compilation (`CGO_ENABLED=0`), and distroless final images.

## Dependencies

| Dependency | Type | Reason |
|---|---|---|
| xstockstrat-config | gRPC WatchConfig stream | Live config at startup |
| xstockstrat-ledger | gRPC write | Emit data ingestion events |
| xstockstrat-notify | gRPC write | Alert on feed disconnect/errors |
| Alpaca Markets API | External HTTP + WS | **Only service to use Alpaca** |
| TimescaleDB | DB (schema: `marketdata`) | OHLCV + quotes hypertables |

## Config Keys Consumed

Namespace: `marketdata`. Keys are listed and read as namespace-relative (`backfill.batch_size`); logs and errors
may print the FQN `marketdata.<key>`. The secret vendor-credential rows (below) are namespace-relative too and are
resolved via the separate `GetSecret` RPC (`x-internal-caller: marketdata`), never `WatchConfig`.

| Key | Type | Default | Description |
|---|---|---|---|
| `alpaca.api_key` | secret (`is_secret`) | *(NULL until set)* | Alpaca API key (feature 147). Encrypted at rest; resolved at startup via `GetSecret` (`Watcher.ResolveSecret`, `x-internal-caller: marketdata`), never streamed via `WatchConfig`. |
| `alpaca.api_secret` | secret (`is_secret`) | *(NULL until set)* | Alpaca API secret (feature 147). Same encrypted/`GetSecret` resolution as `api_key`. |
| `fmp.api_key` | secret (`is_secret`) | *(NULL until set)* | FMP fundamentals API key (feature 147). Encrypted; resolved via `GetSecret`. |
| `finnhub.api_key` | secret (`is_secret`) | *(NULL until set)* | Finnhub fundamentals API key (feature 147). Encrypted; resolved via `GetSecret`. |
| `alpaca.feed` | string | `iex` | Alpaca market-data feed for bar/quote requests (`iex`/`sip`/`otc`). The free/basic (paper) data plan only permits `iex`; omitting the param defaults Alpaca to SIP, which those plans reject with HTTP 403. Read at startup. |
| `alpaca.adjustment` | string | `all` | Corporate-action adjustment applied to historical bars (`raw`/`split`/`dividend`/`all`). Default `all` so splits/dividends do not distort backtest OHLCV. Sent as `adjustment=` on every bars request. Read at startup. |
| `stream.reconnect_delay_ms` | int | `2000` | Reconnect delay on stream drop |
| `stream.max_reconnects` | int | `10` | Max reconnect attempts before alert |
| `stream.warm_interval_ms` | int | `30000` | Interval for the warm-quote poller that refreshes the latest quote of every queried symbol into the DB cache. Read live each cycle; `0`/negative pauses it. |
| `stream.bar_ingest_interval_ms` | int | `300000` | Interval for the always-on bar ingester that upserts recent bars for every queried symbol into `marketdata.ohlcv`. Read live each cycle; `0`/negative pauses it. Default 5m (feature 140): with continuous **daily** ingestion, the forming daily bar needn't refresh every 60s — the UI's 5-min chart poll and `GetBars`' staleness fallback additionally cover freshness. |
| `stream.bar_ingest_timeframe` | string (comma-separated list) | `1d` | Bar timeframe(s) the always-on ingester fetches each cycle. A comma-separated list mechanism (not a single value), parsed by the count-agnostic `resolveIngestTimeframes` — feature 143 narrowed the *default* from `15m,1d` to `1d` (feature 140 flipped the platform to daily) because `GetBars`/`BackfillBars` now reject any non-`1d` request, so continuously ingesting 15m served no consumer. Continuous `1d` ingestion keeps daily bars fresh. Each entry is canonicalized through `internal/timeframe`; an unresolvable entry is skipped with a WARN (not a whole-list fallback), and an empty/wholly-unresolvable value falls back to the default. To pause ingestion, use `bar_ingest_interval_ms <= 0` — never a bogus timeframe value. |
| `stream.bar_ingest_lookback_ms` | int | `900000` | Lookback window the always-on ingester re-fetches each cycle. Overlap is harmless because inserts upsert, and a window wider than the interval lets the feed self-heal after a pause/restart. This raw value (15min) is far too short for the `1d` default — but `ingestRecentBars` widens each timeframe's own window to at least 2× that timeframe's interval (`minIngestLookback`), so `1d` always looks back ≥48h regardless of this key's value. |
| `stream.bar_ingest_backoff_ms` | int | `21600000` | Feature 291 — dead-symbol hold for the always-on bar ingester: how long (ms) a warm symbol must return no bars across informative cycles before the ingester leaves it out of the vendor request, and the fixed probe period after that (see the `StartBarIngestPoller` bullet). Read live each cycle (`resolveBarIngestBackoff`, before `warmMu` is taken); no watcher → `21600000` (6 h). `<= 0` disables the hold and clears all hold state — **asymmetry:** unlike `resolvePositiveInt`, `<= 0` here means *off*, not *default*, and the value is never clamped on read. Seeded (staging + production) at the code default by config migration `042_marketdata_bar_ingest_backoff`; SetConfig-bounded `[0, 86400000]`. Trade-off: a false-positive hold lags that symbol's stored daily bar by up to this value. |
| `price.batch_timeout_ms` | int | `2500` | Feature 227 — budget (ms) for the shared `BatchGetLatestPrice` singleflight closure, which runs on a context **detached** from the first caller's cancellation/deadline (`context.WithoutCancel`) so coalesced waiters are not cancelled by it; symbols not fetched within it are omitted (never fabricated) and every dropped error is logged as a WARN. Read live per call; `value_type` must be `int` (any other type reads as the default); `≤ 0` or no config watcher → `2500`. Seeded by a config migration; SetConfig-bounded `[500,2500]`. |
| `quotes.latest_lookback_hours` | int | `168` | Feature 229 — recency window (hours) of both cached quote readers (`GetLatestQuote`, `GetLatestQuotesBatch`: `time >= now − window`, so TimescaleDB excludes older chunks at plan time) and of the cache-age guard (a quote older than the window is returned but never cached). A symbol with no in-window row is cold and fetched live. 7 days covers 3-day weekends + holidays. Read live per call; `≤ 0` or no watcher → `168`. Seeded by a config migration; SetConfig-bounded `[24,720]`. |
| `quotes.batch_timeout_ms` | int | `2500` | Feature 229 — budget (ms) for the detached `GetLatestQuotes` cold-fetch singleflight closure (`context.WithoutCancel`, so a cancelled first caller never fails coalesced waiters). On a cold failure/timeout the call returns the warm subset, cold symbols omitted (never zero-filled), with a WARN `GetLatestQuotes: cold fetch failed`. Read live per call; `≤ 0` or no watcher → `2500`. Must stay, together with `marketdata.quotes.mark_timeout_ms` (bound = max of the two), below `portfolio.marketdata.quote_timeout_ms` minus the warm read. Seeded by a config migration; SetConfig-bounded `[500,5000]`. |
| `quotes.mark_timeout_ms` | int | `500` | Feature 231 — per-caller budget (ms) for the `GetLatestQuotes` stored-close lookup that backs `Quote.mark_price` for returned quotes lacking a positive bid and ask (a symbol with no quote at all is still omitted); it runs concurrently with the cold fetch, and on timeout/error those symbols return without `mark_price` and a WARN `GetLatestQuotes: mark lookup failed`. Read live per call; `≤ 0` or no watcher → `500`. Seeded by a config migration; SetConfig-bounded `[100,2500]`. |
| `quotes.mark_close_max_age_hours` | int | `168` | Feature 231 — max age (hours) of the stored `1d` close usable as a mark; an older (or absent) close leaves `mark_price` unset (never fabricated). Read live per call; `≤ 0` or no watcher → `168`. Seeded by a config migration; SetConfig-bounded `[120,720]`. |
| `backfill.batch_size` | int | `1000` | Bars per Alpaca API request (`limit=`). Read at startup and clamped to Alpaca's spec maximum of 10000; pagination is handled transparently by the client. |
| `backfill.rate_limit_rps` | int | `200` | Max outbound Alpaca REST calls per second. Read at startup into a token-bucket limiter the client waits on before every REST call; `0` disables rate limiting. |
| `backfill.max_delete_days` | int | `0` | Max date-range span (days) a single scoped backfill delete may cover; `0` = no window cap. A whole-symbol delete (no range) is exempt and double-confirmed in the UI (feature 057, FR-5). |
| `fmp.enabled` | bool | `false` | Master gate for the FMP fundamentals source (feature 059). Off by default; establishes the `marketdata.<source>.enabled` convention. Read live on every `GetFundamentals`/`GetFundamentalsMulti` call (`fundamentalsEnabled()`, `internal/service/marketdata_service.go`) — flipping it takes effect on the very next call, no service restart required (feature 082). The single shared FMP client is always constructed at boot (`cmd/server/main.go`'s `newFMPClient`, handed to `newFundamentalsSource`); this flag gates *use*, not construction. |
| `fmp.cache_ttl_hours` | int | `24` | Hours a cached fundamentals row stays fresh before a re-fetch is attempted. |
| `fmp.daily_request_cap` | int | `250` | Max FMP requests per UTC day — the **single shared budget** every FMP path spends (snapshot fundamentals, ratio enrichment, classification refresh; feature 217), enforced per outbound call inside the one `*fmp.Client` (reserve before the call, refund on non-2xx/transport failure, boot-seeded from today's `source='fmp'` row count (fetched or as-of today), a conservative floor: `edgar+fmp` rows and classification calls write no `fmp` row). At cap, stale rows are served (`stale=true`) or `ResourceExhausted` is returned; an 80%-of-cap crossing emits one WARNING alert/day. `<= 0` is a zero budget (FMP disabled on every path); a large cap is effectively uncapped. |
| `fmp.rate_limit_rps` | int | `5` | FMP token-bucket ceiling (burst = 1; feature 217). 5 rps = FMP Starter's 300/min. `0` = unthrottled. Read live per call. |
| `classification.enabled` | bool | `false` | Gate for the sector-classification refresh job (feature 217). Reads (`GetCurrentSector`/`GetSectorAsOf`/`GetSectorHistory`) always serve from `marketdata.symbol_classification` and never call FMP. |
| `classification.refresh_interval_hours` | int | `24` | Classification refresh cadence (feature 217); `<= 0` pauses. Universe = the warm-quote set ∪ symbols read through the classification RPCs. |
| `assets.refresh_interval_hours` | int | `6` | Feature 282 — cadence (hours) of the asset-set refresher (`StartAssetSetRefresher`, § Asset-set servability). Re-read every minute; `> 24` → `24` on read (a refresh stays inside the 48h `minIngestLookback`), nil/unset → `6`, `<= 0` pauses and keeps the current set (reader-only: SetConfig rejects `< 1`). SetConfig-bounded `[1,24]`. Seeded by config migration `038_marketdata_asset_refresh_interval` (global staging + production rows at `6`). |
| `fmp.base_url` | string | `https://financialmodelingprep.com` | FMP API base URL; endpoint paths (`/stable/quote`, `/stable/ratios-ttm`, `/stable/profile`) are built under it. |
| `fmp.metrics` | string | `core,extended` | Metric tiers to fetch. `core` (batchable quote, 1 call/scan chunk); `extended` adds per-symbol ratios-ttm + profile. |
| `finnhub.enabled` | bool | `false` | Master gate for the Finnhub fundamentals source (feature 129). Off by default; same live-per-call-read/no-restart-needed convention as `marketdata.fmp.enabled`. |
| `finnhub.base_url` | string | `https://api.finnhub.io/api/v1` | Finnhub API base URL; endpoint paths (`/stock/metric`, `/quote`, `/stock/profile2`) are built under it. |
| `finnhub.cache_ttl_hours` | int | `24` | Hours a cached fundamentals row stays fresh before a re-fetch is attempted. |
| `finnhub.symbols_per_minute` | int | `20` | Max distinct symbols fetched per rolling `rate_window_seconds` window — Finnhub's real limit is per-minute (~60 calls/min ÷ 3 calls/symbol), not per-day like FMP's cap. At cap, stale rows are served (`stale=true`) or `ResourceExhausted` is returned; an 80%-of-cap crossing emits one WARNING alert per window. |
| `finnhub.rate_window_seconds` | int | `60` | Rolling window (seconds) `symbols_per_minute` applies over. |
| `fundamentals.provider` | string | `finnhub` | Selects the active `source.FundamentalsSource` (`finnhub` \| `fmp`). Read **once at boot** (`cmd/server/main.go`) — unlike every other fundamentals key above, changing it requires a restart; the active client object and the config-key dispatch it drives must never diverge mid-process. **Note (feature 198):** this selector governs only the latest-*snapshot* source. The historical point-in-time source (SEC EDGAR) is a **separate lane** — never a value here — so adding it never perturbs this selector or the provider-keyed FMP cap. |
| `fundamentals.history.enabled` | bool | `false` | Master gate for the historical point-in-time fundamentals **backfill** (feature 198). Read on `BackfillFundamentals`; the as-of read (`GetHistoricalFundamentals`) is not gated (a stored filing is already public). |
| `edgar.base_url` | string | `https://data.sec.gov` | SEC EDGAR XBRL base URL (`/api/xbrl/companyfacts/CIK{cik}.json`). Ticker→CIK map is fetched from `https://www.sec.gov/files/company_tickers.json` (not under this base). |
| `edgar.user_agent` | string | `xstockstrat/1.0 (ops@xstockstrat.local)` | SEC fair-use `User-Agent` (operator should set a real contact). **Non-secret** ordinary config — read via `GetString`, never `GetSecret`; EDGAR is keyless (F-06). |
| `edgar.rate_limit_rps` | int | `10` | Max outbound SEC requests/sec (SEC fair-use ceiling). `0` disables throttling. |
| `fundamentals.snapshot_source` | string | `vendor` | **Live-read** serving source for the latest-snapshot RPCs (`GetFundamentals`/`GetFundamentalsMulti`, feature 211): `edgar` derives the snapshot from the newest as-reported SEC filing + a live price-join (same financial-debt D/E + currency-consistent P/B convention as the historical lane); `vendor` is the unchanged FMP/Finnhub path. Read on **every** call (`snapshotSource()`) — flipping it takes effect on the next call, no restart. An unrecognized value logs a WARN and fails safe to `vendor` (a live typo must not take serving down). Distinct from `marketdata.fundamentals.provider`, which selects only the *vendor* client and is boot-frozen. |
| `edgar.enabled` | bool | `true` | Kill switch for the EDGAR-canonical snapshot source (feature 211), read only under `snapshot_source=edgar`. **Explicit `true` default** (the feature-100 `GetBool` zero-value trap: a missing key must not read as disabled); `false` ⇒ `FailedPrecondition` + WARN (deliberate all-off). |
| `edgar.cache_ttl_hours` | int | `24` | Hours an EDGAR snapshot cache row (`marketdata.fundamentals`, `source=edgar`) stays fresh before re-derivation (feature 211). A cached row whose `source` is a *vendor* value is never served under the edgar axis (source-aware self-heal), so a `snapshot_source` cutover heals stale vendor rows in one call. |
| `dividends.enabled` | bool | `false` | Master gate for the Alpaca cash-dividend corporate-actions feed backing the PIT T12M dividend yield (feature 211, FR-4). Read on `BackfillFundamentals`. Off/absent/unentitled/errored ⇒ `dividend_yield` left **missing** (never a fabricated 0); a feed error is WARN-logged for post-deploy audit. Reuses the resolved Alpaca creds — no new env var/secret. |
| `dividends.backfill_lookback_years` | int | `2` | Fetch-range bound (years back from now) for the Alpaca cash-dividend feed (feature 211). Bounds only how far back dividends are fetched; the T12M yield window itself is fixed at 365 days in code. `<= 0` falls back to 2. |
| `fundamentals.history.backfill.max_lookback_years` | int | `10` | Default lookback (years) when a `BackfillFundamentals` request omits a range start. |
| `fundamentals.history.backfill.period_types` | string | `both` | Default period types to backfill (`quarterly`\|`annual`\|`both`) when the request omits them. |
| `fundamentals.history.backfill.batch_size` | int | `50` | Symbols per backfill batch (reserved for chunked orchestration). |
| `fundamentals.history.ratio_enrichment.enabled` | bool | `false` | Gate for the optional FMP ratio-fill pass. **Gated on the shared FMP day budget (`marketdata.fmp.daily_request_cap`, feature 217)** — no second cap, no new credential (reuses the feature-147 `marketdata.fmp.api_key`). v1 wires no PIT FMP ratio source, so this is a guarded seam. |
| `retention.quotes_days` | int | `90` | Feature 229 — quote retention (days), enforced by `StartQuoteRetention` (app-level `drop_chunks`; DO's Apache-edition TimescaleDB has no `add_retention_policy`). Read live each hourly run; `≤ 0` or no watcher → `90`, never clamped — a run is **skipped with a WARN** when `days*24 <= marketdata.quotes.latest_lookback_hours` (so it never drops rows the windowed reads serve). Seeded by a config migration; SetConfig-bounded `[31,3650]`. See § Quote retention. |

## Database

- Schema: `marketdata`
- Hypertable `marketdata.ohlcv`: partition by `time`. New chunks are 30 days wide (migration 004); pre-004 chunks stay 1 day. See `docs/runbooks/ohlcv-lock-budget-tuning.md`. (Compression policy planned, not yet applied by any migration.)
- Hypertable `marketdata.quotes`: partition by `time`, chunk = 1 hour (compression policy planned, not yet applied by any migration)
- Table `marketdata.ohlcv_remediation_003`: plain audit table backing migration `003`'s reverse — never drop it
  in `003`'s own `.up.sql`.
- Table `marketdata.symbol_classification` (feature 217): plain Type-2 SCD of each symbol's sector — never
  overwrite a version in place; a sector change closes the open row and opens a new one.
  Epoch-seed rows (`source='seed'`, `valid_from = 1900-01-01`) knowingly apply the first-observed
  sector to all pre-go-live bars (user-signed-off C-16 relaxation; analysis surfaces a backtest warning).
- **Planned, not yet implemented:** continuous aggregate `marketdata.ohlcv_1h` (no migration creates it today)

## Fundamentals Integration (feature 059; provider made switchable by feature 129)

Single chokepoint for fundamentals (FMP/Finnhub vendor clients, EDGAR-canonical snapshots, absence vs outage status codes, `GetEtfFlags`, quota guards, derivation versioning, EDGAR ratio bases) → this service's `docs/` folder (**`fundamentals.md`**).

## Alpaca Integration

REST/WebSocket clients, multi-symbol batching, credential resolution, the `GetLatestQuote`/`GetBars` cache and live-fallback paths, the always-on bar ingester and `BatchGetBars` `allow_partial` → this service's `docs/` folder (**`alpaca-integration.md`**).

## Asset-set servability (feature 282)

`StartAssetSetRefresher` (wired in `cmd/server/main.go`) keeps an in-memory snapshot of Alpaca's active,
tradable `us_equity` assets (`internal/service/asset_servability.go`). A symbol is **unservable** when it is
absent from that set (`UNSERVABLE_REASON_NOT_TRADABLE`) or its exchange is `OTC` (`UNSERVABLE_REASON_OTC`).
`GetSymbolServability` classifies a request against the snapshot only (no DB, no Alpaca call); before the first
load it answers `asset_set_loaded=false` with every symbol servable (fail-open). `xstockstrat-portfolio` calls it
on its watchlist insert paths.

**Fixed invariants** (operator-approved, not config keys): the first load runs immediately at boot; a refresh
that errors, is empty, or is under 50% of the last good set is rejected and the last good set kept; a failed
attempt retries with backoff from 1m doubling to a 30m cap; one WARN on entering the never-loaded state and one
INFO `asset set loaded` on the first load; at most 1000 symbols per `GetSymbolServability` call
(`InvalidArgument` above it); only the **first** successful load prunes the warm set of unservable symbols.

**Gate scope — warm-add sites only** (MARKETDATA-16). Accepted residuals: a symbol that becomes unservable after it was warmed stays warm until
restart (R2); the first load has no previous set to compare against, so a truncated first response
over-refuses until the next good refresh (R3).

## Quote retention (feature 229)

`StartQuoteRetention` (wired in `cmd/server/main.go`) prunes `marketdata.quotes` with `drop_chunks` — an app-level loop because DO's Apache-edition TimescaleDB lacks the TSL `add_retention_policy` (supersedes backlog feature 040's quotes row). **Fixed invariants** (operator-approved, not config keys): hourly cadence; first pass one full hour after boot (a rolling deploy's old pod has drained); each run is one transaction `SET LOCAL lock_timeout = '2s'` → `min(range_start)` → `drop_chunks(older_than => min(oldest + 24h, now − quotes_days))`, so ≤ ~24 chunks (~144 AccessExclusive locks) per run and the staging backlog drains in ~55h; a 30s backstop context, so it holds one PgBouncer slot for at most 30s/hour. Failures (e.g. `must be owner`) are WARN `quote retention failed`, never fatal. The per-step bounds assume the 1h `marketdata.quotes` chunk interval (migration 001) — revisit them on any `set_chunk_time_interval`.

## Observability (feature 294-signal-map-instrumentation)

- `loop tick ok` is written by `warm_quote` (30 s; `idle`, `paused`), `quote_retention` (1 h; `skipped`, `disabled`) and `etf_flag_filler` (event-driven, throttled to one per 60 s; `disabled`, `budget`). `bar_ingest` (`bar ingest: cycle complete`), `classification_refresh` and `asset_refresh` keep their own records.
- Instruments: `marketdata.vendor.requests{vendor fmp|finnhub|edgar|alpaca, op, outcome}` and `marketdata.vendor.request.duration{vendor, op}`; outcome is ok|http_429|http_4xx|http_5xx|transport|read|decode|ctx|cap|throttle|build|other, `ctx` wins whenever the request context errored, and a duration is recorded only when a request was sent. Also `marketdata.stream.reconnects{result reconnected|gave_up}`, the gauge `marketdata.stream.last_message_age`, `marketdata.backfill.symbols{kind bars|fundamentals, outcome written|empty|failed}`, and the unlabelled DB-pool gauges `marketdata.db.pool.{acquired,max,empty_acquire_count,empty_acquire_wait}` (the last two cumulative; `acquired == max` with a rising wait = requests queueing for the 2-connection pool).
- Trace context: `telemetry.Init` installs the W3C `traceparent`/baggage propagator, so an inbound RPC from the UI BFF is a child of the BFF dispatch span rather than a root trace.
- Load-bearing log: WARN `warm poller: cache insert failures` is one aggregate per pass; the per-symbol line is DEBUG.

## Environment Variables

> mTLS: requires `MTLS_CERT`/`MTLS_KEY`/`MTLS_CA_CERT` (fail-closed) — see root CLAUDE.md § Environment Variable Naming Convention.

**Alpaca / FMP / Finnhub API credentials are no longer env vars (feature 147)** — they are encrypted config secrets (`marketdata.alpaca.api_key`, `marketdata.alpaca.api_secret`, `marketdata.fmp.api_key`, `marketdata.finnhub.api_key`) resolved via `GetSecret` at startup. `ALPACA_API_KEY` / `ALPACA_API_SECRET` / `FMP_API_KEY` / `FINNHUB_API_KEY` were removed.

```text
# GRPC_PORT, *_ENDPOINT, APPLICATION_ENV: see docker-compose.yml / internal/config/config.go
# TRADING_MODE is no longer used for config scope (feature 147 removed the trading_mode axis; paper/live is derived from environment)
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
