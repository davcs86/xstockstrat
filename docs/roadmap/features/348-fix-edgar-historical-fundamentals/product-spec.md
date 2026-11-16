# Product Spec: fix-edgar-historical-fundamentals

**Type**: bug
**GitHub Issue**: n/a (Issues disabled) — report `docs/reports/2026-11-16-marketdata-edgar-period-label-collision-defect.md`
**Severity**: SEV-2
**Created**: 2026-11-16

---

## Problem Statement

A strategy author who backtests on fundamentals, and a trader who reads a symbol's fundamentals
history, both rely on each stored period of `marketdata.fundamentals_history` holding one fiscal
period's as-reported values under the date those values were first filed. For filers whose SEC
filings repeat a fiscal-year tag across two years this does not hold. Two fiscal periods a year
apart are stored as one row that carries the earlier filing's `filed_date`, a `period_end` from the
later one and the later period's values; the other period has no row.

Measured on homelab staging after the feature-340 re-derive (all 362 symbols at
`derivation_version` 2): 104 of 6,157 rows (1.7%) in 61 symbols have `period_end` more than 30 days
after `filed_date`, 39 of them by more than 300 days. Example, ORCL `Q1-2026`: `filed_date`
2025-09-10, `period_end` 2026-09-07, net income 4,760M and equity 66,772M. Those are the figures of
the quarter ended 2026-08-31, first filed 2026-09-11. A backtest reading ORCL as of 2025-10-01
therefore sees figures that were published eleven months later (look-ahead), and the quarter ended
2025-08-31 (net income 2,927M, equity 24,154M) is not stored at all.

A second symptom has the same origin: a row's `period_end` is the latest date of any fact in its
bucket, including the cover-page share count, which is dated after the fiscal period ends. ORCL's
row shows 2026-09-07 for a quarter that ended 2026-08-31.

Expected: each row holds one fiscal period's as-reported values, its `period_end` is that period's
own end, its `filed_date` is the first filing of that period's values, and a point-in-time read at
date D never returns values filed after D.

## Reproduction Steps

1. On a database re-derived at `derivation_version` 2, run
   `SELECT symbol, fiscal_period, period_type, period_end, filed_date FROM marketdata.fundamentals_history WHERE period_end > filed_date ORDER BY 1,2;`
2. For ORCL, compare the `Q1-2026` row's equity (66,772M) with the `FY2026` row's equity (42,508M):
   the quarter labelled before the fiscal year end holds a later balance sheet.
3. In code: derive ORCL's SEC companyfacts (CIK0001341439) through `FetchHistorical`. One `Q1-2026`
   period is returned with `period_end` 2026-09-07 and `filed_date` 2025-09-10 (reproduced in the
   triage session against the live payload fetched 2026-11-16).

## Root Cause Hypothesis

**Traced at triage** against live SEC companyfacts for ORCL, CRWD, CLSK, FLXS, UCTT and JAZZ.

- `services/xstockstrat-marketdata/internal/edgar/edgar_client.go:370` (`periodKey`) and `:424`
  key a bucket by the fact's `fy`/`fp`. SEC companyfacts copies those two fields from the filing's
  own cover-page tags (fiscal year focus, fiscal period focus). They describe the filing, and filers
  set them inconsistently: ORCL's 10-Q filed 2025-09-10 (quarter ended 2025-08-31) and its 10-Q filed
  2026-09-11 (quarter ended 2026-08-31) both carry `fy` 2026, `fp` Q1. CRWD's 10-K filings for the
  years ended 2022-01-31 and 2023-01-31 both carry `fy` 2022. The repeat is in the SEC payload, not
  introduced by our parsing.
- `edgar_client.go:431-436` then keeps the earliest `filed` and the latest `end` of everything in
  the shared bucket, and `selectOwnPeriod` (`:295`, feature 340) takes the values at the latest
  balance-sheet date. Before feature 340 the same bucket held the first-seen (earlier) values.
- `edgar_client.go:434` takes the latest `end` over every fact, including
  `EntityCommonStockSharesOutstanding`, whose date is the cover-page date after the period ends.

## Functional Requirements

- **FR-1** — Two different fiscal periods of one symbol are never stored or served as one period:
  every period returned by `FetchHistorical`, and every row of `marketdata.fundamentals_history`,
  holds values of exactly one fiscal period, identified by that period's own end date and period
  type, whatever `fy`/`fp` the filing carries.
- **FR-2** — A period's `period_end` is the fiscal period's own end date (the balance-sheet date of
  the quarter or year), never a later cover-page date; for every row `period_end <= filed_date`.
- **FR-3** — A period's `filed_date` is the date of the earliest filing that reported that period as
  its own current period. A later filing that repeats the period as a comparative column, or that
  carries the same `fy`/`fp`, does not change it.
- **FR-4** — Each period has a `fiscal_period` label that is unique per symbol and period type and
  is a deterministic function of the period itself, so re-deriving the same filings always yields
  the same label and two consecutive fiscal years never share one. The label rule is a design
  decision; labels of existing rows may change.
- **FR-5** — Rows stored before the fix are corrected by the post-deploy re-derive: afterwards no
  row carries a pre-fix derivation version, no row has `period_end > filed_date`, and no row
  remains under a label the fixed derivation no longer produces for that symbol.
- **FR-6** — `GetHistoricalFundamentals` with an as-of date D returns, for each period, only values
  whose filing date is strictly before D (a filing is visible from the day after it was filed; no
  look-ahead), including for filers whose filings repeat `fy`/`fp`.
- **FR-7** — Readers that pick "the newest period" or address a period by label keep working
  against the corrected identity: the EDGAR snapshot path (`GetFundamentals` /
  `GetFundamentalsMulti` under `snapshot_source=edgar`), the agent `query_fundamentals` tool,
  analysis backtests and screens that read fundamental operands, and the UI fundamentals views.
  Recon lists every reader.
- **FR-8** — The operator has a documented repair and audit procedure for both staging lanes
  (homelab at derivation version 2; DigitalOcean staging at version 1, frozen), runnable in one
  pass per lane, whose pass condition includes zero rows with `period_end > filed_date`.

## Affected Services

- `xstockstrat-marketdata`

## Fix Scope

- Proto changes anticipated: **none expected.** `HistoricalFundamentalsPeriod` already carries
  `fiscal_period`, `period_end` and `filed_date`. If design finds a comment-only clarification is
  needed it is additive; a field change would stop the design and go to the operator.
- DB migrations anticipated: **to be decided by design.** The row key is
  `(symbol, fiscal_period, period_type)`. A label change is a key change, so a re-derive that only
  upserts leaves the old-labelled rows behind; they must be removed, either by the re-derive path
  itself or by a new numbered migration in `services/xstockstrat-marketdata/migrations/`
  (`NNN_description.up.sql` + `.down.sql`, never an edit of an applied one; DBA + service-owner
  approval). The mechanism for re-deriving is the existing `DerivationVersion` bump (2 → 3).
- Config key changes anticipated: **none.** The repair uses the existing
  `fundamentals.history.enabled` gate (namespace `marketdata`) as an operator action; no key is
  added or changed.

## Open Questions

None open. The label rule (FR-4) and the stale-row mechanism (FR-5) are design decisions, not
unknowns about the defect.

## Consumer Surface(s)

No consumer code change is expected; each surface reads the corrected rows through marketdata.
Recon confirms this per reader, and a reader that depends on a label format earns its own step.

- [x] **UI** — `xstockstrat-ui` `/trader` symbol page Fundamentals card and `/insights`
  fundamentals views that show historical periods: corrected values, dates and labels.
- [x] **Agent tools** — `query_fundamentals` (historical periods and labels), plus
  `run_fundamentals_scan`, `screen_symbols` and `run_backtest` where they read fundamental
  operands point-in-time.

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- Filers whose net income or equity is reported under tags the derivation does not read
  (`ProfitLoss`, equity including non-controlling interest, IFRS tags): 11 symbols with no quarterly
  net income and 13 with no ROE on the latest quarter. Confirmed at triage to be a different defect,
  recorded as `docs/reports/2026-11-16-marketdata-edgar-tag-coverage-gaps-defect.md`.
- Adding standalone fourth-quarter rows, or any new metric
- Changing the feature-340 own-period value selection or the feature-222 TTM ROE formula, beyond
  what the new period identity requires
- A production repair lane (no production instance exists)
- Running the repair: the operator runs it after deploy
- Refactoring unrelated to the bug
