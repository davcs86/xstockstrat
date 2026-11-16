# Design: fix-edgar-historical-fundamentals

**Created**: 2026-11-16
**Rounds**: 3 (full; termination: approved)
**Approved by**: user @ 2026-11-16 (answers recorded verbatim in context.md)
**Grounded in**: recon.md
**Debate register**: debate.md

---

## Chosen Approach

Paths are under `services/xstockstrat-marketdata/` unless they start with `services/`, `docs/`,
`packages/` or `.github/`. Decision IDs refer to debate.md.

### 1. Derivation (`internal/edgar/edgar_client.go`, `DerivationVersion` 3)

- **Filings (D-1, D-9).** Facts are grouped by accession. An accession has one `filed` date and one
  form class: annual = 10-K, 10-K/A, 10-KT, 10-KT/A, 20-F, 20-F/A, 40-F, 40-F/A; quarterly = 10-Q,
  10-Q/A, 6-K, 6-K/A. Any other form yields no period. An accession whose facts disagree on form
  yields no period and is logged. The filing's `fy`/`fp` are no longer read; the `FY`/`FP` fields of
  `unitDatum` (recon: `edgar_client.go:145-154`), `periodKey` (`:370`), the skip at `:403` and
  `classifyPeriodType` (`:586-608`) go away. Within a filing, flows count only at the class
  duration (80–100 days quarterly, 350–380 annual; constants at `:213-218`).
- **Own end (D-3, D-11).** A filing's own end is its latest balance-sheet anchor (`anchorKeys`,
  `:242`) dated on or before its `filed` date; with no anchor, the latest end of a class-duration
  flow; with neither, no period. The existing `candSet` / `selectOwnPeriod` (`:239-311`) pick the
  values at that date, now per filing instead of per `fy`/`fp` bucket.
- **Shares (D-12).** The share count is the share fact of the filing that supplies the values, with
  the latest end on or before `filed`; `dei` wins on equal dates, the larger value between equal
  tags. A share fact never sets `period_end` (replaces `:434-436`, `:442-449`).
- **Periods (D-1).** Filings merge by (period type, own end). The earliest `filed` supplies values
  and `filed_date`; a same-day tie goes to the smallest accession. A later filing that repeats the
  period as a comparative, or an amendment, never changes it.
- **Labels (D-4, D-10).** Computed over the whole payload before any range or type filter.
  Boundaries B are the own ends of all annual-class filings. Annual: `FY<year(end − 15 days)>`.
  Quarter ending e: reference b = the smallest boundary ≥ e with round((b − e)/91.3125) ≤ 3, else
  the boundary nearest e (tie: earlier), else Dec 31 of year(e) when B is empty;
  r = round((b − e)/91.3125); `Q<4 − (r mod 4)>-<year(b − 15 days) − floor(r/4)>` with floor
  arithmetic. Format unchanged (`Qn-YYYY`, `FYYYYY`).
- **Left-out periods (D-19, D-20).** Two periods of one type with the same label: the
  earlier-ending keeps it, the later is left out (`label_collision`). A quarterly-class period
  whose own end is an actual boundary in B is left out (`year_end_quarter`); a quarter labelled
  through the Dec-31 fallback never is. Each left-out period is logged at WARN and counted by
  `marketdata.backfill.periods_left_out{reason}` (pattern: `internal/telemetry/otel.go:359-371`,
  `:412-414`; allowlist `internal/service/telemetry_allowlist_test.go:28-54`).
- **Corrected dates flow through.** The range and type filters apply after labelling (`:461-466`);
  `annualizeQuarterlyROE` passes the own end and the period's own `filed` to `trailingNetIncome`
  (`:572`), whose formula is unchanged.
- **Entry points (D-21).** One extra method on the EDGAR client, outside
  `source.HistoricalFundamentalsSource` (`internal/source/source.go:139-141`), returns the periods
  with the left-out periods and anchor statistics (filings whose anchor date carries a single
  anchor metric). `FetchHistorical` wraps it and keeps its signature.
- **Version (D-5).** `DerivationVersion = 3` (`:610-614`); the golden map
  (`internal/edgar/derivation_version_test.go:16-19`) gains a version-3 entry.

### 2. Reconcile planner (new internal package, D-13, D-14, D-17, D-18, D-21)

A pure function takes a symbol's stored rows, the full fresh set, the requested period types and
the request range, and returns the plan:

- **Identical**: a stored row equal to a fresh period on (label, type, `period_end`, `filed_date`).
- **Deletes**: every other stored row of a requested type, whatever its `period_end` or version.
- **Inserts**: a fresh period of a requested type with no identical row when (a) its `period_end`
  is within the range, or (b) it shares (type, `period_end`) with a deleted row, or (c) the symbol
  has a deleted row below the current version — then the range does not limit inserts for that
  symbol in that run. `fundamentals.history.backfill.max_lookback_years` is still read
  (`internal/service/marketdata_service.go:2284-2287`).
- **Guards** (fail the symbol, no write): stored rows exist and the fresh set is empty; stored
  rows of a requested type exist and the fresh set has none of that type; no stored non-zero
  `net_income`, `revenue`, `assets`, `liabilities` or `stockholders_equity` value equals the same
  metric of any fresh period (also when the stored rows hold none of the five). A symbol with no
  stored row skips the guards.
- **Deleted-without-replacement list** (operator steer, D-24): every planned delete with no
  inserted or identical row of the same (type, `period_end`), with its category (merged into
  another row; period type changed; no period derived for it; left out).

### 3. Write path (`internal/service/marketdata_service.go`, `internal/repository/marketdata_repo.go`)

- `backfillOneSymbol` (`marketdata_service.go:2320-2431`) fetches the full history (zero range, all
  types), reads all stored rows of the symbol once, runs the planner, and computes every price-join
  value before any transaction. The TTM EPS window (`accumulateTTM`, `:2511-2531`) runs over the
  full chronological fresh set.
- **Inserted rows (D-15).** `market_cap`, `pe_ratio`, `pb_ratio` are recomputed from the row's own
  statement and currency. `price` and `dividend_yield` are merged, with the existing `mergePrice`
  rule (`:2449-2466`), from a stored row with the same `filed_date`; nothing crosses filing dates.
  `derivePriceMetrics` (`:2537-2571`) is split so a carried price reuses the ratio half. The
  dividend fetch start is unchanged.
- **Replace (D-6, D-13).** One transaction per symbol (pattern `marketdata_repo.go:437`): deletes in
  sorted key order, each naming key, `period_end`, `filed_date` and version and required to affect
  exactly one row; then plain inserts (the insert text of `:740-746` without `ON CONFLICT`). Any
  miss or conflict rolls back and the symbol is reported in `failed_symbols`. A second concurrent
  replace of the symbol misses its pinned delete and rolls back.
- **Identical rows** keep today's in-place path unchanged: re-derive when the version is lower
  (`:2398-2407`, `marketdata_repo.go:799-817`), then the price-join gate (`:2409-2413`).
- **Logging (operator steer, D-24).** Each row deleted without a same-(type, `period_end`)
  replacement is logged at INFO with symbol, label, type, dates and category, once per row, at the
  time the symbol's replace commits.
- **Snapshot.** The deferred `DeleteEdgarSnapshot` (`:2353-2361`) runs when anything was re-derived
  or replaced, so the EDGAR snapshot (`edgarResolve`, `:1995-2027`) is rebuilt from the corrected
  newest period.
- **Repository interface.** `histFundamentalsRepo` (`:181-194`) stays at 10 methods: a
  list-all-rows read and the transactional replace come in; `GetHistoricalPriceState`
  (`marketdata_repo.go:761-779`) and `InsertHistoricalFundamentals` (`:732-756`) become unused and
  are removed. `HistoricalPriceState` (`internal/source/source.go:123-134`) gains the label, type
  and `period_end`. The three service fakes (`internal/service/marketdata_service_test.go:2335`,
  `:2576`, `:2938`) follow.

### 4. Consumer surfaces (C-14)

No consumer code changes. The agent (`services/xstockstrat-agent/app/client.py:2017-2050`,
`app/tools.py:380-536`) and the UI data explorer
(`services/xstockstrat-ui/src/app/insights/data-explorer/page.tsx:440-487`) pass the label through
as an opaque string; analysis selects by `filed_date` only
(`services/xstockstrat-analysis/app/services/evaluator.py:78-99`) and its pager's strictly
increasing `(period_end, fiscal_period)` holds because labels stay unique per type
(`services/xstockstrat-analysis/app/handlers/servicer.py:6672-6707`). The surfaces are verified
after deploy through `query_fundamentals` on the canary symbols.

### 5. Audit (D-16, D-21, D-25) and CI

- A thin command wraps the planner and audit logic (both in internal packages that count toward
  coverage, `.github/workflows/ci.yml:374`; the image builds only `./cmd/server`, `Dockerfile:7`).
  Per symbol it fetches SEC companyfacts, derives, plans against the stored rows and reports:
  guard result, identical / delete / insert counts, the deleted-without-replacement list by
  category, left-out periods by reason, single-metric anchors, any derived `period_end >
  filed_date`. A second mode diffs a pre and a post row set and counts value → null per
  price-join column.
- **Input (operator steer, D-25).** The stored rows come from the staging MCP: the main session
  reads the symbol list and each symbol's stored periods through read-only MCP calls
  (`query_fundamentals` historical mode returns every period field,
  `services/xstockstrat-agent/app/client.py:2048`) and feeds them to the command. The proto has no
  derivation version, so the command takes the lane's stored version as a parameter. The operator's
  SQL export is kept for the restore step only.
- **Real-database test.** The replace SQL is exercised against a real database in a new CI job
  modelled on `.github/workflows/ci.yml:1016-1065` and wired into the gate job.

### 6. Operator repair and audit (one pass per lane)

Read-only SQL is [RO], config changes [CFG], writes by the operator [OP-W], MCP calls by the main
session on the operator's word [MCP].

**Lane A — homelab staging (version 2, `fundamentals.history.enabled` = `true` today)**

1. [CFG] Before the merge, set `marketdata/fundamentals.history.enabled` to `false`.
2. [RO] Full-row export for restore:
   `\copy (SELECT * FROM marketdata.fundamentals_history ORDER BY 1,3,2) TO 'A-pre.csv' CSV HEADER`.
   Record the version histogram, the count of `period_end > filed_date`, and that
   `marketdata/fundamentals.history.backfill.period_types` reads `both`.
3. [MCP] The main session reads the lane's symbols and stored periods and runs the audit at a
   pinned commit of the feature branch. The operator reviews the report: guard trips, the
   deleted-without-replacement list, left-out periods. The audit cannot predict empty price columns
   (it does not see bar or dividend coverage). Re-run if the derivation or planner changes before merge.
4. [OP-W] Merge and deploy. Confirm the build stamps version 3.
5. [CFG] Set the flag to `true`.
6. [MCP] Canary `trigger_backfill(symbols=[ORCL, CRWD, JEF, BMO, AAPL, LYFT, AXP], data_kind="fundamentals", start=<lane minimum period_end>, overwrite=true)`,
   polled with `get_backfill_status`; served values checked with `query_fundamentals`
   (ORCL `Q1-2026` equity 24,154M filed 2025-09-10; `Q1-2027` equity 66,772M filed 2026-09-11;
   LYFT `Q3-2026` roe 0.942632).
7. [MCP] The remaining symbols in chunks of at most 50.
8. Pass conditions:
   - [RO] `SELECT count(*) FROM marketdata.fundamentals_history WHERE period_end > filed_date;` is 0.
   - [RO] `SELECT symbol, count(*) FROM marketdata.fundamentals_history WHERE derivation_version < 3 GROUP BY 1;` lists only symbols the repair reported failed.
   - [RO] `SELECT symbol, period_type, period_end, count(*) FROM marketdata.fundamentals_history GROUP BY 1,2,3 HAVING count(*) > 1;` returns no row.
   - [MCP] The audit on the post-repair rows plans no delete and no insert for every non-failed symbol.
   - [MCP] The pre/post diff reports value → null counts per price-join column; they are reported,
     against the causes named in `@AC-11`.
9. Lane A ends with the flag `true` (its prior value).
10. Restore, only if a pass condition fails and the operator decides so [OP-W]: flag `false`; in one
    transaction delete the listed symbols' rows from `marketdata.fundamentals_history`, load only
    those symbols' lines of `A-pre.csv`, and delete their `marketdata.fundamentals` rows with
    `source='edgar'`.

**Lane B — DigitalOcean staging (version 1, frozen, flag `false`)**

The flag stays `false` through merge and deploy. Steps 2–3 on lane B's data, then 5–8 with
`overwrite=true`, then the flag goes back to `false` (its frozen value). One pass takes version-1
rows to version 3: rows the derivation reproduces are re-derived in place and their price-join
refreshed by the overwrite path; all others are replaced.

A symbol failed by a guard keeps its rows and version; the operator decides per symbol from the
audit list.

### 7. Acceptance restatement (this feature)

`acceptance.feature` is restated in the first implementation step: FR-6 and `@AC-4` to the strict
`filed_date < as_of` rule (D-7); labels `Q1-2026` / `Q1-2027` pinned in `@AC-3` and `@AC-5`;
`@AC-6` gains the cache clause; `@AC-7` the full pass conditions; new `@AC-8` (repair restores both
collided periods when the range ends before the later one, and a repaired symbol's later ranged
backfill adds nothing outside its range), `@AC-9` (filer mismatch fails the symbol, no write),
`@AC-10` (June → December year-end change: later-ending periods left out and counted), `@AC-11`
(a replaced row's price-join: price and yield by equal `filed_date`, ratios from its own
statement, a column left unset when no daily bar exists near its `filed_date`, its trailing
12-month dividend window predates the dividend fetch, or its statement lacks the input).

## Rejected Alternatives

- `R-1` SQL migration `010` to correct stored rows — SQL cannot derive a period without the SEC payload.
- `R-2` `period_end` as the physical key — DBA approval, a change to feature 198 `@AC-1` and the analysis pager key, and a key swap that cannot run before the repair.
- `R-3` Keep the filer's label and re-label only on a collision — still reads `fy`/`fp`.
- `R-4` Period type from flow duration — ambiguous and undefined for balance-sheet-only filings.
- `R-5` In-place `UPDATE` of a row's key — a collided row is two periods; label chains conflict mid-statement.
- `R-6` Group facts by own end with no notion of a filing — loses which filing defines `filed_date`.
- `R-7` Require the own end to equal the latest class-duration flow end — false-fails on real data (CRWD).
- `R-8` Ordinal cascade on a label collision — permanent label drift.
- `R-9` Shrink-ratio threshold guard — arbitrary; trips on legitimate repairs.
- `R-10` Extend the dividend fetch start — a short vendor history would read as a zero yield.
- `R-11` Match legacy rows through per-filing `fy`/`fp` keys — unverified premise, legacy-only code, brings `fy`/`fp` back.
- `R-12` Coverage of a deleted row by a date window — completeness depends on old bucket contents.
- `R-13` Two-of-three anchor rule — can silently date a filing to a comparative column.
- `R-14` Recompute ratios on in-place rows without overwrite — changes feature 216 `@AC-3` line 42; `overwrite=true` needs no code.
- `R-15` Filer guard on `filed_date` or `eps` — both coincide across filers.
- `R-16` Ignore the request range on every run — the lookback setting would stop meaning anything.

## Open Risks

- [ ] A filer that moves its year end later within one calendar year (or a 52/53-week year ending near mid-January) has the later-ending period left out, and a row stored before the change can be deleted when the change filing appears. Operator answer recorded in context.md. Visible through the WARN, the counter and the audit — to be surfaced at the audit step (procedure step 3).
- [ ] Rows deleted without a same-date replacement (merged rows, mis-typed rows, excluded forms, year-end quarterlies). Operator answer recorded; logged at INFO; listed by the audit — step 3.
- [ ] Most stored rows carry a cover-page `period_end` (recon § Data findings), so the repair rewrites most of each lane's table. The export, the audit and the canary are the controls — steps 2, 3, 6.
- [ ] Replaced rows are priced at their corrected `filed_date`; a price-join column is empty where no daily bar or dividend coverage exists there. Counted by the pre/post diff — step 8.
- [ ] `overwrite=true` also refreshes identical rows' prices to today's adjusted close (accepted, D-22).
- [ ] 6-K handling is measured on one filer (BMO); a half-year 6-K yields a balance-sheet-only quarterly row. The audit shows it per symbol — step 3.
- [ ] A filing whose latest anchor is a subsequent-event instant on or before `filed` is dated there (D-11); the audit counts single-metric anchors — step 3.
- [ ] A filer with no annual filing is labelled against Dec 31 and is relabelled when its first annual filing arrives; the reconcile replaces those rows. A commit between two pages of an analysis read can make that one read skip a newly inserted period.
- [ ] Symbols failed by the filer guard stay at their old version until the operator decides per symbol — step 3.
- [ ] Once a lane is enabled, any admin-triggered fundamentals backfill runs the reconcile (part of the approved design).
- [ ] How the main session obtains each lane's symbol list through the MCP is not yet established (which tool lists the stored universe) — to be settled in `/sdd-spec` discovery; if no tool lists it, the operator supplies the list.
- [ ] Not yet read: `services/xstockstrat-marketdata/docs/context-constitution.md:27` (MARKETDATA-13), `docs/context-constitution-findings.md:29-31`, `docs/runbooks/historical-backfill.md:148+` — read in `/sdd-spec` before the docs step.

## Constitution Rules Touched

- `C-01`, `F-04` — honored by: every code claim cites recon or a verified `path:line`; unknowns are listed under Open Risks.
- `C-08`, `P-06` — honored by: each code step has a paired test step with a RED assertion on today's code (ORCL and CRWD real fixtures, planner cases, service fakes, pgxmock, real-database job).
- `C-09` — not triggered: no proto change (D-5).
- `C-13` — honored by: real filings as fixtures under `internal/edgar/testdata/`; a second consumer of a fixture centralizes it.
- `C-14` — honored by: consumer surfaces named and reconned; no consumer step is needed because every surface passes the label through; verified after deploy on the canary.
- `C-15` — honored by: `@AC-1..@AC-11`, each traced to a test step.
- `C-16` — honored by: § Business Rules Touched; one signed CHANGE.
- `C-18` — honored by: one planner used by service and audit; no second selection mechanism; rejected machinery recorded (R-11, R-13, R-14).
- `P-01..P-05` — honored by: single orchestrator; register on disk each round; operator answers recorded verbatim.
- `F-01` — honored: no migration is added or edited.
- `F-06` — honored: one short transaction per symbol on the existing pooled connection; no pool change.
- `F-07` — honored: no config value is hardcoded; the day-count constants are algorithm constants like `quarterMinDays`.

## Business Rules Touched (C-16)

`md` = `services/xstockstrat-marketdata/acceptance`.

- CHANGE `@AC-5 @feature-216` "overwrite=true never nulls a pre-existing dividend_yield whose trailing-12-month window predates the current fetch lookback" (`md/fix-historical-fundamentals-price-join.feature:54`) — one `Given` added after line 57: `And the current EDGAR derivation reproduces that period's fiscal_period, period_type, period_end and filed_date`. What happens to a replaced row is this feature's `@AC-11`, promoted in the same PR. Signed off by user @ 2026-11-16 (context.md, answer 2).
- PRESERVE `@AC-3`, `@AC-4 @feature-216` (`md/fix-historical-fundamentals-price-join.feature:35`, `:45`) — not regressed: the price-join fill and refresh paths are unchanged and never touch dates; a row the derivation does not reproduce is replaced by a different path. The scenarios read as being about rows the current derivation reproduces; the 216 header gains a prose note saying so. The migrated 216 tests keep equal dates in the fake source and assert the replace is not called.
- PRESERVE `@AC-1`, `@AC-2 @feature-216` — price-join still derives from the bar at the row's `filed_date` and fails closed.
- PRESERVE `@AC-1 @feature-198` (`md/historical-fundamentals-backtest.feature:10`) — the key tuple is unchanged; a second run plans no insert.
- PRESERVE `@AC-3 @feature-198` (`:17`) — strict `filed_date < as_of` unchanged. Its period name "Q4-2019" predates this fix and is left as is.
- PRESERVE `@AC-5 @feature-198` — the reconcile needs no FMP.
- PRESERVE `@AC-1 @feature-223` (`md/fix-stored-edgar-periods.feature:10`) — AXP `Q2-2026` keeps its label and D/E. The feature description gains a prose note that a period the derivation no longer reproduces is replaced rather than upgraded in place.
- EXTEND `@AC-2 @feature-223` (`:17`) — the snapshot cache is also invalidated after a replace (this feature's `@AC-6`).
- PRESERVE `@AC-1`, `@AC-3`, `@AC-5 @feature-340`; `@AC-1`, `@AC-2`, `@AC-3 @feature-222`; `@AC-1`, `@AC-2`, `@AC-4`, `@AC-5`, `@AC-6`, `@AC-8`, `@AC-9 @feature-211`; `@AC-1 @feature-253` — the label rule reproduces LYFT `Q3-2026` / `FY2025`, AXP `Q2-2026`, BABA `FY2026`, CRCL `FY2025`; the value selection and formulas are unchanged.
- PRESERVE the analysis, agent, UI and ingest scenarios listed in recon — no consumer code changes.
