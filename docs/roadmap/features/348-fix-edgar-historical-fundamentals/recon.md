# Recon: fix-edgar-historical-fundamentals

**Created**: 2026-11-16
**From**: product-spec.md
**Tree**: feature/fix-edgar-historical-fundamentals@9728776 ≡ origin/feature/fix-edgar-historical-fundamentals
**Affected services**: xstockstrat-marketdata (writer); readers reconned for C-14: xstockstrat-analysis, xstockstrat-ingest, xstockstrat-agent, xstockstrat-ui

---

## Objective

EDGAR historical fundamentals periods are bucketed by the filing's `fy`/`fp`, which filers repeat or
mis-set, so two fiscal periods can share one stored row (earlier `filed_date`, later values) and one
period goes missing; `period_end` can also be a cover-page date after the period. The fix derives a
period's identity, `period_end`, `filed_date` and `fiscal_period` label from the period itself, bumps
the derivation version 2 → 3, corrects stored rows (including rows whose label changes), and gives
the operator a repair and audit procedure for both staging lanes.

## Codebase Map

Paths are under `services/xstockstrat-marketdata/` unless they start with `services/`, `docs/` or `packages/`.

- **`xstockstrat-marketdata`** (Go)
  - Derivation: `internal/edgar/edgar_client.go`
    - `unitDatum` carries `Accn`, `FY`, `FP`, `Form`, `Filed`; no `Frame` — `:145-154`
    - `periodAgg` `:220-229`; `candSet` and `add` (best tag rank, then earliest filed) `:239`, `:252`
    - `anchorKeys` (`stockholders_equity`, `assets`, `liabilities`) `:242`; `selectOwnPeriod` `:295-311`
    - `periodKey(fy, fp)` `:370`; bucket fill in `FetchHistorical`: key `:424`, seed `:427`,
      earliest filed `:431-433`, latest end over every fact `:434-436`, shares first-seen `:443-449`,
      facts with empty `fp` or zero `fy` skipped `:403`
    - Range filter on the bucket's `periodEnd` `:461-466`
    - `niFacts` collected before the `fy`/`fp` skip `:398-402`; `trailingNetIncome` keyed by own end
      `:500-558`; `annualizeQuarterlyROE` passes the bucket's `periodEnd` and earliest `filed` `:572`
    - `classifyPeriodType`: `fp == "FY"` is annual; instants are typed from `fp` alone `:586-608`
    - `DerivationVersion = 2` and its bump rule `:610-614`
    - `buildPeriod` label `Qn-YYYY` / `FYYYYY` from `fp`, `fy` `:620`, `:628-630`; dates `:622-623`
  - Repository: `internal/repository/marketdata_repo.go`
    - `InsertHistoricalFundamentals` — `ON CONFLICT (symbol, fiscal_period, period_type) DO NOTHING` `:732-756`
    - `GetHistoricalPriceState` — by triple key; returns `filed_date`, five price columns, currency,
      version; no `period_end` `:761-779`
    - `UpdateHistoricalPriceJoin` — five price columns by triple key `:785-794`
    - `RederiveHistoricalFundamentals` — sets `eps`, `roe`, `debt_to_equity`, `extra_metrics`,
      `derivation_version` where version is lower; never `period_end`, `filed_date`, label, currency `:799-817`
    - `DeleteEdgarSnapshot` — deletes the `marketdata.fundamentals` cache row, `source='edgar'` `:821-826`
    - `QueryHistoricalFundamentals` — `filed_date < asOf`, `period_end` range, cursor and order on
      `(period_end, fiscal_period)` `:831-901`; `parseHistCursor` `:941-951`
    - `LatestHistoricalFundamental` — `ORDER BY period_end DESC, fiscal_period DESC LIMIT 1` `:907-937`
    - No statement deletes a `fundamentals_history` row or changes its label or dates.
    - Transactions exist only for bars and quote retention: `r.pool.Begin` `:80`, `r.db.Begin` `:437`
  - Service: `internal/service/marketdata_service.go`
    - `histFundamentalsRepo` interface (11 methods) `:181-194`
    - `BackfillFundamentals` (gated by `fundamentals.history.enabled`) `:2268-2315`
    - `backfillOneSymbol` `:2320-2431`: new-row path `:2373-2389`; existing-row path pins
      `p.FiledDate = state.FiledDate` `:2394`, re-derive `:2398-2407`, overwrite gate `:2410-2413`,
      snapshot invalidation when anything was re-derived `:2353-2361`
    - `mergePrice` never turns a value into nil `:2449-2466`
    - `GetHistoricalFundamentals` strict `filed_date < as_of` `:2223-2263`; `filterAsOf` `:2633-2644`
    - EDGAR snapshot: `edgarResolve` reads one newest period, no walk-back `:1995-2027`;
      `edgarSnapshotFromPeriod` `:2057`; `hasCoreMetrics` `:1971`
  - Types: `internal/source/source.go` — `HistoricalFundamentalsPeriod` `:85-111`,
    `DerivationOwnedExtraKeys` `:115`, `HistoricalPriceState` `:123-134`,
    `HistoricalFundamentalsSource` `:139-141`
  - Last migration: `009_symbol_classification` (next free `010`). `005_fundamentals_history.up.sql`:
    primary key `(symbol, fiscal_period, period_type)` `:28`, index `(symbol, period_end, filed_date)`
    `:32-33`. `008_...derivation_version.up.sql:4-5`: `derivation_version SMALLINT NOT NULL DEFAULT 0`.
  - Config read: `s.fundCfg.GetBool("fundamentals.history.enabled", false)` `marketdata_service.go:2269`
  - Entry points for the backfill RPC: `internal/handler/marketdata_handler.go:142`, `:353`. No
    scheduled caller in marketdata.
- **`xstockstrat-ingest`** (Python) — sole caller of `BackfillFundamentals`:
  `services/xstockstrat-ingest/app/handlers/servicer.py:669-715`. One call for all symbols; `range`
  and `overwrite` forwarded as given; `periods_written` stored as `bars_processed`. No scheduled trigger.
- **`xstockstrat-analysis`** (Python) — reader. Pager
  `services/xstockstrat-analysis/app/handlers/servicer.py:6672-6707` requires strictly increasing
  `(period_end, fiscal_period)` and loads the whole history with no as-of. As-of selection is by
  `filed_date` only: `services/xstockstrat-analysis/app/services/evaluator.py:78-99`. No label parsing.
- **`xstockstrat-agent`** (Python) — `query_fundamentals` passes periods through
  (`services/xstockstrat-agent/app/client.py:2017-2050`, `app/tools.py:380`, `:391`, `:464-536`);
  `last_refreshed` is the max `filed_date`. No label parsing or sorting.
- **`xstockstrat-ui`** (Next.js) — only `/insights` data explorer reads historical periods
  (`services/xstockstrat-ui/src/app/insights/data-explorer/page.tsx:440-487`,
  `src/hooks/useDataExplorer.ts:96-195`): label shown as an opaque string, chart in returned order.
  The `/trader` Fundamentals card reads the snapshot only (`src/app/trader/positions/[symbol]/page.tsx:1113-1124`).

## Data findings (live SEC companyfacts, fetched 2026-11-16, 14 filers)

Measured by a throwaway prototype outside the repo; payloads are not committed.

- The repeat is in the SEC payload: `fy`/`fp` are copied from each filing's cover page. Repeats per
  filing accession: ORCL 1, CRWD 5, CLSK 6. Details in context.md.
- `fp` is unreliable too. UCTT's three 10-Qs of 2023 (quarters ended 2023-03-31, 06-30, 09-29) all
  carry `fp` Q3. FLXS's 10-Q for 2014-12-31 and SNOW's 10-Q for 2022-04-30 carry `fp` FY, so today
  they produce an "annual" row holding a quarter-end balance sheet.
- Today's code on those payloads gives rows with `period_end > filed_date`: ORCL 1, CRWD 5, CLSK 5,
  FLXS 4, UCTT 4, JAZZ 7 (cover-page share date only), AAPL 0, LYFT 0.
- Prototype rule A — one period per filing: period type from the form (10-K, 10-K/A, 10-KT, 20-F,
  40-F annual; 10-Q, 10-Q/A quarterly), own end = the filing's latest balance-sheet instant date,
  earliest filing wins a shared `(type, end)`. Result on all 14: every period unique, zero
  `period_end > filed_date`.
- Prototype rule B — label from dates only: annual `FY<year of (end − 15 days)>`; quarterly
  `Q<n>-<fiscal year>` where the fiscal year end is the nearest annual end projected by whole years
  and `n = 4 − round(days to that end / 91.31)`. Result on all 14: zero duplicate labels per type;
  no label changes for the calendar-year filers checked (AAPL, LYFT, JAZZ, HSY, CARR, AVGO, JEF);
  changes only where the filer's tag was wrong (ORCL 1, CRWD 10, CLSK 6, FLXS 7, UCTT 3, SNOW 1).
  ORCL's quarter ended 2026-08-31 becomes `Q1-2027`; the one ended 2025-08-31 stays `Q1-2026`.
- Measured during round 1 of the debate (same payloads, the round-1 proposal's exact rules):
  - Every accession has one `form` and one `filed` value across the read tags (0 exceptions in 14 filers).
  - The same `(tag, start, end)` fact appears under several accessions (own filing and later comparatives).
  - JEF changed its year end from December to November: 10-K for 2017-12-31, a `10-KT` filed
    2019-01-29 for the eleven months ended 2018-11-30, then a 10-K for 2019-11-30. With the `10-KT`
    left out of the fiscal-year ends, the quarters ended 2018-03-31, 06-30 and 09-30 and 2019-02-28
    all receive the label `Q1-2019`. Using 2018-11-30 as a fiscal-year end gives Q1, Q2, Q3 of 2018.
  - CRWD's 10-K filed 2021-03-18: balance-sheet anchor 2021-01-31, but no annual-length flow ending
    there among the read flow tags (the latest is 2019-01-31), so "anchor must equal the latest
    matching flow end" does not hold on real data.
  - BMO: 8 annual periods from 40-F; its 22 quarterlies are filed on 6-K.
- Measured during round 2 (round-2 rules: accession grouping, form classes with 6-K quarterly and
  10-KT annual, anchor on or before `filed`, the D-10 label rule):
  - Zero duplicate labels per type on all 14 filers, JEF and BMO included; no label change for the
    calendar-year filers; BMO's 6-K quarterlies keep the labels their tags carried.
  - Filings whose cover-page share count is dated after their own period end: ORCL 69 of 69, AAPL 70
    of 71, JAZZ 62 of 62, AVGO 34 of 34, CLSK 60 of 61, UCTT 60 of 62, JEF 67 of 70, CARR 25 of 27,
    SNOW 23 of 24, FLXS 46 of 61, CRWD 5 of 30, LYFT 5 of 32, HSY 5 of 70, BMO 0 of 31. Today the
    stored `period_end` of those rows is the cover-page date, so most stored rows change
    `period_end` under the fix, not only the 104 collided ones.
- Not covered by the prototype: 6-K filers (BMO files quarterlies on 6-K, annual on 40-F), filers
  with no annual filing in range, fiscal-year-end changes (10-KT), 8-K facts.
- Existing test fixtures use `"accn": "x"` for every fact and set `form` loosely
  (`internal/edgar/derivation_version_test.go:25` gives `10-Q` to every instant), so a rule keyed on
  accession or form changes fixture behaviour.

## Patterns to REUSE

- Per-filing own-period selection → the balance-sheet anchor and `candSet` of feature 340
  (`internal/edgar/edgar_client.go:239-311`); do not add a second selection mechanism.
- Stored-row correction → the `DerivationVersion` gate and the re-derive branch in
  `backfillOneSymbol` (`marketdata_service.go:2398-2407`), with the derivation golden
  (`internal/edgar/derivation_version_test.go:16-53`) gaining a version-3 entry.
- Snapshot cache invalidation after a re-derive → `DeleteEdgarSnapshot` via the existing deferred
  call (`marketdata_service.go:2353-2361`).
- Short transaction under PgBouncer → `Begin`/`Commit` as in `marketdata_repo.go:437`
  (`docs/patterns/database.md:109-158`: a transaction pins one backend connection; no session features).
- Real-filing fixture → `internal/edgar/testdata/lyft_companyfacts.json` (trimmed by tag only) and
  its loader `lyftPeriods` (`internal/edgar/own_period_test.go:16-34`).
- Repository SQL tests → pgxmock text and argument pins (`internal/repository/marketdata_repo_test.go:287-612`).
- Service fakes → `fakeHistRepo` `:2335`, `fakeHistRepo211` `:2576`, `fakeHistRepo216` `:2938` in
  `internal/service/marketdata_service_test.go`; any new interface method must be added to all three.
- Operator repair and audit → feature 340 `design.md` § Step 5 (Q-pre, Q-export, Q-ttm, Q-v1, freeze
  on `fundamentals.history.enabled`, canary then chunks, `trigger_backfill(..., overwrite=true)`),
  and `docs/runbooks/historical-backfill.md:148` (re-deriving stored periods).

## Existing Business Rules (preserve / extend)

Folded from `scenario-recon`. `md` = `services/xstockstrat-marketdata/acceptance`.

- **PRESERVE** `@AC-1 @feature-198` "EDGAR backfill persists point-in-time periods with filing dates" (`md/historical-fundamentals-backtest.feature:10`) — AAPL row for period_end 2019-12-28 with filed_date 2020-01-29; line 15: "backfilling the same range again does not create a duplicate row for that (symbol, fiscal_period, period_type)". CHANGE only if the physical key moves off that tuple.
- **PRESERVE** `@AC-3 @feature-198` "As-of read hides a filing until the trading day after it was filed (T+1)" (`md/historical-fundamentals-backtest.feature:17`) — strict `filed_date < as_of`. The scenario names the period "Q4-2019" (period_end 2019-12-28) while `@AC-1` calls it "fiscal Q1-2020"; the label appears only as a name in Given/Then. CHANGE only if the operator wants the name aligned with the derived label.
- **PRESERVE** `@AC-5 @feature-198` FMP enrichment degrades at the cap (`md/historical-fundamentals-backtest.feature:29`) — the re-derive must not need FMP.
- **PRESERVE** `@AC-1 @feature-216` price-join re-derives after bars exist (`md/fix-historical-fundamentals-price-join.feature:19`).
- **PRESERVE** `@AC-2 @feature-216` a missing bar fails closed, recoverable later (`:28`).
- **PRESERVE / CHANGE-if** `@AC-3 @feature-216` plain re-backfill fills only missing price-join columns (`:35`) — line 43: "every period's as-reported fields and earliest filed_date are left unchanged by the price-join fill". PRESERVE if dates are corrected only by the version-gated re-derive; CHANGE if the plain fill path rewrites them.
- **PRESERVE / CHANGE-if** `@AC-4 @feature-216` `overwrite=true` refreshes the price-join (`:45`) — line 51: "the period's currency, eps, roe, debt_to_equity, and earliest filed_date are left unchanged by the price-join refresh"; line 52: a second run writes nothing. Same condition.
- **PRESERVE (high risk)** `@AC-5 @feature-216` (`:54`) — line 60: "no price-join column for that period transitions from a value to null". A corrected `filed_date` moves the bar lookup and the dividend window; a replaced or re-keyed row must not come back with those columns null where they held a value, unless the operator signs a CHANGE.
- **PRESERVE** C-16 sign-off header of feature 216 (`:6-10`): "As-reported fields and the earliest filed_date are never overwritten" — prose scoped to the price-join paths.
- **PRESERVE** `@AC-1 @feature-223` AXP "Q2-2026" D/E ≈ 1.73 after re-derivation (`md/fix-stored-edgar-periods.feature:10`).
- **EXTEND** `@AC-2 @feature-223` "The EDGAR snapshot reflects the re-derived period" (`md/fix-stored-edgar-periods.feature:17`) — after the version-3 re-derive the newest period can change, so the cached snapshot must not be served.
- **PRESERVE** `@AC-1`, `@AC-3`, `@AC-5 @feature-340` LYFT "Q3-2026" roe 0.942632 and "FY2025" roe 0.868791 (`md/fix-fundamentals-roe-unit.feature:10`, `:29`, `:47`).
- **PRESERVE** `@AC-1`, `@AC-2`, `@AC-3 @feature-222` AXP "Q2-2026" TTM ROE, newest-period snapshot, annual "FY2025" (`md/fix-edgar-quarterly-roe.feature:10`, `:18`, `:24`).
- **PRESERVE** `@AC-1`, `@AC-2`, `@AC-4`, `@AC-5`, `@AC-6`, `@AC-8`, `@AC-9 @feature-211` BABA "FY2026" currency and D/E, P/B and dividend yield anchored at `filed_date`, newest-filing snapshot, data explorer, PIT/snapshot parity (`md/edgar-fundamentals-enrichment.feature:21-85`).
- **PRESERVE** `@AC-1 @feature-253` CRCL "FY2025" annual period (`md/fix-edgar-companyfacts-decode.feature:10`).
- **PRESERVE** `@AC-4 @feature-198` backtest operand T+1 (`services/xstockstrat-analysis/acceptance/historical-fundamentals-backtest.feature:10`); `@AC-12 @feature-215` all pages read (`.../block-fundamentals-strategy-on-etf.feature:104`).
- **PRESERVE** `@AC-8 @feature-198` agent `run_backtest` operand (`services/xstockstrat-agent/acceptance/historical-fundamentals-backtest.feature:9`); agent `query_fundamentals` list, CSV columns, 50-period cap (`.../backfilled-data-queryable.feature:25-67`).
- **PRESERVE** UI data-explorer table, chart, CSV, pagination (`services/xstockstrat-ui/acceptance/backfilled-data-queryable.feature:34-102`).
- **PRESERVE** `@AC-6 @feature-198` fundamentals backfill is a distinct data kind (`services/xstockstrat-ingest/acceptance/historical-fundamentals-backtest.feature:9`).
- `docs/sdd/business-rules/platform.feature`: no scenario on this subject.
- Label-pinned scenarios (AXP `Q2-2026`; LYFT `Q3-2026`, `FY2025`; BABA `FY2026`; CRCL `FY2025`) stay PRESERVE only if the label rule reproduces those labels; all four are filers whose tags agree with their dates.
- Spec wording to correct, not a rule change: product-spec FR-6 says "on or before D"; the existing guarantee is strict `filed_date < as_of`. FR-6 and `@AC-4` of this feature must be restated to the strict rule.

## Dependencies

- Proto/RPC: none expected. `HistoricalFundamentalsPeriod` `fiscal_period = 2`, `period_end = 4`,
  `filed_date = 5` (`packages/proto/marketdata/v1/marketdata.proto:269-292`); the `fiscal_period`
  comment gives examples only.
- Migration: next number `010` for `services/xstockstrat-marketdata/migrations/`, only if the design needs one.
- Config keys: existing `fundamentals.history.enabled` (namespace `marketdata`), operator action only.
- Inter-service edges: ingest → marketdata `BackfillFundamentals`; analysis, agent, UI → marketdata
  `GetHistoricalFundamentals` / `GetFundamentals`. Unchanged.
- New env vars / ports: none.

## Risks / Not-found

- Re-derive today cannot fix a row's `period_end`, `filed_date` or label, and the existing-row path
  re-pins the stored (possibly wrong) `filed_date` before deriving the price-join. Correcting stored
  rows needs a new write path; a pure version bump is not enough.
- A row whose label changes is a new key: the old row stays unless something deletes it. No delete exists.
- A stale delete must be bounded: a backfill fetches only `period_end >= from` (default ten years
  back, or the request's start), so rows older than the fetched range must not be treated as stale.
- Price-join columns are anchored on `filed_date`. Correcting `filed_date` changes price, market cap,
  P/E, P/B and dividend yield for affected rows; if no bar or dividend coverage exists at the corrected
  date the value would become nil (feature 216 `@AC-5`).
- The EDGAR snapshot takes the newest row by `period_end`; today a cover-page date can make an annual
  row outrank a later quarter (JAZZ). Fixing `period_end` changes which period some snapshots serve.
- The analysis pager raises if `(period_end, fiscal_period)` is not strictly increasing across pages;
  two rows with equal `period_end` and equal label cannot exist under the current key, and must not
  under the new one.
- Tests that hard-code version 2 or pin a label: `own_period_test.go:66-69` (`!= 2`), the golden map,
  and the label pins listed in the marketdata digest (context.md keeps the list).
- `internal/edgar/derivation_version_test.go:35` sorts by label and hashes labels and dates, so the
  golden changes with any label or date change.
- Not found: a repo test for `InsertHistoricalFundamentals` or `LatestHistoricalFundamental`; a
  `Frame` field; any scheduled fundamentals backfill; any code that parses the label.
- Not read by the scouts: `docs/context-constitution.md:27`,
  `services/xstockstrat-marketdata/docs/context-constitution-findings.md:29-31` (long lines),
  `docs/runbooks/historical-backfill.md:148+`, `internal/repository/pool.go`. Read before the spec.
- Ledger: `fails.md` 2026-10-07 (198) — a derived-at-write value whose input arrives later needs a
  recovery path and a test; 2026-10-14 (211) — a change touching `cmd/` wiring is verified with
  `go test ./...` across all packages.

## Recommended Scope

Advisory only.

1. Period identity, own `period_end`, per-period `filed_date`, period type and label in
   `FetchHistorical`; `DerivationVersion` 3; golden entry. Paired RED tests on a real ORCL fixture.
2. Stored-row correction in the backfill path: write the corrected dates and label, remove rows the
   derivation no longer produces (bounded to the fetched range), keep the feature-216 guarantees or
   record a signed CHANGE. Paired repository and service tests.
3. Snapshot invalidation for the changed newest period (extend feature 223 `@AC-2`).
4. Docs: `services/xstockstrat-marketdata/docs/fundamentals.md`, the constitution entries that the
   change makes untrue, `docs/runbooks/historical-backfill.md`.
5. Operator repair and audit procedure for both staging lanes, with the new
   `period_end > filed_date` count query.
6. Acceptance restatement (FR-6 strict as-of; labels pinned once the rule is decided) and promotion.
