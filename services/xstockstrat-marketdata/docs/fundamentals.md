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

**Derivation versioning (features 223, 348).** Any change to what the period builder
(`collectFilings`, `ownPeriod`, `labelPeriods`, `buildPeriod`, `annualizeQuarterlyROE`) writes into a
stored column, or to a period's identity (label, type, `period_end`, `filed_date`), MUST bump
`edgar.DerivationVersion` and add a golden entry (the golden-hash test in
`internal/edgar/derivation_version_test.go` fails until you do). The current value is **version 3**.
The bump reaches stored rows only through a fundamentals backfill — see "Backfill reconcile" below and
`docs/runbooks/historical-backfill.md` § Re-deriving stored periods. An in-place re-derive
**replaces** the builder-owned `extra_metrics` keys (`source.DerivationOwnedExtraKeys`) instead of
merging them: they are stripped from the stored row before the new values are merged in, so a key the
new derivation omits keeps no old value; keys outside that list survive. Every key `buildPeriod` writes
must be in the list (parity test `TestDerivationOwnedExtraKeys_ParityWithBuilder_feature340`).

**EDGAR period identity (derivation version 3, feature 348).** A period is **one filing's own
period**. SEC companyfacts copies `fy`/`fp` from each filing's cover page and filers repeat them across
years, so they are not read at all.

- Facts are grouped by **accession number**. The filing's form gives the period type: annual for
  `10-K`, `10-KT`, `20-F`, `40-F` and their `/A` amendments; quarterly for `10-Q`, `6-K` and their
  `/A` amendments. Any other form, and an accession whose facts disagree on form or filing date,
  yields no period.
- The filing's **own end** (`period_end`) is its latest balance-sheet anchor (`StockholdersEquity`,
  `Assets`, `Liabilities`) dated on or before its filing date; with no anchor, the latest end of a flow
  whose duration fits the form class. A cover-page share count never sets or moves `period_end`, so
  no period ends after it was filed.
- Filings with the same type and own end are one period: the earliest filing supplies `filed_date`
  and the values (on a tie, the smallest accession number).
- **Labels come from dates.** Annual: `FY<year(period_end − 15 days)>`. Quarterly: take the fiscal-year
  boundary `b` (the own end of an annual filing, `10-KT` included) that is the smallest one on or after
  the quarter end `e` within three quarters, else the nearest one, else December 31 of `year(e)`; with
  `r = round((b − e) / 91.3125 days)` the label is `Q<4 − (r mod 4)>-<year(b − 15 days) − floor(r / 4)>`.
  Labels are computed over the whole payload before the request's range or type filter.
- **Left-out periods.** A quarterly filing whose own end is a real fiscal-year boundary is left out
  (`year_end_quarter`). When two periods of one type still get the same label (a fiscal year end moved
  later within one calendar year), the earlier-ending one keeps it and the later one is left out
  (`label_collision`). Each is logged at WARN (`edgar: period left out`) and counted by
  `marketdata.backfill.periods_left_out{reason}` during a backfill; the audit command lists them.
- **Shares.** A period's share count is the share fact of the filing that supplies its values with the
  latest date on or before that filing's date; on equal dates the `dei` cover-page fact wins.

**Backfill reconcile (feature 348).** `BackfillFundamentals` derives a symbol's full period set and
compares it with every stored row of the requested period types (`internal/reconcile`):

- A stored row equal to a derived period on (label, type, `period_end`, `filed_date`) is **identical**:
  it is upgraded in place when its version is lower, and its price-join is filled or, with
  `overwrite=true`, refreshed. Identical rows outside the request range are not touched.
- Every other stored row of a requested type is **deleted**, and derived periods are **inserted**, in
  one transaction per symbol (`ReplaceHistoricalFundamentals`): each delete is pinned to the row's
  key, dates and version and must remove exactly one row, inserts are plain, anything else rolls back
  and fails the symbol. A derived period is inserted when its `period_end` is inside the request
  range, or it has the type and `period_end` of a deleted row, or the symbol has a deleted row below
  the current version (the range then does not limit that symbol in that run).
- An inserted row is priced at its own filing date from its own statement. Only `price` and
  `dividend_yield` may be carried, from a stored row of the same type and `filed_date`; `market_cap`,
  `pe_ratio` and `pb_ratio` are always recomputed.
- **Guards** fail the symbol with no write: the derivation returns nothing; a requested type with
  stored rows has no derived period; or no stored non-zero `net_income`, `revenue`, `assets`,
  `liabilities` or `stockholders_equity` equals the same metric of any derived period (the ticker now
  resolves to another filer).
- A deleted row whose period is not stored again is logged at INFO (`fundamentals backfill: stored
  period deleted without replacement`, with a `category`). The EDGAR snapshot cache is invalidated
  whenever a row was re-derived or replaced.

**EDGAR period ratio bases (features 211/222).** `debt_to_equity` = financial debt / equity
(`total_debt` in `extra_metrics`). `roe` on an **annual** row = annual net income / year-end equity; on
a **quarterly** row it is **trailing-twelve-month** net income / period-end equity — the last four
quarters keyed by each fact's own period end, Q4 derived as FY − Q1..Q3, only facts filed on/before
the row's filing (PIT); with n < 4 quarters available it is Σ × 4/n. This matches the TTM EPS behind
the row's P/E.

**EDGAR own-period selection (features 340, 348).** Within a filing, instants (equity, assets,
liabilities, the debt line items) and flows (net income, revenue, EPS) are taken only at the filing's
own end, per unit; among facts with the same date the earliest filing wins, and `Revenues` wins over the
contract-revenue tag. A metric with no fact at the own end is **absent**, never filled from a
comparative column. A filing with no balance-sheet anchor has no instants, and each flow is read at its
own latest period end. The "period-end equity" above is the equity at the own end.
