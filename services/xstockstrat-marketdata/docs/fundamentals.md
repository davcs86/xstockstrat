# xstockstrat-marketdata — Fundamentals Integration (feature 059; provider made switchable by feature 129)

`xstockstrat-marketdata` is also the **single chokepoint** for fundamental metrics (the screener
060 and the fundamentals-signal producer 062 read fundamentals **only** via the cached
`GetFundamentals`/`GetFundamentalsMulti` RPCs, never a provider directly — so each provider's rate
budget is enforced in one place). There are **two** `source.FundamentalsSource` implementations —
`internal/fmp/` and `internal/finnhub/` — selected at boot by `marketdata.fundamentals.provider`
(default `finnhub`; frozen in a `fundProvider` field, never re-read live — see
`internal/service/marketdata_service.go`'s `fundProvider` doc comment for why). Both are
deliberately **NOT** registered in the OHLCV `source.Registry` — the Alpaca/OHLCV path is untouched
(FR-2).

**Snapshot serving source is switchable (feature 211).** `GetFundamentals`/`GetFundamentalsMulti`
dispatch on the **live-read** `marketdata.fundamentals.snapshot_source` axis (`vendor` | `edgar`,
default `vendor`): under `edgar` the snapshot is derived from the newest as-reported SEC filing (one
indexed `LatestHistoricalFundamental` read) + a live price-join, sharing the same read-through
`marketdata.fundamentals` cache (rows written with `source="edgar"`, TTL `marketdata.edgar.cache_ttl_hours`,
gated by `marketdata.edgar.enabled`), and falls back to the enabled vendor for a non-SEC filer. So the
vendor path below is the serving source only while `snapshot_source=vendor` (or as the edgar fallback).
`marketdata.fundamentals.provider` selects only the *vendor* client and stays boot-frozen. The EDGAR
price-join uses the quote `mark_price` (feature 231), else the filed-date close, which is served but not cached.

**Absence is distinct from outage and disable (feature 215, FR-7/FR-8).** Analysis's fundamentals
guard depends on these status codes:

- With no producible EDGAR snapshot and vendor fallback off (`errNoEdgarSnapshot`), single
  `GetFundamentals` returns **NotFound**, and edgar-mode `GetFundamentalsMulti` **omits** the symbol
  instead of failing the batch.
- An FMP single-symbol no-data result wraps `source.ErrNoFundamentals`, which maps to NotFound and
  is omitted from Multi.
- A Finnhub fetch failure stays **Unavailable**. Finnhub has no absence signal, so its
  `GetFundamentals` returns `fetchOne`'s error unwrapped and never `ErrNoFundamentals`.
- The global disables (`marketdata.edgar.enabled=false`, `enabled=false`) stay **FailedPrecondition**,
  and the quota stays `ResourceExhausted`.

**`GetEtfFlags` (feature 215, FR-11)** labels a symbol as an ETF or not, for analysis's
fundamentals-refusal reason. It is **cache-only**:

- A miss or an expired entry returns `is_etf` **unset** and enqueues a non-blocking, deduped
  background fill. The RPC never calls FMP.
- The filler (`StartEtfFlagFiller`) fetches FMP `/stable/profile` `isEtf` only while FMP is enabled,
  the shared budget is wired, `daily_request_cap > 0`, and `!atQuotaAlertThreshold`. That means
  below 80% of `marketdata.fmp.daily_request_cap`, the same single 80% helper as the quota alert.
  The label therefore never spends the guard's FMP headroom.
- Fixed invariants (not config keys): `etfFlagTTL` 30 days, `etfFlagCacheMax` 10000 (oldest
  evicted), `etfFlagQueueCap` 256 (a full queue drops), `etfFlagLogEvery` 1 minute (the fill-log
  rate-limit window).
- An empty profile is negative-cached; a fetch error is not cached.
- The filler logs at Info, each record with the enqueuing request's `trace_id` when present:
  `etf flag fill skipped` (`reason` `fmp_disabled`/`no_cap`/`budget`; `used`/`cap` only for `no_cap`/`budget`;
  config reasons log on change, `budget` once per window), `etf flag fill failed` (error `class` only, never its
  text, fallback `other`; once per class per window), and `etf flag fill unlabelled` (empty profile; once per window).

Both providers share the **identical** read-through DB cache (`marketdata.fundamentals` table) and
RPC layer: cache hit within `cache_ttl_hours` → no provider call; miss/stale → quota-guarded fetch;
at cap → serve stale (`stale=true`) or `ResourceExhausted`; `enabled=false` → `FailedPrecondition`
with no external call. What differs per provider is the **quota-guard shape**
(`fundamentalsQuota()`, `marketdata_service.go`): FMP keeps its fixed UTC-day cap
(`marketdata.fmp.daily_request_cap`, one batchable `quote` call per scan chunk + per-symbol
`ratios-ttm`/`profile`), counted per outbound call by the shared budget on the one `*fmp.Client`
(feature 217 — the same budget the classification refresh spends); Finnhub uses a rolling window (`marketdata.finnhub.symbols_per_minute` /
`.rate_window_seconds`) since its real limit is per-minute, not per-day, and none of its 3
fundamentals endpoints (`/stock/metric`, `/quote`, `/stock/profile2`) batch across symbols — every
`GetFundamentalsMulti` call costs exactly 3 HTTP requests per symbol against Finnhub.

Each provider's API key is an **encrypted config secret** (feature 147) — **`marketdata.fmp.api_key`**
/ **`marketdata.finnhub.api_key`** (`is_secret=true`, AES-256-GCM ciphertext, redacted at every
config read edge) — resolved at startup via the `GetSecret` RPC (`Watcher.ResolveSecret`,
`x-internal-caller: marketdata`) and never logged. This **reverses** the earlier feature-076 model
where these were `FMP_API_KEY` / `FINNHUB_API_KEY` `type: SECRET` env vars; those env vars were
removed. Every other knob (`enabled`, `base_url`, cache/quota settings) remains an ordinary config
key.

**Derivation versioning (feature 223).** Any change to what `buildPeriod` / `annualizeQuarterlyROE`
write into a stored column MUST bump `edgar.DerivationVersion` (the golden-hash test in
`internal/edgar/derivation_version_test.go` fails until you do). Stored rows with a lower
`derivation_version` are upgraded in place on the next fundamentals backfill (statement-derived columns
only) and the symbol's edgar snapshot cache is invalidated — see
`docs/runbooks/historical-backfill.md` § Re-deriving stored periods.

**EDGAR period ratio bases (features 211/222).** `debt_to_equity` = financial debt / equity
(`total_debt` in `extra_metrics`). `roe` on an **annual** row = annual net income / year-end equity; on
a **quarterly** row it is **trailing-twelve-month** net income / period-end equity — the last four
quarters keyed by each fact's own period end (never the filing's fy/fp, which comparative columns
share), Q4 derived as FY − Q1..Q3, only facts filed on/before the row's filing (PIT); with n < 4
quarters available it is Σ × 4/n. This matches the TTM EPS behind the row's P/E.
