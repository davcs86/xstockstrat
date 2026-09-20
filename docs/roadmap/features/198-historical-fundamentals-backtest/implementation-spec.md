# Implementation Spec: historical-fundamentals-backtest

**Status**: `pending`
**Created**: 2026-09-20
**Feature**: `docs/roadmap/features/198-historical-fundamentals-backtest/feature.md`
**Total Steps**: 17
**Feature Branch**: `feature/historical-fundamentals-backtest`

---

## Execution Summary

Proto-first, then a fully separate fundamentals point-in-time (PIT) lane beside the existing
snapshot path at every layer (design.md Chosen Approach). Slice order: (1) additive proto across
ingest/analysis/marketdata → (2) `buf-gen` → (3) marketdata migration `005` + service (EDGAR client,
PIT price-join, FMP-ratio enrichment, `GetHistoricalFundamentals` as-of read, `BackfillFundamentals`
worker) + tests + config → (4) ingest migration `012` + `TriggerBackfill` data-kind branch + tests →
(5) analysis fundamental operand (as-of carry-forward, live parity, T-1 no-look-ahead) + tests +
config → (6) agent consumer surface (`trigger_backfill`/`_build_component`/`run_backtest` +
projection parity + strat-lab skill, same PR) + tests → (7) UI consumer surface (backfills data-kind
selector + `ComponentEditor` fundamental operand) + e2e → (8) docs. Marketdata precedes ingest
(ingest calls the new `BackfillFundamentals` worker); analysis precedes agent/UI (both surface the
new operand). Both consumer surfaces named in `product-spec.md` § Consumer Surface(s) (UI `/insights`
+ Agent `trigger_backfill`/`run_backtest`) earn steps (13/14 Agent, 15/16 UI) — neither is deferred.

### Scenario Coverage (Constitution C-15)

| Scenario | Covered by step(s) |
|---|---|
| `@AC-1` EDGAR PIT persistence + idempotency | 5 (marketdata), 9 (ingest re-backfill) |
| `@AC-2` quarterly + annual time series | 5 (marketdata), 9 (ingest both-periods) |
| `@AC-3` as-of read hides filing until T+1 | 5 (marketdata read), 11 (analysis operand) |
| `@AC-4` backtest fundamental operand, no look-ahead, PIT pe_ratio | 11 (analysis) |
| `@AC-5` FMP enrichment degrades at daily cap | 5 (marketdata) |
| `@AC-6` fundamentals distinct data-kind, BARS default | 9 (ingest) |
| `@AC-7` operator triggers fundamentals backfill from `/insights` | 16 (UI e2e) |
| `@AC-8` agent `run_backtest` fundamental operand + descriptor parity | 14 (agent), 16 (UI operand) |

## Step Dependencies

- Step 2 (`proto-gen`) requires Step 1 (`proto`): stubs regenerate from the edited `.proto`.
- Steps 3–16 require Step 2: all reference generated messages/enums (`data_kind`,
  `COMPONENT_KIND_FUNDAMENTAL`, `HistoricalFundamentalsPeriod`, `GetHistoricalFundamentals`,
  `BackfillFundamentals`).
- Step 4 (marketdata service) requires Step 3 (marketdata migration `005`): the repo writes/reads
  `marketdata.fundamentals_history`.
- Step 5 [test] covers Step 4 [service] (red-green).
- Step 8 (ingest service) requires Step 4: `TriggerBackfill` routes fundamentals chunks to the new
  marketdata `BackfillFundamentals` worker RPC.
- Step 8 requires Step 7 (ingest migration `012`): persists the `data_kind` column.
- Step 9 [test] covers Step 8 [service] (red-green).
- Step 10 (analysis service) requires Step 4: the operand branch calls marketdata
  `GetHistoricalFundamentals`.
- Step 11 [test] covers Step 10 [service] (red-green); includes the mandatory T-1 look-ahead RED test.
- Step 13 (agent) requires Steps 8 + 10: exposes the fundamentals data-kind + fundamental operand.
- Step 14 [test] covers Step 13 [service].
- Step 15 (UI) requires Steps 8 + 10 (data-kind + operand reachable end-to-end).
- Step 16 [test] covers Step 15 [service].
- Step 17 (`docs`) last — teardown/context-constitution refresh runs after behavior lands.

---

### Step 1 — proto: additive fundamentals contracts across ingest, analysis, marketdata

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/ingest/v1/ingest.proto` — modify
- `packages/proto/analysis/v1/analysis.proto` — modify
- `packages/proto/marketdata/v1/marketdata.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness per message, no breaking change without deprecation, `buf lint`/`buf breaking` pass; xstockstrat-ingest owner — idempotent ingestion / schema stability; xstockstrat-analysis owner — backtest reproducibility, no look-ahead bias; xstockstrat-marketdata owner — OHLCV/fundamentals ingestion integrity

**Codebase Evidence**:
- `ingest.proto`: `TriggerBackfillRequest` max field = 6 (`fill_mode = 6`, `ingest.proto:69`) → next free `7`. Enum pattern with `_UNSPECIFIED = 0` confirmed (`BackfillStatus`, `ingest.proto:45-53`; `FillMode`, `:56-60`).
- `analysis.proto`: `enum ComponentKind` has `{UNSPECIFIED=0, BUILTIN_INDICATOR=1, CUSTOM_FORMULA=2}` (`analysis.proto:301-305`) → next free `3`. `message StrategyComponent` max field = 6 (`source_symbol = 6`, `analysis.proto:316`) → next free `7`. `RunBacktestRequest` max = 9 (`fill_model = 9`, `analysis.proto:75`); `BacktestResult` max = 20 — neither is changed (design.md §5: `@AC-8` reads the existing shape).
- `marketdata.proto`: snapshot `message Fundamentals` max field = 18 (`missing_metrics = 18`, `marketdata.proto:220`) — untouched; the historical message is distinct/repeated. Service RPC block `marketdata.proto:14-54` has no `GetHistoricalFundamentals` / `BackfillFundamentals` — greenfield.

**TDD**: `N/A (proto — contract only; behavior verified in the service/test steps that consume the stubs)`

**Covers**: —

**Instructions**:
1. `ingest.proto`: add enum `BackfillDataKind { BACKFILL_DATA_KIND_UNSPECIFIED = 0; BACKFILL_DATA_KIND_BARS = 1; BACKFILL_DATA_KIND_FUNDAMENTALS = 2; }` (C-04 sentinel). Add `BackfillDataKind data_kind = 7;` to `TriggerBackfillRequest` (after `fill_mode = 6`) and add the same `data_kind` field to `BackfillJob` at its next free number (`BackfillJob` max = 14, `ingest.proto:42` → `data_kind = 15`) so status reads expose the kind. Comment: `UNSPECIFIED == BARS` (back-compat; the servicer maps it — @AC-6 is a servicer rule, not enum numbering).
2. `analysis.proto`: add `COMPONENT_KIND_FUNDAMENTAL = 3;` to `enum ComponentKind` (`:301`); add `string fundamental_metric = 7;` to `StrategyComponent` (after `source_symbol = 6`) with a comment: used when `kind == COMPONENT_KIND_FUNDAMENTAL`; a PIT metric name from the `_FUNDAMENTAL_FIELDS ∪ extra_metrics` vocabulary. Do **not** add any `RunBacktestRequest`/`BacktestResult` field.
3. `marketdata.proto`: add `message HistoricalFundamentalsPeriod` — `string symbol = 1; string fiscal_period = 2; string period_type = 3; ` (quarterly|annual) `; google.protobuf.Timestamp period_end = 4; google.protobuf.Timestamp filed_date = 5; google.protobuf.Timestamp accepted_date = 6;` then the reused numeric metric fields (`market_cap`, `pe_ratio`, `pb_ratio`, `dividend_yield`, `eps`, `beta`, `roe`, `debt_to_equity`, `price`, `year_high`, `year_low`) mirroring `Fundamentals` field names, `map<string, double> extra_metrics`, `string currency`, `string source`, and `repeated string missing_metrics`. Add `GetHistoricalFundamentalsRequest { string symbol = 1; google.protobuf.Timestamp as_of_date = 2; google.protobuf.Timestamp range_start = 3; google.protobuf.Timestamp range_end = 4; repeated string period_types = 5; }` and `GetHistoricalFundamentalsResponse { repeated HistoricalFundamentalsPeriod periods = 1; }`. Add the worker RPC pair `BackfillFundamentalsRequest { repeated string symbols = 1; xstockstrat.common.v1.TimeRange range = 2; repeated string period_types = 3; bool overwrite = 4; }` and `BackfillFundamentalsResponse { int64 periods_written = 1; repeated string failed_symbols = 2; }`. Register both new RPCs in `service MarketDataService`: `rpc GetHistoricalFundamentals(...)` and `rpc BackfillFundamentals(...)`.
4. Pre-assign `analysis.proto` numbers as above so a concurrent feature 032 (`RunSegmentedBacktest`, not yet in code — recon.md:70) cannot collide (design.md Open Risk 032 seam); no `merge-order.md` row required now (product-spec.md § Proto: no FAIL-level collision).

**Verification**:
```bash
cd packages/proto && buf lint && buf breaking --against ".git#branch=main-dev,subdir=packages/proto"
```
Both pass (additive only). If `main-dev` is unavailable in-tree, use the feature-branch form
`--against ".git#branch=feature/historical-fundamentals-backtest,subdir=packages/proto"` per
Constitution **C-09**.

---

### Step 2 — proto-gen: regenerate Go/Python/TS stubs

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/**` — modify (generated; never hand-edited)

**Reviewers**: Proto Reviewer — field number uniqueness per message, `buf breaking` clean (inherited from Step 1)

**Codebase Evidence**:
- Codegen entry point `scripts/buf-gen.sh` (root `CLAUDE.md` § Generating Proto Stubs; `packages/proto/CLAUDE.md`: "Never Read/Grep the generated stubs under `gen/`").

**TDD**: `N/A (proto-gen — mechanical codegen)`

**Covers**: —

**Instructions**:
1. Run `./scripts/buf-gen.sh` (generates Go/Python/TS stubs and compiles the TS package).
2. Stage the full regenerated `packages/proto/gen/` tree; do not hand-edit any generated file.

**Verification**:
```bash
./scripts/buf-gen.sh && git status --porcelain packages/proto/gen/ | head
```
Then confirm the new symbols exist in source-level checks the consuming steps rely on (do not Grep
`gen/`): the CI `proto-freshness` job re-runs `buf-gen` and requires an empty
`git diff packages/proto/gen/` — a second run of `./scripts/buf-gen.sh` must leave the tree clean.

---

### Step 3 — migration: marketdata `005` fundamentals_history plain table

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/migrations/005_fundamentals_history.up.sql` — create
- `services/xstockstrat-marketdata/migrations/005_fundamentals_history.down.sql` — create

**Reviewers**: DBA — migration NNN numbering (no gaps), up+down pair present, index correctness, run-order compliance; xstockstrat-marketdata owner — TimescaleDB hypertable partitioning (here: deliberate plain-table decision)

**Codebase Evidence**:
- Migration tip = `004` (`ls services/xstockstrat-marketdata/migrations/` → `000`–`004`, last `004_widen_ohlcv_chunk_interval`) → next free `005` (confirmed; product-spec.md D-1, design.md §1).
- Snapshot store precedent = **plain table** PK `symbol` (`migrations/002_fundamentals.up.sql:7`, recon.md:21) — the design's plain-table choice mirrors it.
- Reused metric vocabulary = `_FUNDAMENTAL_FIELDS` (`services/xstockstrat-analysis/app/services/screener.py:40`) — the nullable-numeric columns match these names.

**TDD**: `N/A (migration — verified offline by inspection; applied in CI/deploy)`

**Covers**: — (behavior covered by Step 5)

**Instructions**:
1. `.up.sql`: `CREATE TABLE IF NOT EXISTS marketdata.fundamentals_history (symbol text NOT NULL, fiscal_period text NOT NULL, period_type text NOT NULL, period_end date NOT NULL, filed_date date NOT NULL, accepted_date timestamptz, source text NOT NULL, currency text, market_cap double precision, pe_ratio double precision, pb_ratio double precision, dividend_yield double precision, eps double precision, beta double precision, roe double precision, debt_to_equity double precision, price double precision, year_high double precision, year_low double precision, extra_metrics jsonb NOT NULL DEFAULT '{}'::jsonb, PRIMARY KEY (symbol, fiscal_period, period_type));` This is a **plain PostgreSQL table** — do **not** call `create_hypertable` (design.md §1 / Rejected Alternatives: ~200k slow-growing rows, read filters `period_end` not the time axis, avoids the ledger-153 chunk-lock-OOM surface).
2. Add btree index: `CREATE INDEX IF NOT EXISTS idx_fundamentals_history_symbol_period ON marketdata.fundamentals_history (symbol, period_end, filed_date);`
3. `.down.sql`: `DROP INDEX IF EXISTS marketdata.idx_fundamentals_history_symbol_period;` then `DROP TABLE IF EXISTS marketdata.fundamentals_history;`
4. Idempotency is enforced at write time by the repo (`ON CONFLICT (symbol, fiscal_period, period_type) DO NOTHING`, Step 4) — the triple PK is the `@AC-1` guarantee; do not add `filed_date` to the PK/unique key (design.md §1).

**Verification**:
```bash
ls services/xstockstrat-marketdata/migrations/005_fundamentals_history.up.sql \
   services/xstockstrat-marketdata/migrations/005_fundamentals_history.down.sql
# read both: confirm every CREATE in .up (table + index) has an inverse DROP in .down. No DB spin-up.
```

---

### Step 4 — service: marketdata EDGAR client, PIT store/read, FMP-ratio enrichment, backfill worker

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/source/source.go` — modify (add `HistoricalFundamentalsSource` interface + `HistoricalFundamentalsPeriod` model, beside `FundamentalsSource`)
- `services/xstockstrat-marketdata/internal/edgar/edgar_client.go` — create (XBRL `companyfacts` client)
- `services/xstockstrat-marketdata/internal/repository/marketdata_repo.go` — modify (insert/query `fundamentals_history`; PIT close read from `marketdata.ohlcv`)
- `services/xstockstrat-marketdata/internal/service/marketdata_service.go` — modify (`GetHistoricalFundamentals` as-of read RPC + `BackfillFundamentals` worker RPC + dedicated FMP ratio-enrichment cap counter)
- `services/xstockstrat-marketdata/cmd/server/main.go` — modify (construct the EDGAR client + wire the historical source; **not** via `newFundamentalsSource`)

**Reviewers**: xstockstrat-marketdata owner — OHLCV ingestion integrity, hypertable/plain-table decisions, fundamentals feed idempotency

**Codebase Evidence**:
- Snapshot `FundamentalsSource interface` (snapshot-only) `internal/source/source.go:65`; model `source.Fundamentals` `:44` (recon.md:24, :106) — the new interface is added **beside** it.
- Provider selector is boot-only via `newFundamentalsSource` (`cmd/server/main.go:185`, read at `:123` `marketdata.fundamentals.provider` default `finnhub`, constructed `:124`). The EDGAR historical source is held as its own service field and **never** added to this selector (design.md §2; recon.md:29 T-3; PRESERVE `@AC-6/@AC-9 @feature-154`).
- FMP daily cap = `marketdata.fmp.daily_request_cap` (default 250), read today at `marketdata_service.go:1373` via `s.fundCfg.GetInt(...)`. The snapshot quota `fundamentalsQuota()` (`marketdata_service.go:1364`) is provider-dispatched and counts the snapshot table — enrichment uses a **dedicated** counter against the same cap value (design.md §2 / Rejected Alternatives; product-spec.md FR-3).
- Config read helpers `internal/config/config.go`: `GetString` `:138`; `ResolveSecret`→`GetSecret` with `x-internal-caller` `:103/:109/:111` (FMP key resolved at boot `main.go:79-80`, recon.md:37-38). EDGAR `User-Agent` uses **non-secret** `GetString` (design.md §2; PRESERVE `@AC-1..5 @feature-147`).
- OHLCV bars are stored in `marketdata.ohlcv` with upsert on `(symbol,timeframe,time)` (`repository/marketdata_repo.go:48`, recon.md:33) — the PIT price-join reads the adjusted close at `filed_date` from here.

**TDD**: `red-green required`

**Covers**: — (assertions in Step 5)

**Instructions**:
1. In `source.go`, add `type HistoricalFundamentalsPeriod struct { ... }` (fields matching the proto message: `Symbol`, `FiscalPeriod`, `PeriodType`, `PeriodEnd`, `FiledDate`, `AcceptedDate`, `*float64` metric fields reusing the `source.Fundamentals` vocabulary, `ExtraMetrics map[string]float64`, `Currency`, `Source`) and `type HistoricalFundamentalsSource interface { FetchHistorical(ctx, symbol string, from, to time.Time, periodTypes []string) ([]HistoricalFundamentalsPeriod, error) }`. Do not modify the snapshot `FundamentalsSource`.
2. `edgar/edgar_client.go`: implement `HistoricalFundamentalsSource` against SEC EDGAR XBRL `companyfacts` (`{base_url}/api/xbrl/companyfacts/CIK{cik}.json`). Resolve ticker→CIK via SEC `company_tickers.json`. Send the configured non-secret `User-Agent` (SEC fair-use) and honor `marketdata.edgar.rate_limit_rps`. Map XBRL tags onto the `_FUNDAMENTAL_FIELDS` vocab where they land, overflow → `extra_metrics` (D-2 mapping depth is pinned here per design.md Open Risk). Keyless HTTP (F-06). Fail-closed per symbol (a fetch error skips the symbol; it does not crash the worker).
3. `marketdata_repo.go`: add `InsertHistoricalFundamentals` using `INSERT INTO marketdata.fundamentals_history (...) VALUES (...) ON CONFLICT (symbol, fiscal_period, period_type) DO NOTHING` (keep earliest `filed_date` — `@AC-1`). Add `QueryHistoricalFundamentals(symbol, asOf, rangeStart, rangeEnd, periodTypes)` filtering `filed_date < asOf` (T+1) and `period_end` within range, ordered by `period_end`. Add `CloseAt(symbol, date)` returning the adjusted close from `marketdata.ohlcv` at/nearest-before `date` for the PIT price-join (null when no bar — fail-closed, design.md Open Risk price-join coverage).
4. `marketdata_service.go`: implement `GetHistoricalFundamentals` (delegates to `QueryHistoricalFundamentals`, marshals to `repeated HistoricalFundamentalsPeriod`) and `BackfillFundamentals` worker (per symbol: fetch EDGAR periods; compute `market_cap = Close(filed_date) × shares_outstanding` and `pe_ratio = Close(filed_date) / eps_ttm` PIT — never FMP `ratios-ttm`, design.md §2; optionally run the FMP ratio-enrichment pass guarded by a **dedicated** request counter against `marketdata.fmp.daily_request_cap` — cap exhausted → skip enrichment, persist the EDGAR-only row with null ratio fields and `source="edgar"`, `@AC-5`; then `InsertHistoricalFundamentals`). Gate the whole path on `marketdata.fundamentals.history.enabled` and enrichment on `marketdata.fundamentals.history.ratio_enrichment.enabled`.
5. `main.go`: construct the EDGAR client (base_url + User-Agent + rps from config) and assign it to a new marketdata-service field. Do **not** route it through `newFundamentalsSource` and do **not** add an EDGAR case to the `marketdata.fundamentals.provider` switch (T-3; PRESERVE `@AC-6/@AC-9 @feature-154`).

**Verification**: covered by Step 5 (build + tests + lint).

---

### Step 5 — test: marketdata PIT persistence, as-of read, FMP-cap degrade

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/edgar/edgar_client_test.go` — create
- `services/xstockstrat-marketdata/internal/service/marketdata_service_test.go` — modify

**Reviewers**: xstockstrat-marketdata owner — fundamentals feed idempotency, PIT correctness

**Codebase Evidence**:
- Existing marketdata service tests drive config via a fake watcher (`marketdata_service_test.go:300` sets `marketdata.fmp.daily_request_cap` in an `ints` map) — reuse this fake-config harness; no deployed instance (T-5, ledger-129: narrow direct/fake-backed unit tests, not `grpcurl`).
- Go coverage-excluded packages: `cmd/`, `handler/`, `repository/`, `telemetry/`, `service/` (spec-template coverage table). The new business logic in `internal/edgar/` and `internal/source/` **is** measured; the `service`/`repository` glue is excluded — put the coverage-bearing assertions in `edgar_client_test.go`.

**TDD**: `red-green required` — author to fail against the pre-implementation tree (asserts the new EDGAR mapping, as-of filter, and cap-degrade behavior).

**Covers**: AC-1, AC-2, AC-3, AC-5

**Instructions**:
1. `edgar_client_test.go` (measured package): with a fake HTTP transport returning a canned `companyfacts` payload, assert AAPL Q1-2020 maps to a period with `period_end 2019-12-28`, `filed_date 2020-01-29`, `period_type "quarterly"`, `source "edgar"` (`@AC-1`); assert 8 quarterly + 3 annual periods are returned for a range with `period_types "both"` and no earlier period is dropped by a later fetch (`@AC-2`).
2. `marketdata_service_test.go`: with the fake config + a stubbed repo, assert `GetHistoricalFundamentals` for AAPL as-of `2020-01-15` and as-of `2020-01-29` does **not** return the Q4-2019 period, and as-of `2020-01-30` **does** return it with `filed_date 2020-01-29` (`@AC-3`, T+1 = `filed_date < as_of`). Assert `BackfillFundamentals` with the dedicated FMP counter at cap still persists EDGAR statement rows with null FMP-only ratio fields and `source "edgar"`, not a failure (`@AC-5`).
3. Reuse the fake-config `ints` map pattern (`:300`); one inline canned payload has a single consumer → inline is C-13-compliant (record that verdict; do not create `internal/testdata/` speculatively).

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod
cd services/xstockstrat-marketdata && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"
```
Confirm total ≥ 40%. If the only new measured logic lands in `internal/edgar/`+`internal/source/`,
those carry the threshold; the `service`/`repository` glue is CI-excluded — note this in the run.

---

### Step 6 — config: marketdata fundamentals-history keys (defaults + registry)

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/CLAUDE.md` — modify (defaults table)
- `docs/patterns/config-governance.md` — modify (Per-Feature Registered Keys log)

**Reviewers**: xstockstrat-marketdata owner — config-key wiring; xstockstrat-config owner — config key naming (`<service>.<category>.<key>`), scoping, WatchConfig stream stability

**Codebase Evidence**:
- Existing marketdata defaults table lists FMP keys, e.g. `marketdata.fmp.daily_request_cap | int | 250` (`services/xstockstrat-marketdata/CLAUDE.md:77`) — new keys append here.
- Reused cap already documented at `docs/patterns/config-governance.md:618` (`marketdata.fmp.daily_request_cap`, 250) — enrichment reuses it, **no second cap** (product-spec.md RESOLVED; design.md §2).
- No new env var is introduced (all knobs are config keys read via `WatchConfig`, F-07) — the deployment-file audit is N/A for this feature.

**TDD**: `N/A (config — key naming/defaults doc; read-with-default enforced in Step 4)`

**Covers**: —

**Instructions**:
1. Append to the marketdata `CLAUDE.md` defaults table (all read via `GetString`/`GetInt`/`GetBool` with these defaults; each key's code read is in Step 4): `marketdata.fundamentals.history.enabled` (bool, `false`); `marketdata.edgar.base_url` (string, `https://data.sec.gov`); `marketdata.edgar.user_agent` (string, operator-set fair-use UA — **non-secret**, ordinary config, no `GetSecret`); `marketdata.edgar.rate_limit_rps` (int, `10`); `marketdata.fundamentals.history.backfill.batch_size` (int, `50`); `marketdata.fundamentals.history.backfill.max_lookback_years` (int, `10`); `marketdata.fundamentals.history.backfill.period_types` (string, `both`); `marketdata.fundamentals.history.ratio_enrichment.enabled` (bool, `false`).
2. Add a Per-Feature Registered Keys log row in `config-governance.md` for feature 198 listing these keys, and a note that ratio enrichment reuses the existing `marketdata.fmp.daily_request_cap` (no new cap) and the feature-147 `marketdata.fmp.api_key` secret (no new credential row).

**Verification**:
```bash
grep -n "marketdata.fundamentals.history\|marketdata.edgar" services/xstockstrat-marketdata/CLAUDE.md docs/patterns/config-governance.md
```
Confirm every key from Step 4's `GetString/GetInt/GetBool` calls appears with a declared default,
and the naming is `<service>.<category>.<key>` (C-05).

---

### Step 7 — migration: ingest `012` data_kind column

**Status**: `pending`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/migrations/012_backfill_data_kind.up.sql` — create
- `services/xstockstrat-ingest/migrations/012_backfill_data_kind.down.sql` — create

**Reviewers**: DBA — migration NNN numbering, up+down pair, run-order compliance; xstockstrat-ingest owner — backfill schema stability

**Codebase Evidence**:
- Migration tip = `011` (`ls services/xstockstrat-ingest/migrations/` → last `011_signal_source_type_mcp_client`) → next free `012` (confirmed; product-spec.md RESOLVED, corrected from the stale `006` guess).
- `ingest.backfill_jobs` (migration `003`), `backfill_chunks` (`004`) have **no `data_kind` column** (recon.md:47-49).

**TDD**: `N/A (migration — verified offline by inspection)`

**Covers**: — (behavior covered by Step 9)

**Instructions**:
1. `.up.sql`: `ALTER TABLE ingest.backfill_jobs ADD COLUMN IF NOT EXISTS data_kind text NOT NULL DEFAULT 'BARS';` and the same on `ingest.backfill_chunks` (so a chunk carries its kind for the worker dispatch). Default `'BARS'` preserves every existing OHLCV job (`@AC-6`).
2. `.down.sql`: `ALTER TABLE ingest.backfill_chunks DROP COLUMN IF EXISTS data_kind;` and `ALTER TABLE ingest.backfill_jobs DROP COLUMN IF EXISTS data_kind;`

**Verification**:
```bash
ls services/xstockstrat-ingest/migrations/012_backfill_data_kind.up.sql \
   services/xstockstrat-ingest/migrations/012_backfill_data_kind.down.sql
# read both: each ADD COLUMN in .up has an inverse DROP COLUMN in .down. No DB spin-up.
```

---

### Step 8 — service: ingest TriggerBackfill data-kind branch → BackfillFundamentals

**Status**: `pending`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/app/handlers/servicer.py` — modify
- `services/xstockstrat-ingest/app/repositories/backfill_jobs.py` — modify (`_UPDATABLE_COLUMNS`, insert path)

**Reviewers**: xstockstrat-ingest owner — idempotent ingestion, backfill schema stability

**Codebase Evidence**:
- `TriggerBackfill` at `servicer.py:220`; the `1d`-only reject is `if canonical_tf != "1d": await context.abort(INVALID_ARGUMENT, ...)` at `servicer.py:236-240` — the fundamentals branch goes **before** this reject (recon.md:44, design.md §4).
- Timeframe is canonicalized before persist (`canonical_tf = _canonical_timeframe(request)`, `servicer.py:233`) — the ledger-080 raw-persist trap is already fixed; fundamentals ride the new `data_kind` axis, never a timeframe value (T-2).
- Outbound worker call pattern: `self._marketdata` stub built at `servicer.py:185`; `BackfillBars` invoked with propagated metadata at `servicer.py:546`; `_propagation_meta(context)` helper at `servicer.py:213` (C-03 header trio). The new `BackfillFundamentals` call reuses `_propagation_meta`.
- Write allow-list `_UPDATABLE_COLUMNS = frozenset(...)` at `backfill_jobs.py:13`; `insert_job` at `:28` (masked updates rejected outside the allow-list, `:60`).

**TDD**: `red-green required`

**Covers**: — (assertions in Step 9)

**Instructions**:
1. In `TriggerBackfill` (`servicer.py:220`), read `request.data_kind`; treat `BACKFILL_DATA_KIND_UNSPECIFIED` as `BARS` (back-compat). **Before** the `canonical_tf != "1d"` reject (`:236`), branch: when `data_kind == FUNDAMENTALS`, skip the timeframe reject entirely (fundamentals have no bar timeframe — `@AC-6`), persist the job with `data_kind='FUNDAMENTALS'`, and plan chunks over symbol × period-range.
2. Persist `data_kind` on the job/chunk rows: add `data_kind` to `_UPDATABLE_COLUMNS` (`backfill_jobs.py:13`) and the `insert_job` column list (`:28`); default `'BARS'` when unset.
3. In the chunk runner (`_run_chunks`/`_execute_backfill`, `servicer.py:516`/`:369`), dispatch a `FUNDAMENTALS` chunk to `self._marketdata.BackfillFundamentals(marketdata_pb2.BackfillFundamentalsRequest(symbols=..., range=..., period_types=..., overwrite=...), metadata=self._propagation_meta(context))` instead of `BackfillBars`; a `BARS`/unset job keeps calling `BackfillBars` byte-for-byte (`servicer.py:546`).
4. Preserve `GetBackfillStatus`/`ListBackfillJobs` observability: surface `data_kind` on the `BackfillJob` proto (field added in Step 1).

**Verification**: covered by Step 9.

---

### Step 9 — test: ingest fundamentals data-kind, BARS default, idempotent re-backfill

**Status**: `pending`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/tests/test_ingest_servicer.py` — modify
- `services/xstockstrat-ingest/tests/_helpers.py` — modify (`job_row` gains `data_kind`, 15→16 cols)

**Reviewers**: xstockstrat-ingest owner — idempotent ingestion, backfill correctness

**Codebase Evidence**:
- Shared fixture `job_row` at `tests/_helpers.py:53` mirrors the DDL columns exactly (feature-080 guard, recon.md:52) — it grows to include `data_kind` when the migration adds the column.
- Servicer tests inject a fake marketdata stub (recon.md; `test_ingest_servicer.py` drives `make_servicer`) — assert dispatch target without a live marketdata.

**TDD**: `red-green required` — author to fail pre-implementation (asserts the fundamentals branch + BARS default).

**Covers**: AC-6, AC-1, AC-2

**Instructions**:
1. Assert `TriggerBackfill` with `data_kind=FUNDAMENTALS` is accepted with **no** `timeframe`/`timeframe_enum` supplied (no INVALID_ARGUMENT) and routes chunks to the fake stub's `BackfillFundamentals`, not `BackfillBars` (`@AC-6`).
2. Assert an existing OHLCV request that omits `data_kind` still defaults to `BARS` and calls `BackfillBars` unchanged (`@AC-6` back-compat).
3. Assert a fundamentals request with `period_types "both"` plans chunks covering both period types (`@AC-2` at the orchestration layer) and that re-running the same range does not double-write (the fake `BackfillFundamentals` is idempotent via the marketdata `ON CONFLICT` — assert the job re-runs without error; `@AC-1` job-level idempotency).
4. Update `job_row` (`_helpers.py:53`) to include `data_kind` (16 cols) so `job_row_to_proto` stays column-exact (feature-080 guard). This is the shared fixture's canonical home (C-13) — the second consumer already exists.

**Verification**:
```bash
cd services/xstockstrat-ingest && ruff check . && ruff format --check .
cd services/xstockstrat-ingest && pytest --cov=app --cov-fail-under=40
```

---

### Step 10 — service: analysis fundamental operand (as-of carry-forward, live parity, no look-ahead)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/services/evaluator.py` — modify (`_compute_component`, `_assemble_component_series`)
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify (preload wiring for backtest + live/readiness/opportunities paths; write-time validation + fingerprint fold)

**Reviewers**: xstockstrat-analysis owner — backtest reproducibility, strategy scoring determinism, **no look-ahead bias**

**Codebase Evidence**:
- Single operand-dispatch seam `_compute_component` at `evaluator.py:276`, dispatching `COMPONENT_KIND_BUILTIN_INDICATOR` (`:287`) / `COMPONENT_KIND_CUSTOM_FORMULA` (`:297`) — the new `COMPONENT_KIND_FUNDAMENTAL` branch slots here (recon.md:58).
- Series-assembly / date-join seam `_assemble_component_series` at `evaluator.py:368` (benchmark date-join region `:396-428`, `idx_by_date[_bar_date(b)]` at `:410`) — the as-of carry-forward join is added beside the `source_symbol` path, not modifying it (design.md §5; EXTEND `@AC-2/3/6/7 @feature-152`).
- As-of clock `_bar_date(bar)` at `evaluator.py:34` (uses `bar.time`, ledger-064 guard) — this is where T-1 (no look-ahead) is enforced: resolve only rows with `filed_date < bar_date` (T+1, user decision 3).
- Outbound marketdata stub `self._marketdata` at `servicer.py:398`; header-trio propagation filter pattern `if k in ("x-user-id","x-access-scope","x-trace-id")` at `servicer.py:604`/`:639` (C-03) — the new `GetHistoricalFundamentals` call reuses it.
- Backtest series computed once before the sim loop at `servicer.py:1550` (`evaluate_with_series`); per-symbol evaluated path `_backtest_symbol_evaluated` at `:1512` (recon.md:55-56).
- Metric-name vocab `_FUNDAMENTAL_FIELDS` (`screener.py:40`) + `extra_metrics` union; existing validator `_validate_fundamental_metrics` at `screener.py:377` (ledger-117) — the operand metric name is validated against this allow-list, restricted to PIT-sourceable metrics.

**TDD**: `red-green required`

**Covers**: — (assertions in Step 11)

**Instructions**:
1. `_compute_component` (`evaluator.py:276`): add an `elif comp.kind == analysis_pb2.COMPONENT_KIND_FUNDAMENTAL:` branch that resolves the component from a preloaded PIT fundamentals series keyed by `filed_date`, not from `closes`.
2. `_assemble_component_series` (`:368`): add a distinct **as-of carry-forward** join (NOT the feature-152 none-on-miss benchmark join): for each `eval_date = _bar_date(bar)`, select the latest PIT row with `filed_date < bar_date` (T+1) and carry it forward until the next filing; before the first filing → `None`/hold (`@AC-3`). Never forward-fill a future value (T-1 invariant).
3. `servicer.py`: preload the per-symbol PIT fundamentals via a new `GetHistoricalFundamentals` call on `self._marketdata` (metadata = the C-03 trio filter at `:604`), with bounded per-symbol fan-out (reuse the existing semaphore/batch pattern that `_load_benchmark_bars` uses). Thread the preload through **every** consumer — backtest servicer (`:1550`), the live loop, `EvaluateReadiness`, `ListOpportunities`, `GetIndicatorSeries` — for backtest/live parity (user decision 2; PRESERVE `@AC-7 @feature-152`).
4. Validate the operand's `fundamental_metric` at write time against `_FUNDAMENTAL_FIELDS ∪ extra_metrics` (reuse `_validate_fundamental_metrics`, `screener.py:377`), restricted to PIT-sourceable metrics; fold it into the `definition_json` fingerprint at write (PRESERVE `@AC-6 @feature-152`). An unset operand never enters the new branch → baseline byte-identical (PRESERVE `@AC-1 @feature-152`).
5. Gate on `analysis.backtest.fundamentals.enabled` (Step 12).

**Verification**: covered by Step 11.

---

### Step 11 — test: analysis operand resolution + T-1 look-ahead RED test

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_evaluator.py` — modify (or create if absent; confirm at execute via `find services/xstockstrat-analysis/tests`)
- `services/xstockstrat-analysis/tests/conftest.py` — modify only if a second consumer of a domain literal appears (C-13)

**Reviewers**: xstockstrat-analysis owner — no look-ahead bias, determinism

**Codebase Evidence**:
- `_bar_date` at `evaluator.py:34`; no-look-ahead contract stated at `evaluator.py:105`/`:390` (recon.md:61-62) — the RED test probes the exact T+1 boundary here.
- analysis `tests/conftest.py` is a proto-path shim only (no backtest fixtures; one inline consumer OK per C-13, recon.md:71) — an inline PIT-series literal with a single consumer stays inline.

**TDD**: `red-green required` — the T-1 test **must fail** against the pre-implementation tree.

**Covers**: AC-4, AC-3

**Instructions**:
1. **T-1 look-ahead RED test (mandatory, design.md Open Risk 3 / recon.md:173):** a strategy with entry `pe_ratio < 15` and an AAPL PIT period `pe_ratio 12` filed `2020-01-29`. Assert no entry uses that `pe_ratio` on any bar dated **on or before** `2020-01-29` (probe the boundary: bar `2020-01-29` is invisible), and entries on bars `2020-01-30`+ may use `pe_ratio 12` (`@AC-4`). Add a between-filings gap case (a later bar still carries forward the last filing, not a future one) and a pre-first-filing hold case (`@AC-3`).
2. Assert the `pe_ratio` is computed PIT from the adjusted close at `filed_date` (drive the fake marketdata to return the PIT-joined value), not a current snapshot (`@AC-4`).
3. Assert an unset fundamental operand leaves a baseline run byte-for-byte unchanged (regression guard for `@AC-1 @feature-152`).

**Verification**:
```bash
cd services/xstockstrat-analysis && ruff check . && ruff format --check .
cd services/xstockstrat-analysis && pytest --cov=app --cov-fail-under=40
```

---

### Step 12 — config: analysis backtest-fundamentals key

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/CLAUDE.md` — modify (defaults table)
- `docs/patterns/config-governance.md` — modify (append to the feature-198 registered-keys row)

**Reviewers**: xstockstrat-analysis owner — config wiring; xstockstrat-config owner — config key naming, WatchConfig stream stability

**Codebase Evidence**:
- Config keys are declared per service in its `CLAUDE.md` and read via `WatchConfig` (root `CLAUDE.md` § Config Governance; F-07). The analysis gate is read in Step 10.

**TDD**: `N/A (config — key naming/default doc)`

**Covers**: —

**Instructions**:
1. Add `analysis.backtest.fundamentals.enabled` (bool, default `false`) to the analysis `CLAUDE.md` defaults table.
2. Add it to the feature-198 Per-Feature Registered Keys row in `config-governance.md`.

**Verification**:
```bash
grep -n "analysis.backtest.fundamentals.enabled" services/xstockstrat-analysis/CLAUDE.md docs/patterns/config-governance.md
```

---

### Step 13 — service: agent trigger_backfill data-kind + fundamental operand + strat-lab skill

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/client.py` — modify (`trigger_backfill`, `_build_component`)
- `services/xstockstrat-agent/app/tools.py` — modify (`trigger_backfill`, `run_backtest` docstrings/args)
- `plugins/strat-lab/skills/backtest/SKILL.md` — modify (same PR)
- `plugins/strat-lab/skills/backtest/reference/backfill.md` — modify (same PR)
- `docs/runbooks/mcp-tools.md` — modify (parameter tables)

**Reviewers**: xstockstrat-agent owner — MCP tool contract stability (name/parameters/return shape) and `mcp-tools.md` parity; tool-count statements kept in sync (unchanged here — tools extended, not added)

**Codebase Evidence**:
- `trigger_backfill` client at `client.py:1606` (builds `TriggerBackfillRequest`, sends `timeframe`+`timeframe_enum`); tool wrapper at `tools.py:1078`. Add a `data_kind: str = "bars"` arg → map to the proto enum; for `"fundamentals"` do not require a timeframe.
- `_build_component` at `client.py:639` maps `{"builtin","formula"}` → `ComponentKind`, raises `ValueError` on unknown (`:650`), builds `StrategyComponent` (`:651`). Add `"fundamental": COMPONENT_KIND_FUNDAMENTAL` to the `kind_map` (`:645`) and set `fundamental_metric=c.get("fundamental_metric","")`. `_build_component` is shared by `manage_strategy` (`client.py:864`) and `screen_symbols` (`:705`) — the fundamental kind flows through both (feature-090 sharing).
- `get_strategy` projects via `MessageToDict(..., always_print_fields_with_no_presence=True)` (`client.py:915-921`) — the new non-presence `StrategyComponent` fields project automatically; the descriptor-parity test guards drift (Step 14).
- `run_backtest` tool at `tools.py:534`, client at `client.py:556`; the fundamental operand rides the stored/inline strategy definition (no new `run_backtest` arg — the operand is a component kind, `@AC-8`).
- strat-lab same-PR skill (root `CLAUDE.md` § strat-lab; ledger-134): `plugins/strat-lab/skills/backtest/SKILL.md` + `reference/backfill.md`. Six tool-inventory surfaces (recon.md:80-82) — extending existing tools keeps the tool **count** unchanged; only parameter docs (docstrings + `mcp-tools.md`) change.

**TDD**: `red-green required`

**Covers**: — (assertions in Step 14)

**Instructions**:
1. `client.py` `trigger_backfill` (`:1606`): add `data_kind: str = "bars"`; map `"bars"→BACKFILL_DATA_KIND_BARS`, `"fundamentals"→BACKFILL_DATA_KIND_FUNDAMENTALS`; raise `ValueError` on unknown (mirror the existing `fill_mode` guard). For `"fundamentals"`, skip the `_TF_ALIASES` timeframe requirement and set `req.data_kind`.
2. `client.py` `_build_component` (`:639`): add `"fundamental"` to `kind_map` and pass `fundamental_metric`. Update the `ValueError` message and the docstring's `expected builtin/formula` list.
3. `tools.py`: extend the `trigger_backfill` (`:1078`) and `run_backtest` (`:534`) docstrings/args to document `data_kind` and the `fundamental` component kind + `fundamental_metric` (the component-dict shape doc at `tools.py:685`).
4. Update `plugins/strat-lab/skills/backtest/SKILL.md` + `reference/backfill.md` in **this** PR to encode the fundamentals data-kind and the fundamental operand (root `CLAUDE.md`, ledger-134).
5. Update `docs/runbooks/mcp-tools.md` parameter tables for both tools. Tool count is unchanged — do not touch the count statements.

**Verification**: covered by Step 14.

---

### Step 14 — test: agent tool contract + descriptor-parity projection

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_backtest_view.py` — modify (descriptor-parity family)
- `services/xstockstrat-agent/tests/test_tools_endpoint.py` — modify (if the `GET /api/tools` catalog shape changes)

**Reviewers**: xstockstrat-agent owner — MCP tool contract stability, descriptor-parity, `mcp-tools.md` parity

**Codebase Evidence**:
- Descriptor-parity/projection test family lives at `tests/test_backtest_view.py` (recon.md:77-78; projection `app/backtest_view.py`, parity guards there). `GET /api/tools` catalog test at `tests/test_tools_endpoint.py:23` (recon.md:80).
- Agent tests import fixtures from the Python canonical home `tests/conftest.py` (C-13).

**TDD**: `red-green required`

**Covers**: AC-8

**Instructions**:
1. Assert `_build_component` maps `{"kind":"fundamental","fundamental_metric":"eps",...}` to a `StrategyComponent` with `kind==COMPONENT_KIND_FUNDAMENTAL` and `fundamental_metric=="eps"`, and still raises `ValueError` on a genuinely unknown kind.
2. Assert a `run_backtest` over a range with backfilled fundamentals returns a `BacktestResult` whose entries are gated on the PIT `eps` series (drive a fake analysis stub) and that the returned shape still passes the descriptor-parity test (`@AC-8`) — the projected `StrategyComponent` gains `fundamental_metric` with no silent allow-list drift.
3. If `GET /api/tools` output shape changes (new parameter documented), update `test_tools_endpoint.py`; otherwise record that the tool count/catalog is unchanged.

**Verification**:
```bash
cd services/xstockstrat-agent && ruff check . && ruff format --check .
cd services/xstockstrat-agent && pytest -q
```
(Agent has no CI coverage threshold row; the descriptor-parity + tool-endpoint tests are the gate.)

---

### Step 15 — service: UI backfills data-kind selector + ComponentEditor fundamental operand

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/insights/backfills/page.tsx` — modify
- `services/xstockstrat-ui/src/components/insights/ComponentEditor.tsx` — modify
- `services/xstockstrat-ui/src/lib/insightsBff.ts` — modify (forward `dataKind` if not already generic)

**Reviewers**: xstockstrat-ui owner — analytics display accuracy, config mutation safety, Connect-RPC call safety, no direct DB access

**Codebase Evidence**:
- Backfills create form `backfills/page.tsx` hardcodes `timeframeEnum: Timeframe.TIMEFRAME_1DAY` in `handleCreate` (`page.tsx:135-141`; region read at `:128-145`) and has no timeframe/kind selector — a data-kind selector slots into the create form (recon.md:85-88); the `trigger.mutate({ symbols, timeframeEnum, range, overwrite })` payload gains `dataKind` (omit `timeframeEnum` when Fundamentals).
- BFF forward `triggerBackfill` at `src/lib/insightsBff.ts:72` (recon.md:87).
- `ComponentEditor.tsx` imports `ComponentKind` from `@xstockstrat/proto/analysis/v1/analysis_pb` (`:20`), renders a kind `Select` with `BUILTIN_INDICATOR`/`CUSTOM_FORMULA` items (`:103-106`) and `aria-label="component kind"` (`:99`) — add a `FUNDAMENTAL` item + a metric-name input, reusing the existing `Select` primitive and accessible-name pattern.
- Nav: `/insights/backfills` is in `NAV_GROUPS` (`navGroups.tsx:64`, admin-only) + `AppShell.tsx:16`, **not** `PLATFORM_SUBNAV` — extending existing pages does not re-trigger C-10(a) nav registration (recon.md:90-91).

**TDD**: `red-green required`

**Covers**: — (assertions in Step 16)

**Instructions**:
1. `backfills/page.tsx`: add a data-kind `Select` (`Bars`/`Fundamentals`) to the create form using canonical `ui/*` primitives + design tokens (C-17); when `Fundamentals`, omit `timeframeEnum` from the `trigger.mutate` payload and send `dataKind` (map to the generated `BackfillDataKind` enum). Give the selector a unique accessible name.
2. `ComponentEditor.tsx`: add a `FUNDAMENTAL` `SelectItem` (`:103-106`) and, when selected, render a metric-name control feeding `fundamental_metric`. Reuse the existing `Select` + `aria-label` pattern; no hardcoded colors.
3. `insightsBff.ts`: ensure `triggerBackfill` forwards `dataKind` (`:72`).
4. No new route/page → no `PLATFORM_SUBNAV`/nav change (recon.md:90-91).

**Verification**: covered by Step 16.

---

### Step 16 — test: UI e2e for fundamentals backfill + fundamental operand

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/insights/backfills.spec.ts` — modify
- `services/xstockstrat-ui/e2e/insights/backtest-*.spec.ts` — modify (fundamental operand in the builder)
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify (handle the fundamentals data-kind + operand)
- `services/xstockstrat-ui/e2e/fixtures/backfillJobs.ts` / `backtests.ts` — modify only if a second consumer forces centralization (C-12)
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify if a fixture was added/changed

**Reviewers**: xstockstrat-ui owner — analytics display accuracy, e2e coverage

**Codebase Evidence**:
- Existing specs `e2e/insights/{backfills,backtest-*}.spec.ts`, mock `e2e/mock-backend.ts`, fixtures `e2e/fixtures/{backfillJobs,backtests,fundamentals}.ts` + `INVENTORY.md` (recon.md:92-94). Auth helpers `e2e/helpers/auth.ts` (`addAuthCookie`/`addAdminCookie`) — new specs never re-implement JWT signing (discovery-checklist §j).

**TDD**: `red-green required`

**Covers**: AC-7, AC-8

**Instructions**:
1. `backfills.spec.ts`: as an admin operator on `/insights/backfills`, select data kind `Fundamentals`, a symbol universe, and a date range, submit, and assert a fundamentals backfill job is created and its status is observable (via the `GetBackfillStatus`-backed list) — `@AC-7`. Use `addAdminCookie` from `e2e/helpers/auth.ts` (admin-only page).
2. `backtest-*.spec.ts`: in the strategy builder, add a fundamental operand (`eps`) via `ComponentEditor` and assert the backtest run reflects it — the UI half of `@AC-8`.
3. `mock-backend.ts`: handle the fundamentals `dataKind` on `triggerBackfill` and the fundamental operand on the backtest RPC. Reuse the `backfillJobs.ts`/`backtests.ts`/`fundamentals.ts` fixtures (C-12); a new domain object gets a fixture module + `INVENTORY.md` row in this step, never an inline literal — scenario one-off overrides (`{ ...FIXTURE, override }`) stay inline.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint
cd services/xstockstrat-ui && pnpm test:e2e -- insights/backfills.spec.ts insights/backtest
grep -n "from '../fixtures'\|from './fixtures'\|helpers/auth" services/xstockstrat-ui/e2e/insights/backfills.spec.ts
```
Confirm fixtures/auth are imported (no inline JWT or domain literals) and `INVENTORY.md` reflects any
fixture change.

---

### Step 17 — docs: runbook + context-constitution teardown

**Status**: `pending`
**Service**: `docs/`
**Files**:
- `docs/runbooks/historical-backfill.md` — modify (fundamentals data-kind note)
- `docs/context-constitution.md` and/or `services/xstockstrat-marketdata/docs/`, `services/xstockstrat-analysis/docs/` — modify only if a `PLAT-*`/`<MODULE>-*` invariant surfaced (teardown audit)

**Reviewers**: none

**Codebase Evidence**:
- `docs/runbooks/historical-backfill.md` documents triggering OHLCV backfills via UI / `TriggerBackfill` / the `trigger_backfill` MCP tool (docs/runbooks/CLAUDE.md) — the fundamentals data-kind is a natural addition.
- Root `CLAUDE.md` § Teardown requires `/context-forge:context-constitution refresh` (scoped to touched context files/behavior) as the last step before pushing.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. Add a short section to `historical-backfill.md` on triggering a **fundamentals** backfill (data kind `Fundamentals` in `/insights`, `data_kind="fundamentals"` in the `trigger_backfill` MCP tool), noting EDGAR is the base source and FMP ratio enrichment is best-effort/cap-bounded.
2. Run the § Teardown audit: `/context-forge:context-constitution refresh` scoped to the context files this feature touched (marketdata/analysis `CLAUDE.md`, `config-governance.md`, `mcp-tools.md`, strat-lab skill); reconcile any grounded drift it reports. If the plugin is unavailable, perform the manual equivalent and record in the PR body both that it was unavailable and the manual reconciliation performed (root `CLAUDE.md` § Teardown; ledger `fails.md:670`).

**Verification**:
```bash
grep -n -i "fundamental" docs/runbooks/historical-backfill.md
```
Confirm the fundamentals backfill path is documented; teardown drift reconciled before the
integration PR.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
