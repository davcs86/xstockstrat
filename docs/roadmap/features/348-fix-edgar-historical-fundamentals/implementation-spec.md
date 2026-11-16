# Implementation Spec: fix-edgar-historical-fundamentals

**Status**: `pending`
**Created**: 2026-11-16
**Feature**: `docs/roadmap/features/348-fix-edgar-historical-fundamentals/feature.md`
**Total Steps**: 15
**Feature Branch**: `feature/fix-edgar-historical-fundamentals`

---

## Execution Summary

Step 1 restates `acceptance.feature` (`@AC-1..@AC-11`) and FR-6 before any code (design.md § 7).
Steps 2+3 land the period identity in the EDGAR derivation (`DerivationVersion` 2 → 3), proven
red-then-green on real ORCL and CRWD companyfacts. Steps 4+5 add the pure reconcile planner, Steps
6+7 the repository read and transactional replace, and Steps 8+9 switch the backfill write path to
the planner, so the version bump can correct a stored row's label and dates and not only its ratios.
Steps 10+11 add the no-write audit that uses the same planner, Step 12 proves the replace SQL on a
real database in CI, Steps 13+14 are the durable-rule and docs changes, and Step 15 is the operator
gate that must close before the integration PR merges into `main-dev`.

Paths below are under `services/xstockstrat-marketdata/` unless they start with `docs/`,
`packages/`, `services/`, `scripts/` or `.github/`. Every line number was re-read on
`Tree: feature/fix-edgar-historical-fundamentals@15da035 ≡ origin/feature/fix-edgar-historical-fundamentals (merged origin/main-dev@f3f02c7)`
(C-01). That merge moved `internal/service/marketdata_service.go` by +21 lines against recon.md and
design.md; the numbers here are the current ones. `internal/edgar/`, `internal/repository/` and
`internal/source/` are unchanged since recon.

No migration, no proto change and no config key is added (design.md D-5; F-01, C-09 and C-05 are not
triggered).

### Scenario Coverage (C-15)

Scenario text is the Step 1 restatement of `acceptance.feature`.

| Scenario | Covered by |
|---|---|
| `@AC-1` two filings with the same fy/fp yield two periods with their own values | Step 3 |
| `@AC-2` no derived period ends after it was filed | Step 3 |
| `@AC-3` each period has its own deterministic label (`Q1-2026`, `Q1-2027`) | Step 3 |
| `@AC-4` a point-in-time read does not return figures filed on or after the as-of date | Step 3 (RED, derived data), Step 9 (read boundary) |
| `@AC-5` a collided row stored before the fix is replaced by the re-derive | Step 7, Step 9, Step 12 |
| `@AC-6` the EDGAR snapshot serves the newest period; the cached snapshot is not served | Step 3 (newest period), Step 9 (snapshot, cache) |
| `@AC-7` the operator audit passes only when every pass condition holds | Step 11, Step 12 |
| `@AC-8` the repair restores both collided periods; a later ranged backfill adds nothing outside its range | Step 5, Step 9 |
| `@AC-9` a ticker that resolves to another filer fails the symbol without a write | Step 5, Step 9 |
| `@AC-10` a year end moved later within one calendar year leaves the later-ending periods out | Step 3 |
| `@AC-11` a replaced row is priced at its own filing date from its own statement | Step 9, Step 11 |

### Consumer Surfaces (C-14)

The product spec names the `/insights` and `/trader` fundamentals views and the agent tools
`query_fundamentals`, `run_fundamentals_scan`, `screen_symbols` and `run_backtest`, with **no
consumer code change** (design.md § 4, grounded in recon.md § Codebase Map: the agent and the data
explorer pass `fiscal_period` through as an opaque string, analysis selects by `filed_date` only,
and its pager key `(period_end, fiscal_period)` stays strictly increasing because labels stay unique
per type). No `services/xstockstrat-ui/` or `services/xstockstrat-agent/` step exists, by decision.
The surfaces are checked through `query_fundamentals` on the canary symbols after deploy (runbook
procedure, Step 14). The `strat-lab` plugin is not touched: `trigger_backfill` and
`get_backfill_status` keep their contracts, and `plugins/strat-lab/skills/backtest/reference/backfill.md`
states nothing about how a fundamentals backfill treats stored rows.

### Decisions the design leaves open (to confirm at `/sdd-review impl-spec`)

Each row is a choice this spec makes where design.md and debate.md are silent or disagree. None
reverses a settled `D-n` or reopens an `R-n`.

| ID | Choice | Basis |
|---|---|---|
| S-1 | The left-out WARN and the `marketdata.backfill.periods_left_out` increment are emitted by `FetchHistorical` (the backfill path). `DeriveHistorical` only returns the list. | D-19 names the counter `marketdata.backfill.*`; the audit must not count. |
| S-2 | The planner takes the left-out list as an optional input. The service has only `FetchHistorical` (D-21), so it passes none: its INFO line reports `no_period_derived` for a row the audit reports as `left_out`. The WARN of the same run names the left-out period. | D-21 keeps the extra entry point outside the source interface; D-24 wants a category on the service log. The two cannot both hold exactly. |
| S-3 | A deleted row is **replaced** when a fresh period of the same type with the row's `filed_date` is inserted or identical; each fresh period replaces at most one deleted row (deleted rows and fresh periods of one type and `filed_date` are paired in `period_end` order). Every other deleted row is **deleted without replacement** and gets a category, first match wins: `left_out` (a left-out period of the same type has the row's `period_end` or `filed_date`); `merged` (a fresh period of the same type has the row's `filed_date` but another deleted row took it); `period_type_changed` (a fresh period of the other type has the row's `filed_date`); `no_period_derived`. | design.md § 2 names the four categories; the pairing rule is the operator's answer of 2026-11-16 ("Narrow set", context.md). |
| S-4 | Decided by the operator (2026-11-16, "Narrow set"): a row whose period is stored again under corrected dates or a corrected label is replaced, not "deleted without replacement", and gets no INFO line. Only rows whose period no longer exists in the table are listed and logged (S-3). | context.md, operator answers after the spec; narrows the literal D-24 wording in design.md § 2 and § 3. |
| S-5 | An accession whose facts disagree on `filed` is handled like one whose facts disagree on `form`: no period, one WARN. | D-9 states the form case only; recon measured zero exceptions for both. |
| S-6 | `year_end_quarter` is applied before `label_collision`, so a quarter left out for ending on a fiscal-year boundary never takes a label from another quarter. | D-19 and D-20 do not order the two rules. |
| S-7 | `source.HistoricalPriceState` also gains `ExtraMetrics`. | D-18 compares stored `net_income`, `revenue`, `assets`, `liabilities` and `stockholders_equity`, which live in `extra_metrics`; design.md § 3 lists only label, type and `period_end` (ledger insight 2026-10-14, feature 216: a field an invariant needs must be in the enumerated type). |
| S-8 | No clock seam is added to `MarketDataService`. The two dividend-window cases are made independent of the wall clock through `dividends.backfill_lookback_years` (1 and 50) and fixed filing dates. | debate.md O-15 closure says "injected clock"; design.md § 3 lists no such field; C-18 (YAGNI). `fails.md` 2026-10-14 (216) accepts either. |
| S-9 | The pinned delete binds `period_end` and `filed_date` as `YYYY-MM-DD` text cast with `::date`. | Under `QueryExecModeExec` a `time.Time` argument is sent as `timestamptz`; `date = timestamptz` depends on the session time zone, and a miss fails the symbol. |
| S-10 | The replace transaction runs before the in-place updates of identical rows; `periods_written` counts inserted rows plus in-place changes. | D-13: a failed replace must leave the symbol unwritten. |
| S-11 | Audit input is one JSON file per lane, `{"<SYMBOL>": [<period as query_fundamentals historical mode returns it>, ...]}`. The pre/post diff matches rows on (symbol, `period_type`, `filed_date`); a key with more than one row on either side is reported as ambiguous and not counted. | D-25 moves the input from a SQL export to MCP reads; design.md § 5 does not define the diff key. D-15: `price` and `dividend_yield` depend only on symbol and `filed_date`. |
| S-12 | Lane symbol list, decided by the operator (2026-11-16): the main session reads every watchlist through the MCP (`list_watchlists`, then `get_watchlist` for each) and takes the union of their symbols. The operator's read-only `SELECT count(DISTINCT symbol)` is recorded beside the union's size; stored symbols outside the union are reported, not silently skipped. | context.md, operator answers after the spec ("Use the mcp to pull the symbols from all watchlists"). |
| S-13 | `periodTypeWanted` moves from `internal/edgar` to `source.PeriodTypesWanted` so the planner and the derivation parse the requested types with one function. | DRY guard rail; the service does not import `internal/edgar`. |

### Open items carried from design (not resolved by this spec)

- Every design.md § Open Risks item whose target is "the audit step" is surfaced by Step 15's report:
  label-collision left-outs, rows deleted without replacement, guard-failed symbols, single-metric
  anchors, 6-K half-year rows.
- Empty price-join columns on replaced rows are counted by the pre/post diff after the repair. The
  repair itself is run by the operator after deploy and is outside this spec (product-spec.md § Out
  of Scope).
- S-2, S-4 and S-12 were answered by the operator on 2026-11-16 (context.md): S-2 agreed as written, S-4 the narrow set, S-12 the union of all watchlists.

## Step Dependencies

- Steps 2+3 land together: Step 3's tests reference symbols Step 2 creates, and Step 2 turns existing
  `internal/edgar` tests red until Step 3 migrates their fixtures (step-constraints §C, rows 1 and 3).
- Steps 4+5 land together: Step 5 references the package Step 4 creates (§C row 3).
- Steps 6+7 land together: Step 7 references the two repository methods Step 6 creates (§C row 3).
- Steps 8+9 land together: Step 8 changes the `histFundamentalsRepo` interface, removes two
  repository methods and a struct field that the service and repository tests use (§C rows 1 and 4).
- Steps 10+11 land together: Step 11 references the package Step 10 creates (§C row 3).
- Step 3 [test] covers Step 2 [service]; Step 5 covers Step 4; Step 7 and Step 12 cover Step 6;
  Step 9 covers Step 8; Step 11 covers Step 10.
- Step 4 requires Step 2: the planner's optional input is `source.LeftOutPeriod`.
- Step 8 requires Steps 2, 4 and 6: it calls the planner, `ListHistoricalRows` and
  `ReplaceHistoricalFundamentals`, and relies on labels and dates from the version-3 derivation.
- Step 10 requires Steps 2 and 4: the audit calls `DeriveHistorical` and the planner.
- Step 12 requires Step 6 (the SQL) and may run before or after Steps 8–11.
- Step 13 requires Step 9: the changed feature-216 scenario describes behaviour Step 8 introduces.
- Step 14 requires Steps 8, 10 and 12: the docs describe the shipped write path, the audit command
  and the CI job.
- Step 15 requires Step 11 (the audit command) and is re-run if `internal/edgar/` or
  `internal/reconcile/` changes afterwards (D-23). It must be `done` before the integration PR merges
  into `main-dev`.
- Each of Steps 2–11 keeps `GOWORK=off go test ./...` green over **all** packages, `cmd/` included
  (`fails.md` 2026-10-14, feature 211).

---

### Step 1 — docs: restate acceptance.feature (`@AC-1..@AC-11`) and FR-6

**Status**: `done`
**Service**: `docs/roadmap/features/348-fix-edgar-historical-fundamentals/`
**Files**:
- `docs/roadmap/features/348-fix-edgar-historical-fundamentals/acceptance.feature` — modify
- `docs/roadmap/features/348-fix-edgar-historical-fundamentals/product-spec.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- design.md § 7 lists the restatement: FR-6 and `@AC-4` to the strict rule (D-7), labels pinned in
  `@AC-3` and `@AC-5`, a cache clause in `@AC-6`, the full pass conditions in `@AC-7` (D-23), new
  `@AC-8..@AC-11`.
- The strict rule already in force: `filterAsOf` keeps `p.FiledDate.Before(asOf)`
  (`internal/service/marketdata_service.go:2654-2665`); durable `@AC-3 @feature-198`
  (`acceptance/historical-fundamentals-backtest.feature:17-25`).
- product-spec.md:80-82 (FR-6) says "on or before D".
- Labels follow D-10 on Oracle's dates (fiscal year ends May 31): the quarter ended 2025-08-31 against
  the boundary 2026-05-31 gives r = 3, `Q1-2026`; the quarter ended 2026-08-31 has no later boundary,
  the nearest is 2026-05-31, r = −1, `Q1-2027`. design.md § 6 step 6 names the same two labels.
- `@AC-10` dates follow D-10 and D-19: with annual-class ends 2023-06-30 and 2023-12-31, both annual
  periods get `FY2023`, and the quarters ended 2023-03-31 and 2023-09-30 both get `Q3-2023`. These
  two results are computed from the rule in this session, not measured; Step 3 is where they are run.
- `@AC-*` IDs are append-only (C-15): `@AC-1..@AC-7` keep their IDs.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:

1. In `acceptance.feature` keep the `Feature:` header, `@AC-1` and `@AC-2` as they are. Replace
   `@AC-3` to `@AC-7` and append `@AC-8` to `@AC-11` with exactly:

   ```gherkin
     @AC-3 @FR-4
     Scenario: each period has its own deterministic label
       Given Oracle's SEC companyfacts, in which the 10-Q filed 2025-09-10 and the 10-Q filed 2026-09-11 both carry fy 2026 and fp "Q1"
       When the historical fundamentals for "ORCL" are derived twice
       Then the quarterly period ending 2025-08-31 is labelled "Q1-2026" and the quarterly period ending 2026-08-31 is labelled "Q1-2027"
       And no two derived periods of the same period type share a fiscal_period label
       And both derivations produce the same label for every period

     # guards: docs/reports/2026-11-16-marketdata-edgar-period-label-collision-defect.md
     @AC-4 @FR-6 @regression
     Scenario: a point-in-time read does not return figures filed on or after the as-of date
       Given the stored "ORCL" periods were derived from Oracle's SEC companyfacts after the fix
       When GetHistoricalFundamentals is called for "ORCL" as of 2025-10-01
       Then the newest quarterly period returned has period_end 2025-08-31 and shareholders' equity 24154000000
       And every returned period has a filed_date before 2025-10-01
       When GetHistoricalFundamentals is called for "ORCL" as of 2025-09-10
       Then the quarterly period with period_end 2025-08-31 is NOT returned
       When GetHistoricalFundamentals is called for "ORCL" as of 2025-09-11
       Then the quarterly period with period_end 2025-08-31 IS returned with filed_date 2025-09-10

     @AC-5 @FR-5
     Scenario: a collided row stored before the fix is replaced by the re-derive
       Given a row stored before the fix for "ORCL" labelled "Q1-2026" with filed_date 2025-09-10, period_end 2026-09-07 and shareholders' equity 66772000000
       When the fix is deployed and the fundamentals backfill re-derives "ORCL"
       Then every stored "ORCL" row carries derivation version 3
       And no stored "ORCL" row has a period_end later than its filed_date
       And no stored "ORCL" row has period_end 2026-09-07
       And the stored row labelled "Q1-2026" has period_end 2025-08-31, filed_date 2025-09-10 and shareholders' equity 24154000000
       And the stored row labelled "Q1-2027" has period_end 2026-08-31, filed_date 2026-09-11 and shareholders' equity 66772000000

     @AC-6 @FR-7
     Scenario: the EDGAR snapshot serves the newest period under the corrected identity
       Given the stored "ORCL" periods were derived from Oracle's SEC companyfacts after the fix
       And the snapshot source is "edgar"
       And an EDGAR snapshot for "ORCL" was cached before the fundamentals backfill replaced a stored "ORCL" row
       When GetFundamentals is called for "ORCL"
       Then the snapshot cached before the replace is not served
       And the snapshot is built from the quarterly period with period_end 2026-08-31, filed_date 2026-09-11 and shareholders' equity 66772000000

     @AC-7 @FR-8
     Scenario: the operator audit passes only when every pass condition holds
       Given a staging database on which the post-deploy repair has finished
       And the lane's fundamentals.history.backfill.period_types reads "both"
       When the operator runs the documented audit
       Then the audit passes only if the count of rows with period_end later than filed_date is 0
       And only if every row below derivation version 3 belongs to a symbol the repair reported failed
       And only if no two rows of one symbol and period type share a period_end
       And only if the audit plans no delete and no insert for every symbol the repair did not report failed
       And the audit reports, per price-join column, how many rows went from a value to null between the pre-repair and post-repair rows

     @AC-8 @FR-1 @FR-5
     Scenario: the repair restores both collided periods, and a later ranged backfill adds nothing outside its range
       Given a row stored before the fix for "ORCL" labelled "Q1-2026" with filed_date 2025-09-10 and period_end 2026-09-07 at derivation version 2
       When the fundamentals backfill runs for "ORCL" with the range 2016-01-01..2026-06-30
       Then the stored quarterly row with period_end 2025-08-31 has filed_date 2025-09-10
       And the stored quarterly row with period_end 2026-08-31 has filed_date 2026-09-11
       Given every stored "ORCL" row carries derivation version 3 and none has a period_end before 2020-01-01
       When the fundamentals backfill runs for "ORCL" with the range 2026-01-01..2026-06-30
       Then no "ORCL" row with a period_end before 2026-01-01 or after 2026-06-30 is added, changed or removed

     @AC-9 @FR-5
     Scenario: a ticker that now resolves to another filer fails the symbol without a write
       Given stored "ORCL" rows with net income 2927000000 and shareholders' equity 24154000000
       And the periods derived for the ticker "ORCL" hold net income 100000000 and shareholders' equity 900000000 and no value equal to a stored one
       When the fundamentals backfill runs for "ORCL"
       Then "ORCL" is reported in failed_symbols
       And no stored "ORCL" row is added, changed or removed

     @AC-10 @FR-4
     Scenario: a fiscal year end moved later within one calendar year leaves the later-ending periods out
       Given a filer's SEC companyfacts with a 10-K for the year ended 2023-06-30, 10-Qs for the quarters ended 2023-03-31 and 2023-09-30, and a 10-KT for the six months ended 2023-12-31
       When the historical fundamentals for that filer are derived by a fundamentals backfill
       Then the annual period ended 2023-06-30 is labelled "FY2023" and the quarterly period ended 2023-03-31 is labelled "Q3-2023"
       And the periods ended 2023-09-30 and 2023-12-31 are left out of the derived set
       And marketdata.backfill.periods_left_out counts 2 with reason "label_collision"
       And no two derived periods of the same period type share a fiscal_period label

     @AC-11 @FR-5 @FR-6
     Scenario: a replaced row is priced at its own filing date from its own statement
       Given a row stored before the fix for "ORCL" labelled "Q1-2026" with filed_date 2025-09-10, period_end 2026-09-07, price 310.25, dividend_yield 0.0065 and pb_ratio 13.1
       When the fundamentals backfill replaces that row with the periods ended 2025-08-31 (filed 2025-09-10) and 2026-08-31 (filed 2026-09-11)
       Then the row for the period ended 2025-08-31 keeps price 310.25 and dividend_yield 0.0065, the values stored under the same filed_date
       And its market_cap, pe_ratio and pb_ratio are computed from price 310.25 and its own statement (shareholders' equity 24154000000), not carried from the stored row
       And the row for the period ended 2026-08-31 takes its price from the daily bar at 2026-09-11, with nothing carried from a row filed on another date
       And a price-join column of a replacement row is left unset when no daily bar exists within 14 days before its filed_date, when its trailing-12-month dividend window predates the dividend fetch, or when its statement lacks the input
   ```

2. In `product-spec.md` FR-6 (lines 80-82) replace "returns, for each period, only values whose filing
   date is on or before D (no look-ahead)" with "returns, for each period, only values whose filing
   date is strictly before D (a filing is visible from the day after it was filed; no look-ahead)".
   Change nothing else in the product spec.
3. If Step 3 shows a label or a left-out period in `@AC-3` or `@AC-10` that differs from the text
   above, stop: record it in context.md and raise it. Do not edit the scenario to fit the code.

**Verification**:

```bash
F=docs/roadmap/features/348-fix-edgar-historical-fundamentals
test "$(grep -c '^  Scenario:' $F/acceptance.feature)" = 11
for n in 1 2 3 4 5 6 7 8 9 10 11; do test "$(grep -c "^  @AC-$n " $F/acceptance.feature)" = 1 || { echo "AC-$n missing or repeated"; exit 1; }; done
test "$(grep -c "on or before D" $F/product-spec.md)" = 0
test "$(grep -c "strictly before D" $F/product-spec.md)" = 1
```

---

### Step 2 — service: EDGAR period identity per filing, date-derived labels, `DerivationVersion` 3

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/edgar/edgar_client.go` — modify
- `services/xstockstrat-marketdata/internal/source/source.go` — modify
- `services/xstockstrat-marketdata/internal/telemetry/otel.go` — modify

**Reviewers**: xstockstrat-marketdata service owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- `unitDatum` carries `Accn`, `FY`, `FP`, `Form`, `Filed` — `internal/edgar/edgar_client.go:145-154`.
- Day-count constants `quarterMinDays` … `annualMaxDays` — `:213-218`.
- `periodAgg` (fields `fy`, `fp`, `periodType`, `periodEnd`, `filed`, `vals`, `flows`, `instants`) —
  `:220-229`; `candSet` `:239`, `anchorKeys` `:242`, `candSet.add` `:252-264`, `latestEnd` `:278-291`,
  `selectOwnPeriod` `:295-311` (reuse; recon.md § Patterns to REUSE).
- `periodKey(fy, fp)` — `:370`; only caller `:424`.
- `FetchHistorical` — `:374-472`: `niFacts` collected before the `fy`/`fp` skip `:398-402`; skip
  `:403-405`; `classifyPeriodType` call `:406`; bucket seed `:427`; earliest filed `:431-433`;
  latest end over every fact `:434-436`; shares first-seen `:442-449`; range filter `:461-466`.
- `trailingNetIncome` — `:500-559`; `annualizeQuarterlyROE` passes `a.periodEnd`, `a.filed` — `:572`.
- `classifyPeriodType` — `:586-608`; only caller `:406`.
- `DerivationVersion = 2` — `:610-614`.
- `buildPeriod` builds the label from `a.fp`, `a.fy` — `:620`, `:628-630`.
- `periodTypeWanted` — `:698-713`; only caller `:385`.
- Interface assertion `var _ source.HistoricalFundamentalsSource = (*Client)(nil)` — `:715`;
  the interface — `internal/source/source.go:139-141`.
- Counter pattern: `backfillSymbols = NewCounter("marketdata.backfill.symbols")`
  (`internal/telemetry/otel.go:371`), `RecordBackfillSymbol` (`:412-414`), label keys `KeyVendor` …
  `KeyKind` (`:311-315`), closed label values as constants (`:360-366`).
- **Not found**: a `reason` label key, a left-out counter, a per-accession grouping, a label function,
  `DeriveHistorical`. All are created here.
- `.golangci.yml` enables `sloglint` with `context: scope`: a log call inside a function that has a
  `ctx` uses the `slog.*Context` form.

**Lands with**: `Step 3`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:

1. **Types.** In `internal/source/source.go` add `LeftOutPeriod` (fields `FiscalPeriod`, `PeriodType`,
   `Reason string`; `PeriodEnd`, `FiledDate time.Time`). In `internal/edgar/edgar_client.go` add
   `Derivation` (`Periods []source.HistoricalFundamentalsPeriod`, `LeftOut []source.LeftOutPeriod`,
   `SingleMetricAnchors int`).
2. **Telemetry.** In `internal/telemetry/otel.go` add `KeyReason = "reason"` beside `KeyKind`, the
   constants `LeftOutLabelCollision = "label_collision"` and `LeftOutYearEndQuarter =
   "year_end_quarter"`, the counter `NewCounter("marketdata.backfill.periods_left_out")` beside
   `backfillSymbols`, and `RecordPeriodLeftOut(ctx, reason string)` after `RecordBackfillSymbol`.
3. **Filings (D-1, D-9).** Group the read facts (tags in `flowTags` and `instantTags`, every taxonomy)
   by `Accn`. A filing has one `Form` and one `Filed`. Form class: annual = `10-K`, `10-K/A`, `10-KT`,
   `10-KT/A`, `20-F`, `20-F/A`, `40-F`, `40-F/A`; quarterly = `10-Q`, `10-Q/A`, `6-K`, `6-K/A`; any
   other form yields no period. An accession whose facts disagree on `Form` or on `Filed` yields no
   period and logs one WARN (S-5). Remove `FY` and `FP` from `unitDatum`, and remove `periodKey`, the
   skip at `:403-405` and `classifyPeriodType`. Replace `periodAgg.fy` and `periodAgg.fp` with what
   the filing needs (accession, form class, label).
4. **Facts of a filing.** A flow enters the filing's `flows` candidates only when its duration is
   inside the class range (`quarterMinDays`–`quarterMaxDays` for quarterly, `annualMinDays`–
   `annualMaxDays` for annual). An instant other than shares enters `instants` only when its `end` is
   on or before the filing's `filed`. Keep collecting every `NetIncomeLoss` fact into `niFacts`
   whatever its form (`:398-402`).
5. **Own end (D-3, D-11).** The filing's own end is `latestEnd(instants, anchorKeys...)`; with no
   anchor, the latest end among its class-duration flows; with neither, the filing yields no period.
   `selectOwnPeriod` is unchanged and runs per filing. Count a filing in `SingleMetricAnchors` when
   exactly one of the three anchor metrics has a fact at its anchor date.
6. **Shares (D-12).** Per unit, take the filing's share fact (`CommonStockSharesOutstanding`,
   `EntityCommonStockSharesOutstanding`) with the latest `end` on or before `filed`; on equal dates the
   `dei` fact wins; between facts of one tag on one date the larger value wins. A share fact never
   sets the own end. This replaces `:434-436` and `:442-449`.
7. **Periods (D-1).** Merge filings by (period type, own end). The earliest `filed` supplies the
   values and `filed_date`; on a same-day tie the smallest accession string wins. Every other filing
   of that period is ignored.
8. **Labels (D-4, D-10).** Compute labels over the whole payload, before any range or type filter.
   B = the own ends of all annual-class filings. Annual: `FY<year(end − 15 days)>`. Quarter ending e:
   reference b = the smallest boundary ≥ e with round((b − e)/91.3125) ≤ 3; else the boundary nearest
   to e (tie: the earlier); else Dec 31 of year(e) when B is empty. r = round((b − e)/91.3125);
   label `Q<4 − (r mod 4)>-<year(b − 15 days) − floor(r/4)>`, with floor (Euclidean) `mod` and `/`:
   Go's `%` and `/` truncate toward zero and must not be used directly for negative r.
   `buildPeriod` (`:620`, `:628-630`) writes this label instead of the one built from `fp`, `fy`.
9. **Left-out periods (D-19, D-20, S-6).** First leave out every quarterly-class period whose own end
   is in B (`year_end_quarter`); a quarter labelled through the Dec-31 fallback is never left out for
   this reason. Then, among the remaining periods of one type that share a label, the earliest-ending
   keeps it and each later one is left out (`label_collision`). Left-out periods go to
   `Derivation.LeftOut` with the label they would have had.
10. **Entry points (D-21, S-1).** Add `func (c *Client) DeriveHistorical(ctx context.Context, symbol
    string) (Derivation, error)`: resolve the CIK, fetch companyfacts (as `:375-383`), derive, and
    return `Periods` sorted by (`PeriodEnd`, `PeriodType`). `FetchHistorical` keeps its signature and
    becomes: call `DeriveHistorical`; for each left-out period log one WARN (symbol, label, period
    type, `period_end`, `filed_date`, reason) and call `telemetry.RecordPeriodLeftOut`; then apply the
    type filter and the `period_end` range filter (`:461-466`) and return. The filters run after
    labelling.
11. **Unchanged formulas.** `trailingNetIncome` and `annualizeQuarterlyROE` keep their bodies;
    `:572` now receives the period's own end and its own `filed`. `buildPeriod`'s ratio and
    `extra_metrics` code is not touched (product-spec.md § Out of Scope).
12. **Version (D-5).** Set `DerivationVersion = 3`. Do not add a version-history comment line (root
    `CLAUDE.md` § How to Act #5); what version 3 means is written in `docs/fundamentals.md` by Step 14.
13. Trading-domain constraints (step-constraints §A): not applicable, no order or broker path. No new
    outbound gRPC call (§B header propagation not triggered).

**Verification**: runs as one unit with Step 3; see Step 3.

---

### Step 3 — test: ORCL and CRWD fixtures, period-identity tests, fixture migration, version-3 golden

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/edgar/testdata/orcl_companyfacts.json` — create
- `services/xstockstrat-marketdata/internal/edgar/testdata/crwd_companyfacts.json` — create
- `services/xstockstrat-marketdata/internal/edgar/period_identity_test.go` — create
- `services/xstockstrat-marketdata/internal/edgar/edgar_client_test.go` — modify
- `services/xstockstrat-marketdata/internal/edgar/ttm_roe_test.go` — modify
- `services/xstockstrat-marketdata/internal/edgar/own_period_test.go` — modify
- `services/xstockstrat-marketdata/internal/edgar/derivation_version_test.go` — modify
- `services/xstockstrat-marketdata/internal/service/telemetry_allowlist_test.go` — modify

**Reviewers**: xstockstrat-marketdata service owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- Real-filing fixture pattern: `internal/edgar/testdata/lyft_companyfacts.json` (top-level keys `cik`,
  `entityName`, `facts`; only read tags kept; each fact keeps `accn`, `fy`, `fp`, `form`, `filed`,
  `frame`) and its loader `lyftPeriods` — `internal/edgar/own_period_test.go:17-34`.
- Test client `newTestClientCF211(cf map[string]any)` resolves only ticker `AAPL` —
  `internal/edgar/edgar_client_test.go:243-256`; `periodByFP` — `internal/edgar/ttm_roe_test.go:41-50`.
- Every existing inline fixture uses one accession for all facts: `cannedCompanyFacts`
  `"accn": "x"` (`edgar_client_test.go:54`, `:57`); `instantFact211` (`:240`); `dualCurrencyCF`
  (`:274`); the flow builder at `:433`; the CIK case at `:468`; `opFlow`, `opInst`
  (`own_period_test.go:76`, `:80`); `axpFacts` gives `"accn": "x"` and `"form": "10-Q"` to every
  fact, the full-year one included (`ttm_roe_test.go:17`, `:20`, `:26`, `:32`); the golden's `inst`
  (`derivation_version_test.go:25`).
- Label pins in existing tests: `Q1-2020` for a lone quarter ended 2019-12-28 with no annual filing
  (`edgar_client_test.go:113`); `Q2-2026` and `FY2025` (`ttm_roe_test.go:63`, `:75`, `:115`;
  `derivation_version_test.go:38`); `Q3-2026` (`own_period_test.go:52`, `:94`); `FY2025`
  (`own_period_test.go:62`, `:192`; `edgar_client_test.go:478`).
- Version pin `p.DerivationVersion != 2` — `own_period_test.go:66-72`; golden map with entries 1 and
  2 and the lookup `derivationGolden[DerivationVersion]` — `derivation_version_test.go:16-19`, `:53`.
- Counter-reading helper in this package: `vendorMetricReader` — `edgar_client_test.go:489`.
- Allowlist: `allowedLabelKeys`, `minInstruments`, `driveAllInstruments` —
  `internal/service/telemetry_allowlist_test.go:28-31`, `:38-42`, `:46-54`.
- Pinned real values (context.md § Root cause; SEC companyfacts CIK0001341439): quarter ended
  2025-08-31 — net income 2,927,000,000, equity 24,154,000,000, filed 2025-09-10, accession
  `0001193125-25-200095`; quarter ended 2026-08-31 — net income 4,760,000,000, equity
  66,772,000,000, filed 2026-09-11, accession `0001193125-26-389274`, cover-page share count dated
  2026-09-07. CRWD: 10-Ks filed 2022-03-16 and 2023-03-09 for the years ended 2022-01-31 and
  2023-01-31 both carry `fy` 2022; the 10-K filed 2021-03-18 has its balance sheet at 2021-01-31 and
  no annual-length flow ending there among the read tags (recon.md § Data findings).
- **Not found**: CRWD's CIK in any feature file. It is resolved from SEC's ticker map
  (`defaultTickerURL`, `edgar_client.go:26`).
- Reachability, checked in the `/sdd-spec` session on 2026-11-16: `data.sec.gov` answered 200 for
  ORCL's companyfacts; `www.sec.gov/files/company_tickers.json` answered 403 to a generic
  `User-Agent` (SEC requires a descriptive one, `edgar_client.go:95-96`).

**Lands with**: `Step 2`

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2, AC-3, AC-4, AC-6, AC-10`

**Instructions**:

1. **Fixtures (D-8).** Fetch `https://data.sec.gov/api/xbrl/companyfacts/CIK0001341439.json` (ORCL)
   and CRWD's companyfacts (CIK from the ticker map) with a generic fair-use `User-Agent` that names the tool only (no personal name, email or project detail). Trim **by tag
   only**: keep every fact of the tags in `flowTags` and `instantTags` (`edgar_client.go:187-210`),
   drop all other tags, keep `cik` and `entityName`. Do not drop or edit a fact. If a fetch is
   blocked, the step is blocked: do not hand-write either file and do not guess CRWD's CIK.
2. **Loader.** In `period_identity_test.go` add one loader that reads a `testdata/` file and returns
   the `Derivation` through `newTestClientCF211(...).DeriveHistorical`; make `lyftPeriods` call it so
   the three fixtures share one loader.
3. **RED tests on ORCL** (each fails on the pre-Step-2 tree, which returns one `Q1-2026` period with
   `period_end` 2026-09-07 and `filed_date` 2025-09-10):
   - `@AC-1`: a quarterly period with `period_end` 2025-08-31, `filed_date` 2025-09-10,
     `extra_metrics.net_income` 2,927,000,000 and `stockholders_equity` 24,154,000,000; and one with
     2026-08-31, 2026-09-11, 4,760,000,000 and 66,772,000,000.
   - `@AC-2`: the quarterly period filed 2026-09-11 has `period_end` 2026-08-31; no period of ORCL,
     CRWD or LYFT has `PeriodEnd` after `FiledDate`.
   - `@AC-3`: the two periods are labelled `Q1-2026` and `Q1-2027`; no two periods of one type share
     a label (ORCL, CRWD, LYFT); two derivations give the same (label, type, `period_end`,
     `filed_date`) list.
   - `@AC-4`: among the quarterly periods with `FiledDate` before 2025-10-01, the one with the latest
     `period_end` ends 2025-08-31 and has equity 24,154,000,000.
   - `@AC-6`: the quarterly period with the latest `period_end` ends 2026-08-31, was filed 2026-09-11
     and has equity 66,772,000,000.
   - Shares (D-12): the period filed 2026-09-11 has `SharesOutstanding` equal to the fixture's `dei`
     share fact of accession `0001193125-26-389274` dated 2026-09-07 (read the expected value from
     the fixture in the test, do not type it).
   - Filters after labelling: `FetchHistorical` with `periodTypes` `["quarterly"]`, and with `from`
     2026-01-01, returns the 2026-08-31 period still labelled `Q1-2027`.
4. **Tests on CRWD**: the annual periods ended 2022-01-31 (filed 2022-03-16) and 2023-01-31 (filed
   2023-03-09) both exist, labelled `FY2022` and `FY2023`; the 10-K filed 2021-03-18 yields an annual
   period with `period_end` 2021-01-31 (no flow-equality requirement, R-7).
5. **Synthetic tests** (inline builders, one accession per filing, a generic entity name):
   - form classes: each of the twelve listed forms maps to its class; `8-K` yields no period; an
     accession with facts of two forms yields no period; a `6-K` yields a quarterly period;
   - `@AC-10`: the 10-K / 10-Q / 10-KT timeline of the scenario. Assert the two kept labels, the two
     left-out periods with reason `label_collision`, and, through a manual metric reader, that one
     `FetchHistorical` call adds 2 to `marketdata.backfill.periods_left_out{reason="label_collision"}`
     while `DeriveHistorical` alone adds nothing;
   - a December to November year-end change with a `10-KT` for the eleven months ended 2018-11-30:
     the quarters ended 2018-03-31, 06-30, 09-30 are `Q1-2018`, `Q2-2018`, `Q3-2018`, and the quarter
     ended 2019-02-28 is `Q1-2019` (recon.md § Data findings, JEF);
   - label arithmetic table, negative r included: boundary 2020-09-26 with quarter ends 2019-12-28
     (`Q1-2020`), 2020-12-26 (`Q1-2021`), 2021-03-27 (`Q2-2021`), 2021-12-25 (`Q1-2022`);
   - `year_end_quarter`: a `10-Q` whose own end equals an annual boundary is left out with that
     reason; a lone quarter with no annual filing is kept;
   - shares tie rules: equal dates across the two tags (the `dei` fact wins); two facts of one tag on
     one date (the larger wins); a share fact dated after `filed` is not used.
6. **Existing fixtures (D-9).** Give every filing its own accession and its real form:
   - `cannedCompanyFacts` (`edgar_client_test.go:50-70`): one accession per `period` spec;
   - `TestFetchHistorical_MapsFiledPeriod_AC1` (`:91-122`): the lone quarter is still exactly one
     period with `period_end` 2019-12-28 and `filed_date` 2020-01-29, and its label is now `Q4-2019`
     (Dec-31 fallback, D-10 and D-20). Add a sibling case that adds the three annual specs of
     `TestFetchHistorical_QuarterlyAndAnnual_AC2` (`:137-139`) and asserts `Q1-2020`. Do not hide the
     lone-quarter case behind the added annual fact (debate.md O-15);
   - `axpFacts` (`ttm_roe_test.go:15-39`): one accession per `filed` date, and form `10-K` for the two
     facts filed 2026-02-10. `Q2-2026` and `FY2025` must still be found;
   - `derivation_version_test.go:25`: `inst` uses the accession of the 2026-07-24 filing;
   - `own_period_test.go:66-72`: compare against `DerivationVersion`, not the literal 2, and rename
     the test accordingly. The fixtures of `opFlow`, `opInst` and `:181-182` are single-filing and are
     expected to need no change; the unit's test run decides.
   - Every existing edgar test that turns red is fixed in this unit, each with one line in
     context.md saying why the old expectation no longer holds. Do not weaken an assertion to get
     green: `@AC-1 @feature-222`, `@AC-3 @feature-222`, `@AC-1 @feature-223`, `@AC-1 @feature-253` and
     the LYFT pins of `@AC-1`, `@AC-3 @feature-340` must still hold (design.md § Business Rules Touched).
7. **Golden.** Run the drift guard, then add entry `3:` to `derivationGolden` with the hash it
   prints. Keep entries `1` and `2`.
8. **Allowlist.** Add `telemetry.KeyReason` to `allowedLabelKeys`,
   `"marketdata.backfill.periods_left_out"` to `minInstruments`, and one
   `telemetry.RecordPeriodLeftOut` call to `driveAllInstruments`.
9. If a fixture does not reproduce a pinned value or a label of Step 1, stop and record it in
   context.md; do not adjust the expectation (`fails.md` 2026-11-04, feature 222).
10. Test data (C-13): each new fixture has one consumer (`period_identity_test.go`) and stays in
    `internal/edgar/testdata/`. The synthetic builders are single-consumer and stay inline.

**Verification** (union for the Steps 2+3 unit; run from the repo root):

```bash
ls services/xstockstrat-marketdata/internal/edgar/testdata/orcl_companyfacts.json services/xstockstrat-marketdata/internal/edgar/testdata/crwd_companyfacts.json
GOWORK=off go -C services/xstockstrat-marketdata test ./internal/edgar/... -race -count=5
GOWORK=off go -C services/xstockstrat-marketdata test ./... -race -count=1
COVERPKGS=$(GOWORK=off go -C services/xstockstrat-marketdata list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//')
GOWORK=off go -C services/xstockstrat-marketdata test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}"
GOWORK=off go -C services/xstockstrat-marketdata tool cover -func=coverage.out | awk '/^total:/ { sub("%","",$3); print "total " $3; if ($3 + 0 < 40) exit 1 }'
(cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod)
test "$(grep -c "const DerivationVersion = 3" services/xstockstrat-marketdata/internal/edgar/edgar_client.go)" = 1
test "$(grep -c "^	3: " services/xstockstrat-marketdata/internal/edgar/derivation_version_test.go)" = 1
test "$(grep -c "FP \|periodKey\|classifyPeriodType" services/xstockstrat-marketdata/internal/edgar/edgar_client.go)" = 0
test "$(grep -c "0001193125-25-200095" services/xstockstrat-marketdata/internal/edgar/testdata/orcl_companyfacts.json)" -ge 1   # the real 10-Q filed 2025-09-10
test "$(grep -c "0001193125-26-389274" services/xstockstrat-marketdata/internal/edgar/testdata/orcl_companyfacts.json)" -ge 1   # the real 10-Q filed 2026-09-11
test "$(grep -rl "orcl_companyfacts" services/xstockstrat-marketdata --include="*_test.go" | wc -l)" -eq 1   # one consumer (C-13)
test "$(grep -rl "crwd_companyfacts" services/xstockstrat-marketdata --include="*_test.go" | wc -l)" -eq 1
```

---

### Step 4 — service: pure reconcile planner (`internal/reconcile`)

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/reconcile/plan.go` — create
- `services/xstockstrat-marketdata/internal/source/source.go` — modify
- `services/xstockstrat-marketdata/internal/edgar/edgar_client.go` — modify

**Reviewers**: xstockstrat-marketdata service owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- **Not found**: `internal/reconcile/` does not exist (`ls internal/` lists `alpaca`, `alpacapace`,
  `classification`, `config`, `edgar`, `finnhub`, `fmp`, `handler`, `middleware`, `mtls`,
  `repository`, `service`, `source`, `telemetry`, `testdata`, `timeframe`). The package is created
  here. It counts toward coverage: the CI exclusion list is `cmd|handler|repository|telemetry|service`
  (`.github/workflows/ci.yml:374`).
- Stored-row type: `source.HistoricalPriceState` — `internal/source/source.go:123-134` (`Found`,
  `FiledDate`, five price columns, `Currency`, `DerivationVersion`).
- Fresh type: `source.HistoricalFundamentalsPeriod` — `:85-111`; the five reported values the guard
  reads are `extra_metrics` keys listed in `DerivationOwnedExtraKeys` — `:115`.
- `period_end` and `filed_date` are `date` columns — `migrations/005_fundamentals_history.up.sql:11-12`;
  the key is `(symbol, fiscal_period, period_type)` — `:28`.
- Requested types reach the backfill as strings (`quarterly`, `annual`, `both`, or empty for both):
  `internal/service/marketdata_service.go:2309-2314`; parsed today by `periodTypeWanted`
  (`internal/edgar/edgar_client.go:698-713`, one caller).
- The lookback key stays read at `internal/service/marketdata_service.go:2306` (D-17).

**Lands with**: `Step 5`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:

1. **Types.** In `source.HistoricalPriceState` add `FiscalPeriod`, `PeriodType string`, `PeriodEnd
   time.Time` and `ExtraMetrics map[string]float64` (S-7). Leave `Found` in place; Step 8 removes it.
2. **Shared parser (S-13).** Move `periodTypeWanted` to `internal/source` as exported
   `PeriodTypesWanted`, unchanged in behaviour, and call it from `internal/edgar/edgar_client.go`.
3. **Planner.** In `internal/reconcile/plan.go` add one pure function (no I/O, no logging, no clock)
   that takes a symbol's stored rows, the full fresh set, and a request (requested period types, the
   `period_end` range, an optional `[]source.LeftOutPeriod`) and returns a plan or a guard error. The
   current version is the highest `DerivationVersion` among the fresh periods. Dates compare by
   calendar day.
   - **Guards (D-14, D-18)**, evaluated first; a symbol with no stored row skips them:
     stored rows exist and the fresh set is empty; stored rows of a requested type exist and the
     fresh set has none of that type; stored rows of a requested type exist and no stored non-zero
     `net_income`, `revenue`, `assets`, `liabilities` or `stockholders_equity` value equals the same
     metric of any fresh period (this also fails when the stored rows hold none of the five). Each
     guard returns its own exported sentinel error.
   - **Identical (D-13)**: a stored row of a requested type equal to a fresh period on (label, type,
     `period_end`, `filed_date`). The plan lists the identical pairs whose `period_end` is inside
     the range (a zero bound is open).
   - **Deletes**: every other stored row of a requested type, whatever its `period_end` or version,
     sorted by (`fiscal_period`, `period_type`). Rows of a type that was not requested are never
     touched.
   - **Inserts (D-17)**: a fresh period of a requested type with no identical stored row, when
     (a) its `period_end` is inside the range, or (b) it shares (type, `period_end`) with a deleted
     row, or (c) the symbol has at least one deleted row below the current version.
   - **Deleted without replacement (D-24, S-3, S-4)**: every delete that no fresh period replaces
     under the S-3 pairing rule, with its category.
4. No config value is read or hardcoded here (F-07). No outbound call (§B header propagation not
   triggered).

**Verification**: runs as one unit with Step 5; see Step 5.

---

### Step 5 — test: reconcile planner cases

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/reconcile/plan_test.go` — create

**Reviewers**: xstockstrat-marketdata service owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- Counter-examples the planner must survive are recorded in debate.md: O-2 (a stale row whose wrong
  end is outside the range; a label chain; a surviving current-version row), O-4 (a current-version
  orphan after a label change), O-5 (an empty or shrunken fresh set), O-6 (several rows filed on one
  day).
- ORCL values for the collided row and its two periods: context.md § Root cause (as in Step 3).
- Table-driven test style in this service: `TestDropQuoteChunksBefore`
  (`internal/repository/marketdata_repo_test.go:760-815`).

**Lands with**: `Step 4`

**TDD**: `red-green required`

**Covers**: `AC-8, AC-9`

**Instructions**:

Write table-driven cases; each names the decision it pins.

1. Identity: equal on all four fields is identical with no delete and no insert; a difference in
   only the label, only `period_end`, or only `filed_date` is a delete plus an insert.
2. `@AC-8`, first half: stored ORCL `Q1-2026` (filed 2025-09-10, `period_end` 2026-09-07, version 2),
   fresh `Q1-2026` (2025-08-31, filed 2025-09-10) and `Q1-2027` (2026-08-31, filed 2026-09-11) at
   version 3, range 2016-01-01..2026-06-30: one delete, both periods inserted (rule c).
3. `@AC-8`, second half: all stored rows identical at version 3 and none before 2020-01-01; the fresh
   set also holds older periods; range 2026-01-01..2026-06-30: no delete, no insert.
4. Rule (b): a deleted current-version row whose (type, `period_end`) is outside the range gets its
   fresh period inserted; an unrelated out-of-range fresh period is not inserted.
5. O-4: a version-3 stored row the fresh set does not reproduce is deleted; rule (c) does not apply.
6. A label chain (stored `FY2022` holding the year the fresh set labels `FY2023`, and so on): the
   plan deletes and inserts the same key, and deletes are in sorted key order.
7. Requested types: an annual-only request neither deletes a quarterly stored row nor inserts a
   quarterly fresh period.
8. `@AC-9` and the other guards: filer mismatch (stored net income 2,927,000,000 and equity
   24,154,000,000; fresh 100,000,000 and 900,000,000); stored rows holding none of the five values;
   a stored zero never counts as a match; fresh set empty; requested type absent from the fresh set;
   no stored row skips every guard, including with an empty fresh set.
9. Categories (S-3, S-4): one case per category, including `left_out` only when the optional list is
   given; a row with a cover-page `period_end` whose corrected period shares its `filed_date` is
   replaced and is NOT in the list; two deleted rows of one type with one `filed_date` and a single
   fresh period give one replaced row and one `merged` row.
10. Test data (C-13): the literals have one consumer and stay inline.

**Verification** (union for the Steps 4+5 unit; run from the repo root):

```bash
GOWORK=off go -C services/xstockstrat-marketdata test ./internal/reconcile/... -race -count=1 -cover   # the new package is covered by its own tests
GOWORK=off go -C services/xstockstrat-marketdata test ./... -race -count=1
COVERPKGS=$(GOWORK=off go -C services/xstockstrat-marketdata list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//')
GOWORK=off go -C services/xstockstrat-marketdata test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}"
GOWORK=off go -C services/xstockstrat-marketdata tool cover -func=coverage.out | awk '/^total:/ { sub("%","",$3); print "total " $3; if ($3 + 0 < 40) exit 1 }'
(cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod)
test "$(grep -rn "periodTypeWanted" services/xstockstrat-marketdata --include="*.go" | wc -l)" -eq 0
```

---

### Step 6 — service: repository list-all-rows read and transactional replace

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/repository/marketdata_repo.go` — modify

**Reviewers**: xstockstrat-marketdata service owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- `MarketDataRepo.db` is a `classificationDB` (`execer` plus `Begin`) — `internal/repository/marketdata_repo.go:36`;
  `internal/repository/classification_repo.go:15-18`.
- Transaction pattern to follow: `DropQuoteChunksBefore` — `marketdata_repo.go:436-472`
  (`r.db.Begin` `:437`, `defer tx.Rollback(ctx)` `:441`, `tx.Commit` `:468`).
- Insert text and arguments: `InsertHistoricalFundamentals` — `:732-756` (statement `:740-746`,
  `ON CONFLICT … DO NOTHING` on `:746`); `extra_metrics` is bound as a string for `::jsonb` — `:747`
  (MARKETDATA-10).
- Per-key read today: `GetHistoricalPriceState` — `:761-779`; JSON decode helper
  `decodeExtraMetrics` — `:558`.
- No statement deletes a `fundamentals_history` row (recon.md § Codebase Map; `grep -n "DELETE FROM
  marketdata.fundamentals_history" internal/repository/*.go` has no hit).
- The pool runs `QueryExecModeExec` when `DB_PGBOUNCER=true` (`internal/repository/pool.go`;
  `docs/patterns/database.md` § Connection pooling): a transaction pins one backend connection, and
  no session feature may be used.
- Pool budget: marketdata is pooled with the default client pool of 2; one short transaction per
  symbol on the existing pool changes nothing in the budget (F-06).

**Lands with**: `Step 7`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:

1. Extract the insert statement (columns and `VALUES`, without the `ON CONFLICT` clause) and its
   argument list into one shared constant and one helper, and make `InsertHistoricalFundamentals`
   use them plus its `ON CONFLICT` suffix, so the statement exists once.
2. Add `ListHistoricalRows(ctx, symbol) ([]source.HistoricalPriceState, error)`: one `SELECT` of
   `fiscal_period`, `period_type`, `period_end`, `filed_date`, the five price columns, `currency`,
   `derivation_version` and `extra_metrics` for the symbol, ordered by (`fiscal_period`,
   `period_type`). No row returns an empty slice and no error.
3. Add `ReplaceHistoricalFundamentals(ctx, symbol, deletes []source.HistoricalPriceState, inserts
   []source.HistoricalFundamentalsPeriod) error` (D-6, D-13):
   - with nothing to delete and nothing to insert, return nil without opening a transaction;
   - one transaction; deletes in sorted (`fiscal_period`, `period_type`) order, each
     `DELETE … WHERE symbol=$1 AND fiscal_period=$2 AND period_type=$3 AND period_end=$4::date AND
     filed_date=$5::date AND derivation_version=$6`, with the two dates bound as `YYYY-MM-DD` text
     (S-9). A delete that does not affect exactly one row is an error;
   - then one plain insert per period with the shared statement (no `ON CONFLICT`);
   - any error returns with the transaction rolled back; commit only after the last insert.
4. No `SET`, advisory lock or other session feature inside the transaction.

**Verification**: runs as one unit with Step 7; see Step 7.

---

### Step 7 — test: pgxmock pins for the list read and the replace

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/repository/marketdata_repo_test.go` — modify

**Reviewers**: xstockstrat-marketdata service owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- pgxmock transaction expectations: `mock.ExpectBegin()`, `ExpectExec`, `ExpectCommit()`,
  `ExpectRollback()` — `internal/repository/marketdata_repo_test.go:788-805`.
- Statement-text and argument pins: `TestUpdateHistoricalPriceJoin` (`:537-562`),
  `TestRederiveHistoricalFundamentals_GuardedUpgrade_feature223` (`:567-600`).
- Row builders `histMockCols`, `histMockRow`, `hfDay` — `:283-300`.
- pgxmock proves text, arguments and control flow only; wire types need a real database
  (`fails.md` 2026-11-04, feature 255). Step 12 is that proof.

**Lands with**: `Step 6`

**TDD**: `red-green required`

**Covers**: `AC-5`

**Instructions**:

1. `ListHistoricalRows`: pin the selected columns, the `WHERE symbol=$1` argument and the order;
   assert label, type, both dates, the price columns, the version and a decoded `extra_metrics` value
   of 66,772,000,000; an empty result is an empty slice with a nil error.
2. `ReplaceHistoricalFundamentals`, the `@AC-5` plan (delete `Q1-2026` with `period_end` 2026-09-07,
   `filed_date` 2025-09-10, version 2; insert `Q1-2026` and `Q1-2027`): `Begin`, the delete with its
   six arguments (dates as `2026-09-07` and `2025-09-10`), two inserts, `Commit`.
3. Two deletes given out of order are executed in sorted key order.
4. A delete reporting 0 rows, and one reporting 2 rows: error, `Rollback`, no insert executed.
5. An insert error: error and `Rollback`.
6. An empty plan: no `Begin`.
7. The shared insert constant does not contain `ON CONFLICT`.
8. Test data (C-13): the literals have one consumer in this file and stay inline.

**Verification** (union for the Steps 6+7 unit; run from the repo root):

```bash
GOWORK=off go -C services/xstockstrat-marketdata test ./internal/repository/... -race -count=1 -run 'ListHistoricalRows|ReplaceHistoricalFundamentals' -v > /tmp/348-step7.log
test "$(grep -c '^--- PASS' /tmp/348-step7.log)" -ge 2   # the new cases ran, not "no tests to run"
GOWORK=off go -C services/xstockstrat-marketdata test ./... -race -count=1
(cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod)
test "$(grep -c "ON CONFLICT (symbol, fiscal_period, period_type) DO NOTHING" services/xstockstrat-marketdata/internal/repository/marketdata_repo.go)" = 1   # until Step 8
```

New logic is in an excluded package (`repository`) — no coverage threshold applies; the pgxmock pins
here and the real-database job of Step 12 are the verification.

---

### Step 8 — service: backfill write path reconciles through the planner

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/marketdata_service.go` — modify
- `services/xstockstrat-marketdata/internal/repository/marketdata_repo.go` — modify
- `services/xstockstrat-marketdata/internal/source/source.go` — modify

**Reviewers**: xstockstrat-marketdata service owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- `histFundamentalsRepo` — `internal/service/marketdata_service.go:181-194`, 10 methods:
  `InsertHistoricalFundamentals` `:182`, `GetHistoricalPriceState` `:189`,
  `UpdateHistoricalPriceJoin` `:190`, `RederiveHistoricalFundamentals` `:192`, `DeleteEdgarSnapshot`
  `:193`.
- `BackfillFundamentals` — `:2289-2336`: gate `:2290`, default `from` from
  `fundamentals.history.backfill.max_lookback_years` `:2305-2308`, `period_types` `:2309-2314`,
  per-symbol call `:2321`, failed symbol handling `:2322-2327`.
- `backfillOneSymbol` — `:2341-2452`: `FetchHistorical(ctx, symbol, from, to, periodTypes)` `:2342`;
  chronological sort `:2347`; dividend fetch `:2351-2370`; deferred snapshot invalidation
  `:2374-2382`; per-period state read `:2388`; new-row path `:2394-2410` (enrichment `:2398-2404`,
  insert `:2405`); stored `filed_date` pin `:2415`; in-place re-derive `:2419-2428`; price-join gate
  `:2431-2434`; derive, merge and write `:2436-2449`.
- `mergePrice` — `:2470-2487`; `priceMergedChanged` — `:2490-2505`; `deriveDividendYield` —
  `:2511-2527`; `accumulateTTM` — `:2532-2552`; `derivePriceMetrics` — `:2558-2592` (close lookup
  `:2559-2566`, ratios `:2567-2591`); `priceJoin` — `:2596-2599`; `recentBarsMinLookback` = 14 days —
  `:481`.
- Snapshot path, unchanged: `edgarResolve` — `:2016-2048` (newest period through
  `LatestHistoricalFundamental` `:2028`); `edgarSnapshotFromPeriod` — `:2078-2101`.
- Read path, unchanged: `GetHistoricalFundamentals` — `:2244-2284`; `filterAsOf` — `:2654-2665`.
- `HistoricalPriceState.Found` is read only at `marketdata_service.go:2394`; it is set at
  `internal/repository/marketdata_repo.go:772`, `:776`.
- Repository methods that lose their last caller: `InsertHistoricalFundamentals` (`marketdata_repo.go:732-756`),
  `GetHistoricalPriceState` (`:761-779`). Kept: `UpdateHistoricalPriceJoin` `:785-794`,
  `RederiveHistoricalFundamentals` `:799-817`, `DeleteEdgarSnapshot` `:821-826`.
- The service does not import `internal/edgar` (`grep -rn 'internal/edgar"' --include="*.go" .` hits
  only `cmd/server/main.go:25`); the EDGAR client is wired at `cmd/server/main.go:139`, `:287-296`.
- Entry points, unchanged: `internal/handler/marketdata_handler.go:142`, `:353`; sole caller
  `services/xstockstrat-ingest/app/handlers/servicer.py:675`.
- **Not found**: a clock seam on `MarketDataService` (`time.Now()` is called directly at `:2307`,
  `:2358-2359`). None is added (S-8).

**Lands with**: `Step 9`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:

1. **Interface (design.md § 3).** In `histFundamentalsRepo` replace `InsertHistoricalFundamentals`
   and `GetHistoricalPriceState` with `ListHistoricalRows` and `ReplaceHistoricalFundamentals`
   (Step 6). The interface stays at 10 methods. Delete the two replaced methods from
   `marketdata_repo.go` together with the `ON CONFLICT` suffix that only the removed insert used, and
   remove `Found` from `source.HistoricalPriceState` (its only reader goes away below).
2. **Fetch and plan.** In `backfillOneSymbol`:
   - fetch the full history: `FetchHistorical(ctx, symbol, time.Time{}, time.Time{}, nil)`;
   - keep the chronological sort (`:2347`) and the dividend fetch (`:2351-2370`) as they are;
   - read the stored rows once with `ListHistoricalRows`; an error fails the symbol;
   - run the planner with the request's period types and `from`/`to`. A guard error is returned as
     the symbol's error, so `BackfillFundamentals` reports it in `failed_symbols` (`:2322-2327`) and
     nothing is written.
3. **TTM EPS.** Run `accumulateTTM` once over the full chronological fresh set and keep each period's
   TTM value for the paths below.
4. **Inserted rows (D-15).** For each planned insert, before any transaction (where a stored
   row supplies `price` or `dividend_yield`, it is a stored row of the same period type and
   `filed_date`; with several, the first in `period_end` order — every such row holds the same
   bar date, D-15):
   - split `derivePriceMetrics` into the close lookup (`:2559-2566`) and the ratio half
     (`:2567-2591`); `derivePriceMetrics` keeps its behaviour by calling both, so the in-place path
     and `priceJoin` are unchanged;
   - look up the close at the row's own `filed_date` and derive the dividend yield with
     `deriveDividendYield`;
   - when a stored row has the same `filed_date`, merge `price` and `dividend_yield` with the
     `mergePrice` rule (stored-or-derived by default, derived-or-stored under `overwrite`). Take only
     those two columns from the merge; nothing is carried from a row with another `filed_date`;
   - compute `market_cap`, `pe_ratio` and `pb_ratio` with the ratio half from the resulting price, the
     row's own statement and the row's own currency. No price leaves all three unset;
   - keep the ratio enrichment of a new row as today (`:2398-2404`).
5. **Replace (D-6, D-13, S-10).** When the plan has a delete or an insert, call
   `ReplaceHistoricalFundamentals` once. An error is returned as the symbol's error, and no in-place
   update is made for that symbol in that run.
6. **Log (D-24).** After the replace commits, log one INFO record per row deleted without
   replacement: symbol, label, period type, `period_end`, `filed_date`, category.
7. **Identical rows.** Apply today's in-place path (`:2412-2449`) to each identical pair of the plan,
   with the stored row taken from the list read: the `filed_date` pin, the version-gated
   `RederiveHistoricalFundamentals`, the price-join gate, `mergePrice`, `priceMergedChanged`,
   `UpdateHistoricalPriceJoin`. Do not change any of these functions (R-14).
8. **Snapshot.** The deferred `DeleteEdgarSnapshot` (`:2374-2382`) also runs when a replace
   committed.
9. `periods_written` counts inserted rows plus in-place changes (S-10).
10. Do not add a config read, a clock field, a new RPC, or a new log line other than the INFO of
    item 6. `fundamentals.history.backfill.max_lookback_years` stays read at `:2306` (D-17, F-07).
    No new outbound gRPC call (§B header propagation not triggered). Trading-domain constraints
    (§A): not applicable.

**Verification**: runs as one unit with Step 9; see Step 9.

---

### Step 9 — test: backfill reconcile tests, migrated fakes, read and snapshot cases

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/marketdata_service_test.go` — modify
- `services/xstockstrat-marketdata/internal/repository/marketdata_repo_test.go` — modify

**Reviewers**: xstockstrat-marketdata service owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- The three fakes that implement `histFundamentalsRepo`, in
  `internal/service/marketdata_service_test.go`: `fakeHistRepo` `:2335-2402` (plus `:3278-3281`),
  `fakeHistRepo211` `:2576-2609` (plus `:3282-3285`), stateful `fakeHistRepo216` `:2938-3008` (plus
  `:3289-3301`; `stateKey` `:2956`; `backfill216Cfg` `:3010-3016`; `onePeriod216` `:3018-3025`).
- `fakeHistSource` ignores range and types — `:2404-2419`.
- Tests on the old insert path: `TestBackfillFundamentals_CapDegrade_AC5` `:2513-2572`
  (`repo.inserted`), the four dividend tests `:2709-2768` (`dividendYieldSvc` `:2684-2705`).
- Tests on the in-place path: feature 216 `:3028-3215`, feature 223 `:3315-3353` (`axpQ2Period`
  `:3303-3310`). Their stored states carry no label, type, `period_end` or reported value today.
- Read and snapshot helpers: `TestGetHistoricalFundamentals_TPlus1_AC3` `:2433`, `edgarSnapshotSvc`
  `:2776-2795`, `hfDate` `:2430`, `f64p` `:44`.
- Log and metric helpers: `installWarmLogRecorder` `:5034`, `serviceMetricReader` `:5200`,
  `backfillSymbolCounts` `:5214`.
- Repository test of a method Step 8 removes: `TestGetHistoricalPriceState` —
  `internal/repository/marketdata_repo_test.go:474-531`.
- Wall-clock traps: the default `from` is now minus `max_lookback_years` (`marketdata_service.go:2305-2308`)
  and the planner applies it, so a migrated test with fixed dates would start failing once its dates
  fall outside ten years; the dividend coverage guard is relative to now (`:2516`). Rule:
  `fails.md` 2026-10-14 (feature 216).

**Lands with**: `Step 8`

**TDD**: `red-green required`

**Covers**: `AC-4, AC-5, AC-6, AC-8, AC-9, AC-11`

**Instructions**:

1. **Fakes.** Give all three fakes `ListHistoricalRows` and `ReplaceHistoricalFundamentals` and
   remove the two old methods. `fakeHistRepo216` lists its store for the symbol and applies a replace
   as the SQL does: a pinned delete that does not match exactly one stored row returns an error and
   changes nothing. It records every replace call. `fakeHistRepo` records inserted periods from the
   replace so the existing `repo.inserted` assertions keep their meaning.
2. **Migrated tests (debate.md O-21).** For every feature 216 and 223 test, give the stored state
   the same label, type, `period_end` and `filed_date` as the fake source's period, and one equal
   reported value on both sides (`net_income`, which the price-join does not read). Assert that no
   replace was called. Keep every existing assertion. In each migrated config set
   `fundamentals.history.backfill.max_lookback_years` to 100 so no result depends on today's date.
3. **New tests** (ORCL literals from context.md § Root cause; version 3 on the fresh side):
   - `@AC-5`: stored collided `Q1-2026` (filed 2025-09-10, `period_end` 2026-09-07, version 2, equity
     66,772,000,000, net income 4,760,000,000). After the backfill the store holds `Q1-2026`
     (2025-08-31, 2025-09-10, 24,154,000,000) and `Q1-2027` (2026-08-31, 2026-09-11,
     66,772,000,000), both at version 3, and no row with `period_end` 2026-09-07.
   - `@AC-6`: the same run invalidates the EDGAR snapshot once for `ORCL` although nothing was
     re-derived in place; and `GetFundamentals` under `snapshot_source=edgar` with the newest stored
     period (`edgarSnapshotSvc`) is built from the 2026-08-31 period with `as_of` 2026-09-11.
   - `@AC-8`: the collided row with the request range 2016-01-01..2026-06-30 stores both periods; a
     second run on the repaired store with range 2026-01-01..2026-06-30 calls no replace and changes
     nothing.
   - `@AC-9`: a filer mismatch puts `ORCL` in `failed_symbols`, calls no replace, no update and no
     re-derive, and counts `fundamentals/failed` once in `marketdata.backfill.symbols`.
   - `@AC-11`: (i) the replacement filed 2025-09-10 keeps the stored price 310.25 and yield 0.0065,
     and its `market_cap` and `pb_ratio` equal price × shares and that over 24,154,000,000, not the
     stored 13.1; (ii) the replacement filed 2026-09-11 takes the fake's close and carries nothing;
     (iii) with no close, `price`, `market_cap`, `pe_ratio` and `pb_ratio` are nil; (iv) with
     `dividends.backfill_lookback_years` 1 the yield of a row with no stored value is nil, and with
     50 it is computed (S-8); (v) with no shares in the statement, `market_cap` and `pb_ratio` are nil
     while `price` is set; (vi) a stored USD row replaced by a fresh CNY period gets no `pe_ratio`.
   - D-24: one INFO record per row deleted without replacement, with its category, after a committed
     replace; none when the replace fails.
   - S-10: when the replace fails, the symbol is in `failed_symbols` and no in-place update ran.
   - TTM EPS: an inserted quarterly row's `pe_ratio` uses the four quarters ending at it, including
     quarters that were identical and not inserted.
   - `@AC-4`, read boundary: with the two corrected ORCL periods stored, the read as of 2025-10-01
     returns the 2025-08-31 period and none filed on or after 2025-10-01; as of 2025-09-10 it is
     not returned; as of 2025-09-11 it is. This case passes on the pre-Step-8 tree (the read path is
     unchanged): record it as "red N/A — characterization" per `tdd-gate.md`; the RED for `@AC-4`
     is Step 3's.
4. **Repository test.** Delete `TestGetHistoricalPriceState` (`marketdata_repo_test.go:470-531`); its
   projection is pinned by Step 7's list-read test.
5. Do not weaken an existing assertion to get green. An existing test that cannot stay green without
   a weaker assertion is a deviation: stop and record it (`fails.md` 2026-10-14, feature 216).
6. Test data (C-13): the ORCL literals are used by this file only; put them in one helper beside
   `axpQ2Period`. Nothing moves to `internal/testdata/`.

**Verification** (union for the Steps 8+9 unit; run from the repo root):

```bash
GOWORK=off go -C services/xstockstrat-marketdata test ./internal/service/... -race -count=1 -run 'BackfillFundamentals|GetHistoricalFundamentals|EdgarSnapshot|PriceJoin' -v > /tmp/348-step9.log
test "$(grep -c 'feature348' /tmp/348-step9.log)" -ge 1   # the new cases ran
test "$(grep -c '^--- SKIP' /tmp/348-step9.log)" -eq 0
GOWORK=off go -C services/xstockstrat-marketdata test ./... -race -count=1   # all packages, cmd included
COVERPKGS=$(GOWORK=off go -C services/xstockstrat-marketdata list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//')
GOWORK=off go -C services/xstockstrat-marketdata test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}"
GOWORK=off go -C services/xstockstrat-marketdata tool cover -func=coverage.out | awk '/^total:/ { sub("%","",$3); print "total " $3; if ($3 + 0 < 40) exit 1 }'
(cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod)
test "$(grep -rn "InsertHistoricalFundamentals\|GetHistoricalPriceState" services/xstockstrat-marketdata/internal services/xstockstrat-marketdata/cmd --include="*.go" | wc -l)" -eq 0
test "$(grep -rn "state\.Found\|HistoricalPriceState{Found" services/xstockstrat-marketdata/internal --include="*.go" | wc -l)" -eq 0
test "$(grep -c "ON CONFLICT (symbol, fiscal_period, period_type)" services/xstockstrat-marketdata/internal/repository/marketdata_repo.go)" = 0
test "$(grep -c "fundamentals.history.backfill.max_lookback_years" services/xstockstrat-marketdata/internal/service/marketdata_service.go)" -ge 1   # still read (D-17)
node scripts/check-config-wiring.mjs
```

New logic is in an excluded package (`service`) — no coverage threshold applies to it; the service
tests above are the verification. The threshold command still runs for the rest of the module.

---

### Step 10 — service: no-write audit (`internal/fundaudit`, `cmd/fundamentals-audit`)

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/fundaudit/audit.go` — create
- `services/xstockstrat-marketdata/cmd/fundamentals-audit/main.go` — create

**Reviewers**: xstockstrat-marketdata service owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- **Not found**: `internal/fundaudit/` and `cmd/fundamentals-audit/` (`ls cmd` lists only `server`).
  Both are created here. The image builds only `./cmd/server` (`Dockerfile:7`), so the command is not
  shipped; `cmd` is excluded from coverage and `internal/fundaudit` is counted
  (`.github/workflows/ci.yml:374`).
- Stored rows as the MCP returns them: `query_fundamentals` in historical mode returns
  `{"periods": [...], "next_page_token": ...}` with each period a
  `MessageToDict(p, preserving_proto_field_name=True)` of `HistoricalFundamentalsPeriod`
  (`services/xstockstrat-agent/app/client.py:2047-2050`; `services/xstockstrat-agent/app/tools.py:504-536`,
  page size capped at 50, `:511`). Fields: `packages/proto/marketdata/v1/marketdata.proto:269-292`.
  A metric the row does not hold is named in `missing_metrics` and serialised as 0 or omitted
  (`internal/service/marketdata_service.go:2611-2650`).
- The proto carries no derivation version (`marketdata.proto:269-292`), so the lane's stored version
  is a parameter (D-25): lane A 2, lane B 1 (design.md § 6).
- EDGAR client construction outside the service: `edgar.NewClient(baseURL, userAgent, rateLimitRPS)` —
  `internal/edgar/edgar_client.go:50-53`; the service's own values come from config
  (`cmd/server/main.go:287-296`), which the command cannot read.
- The planner and `DeriveHistorical` come from Steps 4 and 2 (C-18: one planner for the service and
  the audit).

**Lands with**: `Step 11`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:

1. **`internal/fundaudit`** (logic only; the SEC fetch is behind a one-method interface so tests need
   no network):
   - parse a lane rows file (S-11) into stored rows per symbol: dates from the RFC 3339 strings, a
     price-join column named in `missing_metrics` is nil, `extra_metrics` copied, the version from
     the parameter;
   - plan one symbol: derive through the interface, run the planner with both period types and an
     open range, and report the guard result, the identical, delete and insert counts, the
     deleted-without-replacement list by category, the left-out periods by reason, the single-metric
     anchor count and the number of derived periods with `period_end` after `filed_date`. A derive
     error is reported for that symbol and does not stop the lane;
   - lane totals over the stored rows: the count with `period_end` after `filed_date`, and the count
     of (symbol, period type, `period_end`) groups with more than one row;
   - post-repair verdict (`@AC-7`): pass only when both totals are 0 and no symbol outside the given
     failed list plans a delete or an insert;
   - pre/post diff: per price-join column, the number of rows that went from a value to nil, matched
     on (symbol, `period_type`, `filed_date`); ambiguous keys and pre rows with no post row are
     counted separately (S-11).
2. **`cmd/fundamentals-audit`** (thin): two modes. `plan` takes the rows file, the stored version,
   and the SEC `User-Agent` and rate as required flags (no default is hardcoded, F-07), an optional
   base URL, and for the post-repair run a flag carrying the failed symbols; it prints the report as
   JSON and exits non-zero only when the post-repair verdict fails or the input cannot be read.
   `diff` takes a pre and a post rows file and prints the counts. The command opens no database
   connection and calls no service.
3. The command's left-out and anchor figures come from `DeriveHistorical`, so it adds nothing to
   `marketdata.backfill.periods_left_out` (S-1).

**Verification**: runs as one unit with Step 11; see Step 11.

---

### Step 11 — test: audit parsing, per-symbol report, pass conditions, pre/post diff

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/fundaudit/audit_test.go` — create

**Reviewers**: xstockstrat-marketdata service owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- The collided row as staging stores it (product-spec.md § Problem Statement): `ORCL`, `Q1-2026`,
  `filed_date` 2025-09-10, `period_end` 2026-09-07, net income 4,760M, equity 66,772M.
- Row shape: as in Step 10 (snake_case keys, RFC 3339 timestamps, `missing_metrics`).
- debate.md O-23: the input parser needs a test against a real row; D-25 moved the input from a CSV
  export to MCP rows.

**Lands with**: `Step 10`

**TDD**: `red-green required`

**Covers**: `AC-7, AC-11`

**Instructions**:

1. Parsing: one ORCL period in the `query_fundamentals` shape with the values above, with `pe_ratio`
   named in `missing_metrics` and a zero-valued key omitted. Assert the dates, the nil `pe_ratio`, a
   0 for the omitted non-missing column, the reported values and the version parameter. A malformed
   date is an error naming the symbol.
2. Per-symbol report with a stub deriver returning the two corrected ORCL periods: one delete, two
   inserts, and NO deleted-without-replacement entry (the collided row is replaced by the fresh
   period with its `filed_date`, S-3/S-4); a second stored annual row whose `filed_date` no fresh
   annual period has is listed under `no_period_derived`; a stub returning another filer's values
   reports the guard; a stub error is reported and the next symbol is still planned.
3. `@AC-7`: the post-repair verdict fails with one stored row whose `period_end` is after its
   `filed_date`; fails with two rows of one symbol and type on one `period_end`; fails when a symbol
   outside the failed list plans a change; passes when a symbol inside the failed list plans a
   change and everything else is clean.
4. `@AC-11`, diff: a pre row with a `pb_ratio` and a post row with the same (symbol, type,
   `filed_date`) and none counts 1 under `pb_ratio`; value to value counts nothing; an ambiguous key
   and an unmatched pre row are counted in their own fields.
5. Test data (C-13): the literals have one consumer and stay inline.

**Verification** (union for the Steps 10+11 unit; run from the repo root):

```bash
GOWORK=off go -C services/xstockstrat-marketdata test ./internal/fundaudit/... -race -count=1 -cover
GOWORK=off go -C services/xstockstrat-marketdata build -o /dev/null ./cmd/fundamentals-audit
GOWORK=off go -C services/xstockstrat-marketdata test ./... -race -count=1
COVERPKGS=$(GOWORK=off go -C services/xstockstrat-marketdata list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//')
GOWORK=off go -C services/xstockstrat-marketdata test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}"
GOWORK=off go -C services/xstockstrat-marketdata tool cover -func=coverage.out | awk '/^total:/ { sub("%","",$3); print "total " $3; if ($3 + 0 < 40) exit 1 }'
(cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod)
test "$(grep -c "cmd/server" services/xstockstrat-marketdata/Dockerfile)" -ge 1
test "$(grep -c "fundamentals-audit" services/xstockstrat-marketdata/Dockerfile)" = 0   # the image still builds only ./cmd/server
```

---

### Step 12 — test: replace SQL against a real database (`dbtest` tag) and CI job `marketdata-db-test`

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/repository/fundamentals_replace_dbtest_test.go` — create
- `.github/workflows/ci.yml` — modify
- `docs/patterns/ci-overview.md` — modify

**Reviewers**: xstockstrat-marketdata service owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- Job to model on: `portfolio-db-test` — `.github/workflows/ci.yml:1016-1065` (TimescaleDB service
  `:1027-1040`, migrator image and apply `:1049-1057`, `go test -tags dbtest` with a URL env and
  `CI: "true"` `:1059-1065`).
- Gate job: `ci-gate` `needs` list — `:1307-1334`; per-job echo lines — `:1339-1365`.
- Path filters: `xstockstrat-marketdata` — `:56`; `migrations` — `:88-97`; `proto`, `go-shared`, `ci`
  — `:43-50`.
- Fail-closed helper pattern: `testPool` fatals when the URL is unset under `CI=true` and skips
  otherwise — `services/xstockstrat-portfolio/internal/repository/dbtest_helpers_test.go:22-31`.
- The existing marketdata live-database test is gated only on `DATABASE_URL` and skips in CI
  (`internal/repository/fundamentals_livedb_test.go:15-19`); `fails.md` 2026-11-04 (feature 255)
  records why a skip is not evidence. It is not touched here.
- Exec mode is switched on by `DB_PGBOUNCER` (`fundamentals_livedb_test.go:20` sets it before
  `NewMarketDataRepo`).
- Docs row to mirror: `docs/patterns/ci-overview.md:27` (`portfolio-db-test`).
- **Not found**: a `dbtest`-tagged file or a database CI job for marketdata
  (`grep -rln "go:build dbtest" services/` lists only portfolio files).

**TDD**: `red-green required` — red N/A is expected: the SQL shipped in Steps 6+7; this step is its
characterization on a real database. State that in the PR body and context.md (`tdd-gate.md`).

**Covers**: `AC-5, AC-7`

**Instructions**:

1. **Test file** (`//go:build dbtest`, package `repository`). Read `MARKETDATA_DB_TEST_URL`; unset
   under `CI=true` is a fatal error, unset otherwise is a skip. Set `DB_PGBOUNCER=true` before
   `NewMarketDataRepo`. Use a reserved symbol prefix and delete its rows in cleanup. Cases:
   - `@AC-5`: seed the collided ORCL-shaped row (version 2) under the reserved symbol; replace it
     with the two corrected periods; read back through `ListHistoricalRows`: two rows, their labels,
     dates, version 3, and `extra_metrics` values equal to what was written (66,772,000,000 exactly);
   - a pinned delete with a wrong version, and one with a wrong `period_end`: error, and the table is
     unchanged;
   - an insert whose key is already stored and not deleted in the same plan: error, and the planned
     delete is rolled back;
   - sequential second replace (D-13): the same plan run a second time misses its pinned delete,
     returns an error and changes nothing;
   - `@AC-7`: the documented count `SELECT count(*) FROM marketdata.fundamentals_history WHERE
     period_end > filed_date` restricted to the reserved symbol is 1 before the replace and 0 after;
     the duplicate query (`GROUP BY symbol, period_type, period_end HAVING count(*) > 1`) returns no
     row after it.
2. **CI job** `marketdata-db-test` in `.github/workflows/ci.yml`, a copy of `portfolio-db-test` with
   the marketdata service, the `xstockstrat-marketdata` path filter and
   `MARKETDATA_DB_TEST_URL`; `run: go test -tags dbtest -race -count=1 ./internal/repository/...`.
   Add it to `ci-gate`'s `needs` and to its echo list.
3. **Docs.** Add a `marketdata-db-test` row to `docs/patterns/ci-overview.md` after the
   `portfolio-db-test` row.
4. `MARKETDATA_DB_TEST_URL` is a CI-only test DSN, not an inter-service connection variable; nothing
   is added to `docker-compose.yml`, `.do/app.dev.yaml` or `.do/app.yaml`.
5. Never start a database in the execute session. The proof is the CI job on the step's PR: record
   the job URL and its executed (not skipped) test count in context.md after the push.

**Verification** (run from the repo root):

```bash
GOWORK=off go -C services/xstockstrat-marketdata vet -tags dbtest ./internal/repository/...
GOWORK=off go -C services/xstockstrat-marketdata test -tags dbtest ./internal/repository/... -count=1 -run 'Replace' -v > /tmp/348-step12.log
test "$(grep -c '^--- SKIP' /tmp/348-step12.log)" -ge 1   # the dbtest cases exist and skip locally (no URL)
! CI=true GOWORK=off go -C services/xstockstrat-marketdata test -tags dbtest ./internal/repository/... -count=1 -run 'Replace'   # fails closed without the URL
GOWORK=off go -C services/xstockstrat-marketdata test ./... -race -count=1   # untagged run unaffected
test "$(grep -c 'marketdata-db-test' .github/workflows/ci.yml)" -ge 3   # job, ci-gate needs, echo line
test "$(grep -c "MARKETDATA_DB_TEST_URL" .github/workflows/ci.yml)" -ge 1
test "$(grep -c "MARKETDATA_DB_TEST_URL" services/xstockstrat-marketdata/internal/repository/fundamentals_replace_dbtest_test.go)" -ge 1
test "$(grep -c "marketdata-db-test" docs/patterns/ci-overview.md)" -ge 1
# after the push: the PR's "Marketdata DB test" job is green and its log shows the cases ran (no SKIP) — recorded in context.md
```

New logic is in an excluded package (`repository`) — no coverage threshold applies; integration test
verification is sufficient.

---

### Step 13 — docs: signed CHANGE to feature 216 `@AC-5` and two prose notes in the durable suites

**Status**: `pending`
**Service**: `services/xstockstrat-marketdata/acceptance/`
**Files**:
- `services/xstockstrat-marketdata/acceptance/fix-historical-fundamentals-price-join.feature` — modify
- `services/xstockstrat-marketdata/acceptance/fix-stored-edgar-periods.feature` — modify

**Reviewers**: none

**Codebase Evidence**:
- The signed CHANGE: design.md § Business Rules Touched, first bullet; context.md, operator answer 2
  (2026-11-16), which fixes the added line's text.
- Target scenario: `@AC-5 @regression @feature-216` —
  `acceptance/fix-historical-fundamentals-price-join.feature:54-60`; its two givens are lines 56-57
  and `When` is line 58.
- 216 sign-off header — `fix-historical-fundamentals-price-join.feature:6-10`.
- 223 feature description — `acceptance/fix-stored-edgar-periods.feature:6-8`.
- Promotion of this feature's own `@AC-*` (including the EXTEND of `@AC-2 @feature-223` through
  `@AC-6`, and `@AC-11`) is done at integration by `/sdd-execute` through `scenario-promoter`
  (`docs/sdd/business-rules/CLAUDE.md` § Lifecycle of a scenario). It is not done in this step.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:

1. In `fix-historical-fundamentals-price-join.feature` insert after line 57, with the same
   indentation, exactly:
   `And the current EDGAR derivation reproduces that period's fiscal_period, period_type, period_end and filed_date`
   Change nothing else in the scenario.
2. In the same file extend the header comment after line 10 with a note that `@AC-3`, `@AC-4` and
   `@AC-5` are about rows the current EDGAR derivation reproduces, and that a row it does not
   reproduce is replaced by the fundamentals backfill (feature 348 `@AC-5`, `@AC-11`).
3. In `fix-stored-edgar-periods.feature` add one sentence to the feature description (after line 8):
   since feature 348 a stored period the current derivation no longer reproduces is replaced, not
   upgraded in place.
4. Edit no other scenario and add none (C-16: a rule enters only by promotion).

**Verification**:

```bash
A=services/xstockstrat-marketdata/acceptance
test "$(grep -c "    And the current EDGAR derivation reproduces that period's fiscal_period, period_type, period_end and filed_date" $A/fix-historical-fundamentals-price-join.feature)" = 1
test "$(grep -c '^  Scenario' $A/fix-historical-fundamentals-price-join.feature)" = 5
test "$(grep -c '^  Scenario' $A/fix-stored-edgar-periods.feature)" = 2
test "$(grep -c "348" $A/fix-historical-fundamentals-price-join.feature)" -ge 1
test "$(grep -c "348" $A/fix-stored-edgar-periods.feature)" -ge 1
test "$(git diff --name-only HEAD -- services/xstockstrat-marketdata/acceptance | wc -l)" -eq 2
```

---

### Step 14 — docs: derivation and reconcile docs, MARKETDATA-13, findings, observability, runbook procedure

**Status**: `pending`
**Service**: `xstockstrat-marketdata` docs, `docs/runbooks/`
**Files**:
- `services/xstockstrat-marketdata/docs/fundamentals.md` — modify
- `services/xstockstrat-marketdata/docs/context-constitution.md` — modify
- `services/xstockstrat-marketdata/docs/context-constitution-findings.md` — modify
- `services/xstockstrat-marketdata/CLAUDE.md` — modify
- `docs/runbooks/historical-backfill.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `docs/fundamentals.md`: "Derivation versioning (feature 223)" says stored rows are "upgraded in
  place"; "EDGAR period ratio bases" says the filing's fy/fp are not used for flows; "EDGAR
  own-period selection (derivation version 2, feature 340)" describes a bucket as "fiscal year +
  fiscal period" and says `shares` is not anchor-selected (the last three paragraphs of the file).
- MARKETDATA-13 — `docs/context-constitution.md:27`: "rows are pinned to their earliest filing
  (`ON CONFLICT DO NOTHING`)".
- Findings resolved by this feature — `docs/context-constitution-findings.md:29` (EDGAR `shares`
  first-seen, D-12) and `:30` (stored `period_end` can be a cover-page date, D-3). `:31` (stale
  `pe_ratio`/`pb_ratio` after a re-derive) stays open for rows upgraded in place and cites
  `#mergePrice (~L2449)`, now `:2470`. The file has a `## Resolved` section (`:50`).
- `CLAUDE.md` § Observability lists `marketdata.backfill.symbols{kind, outcome}` (`:152`).
- Runbook: "Re-deriving stored periods after a period-builder change (feature 223)" —
  `docs/runbooks/historical-backfill.md:148-167`, which says a re-run rewrites only statement-derived
  columns and leaves `filed_date` untouched.
- The lane procedure to document: design.md § 6 (lanes A and B, steps 1-10, pass conditions,
  restore). Read-path commands per lane and the query-file convention: feature 340 `design.md`
  § Step 5 (`docs/roadmap/features/340-fix-fundamentals-roe-unit/design.md`), which cites
  `docs/runbooks/operator-db-access.md`.
- Doc gates: `scripts/check-context-map.py` (CI job `context-map`), `scripts/check-otel-produced-signals.py`
  (job `otel-signals`), markdownlint on `**/CLAUDE.md` (job `markdown-lint`).
- macOS rule for runbook commands: root `CLAUDE.md` § Language Versions & Tooling.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:

1. `docs/fundamentals.md`: rewrite the three paragraphs named above for version 3. State: a period
   is one filing's own period (accession, form class, own end); the label rule and its format; the
   two left-out reasons and where they are visible; the shares rule; that a backfill reconciles a
   symbol's stored rows (identical rows upgraded in place, all others replaced in one transaction,
   guards fail the symbol); and that any change to the period builder still needs a version bump and
   a golden entry. Remove the sentence pointing to the findings log for `shares`.
2. `docs/context-constitution.md` MARKETDATA-13: restate the invariant for the reconcile: rows are
   written only by the fundamentals backfill; a builder change reaches stored rows through the
   version bump and a backfill; a row the derivation reproduces is upgraded in place and any other
   row of a requested type is replaced by `ReplaceHistoricalFundamentals` with pinned deletes; never
   add another writer or an `ON CONFLICT` insert. Update the evidence cell to the current symbols.
3. `docs/context-constitution-findings.md`: move the rows at `:29` and `:30` to `## Resolved` in that
   section's format, naming feature 348; re-stamp the line hints of `:31`.
4. `CLAUDE.md` § Observability: add `marketdata.backfill.periods_left_out{reason
   label_collision|year_end_quarter}` to the instruments sentence, and one line for the INFO record
   of a row deleted without replacement. Add nothing else to the file.
5. `docs/runbooks/historical-backfill.md`: replace the feature-223 subsection (`:148-167`) with the
   reconcile semantics and the operator procedure of design.md § 6, both lanes, in one pass each:
   freeze flag, full-row export and the recorded figures, the symbol list (S-12, with
   `SELECT count(DISTINCT symbol) FROM marketdata.fundamentals_history;` as the operator's check),
   the audit command (`go run ./cmd/fundamentals-audit plan …` and `diff …`, run from
   `services/xstockstrat-marketdata` at a pinned commit), the canary and its served values, chunks of
   at most 50, the pass conditions with their three read-only queries verbatim, the end state of the
   flag per lane, and the restore. Say that the audit cannot predict empty price columns, that
   `overwrite=true` also refreshes identical rows' prices (D-22), and that a guard-failed symbol
   keeps its rows. Commands must work on macOS (`brew`, BSD-compatible flags, `python3 -m pip`).
6. Comments in code are not touched by this step.

**Verification** (run from the repo root):

```bash
python3 scripts/check-context-map.py
python3 scripts/check-otel-produced-signals.py
npx --yes markdownlint-cli2 --config .markdownlint.yaml services/xstockstrat-marketdata/CLAUDE.md
test "$(grep -c "periods_left_out" services/xstockstrat-marketdata/CLAUDE.md)" -ge 1
test "$(grep -c "period_end > filed_date" docs/runbooks/historical-backfill.md)" -ge 1
test "$(grep -c "fundamentals-audit" docs/runbooks/historical-backfill.md)" -ge 1
test "$(grep -c "DerivationVersion.*3\|version 3" services/xstockstrat-marketdata/docs/fundamentals.md)" -ge 1
# read by eye and recorded in context.md: no line of the three docs presents ON CONFLICT DO NOTHING, first-seen shares or a cover-page period_end as current behaviour
```

---

### Step 15 — docs: operator gate — freeze lane A and record the pre-enable audit

**Status**: `pending`
**Service**: `docs/roadmap/features/348-fix-edgar-historical-fundamentals/`
**Files**:
- `docs/roadmap/features/348-fix-edgar-historical-fundamentals/audit-lane-a-homelab.md` — create
- `docs/roadmap/features/348-fix-edgar-historical-fundamentals/audit-lane-b-do-staging.md` — create

**Reviewers**: none

**Codebase Evidence**:
- Procedure: design.md § 6, lane A steps 1-3 and lane B "Steps 2–3 on lane B's data" (D-16: the
  no-write audit is required before a lane is enabled; D-23: it runs at a pinned commit and is
  re-run if the derivation or planner changes before merge).
- Operator answer 5 (context.md, 2026-11-16) is the standing word for the read-only MCP reads and
  the SEC fetches. It is **not** consent for `set_config`, `trigger_backfill` or any other staging
  change; each needs the operator's word at the time (context.md § Authorization reference).
- Lane MCP servers: `xstockstrat_homelab_staging` (lane A), `xstockstrat_staging` (lane B) —
  feature 340 `design.md` § Step 5 table. Lane A's flag is `true` today and lane B's is `false`
  (design.md § 6).
- Gate key: `fundamentals.history.enabled`, namespace `marketdata`
  (`internal/service/marketdata_service.go:2290`).
- Symbol source (S-12): the MCP tools `list_watchlists` and `get_watchlist`
  (`docs/runbooks/mcp-tools.md`), union over all watchlists. **Not found**: an RPC or tool that
  lists the symbols stored in `marketdata.fundamentals_history`
  (`packages/proto/marketdata/v1/marketdata.proto:38-62` has none).
- Report precedent: `docs/roadmap/features/340-fix-fundamentals-roe-unit/audit-lane-a-homelab.md`.
  Raw rows and exports are never committed (feature 340 design, R-16).

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:

1. Ask the operator before each staging change and each operator-only action; record every answer
   verbatim in context.md with time and lane.
2. **Lane A.**
   - With the operator's word, set `marketdata/fundamentals.history.enabled` to `false` and confirm
     with `get_config` (design step 1). Record the prior value.
   - The operator takes the full-row export and records the version histogram, the count of
     `period_end > filed_date`, the distinct symbol count, and that
     `fundamentals.history.backfill.period_types` reads `both` (design step 2).
   - Build the symbol list (S-12: union of all watchlists) and record its size beside the
     operator's distinct count. Report the difference in counts; the MCP cannot name a stored symbol
     that is in no watchlist, so a non-zero difference is put to the operator, who can name them
     with one read-only query.
   - Read every symbol's stored periods through `query_fundamentals` (`mode="historical"`, all
     pages) into a rows file in the session scratch directory, and run
     `fundamentals-audit plan` with stored version 2 at the feature branch's current commit.
   - Write `audit-lane-a-homelab.md`: the commit, the symbol and row counts, guard trips, the
     deleted-without-replacement list by category (S-3, S-4),
     left-out periods by reason, single-metric anchors, derived periods with `period_end` after
     `filed_date`, and symbols whose derive failed. No raw rows.
   - Stop for the operator's review of the report. Record the answer.
   - Lane A's flag stays `false` from the freeze until the operator enables it after deploy
     (design.md § 6, step 5).
3. **Lane B.** The flag is already `false` and stays so. The operator takes the full-row export
   and records the same figures; the main session then does the same list, read and audit
   with stored version 1 and write `audit-lane-b-do-staging.md`. Lane B's report blocks only lane
   B's enable; if the operator defers it, record the deferral and its condition in context.md and
   say so in the report file.
4. If `internal/edgar/` or `internal/reconcile/` changes after a report was written, re-run that
   lane's audit and replace the report before the integration PR merges.
5. Post-deploy steps 4-10 of design.md § 6 (deploy, enable, canary, chunks, pass conditions,
   restore) are run by the operator from the runbook and are outside this spec.

**Verification**:

```bash
F=docs/roadmap/features/348-fix-edgar-historical-fundamentals
test -f $F/audit-lane-a-homelab.md
test -f $F/audit-lane-b-do-staging.md || grep -q "lane B deferred" $F/context.md
test "$(grep -c "commit" $F/audit-lane-a-homelab.md)" -ge 1
test "$(grep -c "fundamentals.history.enabled" $F/context.md)" -ge 1   # the freeze and the operator's words are recorded
test "$(git diff --cached --name-only | grep -Ev "audit-lane-|context.md|implementation-spec.md|feature.md|status.md" | wc -l)" -eq 0   # no raw rows staged
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
