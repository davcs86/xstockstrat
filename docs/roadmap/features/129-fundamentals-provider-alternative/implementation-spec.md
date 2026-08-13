# Implementation Spec: fundamentals-provider-alternative

**Status**: `pending`
**Created**: 2026-08-13
**Feature**: `docs/roadmap/features/129-fundamentals-provider-alternative/feature.md`
**Total Steps**: 12
**Feature Branch**: `claude/fmp-free-layer-ratios-dr0c4j` (this feature's **Development Branch** deviation — see `product-spec.md` § Feature Workflow Notes; all step PRs target this branch, never `main-dev`)

---

## Execution Summary

Add Finnhub as a second `source.FundamentalsSource` behind the existing, unchanged interface
(`internal/source/source.go:57-60`), switchable-not-replacing FMP via a new
`marketdata.fundamentals.provider` selector read once at boot (mirrors the existing
startup-only read pattern for `marketdata.fmp.base_url`/`.metrics`, `cmd/server/main.go:181-182`).
The read-through cache/quota-guard logic in `marketdata_service.go:846-1002` is generalized to
dispatch its config-key names, quota shape, and alert text off a new `s.fundProvider` field frozen
at construction — FMP keeps its exact existing daily-cap branch untouched and fully backward
compatible; Finnhub gets a new rolling-window branch (`CountFundamentalsFetchedSince`, per design.md).
No proto field/message/RPC shape changes — 3 doc-comments naming FMP specifically get a text-only
edit. **Consumer Surface(s) = None** (product-spec, confirmed unchanged by design.md): this is an
internal/platform-only client swap behind `GetFundamentals`/`GetFundamentalsMulti`, so no UI or
Agent step is required — no consumer-surface step is deferred, there is none to defer per C-14.

This session's live-docs research (WebFetch against `raw.githubusercontent.com/Finnhub-Stock-API/
finnhub-python/master/finnhub/client.py`, a static, non-JS-rendered source) closes design.md's
Open Risk #2 (per-symbol-vs-batch call shape): **confirmed** — `company_basic_financials(symbol,
metric)`, `quote(symbol)`, and `company_profile2(**params)` each take exactly one `symbol` param,
no multi-symbol batching, against base URL `https://api.finnhub.io/api/v1` with the API key sent
as a `token` query parameter. This derives `marketdata.finnhub.symbols_per_minute = 20` from
Finnhub's cited 60 calls/minute free-tier ceiling (design.md, `context.md` § sdd-design session) ÷
3 calls/symbol (`/stock/metric` + `/quote` + `/stock/profile2`, one call each). Design.md's Open
Risk #1 (dividend-yield field's exact name on `/stock/metric`) remains genuinely unconfirmed by any
rendering-capable source this session (Finnhub's own `docs.finnhub.io` is a JS SPA; several
indirect sources reference a `dividendYieldIndicatedAnnual`-shaped field but none was verified
directly) — Step 2 makes closing it the first sub-instruction of writing the client, and Step 12
is the mandated AC-3 live smoke test that gives it a final, authoritative answer before
`marketdata.finnhub.enabled` is ever flipped `true` in production.

## Step Dependencies

- Step 3 requires Step 2 (tests the client Step 2 creates).
- Step 5 requires Step 4 (`fundamentalsRepo` interface needs `CountFundamentalsFetchedSince`,
  added in Step 4, before the service can dispatch to it).
- Step 6 requires Steps 4 and 5 (covers both — the paired `test` step for both `service` steps,
  per the Test step pairing rule; `internal/repository/` is CI-coverage-excluded and has no
  existing direct SQL-layer test for the sibling `CountFundamentalsFetchedToday` either, so
  `CountFundamentalsFetchedSince` is exercised the same way: via the `fakeFundRepo` in
  `marketdata_service_test.go`, matching the existing convention exactly — not a lowered bar).
- Step 7 requires Steps 2 and 5 (`main.go` imports the new `internal/finnhub` package and calls
  `NewMarketDataService` with its new `provider` parameter from Step 5).
- Step 8 requires Step 7 (tests the wiring Step 7 creates).
- Step 9 (proto) is independent of Steps 2-8 — the 3 doc-comments name FMP in prose only; no Go
  code reads them at runtime. Recon flags it as required in the **same feature** regardless.
- Step 10 requires Steps 1, 2, 4, 5, 7 (documents the final key set and behavior).
- Step 11 requires Step 1 (documents the same key set in the cross-feature governance log).
- Step 12 requires Steps 1, 2, 5, 7 (needs the full client + wiring + seeded keys deployed, plus
  an operator-supplied `FINNHUB_API_KEY`) and is the acceptance-criteria-mandated close of design.md's
  two Open Risks — it is **not** a CI-run automated test (no live external network call belongs in
  the CI suite, matching the `082-fix-fmp-config-boot-only` insight, `insights.md` 2026-07-30, of
  composing a fragile-live-call proof from unit facts + one recorded, inspectable manual run instead).
- No `xstockstrat-marketdata` DB migration is needed — `002_fundamentals.up.sql:7-25` already has a
  column for every `source.Fundamentals` field (verified directly this session against
  `internal/repository/marketdata_repo.go:248,278-295`), including the `source` text column that
  already defaults to `'fmp'` and will simply also carry `'finnhub'` values — re-confirming recon's
  finding of no column gap.

---

### Step 1 — config: seed `marketdata.finnhub.*` + `marketdata.fundamentals.provider` config keys

**Status**: `done`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/migrations/015_marketdata_finnhub.up.sql` — create
- `services/xstockstrat-config/migrations/015_marketdata_finnhub.down.sql` — create

**Reviewers**: DBA — migration NNN numbering, up+down pair present; `xstockstrat-config` (service owner) — config key naming (`<service>.<category>.<key>`), environment/trading_mode scoping; Security — no secrets in config-service state, secret keys use `secret.*` prefix / secret-env-var convention

**Codebase Evidence**:
- `ls services/xstockstrat-config/migrations/` (run this session) confirms the last file is
  `014_config_caller_identity.up.sql` — next free number is **015**, re-verified this session per
  design.md's Open Risk #3 (the 2026-08-06 migration-collision ledger trap).
- Exact seed pattern to mirror, read in full this session:
  `services/xstockstrat-config/migrations/007_marketdata_fmp.up.sql:1-64` (column list
  `namespace, key, value_type, value_data, description, default_value, consuming_service,
  environment, trading_mode, is_secret`; two rows per key — `environment` ∈ {`dev`, `production`},
  `trading_mode='all'`; `ON CONFLICT (namespace, key, environment, trading_mode) DO NOTHING`) and
  `.down.sql:5-14` (symmetric `DELETE ... WHERE key IN (...)`).
- Value-type CHECK constraint confirmed: `services/xstockstrat-config/migrations/001_config_tables.up.sql:6-21`
  (`value_type IN ('string','int','float','bool','json')`).
- API-credential precedent confirmed **not** to seed a `secret.marketdata.finnhub.api_key` row:
  `services/xstockstrat-config/migrations/009_drop_fmp_api_key_config.up.sql:1-20` (feature 076 —
  removed the platform's only `is_secret` credential row in favor of the `FMP_API_KEY` env var,
  "every other credential on the platform is delivered as a DO App Platform `type: SECRET` env
  var"). `FINNHUB_API_KEY` follows the identical env-var-only pattern (Step 7).
- `marketdata.finnhub.base_url` default confirmed this session via WebFetch against
  `raw.githubusercontent.com/Finnhub-Stock-API/finnhub-python/master/finnhub/client.py`:
  `API_URL = "https://api.finnhub.io/api/v1"`.
- `marketdata.finnhub.symbols_per_minute` default derivation: 60 calls/minute (design.md § Chosen
  Approach, citing `finnhub.io/pricing` + 3 secondary sources) ÷ 3 calls/symbol (confirmed this
  session — see Execution Summary) = **20**. This is a verified, citable default per design.md's
  Open Risk #2 closure — not the proposer's original unverified guess.

**TDD**: `N/A (migration — non-code-bearing)`

**Instructions**:
1. Create `015_marketdata_finnhub.up.sql` mirroring `007_marketdata_fmp.up.sql:1-64`'s exact
   shape (header comment block explaining the migration, then one `INSERT INTO
   config.config_values (...) VALUES (...) ON CONFLICT (namespace, key, environment,
   trading_mode) DO NOTHING;` with two rows — `dev` and `production`, both `trading_mode='all'` —
   per key below. `namespace` is `'marketdata'` for every row (the marketdata service's
   `config.Watcher` subscribes to the `marketdata` namespace as a whole — confirmed
   `cmd/server/main.go:52` `config.NewWatcher(cfg.ConfigEndpoint, "marketdata", ...)` — and reads
   keys by their full dotted string, so the seeded `key` column must equal the string the Go code
   reads).

   | key | value_type | value_data / default_value | description |
   |---|---|---|---|
   | `marketdata.finnhub.enabled` | `bool` | `false` | Master gate for the Finnhub fundamentals source; off by default (mirrors the `marketdata.<source>.enabled` convention feature 059 established) |
   | `marketdata.finnhub.base_url` | `string` | `https://api.finnhub.io/api/v1` | Finnhub API base URL; endpoint paths (`/stock/metric`, `/quote`, `/stock/profile2`) are built under it |
   | `marketdata.finnhub.cache_ttl_hours` | `int` | `24` | Hours a cached fundamentals row stays fresh before a re-fetch is attempted (mirrors `marketdata.fmp.cache_ttl_hours`) |
   | `marketdata.finnhub.symbols_per_minute` | `int` | `20` | Max distinct symbols fetched per rolling `rate_window_seconds` window (derived: Finnhub's free-tier ~60 calls/min ÷ 3 calls/symbol — `/stock/metric`+`/quote`+`/stock/profile2`, none batchable). Re-verify against Step 12's live smoke test before raising in production. |
   | `marketdata.finnhub.rate_window_seconds` | `int` | `60` | Rolling window (seconds) `symbols_per_minute` applies over |
   | `marketdata.fundamentals.provider` | `string` | `finnhub` | Selects the active `source.FundamentalsSource`: `finnhub` or `fmp`. Read once at boot (`cmd/server/main.go`, Step 7) — changing it takes effect on next restart, not live, unlike the other fundamentals keys |

   `consuming_service` = `'xstockstrat-marketdata'` for every row, `is_secret` = `FALSE` for
   every row (no credential is seeded — see Codebase Evidence).
2. Create `015_marketdata_finnhub.down.sql` mirroring `007_marketdata_fmp.down.sql:1-14`: a
   single `DELETE FROM config.config_values WHERE namespace = 'marketdata' AND key IN (...)`
   listing all 6 keys above.

**Verification**:
```
ls services/xstockstrat-config/migrations/015_marketdata_finnhub.up.sql services/xstockstrat-config/migrations/015_marketdata_finnhub.down.sql
```
Then read both files: confirm every `INSERT` row in `.up.sql` has a corresponding key in the
`.down.sql`'s `DELETE ... WHERE key IN (...)` list, and that no row sets `is_secret = TRUE`
(this feature seeds no credential — matches feature 076's precedent). This is an offline,
no-database check per the migration-step verification rule — no `psql`/`migrate apply` here.

---

### Step 2 — service: new Finnhub fundamentals client (`internal/finnhub/`)

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/finnhub/finnhub_client.go` — create

**Reviewers**: `xstockstrat-marketdata` (service owner) — OHLCV ingestion integrity (Alpaca path
must stay untouched), Alpaca feed idempotency; here: new fundamentals-source client correctness,
quota-guard behavior, cache correctness

**Codebase Evidence**:
- Exact shape to mirror symbol-for-symbol, read in full this session:
  `internal/fmp/fmp_client.go:1-250` — package doc comment (`:1-4`), `ClientConfig`/`Client`
  structs (`:21-38`), `NewClient` (`:41-58`), `var _ source.FundamentalsSource = (*Client)(nil)`
  (`:60`), `GetFundamentals` delegating to `GetFundamentalsMulti` (`:63-72`),
  `GetFundamentalsMulti` (`:76-115`), `getJSON` HTTP plumbing — apikey added to the query, never
  logged, URL never in error strings (`:121-148`), per-endpoint fetchers (`:150-184`), response
  structs + `apply()`/`toFundamentals()` mappers (`:189-250`).
- Target interface (unchanged): `internal/source/source.go:34-51` (`Fundamentals` struct — every
  field this client must populate: `Symbol, MarketCap, PERatio, PBRatio, DividendYield, EPS, Beta,
  ROE, DebtToEquity, Price, YearHigh, YearLow, ExtraMetrics, AsOf, Currency, Source`), `:57-60`
  (`FundamentalsSource` interface — `GetFundamentals`/`GetFundamentalsMulti`), `:64-91`
  (`Registry` — confirmed this client must **never** be registered here, same as `fmp.Client`).
- Base URL, auth mechanism, endpoint paths, and (critically) the **no-batching, one-symbol-per-call**
  shape confirmed this session via WebFetch against
  `raw.githubusercontent.com/Finnhub-Stock-API/finnhub-python/master/finnhub/client.py`:
  `API_URL = "https://api.finnhub.io/api/v1"`; `session.params["token"] = api_key` (query param,
  not a header); `def company_basic_financials(self, symbol, metric): return self._get("/stock/metric",
  params={"symbol": symbol, "metric": metric})`; `def quote(self, symbol): return self._get("/quote",
  params={"symbol": symbol})`; `def company_profile2(self, **params): return self._get("/stock/profile2",
  params=params)`. This closes design.md's Open Risk #2 — unlike FMP's batchable `/stable/quote`,
  **every** Finnhub fundamentals endpoint takes exactly one symbol, so `GetFundamentalsMulti` costs
  **3 calls per symbol always** (no core/extended tiering like FMP's `metrics` key — matches
  design.md: "No `marketdata.finnhub.metrics` tiering key").

**TDD**: `red-green required`

**Instructions**:
1. **Close design.md's Open Risk #1 before writing the response structs.** Obtain a free Finnhub
   API key (no credit card required per design.md's cited pricing page) and make one live GET to
   `https://api.finnhub.io/api/v1/stock/metric?symbol=AAPL&metric=all&token=<key>` (and one each to
   `/quote?symbol=AAPL&token=<key>` and `/stock/profile2?symbol=AAPL&token=<key>`). Record the
   **exact** JSON field names for: 52-week high, 52-week low, P/E, P/B, EPS, ROE, debt-to-equity,
   beta, market cap, and — the genuinely unconfirmed one — **dividend yield**. Indirect,
   non-authoritative sources found this session suggest a `dividendYieldIndicatedAnnual`-shaped
   field name on `/stock/metric`, but no rendering-capable source confirmed it directly (Finnhub's
   own `docs.finnhub.io` is a JS SPA that did not render for this session's fetch tooling, matching
   design.md's own finding). **If dividend yield is genuinely absent from the live response, do not
   silently ship a client that always returns `0` for it** — stop and escalate to the user per
   Constitution P-03/C-01: this may force re-opening the FR-1/FR-2 provider comparison, since FMP
   would then be the only candidate covering all required fields. Record whichever outcome in
   `context.md`.
2. Once the live field names are confirmed, write `finnhub_client.go` mirroring
   `internal/fmp/fmp_client.go:1-250`:
   - `ClientConfig{BaseURL, APIKey, HTTPClient}` (Finnhub has no `Metrics` tiering field — see
     Codebase Evidence — so this struct is smaller than FMP's).
   - `Client{baseURL, apiKey, http}`, `NewClient` (nil `HTTPClient` → 30s-timeout default, mirrors
     `fmp_client.go:41-58`).
   - `var _ source.FundamentalsSource = (*Client)(nil)`.
   - `GetFundamentals` delegates to `GetFundamentalsMulti([]string{symbol})`, mirrors `:63-72`.
   - `GetFundamentalsMulti(ctx, symbols)`: **no batched call exists** (unlike FMP's one-quote-call
     core path) — loop over `symbols`, issuing 3 calls per symbol (`/stock/metric?metric=all`,
     `/quote`, `/stock/profile2`), building one `source.Fundamentals` per symbol from the 3
     responses. Skip (don't fail the whole batch on) a symbol whose calls error, mirroring
     `fmp_client.go`'s "skip symbols FMP did not return" comment at `:107`.
   - `getJSON` HTTP plumbing mirrors `fmp_client.go:121-148` exactly, except the auth param is
     `token` (not `apikey`) per the confirmed client.py evidence — still added to the query, never
     logged, URL never included in any error string.
   - Response structs (`finnhubMetric`, `finnhubQuote`, `finnhubProfile2`) use the field names
     confirmed in sub-step 1; map into `source.Fundamentals{Symbol, MarketCap, PERatio, PBRatio,
     DividendYield, EPS, Beta, ROE, DebtToEquity, Price, YearHigh, YearLow, AsOf: time.Now().UTC(),
     Currency, Source: "finnhub"}`, mirroring the `apply()`/`toFundamentals()` split at
     `fmp_client.go:202-250`. `ExtraMetrics` may stay empty (`map[string]float64{}`) unless
     sub-step 1's live response surfaces an obviously useful extra numeric field worth carrying,
     mirroring FMP's `volume`/`change` pattern at `fmp_client.go:203-209`.

**Verification**:
```
cd services/xstockstrat-marketdata && GOWORK=off go build ./internal/finnhub/...
```
Confirms the package compiles and satisfies `source.FundamentalsSource` (the `var _
source.FundamentalsSource = (*Client)(nil)` compile-time assertion fails the build otherwise).

---

### Step 3 — test: `internal/finnhub/finnhub_client_test.go`

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/finnhub/finnhub_client_test.go` — create

**Reviewers**: `xstockstrat-marketdata` (service owner) — same focus as Step 2

**Codebase Evidence**:
- Full pattern to mirror: `internal/fmp/fmp_client_test.go:1-131` — `recordingRT` fake
  `http.RoundTripper` (`:13-42`), `newTestClient` helper (`:44-51`),
  `TestGetFundamentals_MapsCoreAndExtended` (field-mapping assertions, `:53-87`),
  `TestGetFundamentalsMulti_OneQuoteCall` (call-count assertion, `:89-117`),
  `TestHTTPError_DoesNotLeakAPIKey` (`:119-130`).

**TDD**: `red-green required` — write these tests **before** Step 2's mapper logic is finalized;
they must fail (compile error or wrong-field assertion) against a stub/no-op client, then pass
once Step 2's real mapping lands, per Constitution P-06.

**Instructions**:
1. Reuse the `recordingRT` fake `http.RoundTripper` shape from `fmp_client_test.go:13-42`
   verbatim (records request paths, responds per-path with a canned status+body) — this is
   test-double scaffolding, not domain data, so no C-13 fixture-home question applies (single
   consumer, this new test file).
2. `TestGetFundamentals_MapsField` — feed canned JSON for all 3 endpoints (using the field names
   Step 2 confirmed live) and assert every `source.Fundamentals` field is mapped, mirroring
   `fmp_client_test.go:53-87`'s structure. This test is the durable, CI-safe proof that the
   mapping logic is correct — Step 12's live smoke test is the one-time proof the *real* Finnhub
   response actually has those field names.
3. `TestGetFundamentalsMulti_ThreeCallsPerSymbol` — assert exactly 3 requests per symbol for N
   symbols (`3*N` total, via `recordingRT`'s path-count helper, `fmp_client_test.go:32-42`) —
   this is the regression guard for design.md's "no batching" finding and for the
   `symbols_per_minute` quota math in Step 1 (if Finnhub ever adds batching, this test forces the
   quota default to be re-derived, not silently go stale).
4. `TestHTTPError_DoesNotLeakAPIKey` — mirrors `fmp_client_test.go:119-130` exactly, substituting
   the Finnhub `token` param for FMP's `apikey`.

**Verification**:
```
cd services/xstockstrat-marketdata && GOWORK=off go test ./internal/finnhub/... -race -count=1 -v
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod ./internal/finnhub/...
```
`internal/finnhub` is not in the CI coverage-exclusion list (`cmd|handler|repository|telemetry|service`)
— it counts toward the service's 40% threshold the same way `internal/fmp` does today; full-suite
coverage confirmed together with Step 6's verification.

---

### Step 4 — service: `CountFundamentalsFetchedSince` repo method

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/repository/marketdata_repo.go` — modify

**Reviewers**: `xstockstrat-marketdata` (service owner) — same focus as Step 2

**Codebase Evidence**:
- Sibling method to mirror, read in full this session:
  `internal/repository/marketdata_repo.go:337-346` (`CountFundamentalsFetchedToday` — `SELECT
  count(*) FROM marketdata.fundamentals WHERE fetched_at >= date_trunc('day', now() AT TIME ZONE
  'UTC')`, backed by `idx_fundamentals_fetched_at`).
- Column/index reused, confirmed no schema gap: `migrations/002_fundamentals.up.sql:24,27-28`
  (`fetched_at timestamptz NOT NULL DEFAULT now()`, `idx_fundamentals_fetched_at` index).
- Design.md's exact mandate: "a new sibling repo method `CountFundamentalsFetchedSince(ctx, since
  time.Time)` (reuses the existing `fetched_at` column ...), called with `since = now - rateWindow`."

**TDD**: `N/A (repository/ is CI-coverage-excluded and has no existing direct-SQL test pattern
for its Fundamentals sibling, CountFundamentalsFetchedToday, either — see Step Dependencies)`

**Instructions**:
1. Add, immediately after `CountFundamentalsFetchedToday` (`marketdata_repo.go:337-346`):
   ```go
   // CountFundamentalsFetchedSince counts rows fetched since the given time — the rolling-window
   // quota shape a per-minute-limited provider (e.g. Finnhub) needs, as opposed to
   // CountFundamentalsFetchedToday's fixed UTC-day window (feature 129).
   func (r *MarketDataRepo) CountFundamentalsFetchedSince(ctx context.Context, since time.Time) (int, error) {
       var n int
       err := r.pool.QueryRow(ctx,
           `SELECT count(*) FROM marketdata.fundamentals WHERE fetched_at >= $1`, since).Scan(&n)
       if err != nil {
           return 0, fmt.Errorf("count fundamentals fetched since %s: %w", since, err)
       }
       return n, nil
   }
   ```
   Same `idx_fundamentals_fetched_at` index backs this scan (a `>=` predicate on an indexed column,
   same shape as the sibling method).

**Verification**:
```
cd services/xstockstrat-marketdata && GOWORK=off go build ./internal/repository/...
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod ./internal/repository/...
```
`internal/repository` is CI-coverage-excluded (matches the sibling method's own untested-directly
status) — Step 6 exercises this method through `fakeFundRepo` (mirroring how
`CountFundamentalsFetchedToday` is exercised today, `marketdata_service_test.go:195-197`).

---

### Step 5 — service: provider-dispatch the fundamentals cache/quota guard

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/marketdata_service.go` — modify

**Reviewers**: `xstockstrat-marketdata` (service owner) — same focus as Step 2

**Codebase Evidence** (every cited line read in full this session):
- Struct + interfaces to extend: `MarketDataService` struct (`:29-59`, add `fundProvider string`
  field), `fundamentalsRepo` interface (`:68-73`, add `CountFundamentalsFetchedSince(ctx
  context.Context, since time.Time) (int, error)` — satisfied automatically by Step 4's method
  since `*repository.MarketDataRepo` already implements the interface structurally).
- Constructor: `NewMarketDataService(registry, repo, cfgWatcher, ledgerEndpoint, notifyEndpoint,
  fundamentals source.FundamentalsSource) (*MarketDataService, error)` (`:78-107`) — confirmed
  (`grep -rn "NewMarketDataService(" services/xstockstrat-marketdata`) its **only** call site is
  `cmd/server/main.go:112`, so the signature is safe to extend with a new `provider string` param
  with no other caller to update.
- Design.md's mandatory literal-generalization list, each confirmed at its exact line this
  session:
  - `:866` `ttl := time.Duration(s.fundCfg.GetInt("marketdata.fmp.cache_ttl_hours", 24)) * time.Hour` (inside `GetFundamentalsMulti`)
  - `:888` `dailyCap := int(s.fundCfg.GetInt("marketdata.fmp.daily_request_cap", 250))` (inside `GetFundamentalsMulti`)
  - `:927` same `ttl` read (inside `resolveFundamentals`)
  - `:936` same `dailyCap` read (inside `resolveFundamentals`)
  - `:966` `if !s.fundCfg.GetBool("marketdata.fmp.enabled", false) || s.fundamentals == nil {` (`fundamentalsEnabled`)
  - `:967` `fmt.Errorf("fmp fundamentals source disabled")`
  - `:995` `Title: "marketdata FMP quota warning"` (`emitWarning`)
  - `:996` `Body: msg` — the `msg` string is built by the caller `maybeAlertQuota` at `:986`:
    `fmt.Sprintf("FMP daily request usage at %d/%d (>=80%% of cap)", count, dailyCap)`
  - Doc comments naming FMP: `:48-50` (struct field comment), `:840-844` (section banner comment),
    `:959-964` (`fundamentalsEnabled` doc comment), `cmd/server/main.go:103-105,175-178` (handled
    in Step 7).
- **Additional finding beyond design.md's named list** (spec-time discovery, C-01): `:1009-1012`
  inside `toProtoFundamentals` — `src := f.Source; if src == "" { src = "fmp" }`. This defensive
  fallback for an empty `Source` field is currently exercised by the **existing** test
  `TestGetFundamentals_MissFetchesAndUpserts` (`marketdata_service_test.go:378-393`, whose
  `fakeFundSource` stub leaves `Source` unset) and must also become provider-aware, or a
  Finnhub-sourced row with a genuinely empty `Source` would misreport as `"fmp"` on the wire.
- Quota-shape source: `CountFundamentalsFetchedToday` (`marketdata_repo.go:337-346`, FMP path,
  unchanged) vs. `CountFundamentalsFetchedSince` (Step 4, Finnhub path, new).
- `quotaAlertMu`/`quotaAlertDay` fields (`:56-58`) — dedup state, needs generalizing from a
  UTC-date string to a window-bucket string (see Instructions).

**TDD**: `red-green required`

**Instructions**:
1. Add `fundProvider string` to the `MarketDataService` struct (`:29-59`), set once at
   construction — **never** re-read live from `s.fundCfg` inside the RPC handlers. This is a
   deliberate design choice: `cmd/server/main.go` (Step 7) decides, once at boot, both *which*
   `source.FundamentalsSource` client to construct (FMP vs Finnhub) *and* which provider name to
   pass here — the two **must** stay coupled, because a client object built for one provider
   combined with config-key names dispatched for a different provider (if `fundProvider` were
   re-read live and diverged from the frozen client choice) would silently read the wrong
   quota/cache keys against the wrong client. This mirrors the existing `base_url`/`.metrics`
   "startup-only" read pattern already used for FMP (recon.md's config-read-pattern citation,
   `cmd/server/main.go:181-182`) — extended here to the provider *selection* itself, while every
   individual per-provider knob (`cache_ttl_hours`, the quota cap, `enabled`) stays a live
   per-call read exactly as today, just under a provider-dispatched key name.
2. Extend `fundamentalsRepo` (`:68-73`) with `CountFundamentalsFetchedSince(ctx context.Context,
   since time.Time) (int, error)`.
3. Extend `NewMarketDataService`'s signature (`:78-107`) with a new final parameter `provider
   string`, stored as `fundProvider: provider` in the returned struct literal (`:94-106`).
4. Generalize the two `cache_ttl_hours` reads (`:866`, `:927`) from the literal
   `"marketdata.fmp.cache_ttl_hours"` to `"marketdata."+s.fundProvider+".cache_ttl_hours"`.
5. Replace the two identical daily-cap quota-check blocks (`:887-912` inside
   `GetFundamentalsMulti`, `:936-946` inside `resolveFundamentals`) with a provider dispatch.
   Both call sites need the same three values — `count int`, `cap int`, `windowSeconds int64` —
   so factor a small unexported helper, e.g.:
   ```go
   // fundamentalsQuota returns the active provider's current fetch count, cap, and window
   // (seconds) for the 80%-WARNING/at-cap logic. FMP keeps its exact pre-existing daily-cap
   // shape (unchanged config key, unchanged repo method); Finnhub uses the new rolling window.
   func (s *MarketDataService) fundamentalsQuota(ctx context.Context) (count, cap int, windowSeconds int64, err error) {
       switch s.fundProvider {
       case "finnhub":
           windowSeconds = s.fundCfg.GetInt("marketdata.finnhub.rate_window_seconds", 60)
           cap = int(s.fundCfg.GetInt("marketdata.finnhub.symbols_per_minute", 20))
           since := time.Now().Add(-time.Duration(windowSeconds) * time.Second)
           count, err = s.fundRepo.CountFundamentalsFetchedSince(ctx, since)
       default: // "fmp" and any unrecognized value fall back to the existing, well-tested daily-cap shape
           windowSeconds = 86400
           cap = int(s.fundCfg.GetInt("marketdata.fmp.daily_request_cap", 250))
           count, err = s.fundRepo.CountFundamentalsFetchedToday(ctx)
       }
       return count, cap, windowSeconds, err
   }
   ```
   Call this at both `:888` and `:936` in place of the current inline `dailyCap`/`count`
   computation, keeping the surrounding at-cap/stale-serve/`ResourceExhausted` branch structure
   (`:893-912`, `:941-946`) **unchanged** — design.md explicitly requires the branch structure to
   stay as-is, only the count/cap/window source changes.
6. Generalize `fundamentalsEnabled` (`:965-970`): `s.fundCfg.GetBool("marketdata."+s.fundProvider+".enabled",
   false)`; error text becomes `fmt.Errorf("%s fundamentals source disabled", s.fundProvider)`.
7. Generalize the quota-WARNING dedup (`:972-987`, `quotaAlertDay` at `:58`): rename
   `quotaAlertDay` to `quotaAlertBucket` (string) and compute the dedup key as a window-bucket —
   `bucket := fmt.Sprintf("%d", time.Now().Unix()/windowSeconds)` — instead of
   `time.Now().UTC().Format("2006-01-02")`. For FMP's `windowSeconds=86400`, `floor(unixSeconds /
   86400)` is UTC-midnight-aligned (Unix epoch starts at UTC midnight) — **identical** dedup
   behavior to today's UTC-day string, so `TestGetFundamentals_QuotaWarningEmittedOnce`
   (`marketdata_service_test.go:396-412`) keeps passing unmodified for the FMP path. For
   Finnhub's `windowSeconds=60`, this makes the WARNING correctly re-fire once per new
   60-second window instead of firing once and going silent until the next UTC day — closing the
   exact gap design.md's "Quota guard" section named. Update `maybeAlertQuota`'s signature to
   accept `windowSeconds int64` (from step 5's helper) alongside `count, dailyCap`.
8. Generalize `emitWarning` (`:989-1002`): `Title: fmt.Sprintf("marketdata %s quota warning",
   strings.ToUpper(s.fundProvider))`; and `maybeAlertQuota`'s message builder (`:986`) becomes
   `fmt.Sprintf("%s request usage at %d/%d (>=80%% of cap) in the last %ds", strings.ToUpper(s.fundProvider), count, cap, windowSeconds)`.
9. Generalize `toProtoFundamentals`'s empty-`Source` fallback (`:1009-1012`): `src = s.fundProvider`
   instead of the literal `"fmp"`. This is a method on `*MarketDataService` today only in the sense
   that it's called from service methods — confirm it either becomes a method (`s.toProtoFundamentals`)
   or keep it a free function and pass `s.fundProvider` in explicitly at both call sites
   (`:881`, `:897`, `:909`, `:917`/`:933`/`:943` — wherever `toProtoFundamentals(f, stale)` is
   currently invoked); pick whichever keeps the diff smaller.
10. Update the doc comments naming FMP specifically at `:48-50`, `:840-844`, `:959-964` to
    describe the fundamentals source generically (e.g. "the active fundamentals provider,
    selected by `marketdata.fundamentals.provider`") rather than hardcoding "FMP".

**Verification**:
```
cd services/xstockstrat-marketdata && GOWORK=off go build ./internal/service/...
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod ./internal/service/...
```
Full behavioral + coverage verification runs together with Step 6 (this step's code and its test
step are inseparable for a meaningful `go test` run, since Step 5 alone doesn't compile against
the *old* test file's `newFundSvc`/`NewMarketDataService` call sites — see Step 6).

---

### Step 6 — test: update + extend `marketdata_service_test.go` fundamentals suite

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/marketdata_service_test.go` — modify

**Reviewers**: `xstockstrat-marketdata` (service owner) — same focus as Step 2

**Codebase Evidence**:
- Existing fixture/helper shape to update, read in full this session:
  `fakeFundRepo` (`:168-197`, add a `CountFundamentalsFetchedSince` method satisfying the Step 4
  interface addition — e.g. bucket its `todayCount` by a caller-supplied `since` the same way
  `CountFundamentalsFetchedToday` returns `todayCount` today, or track a separate counter — the
  test author's call once the real dispatch logic (Step 5) is in front of them), `fakeCfg`
  (`:229-246`, `GetString` currently ignores its key arg and always returns the default — needs a
  real map lookup like `bools`/`ints` already have, so tests can set
  `strings["marketdata.fundamentals.provider"] = "finnhub"`), `enabledCfg()` (`:260-265`,
  currently hardcodes `marketdata.fmp.*` keys), `newFundSvc` (`:267-269`, currently constructs
  `&MarketDataService{...}` directly with a struct literal, not via `NewMarketDataService` — add
  a `provider string` param and set `fundProvider: provider` in the literal).
- Existing 8 acceptance tests to keep passing for the FMP path, each read this session:
  `TestGetFundamentals_CacheHitNoFMP` (`:272-289`), `TestGetFundamentals_AtCapStale`
  (`:292-310`), `TestGetFundamentals_AtCapNoCacheResourceExhausted` (`:313-323`),
  `TestGetFundamentals_DisabledFailedPrecondition` (`:326-339`),
  `TestGetFundamentals_LiveToggle_NoRestart` (`:344-375`), `TestGetFundamentals_MissFetchesAndUpserts`
  (`:378-393`), `TestGetFundamentals_QuotaWarningEmittedOnce` (`:396-412`),
  `TestGetFundamentals_NilSourceFailedPrecondition` (`:418-424`).

**TDD**: `red-green required` — after Step 5 lands, this file will not even compile (new
constructor signature, new interface method) until updated; that compile failure **is** the red
state for this step's TDD pairing with Step 5.

**Instructions**:
1. Update `fakeCfg.GetString` (`:246`) to do a real map lookup against a new `strings
   map[string]string` field (mirroring `bools`/`ints`), so tests can set
   `marketdata.fundamentals.provider`, `marketdata.finnhub.base_url`, etc.
2. Update `enabledCfg()` (`:260-265`) to accept a `provider` argument (or add a sibling
   `enabledFinnhubCfg()`) seeding the correct provider-prefixed keys.
3. Update `newFundSvc` (`:267-269`) to take a `provider string` param, set `fundProvider:
   provider`.
4. Add `CountFundamentalsFetchedSince` to `fakeFundRepo` (`:168-197`).
5. Update all 8 existing FMP-path tests' call sites to pass `provider: "fmp"` explicitly (they
   must keep passing byte-for-byte on the same assertions — this is the regression proof that
   Step 5's generalization didn't change FMP's behavior).
6. Add a parallel Finnhub-path suite mirroring the 8 FMP tests 1:1, substituting
   `marketdata.finnhub.*` keys and asserting the **rolling-window** shape specifically:
   - `TestGetFundamentals_Finnhub_CacheHitNoFetch` (mirrors `:272-289`)
   - `TestGetFundamentals_Finnhub_AtCapStale` — set `fakeFundRepo`'s since-counter so
     `CountFundamentalsFetchedSince` returns ≥ `symbols_per_minute`, assert `stale=true` (mirrors `:292-310`)
   - `TestGetFundamentals_Finnhub_AtCapNoCacheResourceExhausted` (mirrors `:313-323`)
   - `TestGetFundamentals_Finnhub_DisabledFailedPrecondition` — assert the error text now reads
     `"finnhub fundamentals source disabled"`, proving Step 5.6's generalization (mirrors `:326-339`)
   - `TestGetFundamentals_Finnhub_MissFetchesAndUpserts` (mirrors `:378-393`) — also assert
     `toProtoFundamentals`'s `Source` fallback is `"finnhub"` not `"fmp"` when the fake source
     returns an empty `Source`, proving Step 5.9
   - `TestGetFundamentals_Finnhub_QuotaWarningRefiresPerWindow` — the **new** behavior design.md
     called for: cross 80% of `symbols_per_minute` twice, with the fake clock/window bucket
     advanced between calls (or two calls within the same window asserting exactly one WARNING,
     then a third call in a *new* window bucket asserting a second WARNING) — proving the
     dedup key is now window-scoped, not day-scoped, for the per-minute provider (mirrors
     `:396-412` but proves the opposite of what that test proves for FMP: FMP's day-bucket still
     fires once and goes silent; Finnhub's minute-bucket must re-fire every new window)
   - `TestGetFundamentals_Finnhub_ThreeCallsPerSymbolCostsQuota` — verify `GetFundamentalsMulti`
     for N symbols against the fake Finnhub source advances the quota count by `3*N` semantically
     consistent with Step 3's `TestGetFundamentalsMulti_ThreeCallsPerSymbol` (this is a
     service-level sanity check, not a duplicate of Step 3's client-level HTTP-call-count test)

**Verification**:
```
cd services/xstockstrat-marketdata && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"
```
Confirm ≥ 40%. `internal/service` itself is CI-coverage-excluded (per the `COVERPKGS` grep), but
`go test ./...` still **runs** every test in it — `internal/finnhub`'s new coverage (Step 3) is
what carries the measured total, exactly like `internal/fmp` does for the existing FMP tests
today.
```
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod ./internal/service/...
```

---

### Step 7 — service: wire the provider selector into `main.go` + `FINNHUB_API_KEY`

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/cmd/server/main.go` — modify
- `services/xstockstrat-marketdata/internal/config/config.go` — modify
- `docker-compose.yml` — modify
- `.do/app.dev.yaml` — modify
- `.do/app.yaml` — modify

**Reviewers**: `xstockstrat-marketdata` (service owner) — same focus as Step 2; Security — API key
scoping correct, secret-env-var convention followed (no `secret.*` config-service row)

**Codebase Evidence** (every line read in full this session):
- `internal/config/config.go:19-32` (`Config` struct — add `FinnhubAPIKey string`), `:36-54`
  (`LoadFromEnv` — add `FinnhubAPIKey: getEnv("FINNHUB_API_KEY", "")`, mirroring the `FMPAPIKey`
  line `:50` and its comment about being a secret env var, never a config key).
- `cmd/server/main.go:103-105` (`fundamentalsSrc := newFundamentalsSource(cfgWatcher,
  cfg.FMPAPIKey)` call site), `:112` (`NewMarketDataService(reg, repo, cfgWatcher,
  cfg.LedgerEndpoint, cfg.NotifyEndpoint, fundamentalsSrc)` — confirmed only call site, per Step 5
  evidence), `:175-189` (`newFundamentalsSource` function body — currently unconditionally builds
  `fmp.NewClient`).
- `docker-compose.yml:250-252` (`FMP_API_KEY` block — `# Optional: only needed when
  marketdata.fmp.enabled is true (feature 059).` / `# Same secret mechanism as the Alpaca keys
  above — never stored in config.` / `FMP_API_KEY: ${FMP_API_KEY:-}`) — confirmed
  `FINNHUB_API_KEY` is absent from this file.
- `.do/app.dev.yaml:144-147` / `.do/app.yaml:144-147` (`- key: FMP_API_KEY` / `scope: RUN_TIME` /
  `value: YOUR_DEV_FMP_API_KEY` (or `YOUR_PROD_...`) / `type: SECRET`) — confirmed
  `FINNHUB_API_KEY` is absent from both files.
- `internal/finnhub/finnhub_client.go` (Step 2) and `internal/fmp/fmp_client.go` (unchanged) —
  both implement `source.FundamentalsSource`.

**TDD**: `red-green required`

**Instructions**:
1. Add `FinnhubAPIKey string` to `Config` (`config.go:19-32`) and `FinnhubAPIKey: getEnv("FINNHUB_API_KEY",
   "")` to `LoadFromEnv` (`:36-54`), with a comment mirroring `FMPAPIKey`'s (`:46-49`) — delivered
   as a DO App Platform `type: SECRET` env var, never through the config service.
2. Rewrite `newFundamentalsSource` (`main.go:175-189`) to read the provider selector and dispatch:
   ```go
   // newFundamentalsSource constructs the active fundamentals client (feature 129), selected by
   // marketdata.fundamentals.provider (read once at boot — see marketdata_service.go's
   // fundProvider doc comment for why this is startup-only, not a live per-call read). Always
   // constructed regardless of the provider's own .enabled flag — that flag is a live per-RPC
   // gate (fundamentalsEnabled(), internal/service/marketdata_service.go), not a boot-time gate
   // (feature 082 fix).
   func newFundamentalsSource(cfgWatcher *config.Watcher, provider, fmpAPIKey, finnhubAPIKey string) source.FundamentalsSource {
       switch provider {
       case "finnhub":
           baseURL := cfgWatcher.GetString("marketdata.finnhub.base_url", "https://api.finnhub.io/api/v1")
           slog.Info("Finnhub fundamentals client constructed", "base_url", baseURL)
           return finnhub.NewClient(finnhub.ClientConfig{BaseURL: baseURL, APIKey: finnhubAPIKey})
       default: // "fmp" and any unrecognized value fall back to the pre-existing FMP client
           baseURL := cfgWatcher.GetString("marketdata.fmp.base_url", "https://financialmodelingprep.com")
           metrics := strings.Split(cfgWatcher.GetString("marketdata.fmp.metrics", "core,extended"), ",")
           slog.Info("FMP fundamentals client constructed", "base_url", baseURL, "metrics", metrics)
           return fmp.NewClient(fmp.ClientConfig{BaseURL: baseURL, APIKey: fmpAPIKey, Metrics: metrics})
       }
   }
   ```
   Add `"github.com/xstockstrat/marketdata/internal/finnhub"` to the import block.
3. In `main()`, before the `fundamentalsSrc := ...` call (`:103-105`), read the selector once:
   `fundProvider := cfgWatcher.GetString("marketdata.fundamentals.provider", "finnhub")`. Pass it
   into both `newFundamentalsSource(cfgWatcher, fundProvider, cfg.FMPAPIKey, cfg.FinnhubAPIKey)`
   and the `service.NewMarketDataService(reg, repo, cfgWatcher, cfg.LedgerEndpoint,
   cfg.NotifyEndpoint, fundamentalsSrc, fundProvider)` call (`:112`, new trailing arg per Step 5.3).
4. Add to `docker-compose.yml`, immediately after the `FMP_API_KEY` line (`:252`):
   ```yaml
      # Optional: only needed when marketdata.finnhub.enabled is true (feature 129).
      # Same secret mechanism as the Alpaca/FMP keys above — never stored in config.
      FINNHUB_API_KEY: ${FINNHUB_API_KEY:-}
   ```
5. Add to `.do/app.dev.yaml`, immediately after the `FMP_API_KEY` block (`:144-147`):
   ```yaml
      - key: FINNHUB_API_KEY
        scope: RUN_TIME
        value: YOUR_DEV_FINNHUB_API_KEY
        type: SECRET
   ```
   Mirror in `.do/app.yaml` with `value: YOUR_PROD_FINNHUB_API_KEY`.
6. Update the `newFundamentalsSource` doc comment (`main.go:175-178`, already partly rewritten in
   sub-step 2) and the `fundamentalsSrc := ...` call-site comment (`:103-105`) to no longer say
   "FMP fundamentals source (feature 059) — always constructed" as the sole description; state
   both providers are selectable.

**Verification**:
```
cd services/xstockstrat-marketdata && GOWORK=off go build ./...
grep -n "FINNHUB_API_KEY" docker-compose.yml .do/app.dev.yaml .do/app.yaml
```
Confirm all three deployment files now reference `FINNHUB_API_KEY` alongside the existing
`FMP_API_KEY`, each with `type: SECRET` in the `.do/*.yaml` files.
```
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod ./cmd/... ./internal/config/...
```

---

### Step 8 — test: update `main_test.go`'s boot-canary for the new signature

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/cmd/server/main_test.go` — modify

**Reviewers**: `xstockstrat-marketdata` (service owner) — same focus as Step 2

**Codebase Evidence**:
- `main_test.go:33-46` (`TestNewFundamentalsSource_AlwaysNonNil` — the feature 082 boot-time
  regression canary: "the extracted constructor must return non-nil regardless of apiKey/config
  state"; uses a zero-value `&config.Watcher{}`, safe per the test's own comment citing
  `internal/config/config.go:100-153` — now renumbered by Step 7's edits, re-confirm the exact
  lines when this step executes).

**TDD**: `red-green required` — this file will not compile after Step 7 changes
`newFundamentalsSource`'s signature; that compile failure is this step's red state.

**Instructions**:
1. Update `TestNewFundamentalsSource_AlwaysNonNil` (`:38-46`) to call the new 4-arg signature
   (`cfgWatcher, provider, fmpAPIKey, finnhubAPIKey`), looping over **both** `provider` values
   (`"fmp"`, `"finnhub"`) crossed with the existing `apiKey` cases (`""`, a real-looking value),
   asserting non-nil in every combination — the regression this canary guards against
   (`newFundamentalsSource` returning `nil`) is exactly as reachable for the new `"finnhub"`
   branch as it was for the sole FMP branch before.
2. Also assert the *type* returned differs per provider (e.g. via a type assertion or an
   exported marker) if that's cheap — optional, the non-nil guarantee is the load-bearing
   assertion per the existing test's own docstring.

**Verification**:
```
cd services/xstockstrat-marketdata && GOWORK=off go test ./cmd/server/... -race -count=1 -v
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod ./cmd/server/...
```
`cmd/` is CI-coverage-excluded — behavioral pass is the verification, matching the note in
`reference/spec-template.md` for excluded-package steps.

---

### Step 9 — proto: text-only doc-comment edits (no wire shape change)

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/marketdata/v1/marketdata.proto` — modify
- `packages/proto/gen/go/marketdata/v1/` — modify (regenerated)
- `packages/proto/gen/python/marketdata/v1/` — modify (regenerated)
- `packages/proto/gen/ts/marketdata/v1/` — modify (regenerated)

**Reviewers**: Proto Reviewer — field number uniqueness (unaffected — no field added/removed),
`buf lint`/`buf breaking` pass; `xstockstrat-marketdata` (service owner) — same focus as Step 2

**Codebase Evidence**:
- `packages/proto/marketdata/v1/marketdata.proto:160,174,178` (read in full this session,
  `:150-197`): line 160 `// Fundamentals (feature 059) — cached fundamental metrics for a symbol,
  FMP-backed.`; line 174 `// FMP's open-ended metric set (keys are FMP field names)` (the
  `extra_metrics` field comment); line 178 `string source = 16;   // "fmp"`.
- recon.md confirms: "No field/message/RPC shape change is needed..., but these three comments
  need a text-only edit in the same PR that swaps the client, or they actively mislead the next
  reader" and "A comment-only `.proto` edit still goes through the normal `buf lint`/`buf breaking`
  + `./scripts/buf-gen.sh` steps... even though it changes no wire shape."

**TDD**: `N/A (proto comment-only edit — no code-bearing behavior change)`

**Instructions**:
1. Line 160: `// Fundamentals (feature 059) — cached fundamental metrics for a symbol, FMP-backed.`
   → `// Fundamentals (feature 059; provider made switchable by feature 129) — cached fundamental
   metrics for a symbol, sourced from the active marketdata.fundamentals.provider.`
2. Line 174: `// FMP's open-ended metric set (keys are FMP field names)` →
   `// The active provider's open-ended metric set (keys are provider-specific field names)`
3. Line 178: `string source = 16;   // "fmp"` → `string source = 16;   // e.g. "fmp" or "finnhub" — the provider that produced this row`
4. Run `./scripts/buf-gen.sh` to regenerate stubs — expect non-empty diffs limited to the
   3 doc-comment strings propagated into generated Go doc comments / Python docstrings / TS JSDoc
   (no field/message/RPC signature changes).

**Verification**:
```
cd packages/proto && buf lint
cd packages/proto && buf breaking --against ".git#branch=claude/fmp-free-layer-ratios-dr0c4j"
./scripts/buf-gen.sh
git diff --stat packages/proto/gen/
```
`buf lint`/`buf breaking` pass with zero findings (comment-only change is never breaking); the
`git diff` on `gen/` should touch only the 3 comment locations' generated representations, no
field numbers/types/RPC signatures.

---

### Step 10 — docs: `xstockstrat-marketdata` service docs

**Status**: `pending`
**Service**: `docs/`
**Files**:
- `services/xstockstrat-marketdata/CLAUDE.md` — modify
- `services/xstockstrat-marketdata/docs/context-constitution.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `services/xstockstrat-marketdata/CLAUDE.md:48-70` (Config Keys Consumed table — currently ends
  with the `marketdata.fmp.*` rows at `:66-70`), `:88-103` ("## FMP Fundamentals Integration
  (feature 059)" section, read in full this session).
- `services/xstockstrat-marketdata/docs/context-constitution.md:4` (top-of-file summary: "Alpaca
  feed + FMP fundamentals"), `:49` (`MARKETDATA-*` invariant row: "FMP gated live per-RPC by
  `marketdata.fmp.enabled`... held off the OHLCV `Registry` (FR-2)").

**TDD**: `N/A (docs)`

**Instructions**:
1. In `CLAUDE.md`'s Config Keys Consumed table (`:48-70`), append the 6 new rows from Step 1's
   migration (same Key/Type/Default/Description columns), immediately after the existing
   `marketdata.fmp.*` rows.
2. Rename `## FMP Fundamentals Integration (feature 059)` (`:88`) to `## Fundamentals Integration
   (feature 059; provider made switchable by feature 129)` and rewrite its body to describe: two
   `source.FundamentalsSource` implementations (`internal/fmp/`, `internal/finnhub/`), selected at
   boot by `marketdata.fundamentals.provider` (default `finnhub`), sharing the identical
   read-through-cache/quota-guard RPC layer — with the quota-guard's shape (daily cap vs. rolling
   window) now provider-dependent, per Step 5's `fundamentalsQuota` dispatch. Keep the "single
   chokepoint" invariant sentence (analysis/screener never call a provider directly) — unchanged
   by this feature.
3. In `docs/context-constitution.md`, update line 4's summary phrase ("Alpaca feed + FMP
   fundamentals") to "Alpaca feed + switchable fundamentals providers (FMP/Finnhub)", and update
   the `MARKETDATA-*` table row at `:49` to describe the provider-dispatched gate (`s.fundProvider`,
   `marketdata_service.go`'s `fundamentalsEnabled`) instead of naming only FMP.

**Verification**:
Read both files after editing: confirm no remaining unqualified "FMP" reference implies FMP is the
*only* fundamentals source (mentioning FMP by name as one of two providers is fine and expected).
```
grep -n "FMP" services/xstockstrat-marketdata/CLAUDE.md services/xstockstrat-marketdata/docs/context-constitution.md
```
Manually review each hit — every survivor must describe FMP as *a* provider option, never *the*
provider.

---

### Step 11 — docs: `config-governance.md` Per-Feature Registered Keys log

**Status**: `pending`
**Service**: `docs/`
**Files**:
- `docs/patterns/config-governance.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `docs/patterns/config-governance.md:48-50` ("Per-Feature Registered Keys" section header —
  "Append-only log... Newest first. Don't edit past entries; superseding a key's behavior gets a
  new entry, not a rewrite of the old one.") and the existing `### feature 059 — fundamentals data
  source (xstockstrat-marketdata)` entry at `:205-216` (kept verbatim, not edited, per the
  append-only rule).

**TDD**: `N/A (docs)`

**Instructions**:
1. Insert a new entry **above** the existing `### feature 102 — broker-state-reconciliation`
   entry (i.e. at the very top of the log, since it's "newest first" and this feature's number
   (129) is higher than every existing entry), following the exact table shape of the `feature
   059` entry (`:205-216`):

   ```markdown
   ### feature 129 — fundamentals-provider-alternative (`xstockstrat-marketdata`)

   Adds Finnhub as a second `source.FundamentalsSource`, switchable-not-replacing FMP via
   `marketdata.fundamentals.provider` (read once at boot). FMP's `marketdata.fmp.*` keys (feature
   059, above) are unchanged and still fully functional; Finnhub's quota shape is a rolling
   window (`symbols_per_minute` / `rate_window_seconds`) rather than FMP's fixed UTC-day cap,
   since Finnhub's real limit is per-minute, not per-day.

   | Key | Type | Default | Description |
   |---|---|---|---|
   | `marketdata.finnhub.enabled` | bool | `false` | Master gate for the Finnhub fundamentals source; off by default |
   | `marketdata.finnhub.base_url` | string | `https://api.finnhub.io/api/v1` | Finnhub API base URL |
   | `marketdata.finnhub.cache_ttl_hours` | int | `24` | Hours a cached fundamentals row stays fresh before a re-fetch is attempted |
   | `marketdata.finnhub.symbols_per_minute` | int | `20` | Max distinct symbols fetched per rolling `rate_window_seconds` window (derived from Finnhub's ~60 calls/min free tier ÷ 3 calls/symbol) |
   | `marketdata.finnhub.rate_window_seconds` | int | `60` | Rolling window (seconds) `symbols_per_minute` applies over |
   | `marketdata.fundamentals.provider` | string | `finnhub` | Selects the active fundamentals source (`finnhub` \| `fmp`); read once at boot, not live |
   ```

**Verification**:
Read the file after editing: confirm the new entry sits above `feature 102` (correct
newest-first ordering) and the `feature 059` entry below it is untouched byte-for-byte.

---

### Step 12 — test: AC-3 live smoke test (manual, not CI-automated)

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `docs/roadmap/features/129-fundamentals-provider-alternative/context.md` — modify (record the
  smoke-test transcript/result — the durable, load-bearing record per Constitution P-05)

**Reviewers**: `xstockstrat-marketdata` (service owner) — same focus as Step 2

**Codebase Evidence**:
- Product-spec Acceptance Criterion 3: "The new client returns all of: price, market cap, P/E,
  EPS, 52w high/low, P/B, dividend yield, ROE, debt-to-equity, beta, currency for a representative
  sample of symbols outside FMP's restricted-free-tier set, verified via a live smoke test against
  the provider's free tier."
- Design.md's two Open Risks this step is the designated closer for: dividend-yield field
  existence, and the numeric `symbols_per_minute` default's real-world accuracy.
- Precedent for a manual-recorded proof over a fragile live-network CI test:
  `docs/roadmap/ledger/insights.md` 2026-07-30 (`082-fix-fmp-config-boot-only`) — "compose the
  proof from narrower unit facts plus one written, inspectable argument" rather than force a
  network-dependent test into the automated suite.

**TDD**: `N/A (manual verification — no CI-run test asserts against a live external API by
platform convention; Steps 3 and 6's fake-backed tests are the durable, CI-safe regression
coverage for the mapping/dispatch logic this step is validating end-to-end, once)`

**Instructions**:
1. With `FINNHUB_API_KEY` set (a real free-tier key) and `marketdata.fundamentals.provider=finnhub`,
   `marketdata.finnhub.enabled=true` applied via `SetConfig` (per
   `docs/runbooks/config-rollout.md` Step 2) against a running `xstockstrat-marketdata` instance,
   call `GetFundamentalsMulti` (via `grpcurl` or the existing integration-test pattern) for a
   representative sample of symbols **outside** FMP's restricted-free-tier set (product-spec's
   whole motivation — pick symbols FMP's free tier could not serve `ratios-ttm`/`profile` for).
2. Confirm the response populates all of: `price, market_cap, pe_ratio, eps, year_high, year_low,
   pb_ratio, dividend_yield, roe, debt_to_equity, beta, currency` — **non-zero/non-empty** for
   each (a silently-zero field is indistinguishable from a missing one at the proto level; check
   the raw Finnhub JSON if any field reads exactly `0`/`""`).
3. If `dividend_yield` is genuinely never populated (design.md's Open Risk #1), this is a
   **feature-level finding**, not a step failure to quietly work around: record it in
   `context.md`, and per Constitution P-03, escalate to the user — the honest outcomes are either
   (a) re-open FR-1/FR-2 and reconsider FMP-only, or (b) accept Finnhub without dividend yield if
   the user judges that acceptable, with product-spec AC-3 explicitly updated to reflect the
   accepted gap. Do not silently mark AC-3 satisfied if this field never appears.
4. Record the exact symbols tested, the raw response (redacting nothing sensitive — no secrets
   appear in a `Fundamentals` message), and the outcome in `context.md` under a new session entry.
   This is the single load-bearing artifact that AC-3 was actually checked, not assumed.

**Verification**:
`context.md` contains a dated session entry recording: the symbols tested, confirmation that
every required field (including `dividend_yield`) was populated (or an explicit, escalated finding
if not), and confirmation that Steps 1-11's code/config were deployed and exercised for this test
(not tested against a stub).

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
