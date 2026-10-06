# Implementation Spec: fix-historical-fundamentals-price-join

**Status**: `done`
**Created**: 2026-09-27
**Feature**: `docs/roadmap/features/216-fix-historical-fundamentals-price-join/feature.md`
**Total Steps**: 4
**Feature Branch**: `feature/fix-historical-fundamentals-price-join`

---

## Execution Summary

The fix lives entirely in **xstockstrat-marketdata** on the write path (design.md § Chosen Approach);
no proto, migration, config, ingest, agent, or UI change is needed. The change has two layers, each a
`service` step with a paired `test` step:

- **Step 1 (repo + source type)** adds a stored-row reader (`GetHistoricalPriceState`) and a
  column-scoped writer (`UpdateHistoricalPriceJoin`) to `MarketDataRepo`, plus the
  `source.HistoricalPriceState` carrier struct. Both are the "dumb SQL" half of the Go-merge design.
- **Step 3 (service loop)** restructures `backfillOneSymbol`'s per-period loop into
  read-classify-derive-merge keyed on the **stored** row, splits `priceJoin` into `accumulateTTM`
  (always) + `derivePriceMetrics` (when deriving), wires the `overwrite` request flag through, and
  adds the dividend coverage guard and currency-mismatch fail-closed. This is where the clobber-vs-fill
  merge logic (unit-testable Go) lives.

Steps 2 and 4 are the paired tests. Both marketdata packages touched (`repository`, `service`) are in
the Go coverage-excluded set (`repository/`, `service/`) — the CI coverage threshold does not measure
them, so the `test` steps run the full unit suite (`go test ./...`) to prove the new tests pass and
run the coverage command only to confirm the total floor still holds (spec-template § Coverage
thresholds). Every `@AC-*` scenario is covered by the Step 4 service tests.

### Scenario Coverage (Constitution C-15)

| Scenario | Covered by |
|---|---|
| `@AC-1` re-run with `overwrite=true` after bars re-derives price-join | Step 4 |
| `@AC-2` genuinely-missing bar fails closed, later run recovers | Step 4 |
| `@AC-3` plain re-backfill fills only missing columns, never touches populated / as-reported | Step 4 |
| `@AC-4` `overwrite=true` refreshes populated price-join, as-reported unchanged, stable re-run no write | Step 4 |
| `@AC-5` `overwrite=true` never nulls a pre-existing `dividend_yield` whose T12M window predates lookback | Step 4 |

### Consumer Surface (Constitution C-14)

The product spec and design mark the consumer surfaces as **existing, no change**: the re-derived
backend data flows unchanged to the `xstockstrat-agent` `query_fundamentals` tool and the
`xstockstrat-ui /insights/data-explorer` page — both render backend-authoritative data
(`missing_metrics` is backend-authoritative per recon.md § agent), so previously-"—"/missing cells
populate after recovery with no agent or UI code change (design.md § Consumer surface). No consumer
step is required; this is a decision, not an omission.

## Step Dependencies

- **Step 3 requires Step 1**: the service loop calls `s.histRepo.GetHistoricalPriceState` /
  `UpdateHistoricalPriceJoin` and references `source.HistoricalPriceState`, all created in Step 1;
  the `NewMarketDataService` `histRepo: repo` assignment (`marketdata_service.go:162`) will not
  compile until `*MarketDataRepo` implements the two new interface methods Step 3 adds to
  `histFundamentalsRepo`.
- **Step 2 covers Step 1** (repo/source unit tests) — C-08 pairing.
- **Step 4 covers Step 3** (service behavior, all `@AC-*`) — C-08 pairing.
- Recommended execution order: 1 → 2 → 3 → 4.

### Open risks carried from design.md (document during execute; no extra code)

- **Adjusted-close drift under `overwrite`** — `marketdata.alpaca.adjustment=all` means the adjusted
  close for a past date drifts after later splits/dividends, so an `overwrite=true` re-run after a
  corporate action legitimately rewrites `price/market_cap/pe_ratio/pb_ratio` (a correct write, not
  churn). `@AC-4`'s "subsequent overwrite re-run persists no further write" holds only when the
  adjusted OHLCV + EDGAR facts are byte-stable — Step 4's stable-re-run assertion uses a fixed
  `CloseAt`. Record as an operator-visible note in the Deviation Log; no code change.
- **EDGAR `fiscal_period` relabel between insert and re-run** → `GetHistoricalPriceState` returns
  `Found=false` → the new-row DO-NOTHING lane no-ops the stale nil row for that period. Label-agnostic
  matching is out of scope; note in the Deviation Log.
- **Pre-211 non-USD rows** whose stored `currency` is wrongly "USD" won't recover native `pe/pb` until
  their as-reported currency is corrected — now fail-closed (nil), never fabricated. Covered by the
  currency-mismatch test in Step 4.

---

### Step 1 — service: repo stored-row reader + column-scoped writer + `HistoricalPriceState` type

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/source/source.go` — modify (add `HistoricalPriceState` struct)
- `services/xstockstrat-marketdata/internal/repository/marketdata_repo.go` — modify (add `GetHistoricalPriceState`, `UpdateHistoricalPriceJoin`)

**Reviewers**: `xstockstrat-marketdata` (service owner) — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- `source.HistoricalFundamentalsPeriod` struct — `internal/source/source.go:75-98`; metric fields are
  `*float64` (nil = not supplied, never a real 0.0, `:72-74`); `Currency string` at `:96`. The new
  `HistoricalPriceState` mirrors the 5 price-join `*float64` fields + `Currency` + a `Found bool`.
- Confirmed non-existent today: `grep -rn "HistoricalPriceState" services/xstockstrat-marketdata` → no
  match (new symbol, per design.md § New symbols/signatures).
- Insert-only write to preserve for new rows: `InsertHistoricalFundamentals` —
  `internal/repository/marketdata_repo.go:596`; `ON CONFLICT (symbol, fiscal_period, period_type) DO
  NOTHING` at `:610` (deliberate, feature-198 `@AC-1`/`@AC-2` idempotency, doc `:593-595`); executes
  via `r.db.Exec` at `:612`.
- Reuse the column-scoped upsert shape from `InsertBars` — `marketdata_repo.go:63`
  (`ON CONFLICT (symbol,timeframe,time) DO UPDATE SET ...`), but the new writer is a plain triple-PK
  `UPDATE` (not an upsert) since the row is known to exist (design.md § Go-merge + dumb SQL).
- Triple PK is `(symbol, fiscal_period, period_type)` — `005_fundamentals_history.up.sql:28`; the 5
  price columns (`market_cap`, `pe_ratio`, `pb_ratio`, `dividend_yield`, `price`) already exist
  (`005_fundamentals_history.up.sql:16-24`) → no migration.
- Precedent for the read shape: `histFundamentalsColumns` SELECT const — `marketdata_repo.go:591`;
  `QueryHistoricalFundamentals` builds `SELECT ... FROM marketdata.fundamentals_history WHERE symbol=$1`
  at `:629`. `CloseAt` returns `nil, nil` on `pgx.ErrNoRows` (fail-closed pattern) — `:755-767`.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. In `internal/source/source.go`, after the `HistoricalFundamentalsPeriod` struct (ends `:98`), add:
   ```go
   // HistoricalPriceState is the stored price-join state of one fundamentals_history row, read by the
   // backfill recovery path (feature 216). Found=false when no row exists for the triple PK. FiledDate
   // is the stored earliest filing date; recovery derives against it (never the re-fetch's filed_date)
   // so the point-in-time price never looks ahead (feature-198 @AC-4). The five price columns are
   // *float64 (nil = column is NULL / never derived); Currency is the stored as-reported currency used
   // to gate native pe/pb recovery (fail closed on a mismatch).
   type HistoricalPriceState struct {
       Found         bool
       FiledDate     time.Time
       Price         *float64
       MarketCap     *float64
       PERatio       *float64
       PBRatio       *float64
       DividendYield *float64
       Currency      string
   }
   ```
2. In `internal/repository/marketdata_repo.go`, add `GetHistoricalPriceState(ctx, symbol, fiscalPeriod,
   periodType string) (*source.HistoricalPriceState, error)` near the other historical methods (after
   `InsertHistoricalFundamentals`, i.e. after `:620`). It runs one indexed triple-PK read:
   `SELECT filed_date, price, market_cap, pe_ratio, pb_ratio, dividend_yield, currency FROM
   marketdata.fundamentals_history WHERE symbol=$1 AND fiscal_period=$2 AND period_type=$3`. Scan
   `filed_date` into `FiledDate` (a `time.Time`), the five price columns into `*float64` targets, and
   currency into a `string`. On `pgx.ErrNoRows` return `&source.HistoricalPriceState{Found: false}, nil`
   (mirror `CloseAt`'s `:761-763` no-rows handling); otherwise return `Found: true` with the scanned
   values. Use `r.db` (matching `InsertHistoricalFundamentals` at `:612`), not `r.pool`.
3. Add `UpdateHistoricalPriceJoin(ctx, symbol, fiscalPeriod, periodType string, price, marketCap,
   peRatio, pbRatio, dividendYield *float64) error` — a trivial fixed-SET-list, triple-PK-WHERE update:
   `UPDATE marketdata.fundamentals_history SET price=$4, market_cap=$5, pe_ratio=$6, pb_ratio=$7,
   dividend_yield=$8 WHERE symbol=$1 AND fiscal_period=$2 AND period_type=$3`. Execute via `r.db.Exec`.
   The fixed 5-column SET + triple-PK WHERE is the structural guarantee that as-reported fields
   (currency, eps, roe, debt_to_equity, beta, year_high/low, extra_metrics) and the earliest
   `filed_date` are never touched (design.md § Business Rules Touched — the C-16 CHANGE is scoped to
   these 5 derived columns only).
4. Do **not** touch `InsertHistoricalFundamentals` or its `ON CONFLICT DO NOTHING` at `:610` — new rows
   keep insert-only semantics (feature-198 `@AC-1` no-duplicate).

**Verification**:
- Compiles: `cd services/xstockstrat-marketdata && GOWORK=off go build ./...`
- Behavioral proof is in Step 2 (paired test). Lint runs in Step 2.

---

### Step 2 — test: pgxmock pins for the two new repo methods

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/repository/marketdata_repo_test.go` — modify

**Reviewers**: `xstockstrat-marketdata` (service owner) — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- Existing pgxmock harness: `marketdata_repo_test.go:116` (`pgxmock.NewPool()`); the `ExpectExec`
  SQL-text pin at `:129` (`` `\$14::jsonb` ``) belongs to `TestUpsertFundamentals_CastsExtraMetricsToJSONB`
  (which pins `UpsertFundamentals`, `$14::jsonb`) — the exemplar `ExpectExec` pattern to mirror;
  `WillReturnRows` row pin at `:159` for a `close` read. These are SQL-text + arg + control-flow pins
  (pgxmock does not run Postgres — `:110-116` note), which is the established bar for repo tests here.
  (`InsertHistoricalFundamentals` itself has no existing test in this file and uses `$20::jsonb`, so it
  is not the pattern source — the new methods below are the first `fundamentals_history` write/read tests.)
- The two new methods use `r.db` — the pgxmock pool is wired to `r.db` in the existing tests (same
  wiring the `UpsertFundamentals` test uses at `:116-142`).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add `TestGetHistoricalPriceState` — build a pgxmock pool, `ExpectQuery` matching the triple-PK SELECT
   (pin the `WHERE symbol = \$1 AND fiscal_period = \$2 AND period_type = \$3` predicate and the five
   price columns + `currency` in the projection), `WillReturnRows` with one row → assert `Found==true`
   and the scanned `*float64`/currency values. Add a second sub-case: `WillReturnError(pgx.ErrNoRows)`
   → assert `Found==false` and `err==nil` (fail-closed no-rows).
2. Add `TestUpdateHistoricalPriceJoin` — `ExpectExec` pinning the `UPDATE marketdata.fundamentals_history
   SET price=\$4, market_cap=\$5, pe_ratio=\$6, pb_ratio=\$7, dividend_yield=\$8 WHERE symbol=\$1 AND
   fiscal_period=\$2 AND period_type=\$3` text (assert the SET list is exactly the 5 price columns — no
   as-reported column and no `filed_date` appears), `WillReturnResult(pgxmock.NewResult("UPDATE", 1))`;
   assert no error and `mock.ExpectationsWereMet()`. This is the string-pin that retires the
   fails.md:722/757 "SQL merge only asserted as a string, never traced against the real write path"
   trap — the SET list is the exact statement, and the merge decision itself is tested in Step 4 Go.
3. **C-13 (Go test data):** the mock rows/args are scenario one-offs (pgxmock literals), single consumer
   — inline is compliant; no `internal/testdata/` home is created.
4. **RED first:** both tests reference `GetHistoricalPriceState`/`UpdateHistoricalPriceJoin`; run them
   against the pre-Step-1 tree to confirm a compile/undefined failure, then GREEN after Step 1.

**Verification**:
- Unit tests pass: `cd services/xstockstrat-marketdata && GOWORK=off go test ./internal/repository/... -run 'TestGetHistoricalPriceState|TestUpdateHistoricalPriceJoin' -race -count=1`
- Lint: `cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod`
- Coverage floor still holds (new logic is in the excluded `repository/` package — no coverage
  threshold applies to it; run the total-floor check): `cd services/xstockstrat-marketdata && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"` — confirm ≥ 40%.

---

### Step 3 — service: restructure `backfillOneSymbol` recovery loop + split `priceJoin` + wire `overwrite`

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/marketdata_service.go` — modify

**Reviewers**: `xstockstrat-marketdata` (service owner) — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- `histFundamentalsRepo` interface — `marketdata_service.go:112-119` (`InsertHistoricalFundamentals`
  `:113`, `CloseAt` `:116`, `UpsertDividends` `:117`, `SumDividendsInWindow` `:118`). The two Step-1
  methods must be added here so the service can call them and the fakes must implement them.
- `BackfillFundamentals` — `marketdata_service.go:1719`; **never reads `overwrite`** today
  (`:1719-1758`); per-symbol loop calls `backfillOneSymbol(ctx, sym, from, to, periodTypes,
  enrichEnabled)` at `:1750`. The proto flag exists: `BackfillFundamentalsRequest.overwrite = 4`
  (`packages/proto/marketdata/v1/marketdata.proto:296`) → read via `req.GetOverwrite()`.
- `backfillOneSymbol` — `marketdata_service.go:1762`; dividend fetch block `:1772-1789` with
  `lookbackYears` `:1774` and `divFetchStart = time.Now().AddDate(-lookbackYears,0,0)` `:1778`;
  per-period loop `:1792-1817` (`priceJoin` `:1794`, T12M yield `:1798-1805`, enrichment `:1806-1812`,
  `InsertHistoricalFundamentals` `:1813`).
- `priceJoin` — `marketdata_service.go:1824`; TTM accumulation `:1825-1843`; `CloseAt` `:1844`;
  fail-closed nil on no bar `:1849-1851`; price `:1853`; market_cap `:1854-1857`; pe (gated
  `p.Currency=="USD"`) `:1861-1864`; pb (USD-equity `:1869-1871`, native gated `p.Currency=="USD"`
  `:1872-1877`).
- `SumDividendsInWindow(ctx, symbol, asOf, windowStart)` — called at `:1799` as
  `SumDividendsInWindow(ctx, symbol, p.FiledDate, p.FiledDate.AddDate(-1,0,0))` (asOf=filed,
  windowStart=filed−365d). Its middle bool return is "has any dividend row" (COUNT, no date filter,
  `marketdata_repo.go:548-560`) — **not** a coverage signal; keep discarding it.
- `fundamentalsConfig` interface — `marketdata_service.go:95-100` (`GetBool`/`GetInt`/`GetString`);
  reuse `s.fundCfg` reads for the dividends lookback (`:1774`). No new config key (F-07).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **Interface:** add to `histFundamentalsRepo` (`:112-119`):
   `GetHistoricalPriceState(ctx context.Context, symbol, fiscalPeriod, periodType string)
   (*source.HistoricalPriceState, error)` and `UpdateHistoricalPriceJoin(ctx context.Context, symbol,
   fiscalPeriod, periodType string, price, marketCap, peRatio, pbRatio, dividendYield *float64) error`.
2. **Split `priceJoin`** (`:1824`) into:
   - `accumulateTTM(p *source.HistoricalFundamentalsPeriod, quarterlyEPS *[]float64) *float64` — the
     rolling 4-quarter TTM-EPS window from `:1825-1843`, returning `ttmEPS`. Must run **always**
     (before any branch) so the window stays aligned even for skipped/existing periods.
   - `derivePriceMetrics(ctx, p, ttmEPS *float64, storedCurrency string)` — the CloseAt→price→market_cap
     →pe→pb body from `:1844-1878`, but the native pe/pb currency gates (`:1861`, `:1872`) key on
     `storedCurrency` when deriving for an existing row (see step 5 currency-mismatch), and on
     `p.Currency` for a new row. Keep the fail-closed nil-on-no-bar (`:1849-1851`) unchanged.
   - Retain `priceJoin` as a thin wrapper (`accumulateTTM` then `derivePriceMetrics(..., p.Currency)`)
     so `TestPriceJoin_*` (`marketdata_service_test.go:1751`, `:1774`, `:1789`) still compile and pass.
3. **Wire `overwrite`:** read `req.GetOverwrite()` in `BackfillFundamentals` (`:1749-1757` loop) and pass
   it as a new `overwrite bool` param to `backfillOneSymbol` (update the signature at `:1762` and the
   call at `:1750`).
4. **Restructure the per-period loop** (`:1792-1817`) to read-classify-derive-merge keyed on the
   **stored** row (design.md § Chosen Approach 1–4):
   - a. `ttmEPS := s.accumulateTTM(p, &quarterlyEPS)` — always, first.
   - b. `state, err := s.histRepo.GetHistoricalPriceState(ctx, sym, p.FiscalPeriod, p.PeriodType)`
     (WARN-log + `continue` on error, matching the per-symbol fail-closed style).
   - c. **New row (`!state.Found`)** — forward path: `s.derivePriceMetrics(ctx, p, ttmEPS, p.Currency)`,
     then the dividend-yield derivation (step 6), then optional enrichment (`:1806-1812` unchanged),
     then `InsertHistoricalFundamentals` (`:1813`, DO NOTHING preserved); `written++`.
   - d. **Existing row (`state.Found`)** — recover keyed on the **stored earliest `filed_date`**. Set
     `p.FiledDate = state.FiledDate` **before** any derivation (design.md § Chosen Approach 4), so
     `derivePriceMetrics`' `CloseAt` lookup and `deriveDividendYield`'s T12M window both key on the
     stored earliest filing, never the re-fetch's `filed_date`. This is the load-bearing property that
     keeps look-ahead impossible and preserves feature-198 `@AC-4` even if EDGAR later relabels/amends
     the filing — the drift-fragile "key on the incoming `filed_date`" path was explicitly rejected in
     design.md § Rejected Alternatives. `state.FiledDate` is populated by Step 1's SELECT (the struct
     now carries `FiledDate time.Time`). Then:
     - Gate: default (`overwrite=false`) processes only `needsFill` rows — any of the 5 stored price
       columns is nil; `overwrite=true` processes every existing row.
     - `s.derivePriceMetrics(ctx, p, ttmEPS, state.Currency)` + dividend-yield derivation (step 6).
     - Apply the **unified per-column merge** over all 5 columns (`price`, `market_cap`, `pe_ratio`,
       `pb_ratio`, `dividend_yield`), identical rule per column (`??` = coalesce, left if non-nil else
       right):
       - default: `merged = existing ?? derived` (fill only nil columns; a populated column is never
         touched).
       - `overwrite=true`: `merged = derived ?? existing` (take a non-nil freshly-derived value; keep
         existing when derivation yields nil).
       Every cell is monotonic: nil→value or value→value′, **never value→nil**.
     - Call `s.histRepo.UpdateHistoricalPriceJoin(...)` **only when ≥1 merged column differs from the
       stored value** (write-only-if-changed → idempotent stable re-run, `@AC-4`). Count it in
       `written` only when a write occurs.
5. **Currency-mismatch fail-closed** (Round-5 hardening): in `derivePriceMetrics`, when deriving for an
   **existing** row, derive native `pe_ratio`/`pb_ratio` (the `p.Currency=="USD"` gates at `:1861`,
   `:1872`) **only when `storedCurrency == p.Currency`** — otherwise leave nil. The USD-equity pb path
   (`stockholders_equity_usd`, `:1869-1871`) is currency-agnostic and stays unchanged. This stops a
   pre-211 non-USD row (stored currency wrongly "USD") from producing a fabricated USD-price ÷
   fresh-native-equity ratio (feature-211 `@AC-1`/`@AC-9`).
6. **Dividend fail-closed coverage guard** (on derivation, both new-row and existing-row paths): compute
   the T12M window `windowStart = p.FiledDate.AddDate(-1,0,0)` and the dividend fetch start
   `divFetchStart = time.Now().AddDate(-lookbackYears,0,0)` (already computed at `:1778`; thread it into
   the loop). When `windowStart.Before(divFetchStart)`, the window predates the fetched dividend range →
   leave the derived `dividend_yield` **nil** (never a fabricated 0 and, combined with the monotonic
   merge, never wiping a stored value — `@AC-5`). Keep the existing `dividendsFetched && p.Price != nil
   && *p.Price > 0` guard (`:1798`) and continue discarding `SumDividendsInWindow`'s middle bool.
7. **Header propagation (§B):** this step adds **no new outbound gRPC call** — only repo DB reads/writes
   (`GetHistoricalPriceState`/`UpdateHistoricalPriceJoin`) — so the header-propagation trigger is not
   met; nothing to forward.

**Verification**:
- Compiles: `cd services/xstockstrat-marketdata && GOWORK=off go build ./...`
- Behavioral proof + lint in Step 4 (paired test).

---

### Step 4 — test: recovery / fill-if-null / overwrite / dividend-coverage / currency-mismatch

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/marketdata_service_test.go` — modify

**Reviewers**: `xstockstrat-marketdata` (service owner) — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- `fakeHistRepo211` — `marketdata_service_test.go:1717-1740`: value-based fake with `closeVal` and
  `queriedFor`; `CloseAt` is date-keyed (`:1728-1731`), `InsertHistoricalFundamentals` is a no-op
  (`:1722-1724`), `SumDividendsInWindow` returns `0,false,nil` (`:1735-1737`). Extend it to be
  **stateful**: back it with a map of `(fiscalPeriod,periodType) → stored HistoricalPriceState` so
  `GetHistoricalPriceState` returns the seeded row and `UpdateHistoricalPriceJoin` mutates it and
  records write count/values. Add the two new methods so it satisfies the extended interface.
- `fakeDividendSrc` — `:1742-1749` (feed stub); `dividendYieldSvc` helper — `:1812` (builds a service
  with `fakeHistRepo` + dividend cfg). Reuse these shapes for the dividend-coverage case.
- Existing `TestPriceJoin_*` — `:1751`, `:1774`, `:1789` — must still pass (regression guard that the
  `priceJoin` wrapper is behavior-preserving).
- `f64p` / `hfDate` / `fakeCfg` helpers already exist (used at `:1752`, `:1815`, `:1819`).

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2, AC-3, AC-4, AC-5`

**Instructions**:
Write each test to fail against the pre-Step-3 tree (RED — the recovery/merge behavior does not exist
yet) and pass after (GREEN). Extend the stateful `fakeHistRepo211` first.

1. **`@AC-1` recovery under `overwrite=true`** — seed an existing row with all 5 price columns nil
   (`Found=true`, currency "USD"); set the fake `CloseAt` to return a real close (bar now present);
   run `BackfillFundamentals` with `Overwrite: true` for the symbol. Assert `UpdateHistoricalPriceJoin`
   was called and the stored row now has `price`/`market_cap`/`pe_ratio`/`pb_ratio` (and
   `dividend_yield` when the window is covered) non-nil. **Covers AC-1.**
2. **`@AC-2` fail-closed then recover** — first run with `CloseAt`→nil (no bar): assert the derived
   metrics stay nil and no value→value is fabricated; then flip `CloseAt` to a real close and re-run:
   assert the metrics are now derived and persisted. **Covers AC-2.**
3. **`@AC-3` default fill-if-null, populated untouched** — seed two existing rows on the same symbol:
   row A with all price columns nil, row B with all price columns populated (distinct known values);
   `CloseAt` returns a real close; run `BackfillFundamentals` **without** overwrite. Assert row A's
   columns are now derived+persisted, row B's price-join columns are **unchanged** (no
   `UpdateHistoricalPriceJoin` write, or a write with byte-identical values), and neither row's
   as-reported fields / `filed_date` are touched (structural — the fake's update only mutates the 5
   price columns). **Covers AC-3.**
4. **`@AC-4` overwrite refresh + stable-re-run idempotency** — seed an existing row with
   price/market_cap/pe/pb populated from an "earlier" close; set `CloseAt` to a **different** close;
   run with `Overwrite: true`: assert the 4 columns are recomputed from the new close and persisted,
   and `currency`/`eps`/`roe`/`debt_to_equity`/`filed_date` are unchanged (the fake update cannot touch
   them). Then run `Overwrite: true` **again** against the same `CloseAt`: assert **no further write**
   (write-only-if-changed). **Covers AC-4.**
5. **`@AC-5` overwrite never nulls a covered-then-uncovered dividend_yield** — seed an existing row with
   a non-null `dividend_yield`; configure the dividend lookback so `divFetchStart` is **after** the
   row's T12M `windowStart` (window predates the fetch → coverage guard yields nil); run with
   `Overwrite: true`: assert the stored `dividend_yield` **retains its value** (monotonic merge:
   derived-nil keeps existing) and no price-join column transitions value→null. **Covers AC-5.**
6. **Currency-mismatch fail-closed (open-risk test f)** — seed an existing row whose stored currency is
   "USD" but the fresh fetched `p.Currency` is non-USD (e.g. "CNY"); `CloseAt` returns a close; run
   overwrite. Assert native `pe_ratio`/`pb_ratio` are left nil (no fabricated cross-currency ratio),
   while the USD-equity pb path still derives if `stockholders_equity_usd` is present. (Supports
   design.md Open Risk 3; not an `@AC-*` but a required regression guard.)
7. **C-13 (Go test data):** the seeded periods/rows are scenario one-offs, single consumer — inline in
   the test file is compliant; no `internal/testdata/` home is created (recon.md § Risks — inline fakes
   compliant for a single consumer).

**Verification**:
- New + existing service tests pass: `cd services/xstockstrat-marketdata && GOWORK=off go test ./internal/service/... -race -count=1` (includes the existing `TestPriceJoin_*` regression guards).
- Lint: `cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod`
- Coverage floor: new logic is in the excluded `service/` package — no coverage threshold applies to
  it; confirm the total floor still holds: `cd services/xstockstrat-marketdata && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"` — confirm ≥ 40%.
- Product-spec dev smoke (real Postgres, per acceptance criteria): reproduce the defect steps
  (`docs/reports/2026-09-27-fundamentals-backfill-not-rederived-defect.md` (pruned 2026-10-05; `git show 2ce8de0a:docs/reports/2026-09-27-fundamentals-backfill-not-rederived-defect.md`) reproduction) on dev —
  backfill fundamentals with no bars, store bars, re-backfill `overwrite=true`, confirm
  `query_fundamentals(mode=historical)` no longer reports the 5 metrics missing.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
