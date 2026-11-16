# Debate Register: fix-edgar-historical-fundamentals

**State**: in-debate
**Mode**: full
**Rounds run**: 1 (round numbers continue across runs; the mode's 2–5 bounds count this run only)

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-16 | /sdd-design | 8 | 6 | 0 | 18 | 0 | yes |

## Settled Decisions

<!-- Status: settled → superseded by D-m (only after a user-approved REOPEN) -->
| ID | Round | Decision | Evidence | Status |
|---|---|---|---|---|
| D-1 | 1 | A period is one filing's own period. Facts are grouped per filing; filings are merged into periods keyed by (period type, own end); the earliest filing of a period supplies both its values and its `filed_date`. The filing's `fy` and `fp` are not used for identity. | `services/xstockstrat-marketdata/internal/edgar/edgar_client.go:370`, `:424`, `:431-436`; recon.md § Data findings (rule A: 14 filers, every period unique, zero `period_end > filed_date`) | settled |
| D-2 | 1 | Period type comes from the filing's form class, not from `fp`. | recon.md § Data findings (UCTT three quarters tagged Q3; FLXS and SNOW 10-Qs tagged FY); `edgar_client.go:586-608` | settled |
| D-3 | 1 | `period_end` is the filing's own period end. The cover-page share count never dates a period. | `edgar_client.go:434-436`; ORCL share fact dated 2026-09-07 for a quarter ended 2026-08-31 (context.md) | settled |
| D-4 | 1 | The `fiscal_period` label is computed from dates only and keeps today's format `Qn-YYYY` / `FYYYYY`. Annual: `FY<year of (end − 15 days)>`. The quarterly rule is still open (O-3, O-4). | recon.md § Data findings (rule B: no label change for the calendar-year filers; zero duplicates on 14 filers); feature 340 `design.md:168-169` (Q-ttm parses the format) | settled |
| D-5 | 1 | No schema or data migration, no proto change, no new config key. Code changes stay in `xstockstrat-marketdata`. `DerivationVersion` becomes 3 with a new golden entry. | recon.md § Dependencies; `edgar_client.go:610-614`; `internal/edgar/derivation_version_test.go:16-19` | settled |
| D-6 | 1 | Stored rows are corrected by the fundamentals backfill path. Rows whose identity changed are written inside one short transaction per symbol using a plain `INSERT`, so a key conflict is an error that rolls the symbol back; `ON CONFLICT DO NOTHING` is not used on that path. | `internal/repository/marketdata_repo.go:437` (transaction pattern), `:746`; `internal/service/marketdata_service.go:2384-2387`; `docs/patterns/database.md:109-158` | settled |
| D-7 | 1 | This feature's FR-6 and `@AC-4` are restated to the existing strict rule `filed_date < as_of` (T+1). No existing as-of scenario changes. | `services/xstockstrat-marketdata/acceptance/historical-fundamentals-backtest.feature:17-25`; `marketdata_service.go:2633-2644` | settled |
| D-8 | 1 | Regression fixtures are real SEC companyfacts trimmed by tag only: ORCL (the acceptance values) and CRWD (annual collision, January year end, label chain). Nothing is synthesised to look like a real filer. | recon.md § Data findings; trimmed sizes ORCL about 340 KB, CRWD about 117 KB; `internal/edgar/own_period_test.go:16-34` | settled |

## Rejected Alternatives (locked)

<!-- Status: locked → reopened @ round N (user, context.md <ISO>) -->
| ID | Round | Alternative | Why rejected | Status |
|---|---|---|---|---|
| R-1 | 1 | Correct stored rows with a SQL migration `010`. | SQL cannot derive a period without the SEC payload; it would leave a gap until a backfill runs; needs DBA approval for no gain. | locked |
| R-2 | 1 | Make `period_end` the physical key (migration `010` changing the primary key). | Needs DBA approval, a C-16 CHANGE to feature 198 `@AC-1` (which names the key tuple), a change to the analysis pager key and a two-step rollout; existing rows hold wrong and duplicate `period_end` values, so the key swap cannot run before the repair. Too heavy for this fix. | locked |
| R-3 | 1 | Keep the filer's label and re-label only on a collision. | Still reads `fy`/`fp`, which are wrong on real filings; not a deterministic function of the period (FR-4). | locked |
| R-4 | 1 | Decide period type from flow duration. | Ambiguous for a 10-K that also carries a three-month flow; undefined for a filing with balance-sheet facts only. | locked |
| R-5 | 1 | Correct a row's key with an in-place `UPDATE`. | A collided row maps to two periods, and a label chain (CRWD) hits key conflicts mid-statement. | locked |
| R-6 | 1 | Group facts by own end directly, with no notion of a filing. | Loses which filing reported the period as its own, which is what defines `filed_date` (FR-3); a comparative column would form a period. | locked |

## Objections

<!-- Status: open → closed @ round N (<how>) | waived @ round N (user) | reopened @ round N (user) -->
| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|
| O-1 | 1 | Carrying stored price-join values onto a replaced row keeps look-ahead: `market_cap`, `pe_ratio` and `pb_ratio` depend on statement inputs this fix corrects (ORCL's corrected 2025-08-31 row would inherit a P/B computed on equity filed a year later). FR-6; feature 211 `@AC-9`. | yes | open |
| O-2 | 1 | A range-bounded delete followed by `ON CONFLICT DO NOTHING` can silently drop a fresh period and keep a stale row (stale row's wrong end outside the range; label chain; surviving current-version row). FR-1, FR-5. | yes | open |
| O-3 | 1 | The proposed quarterly label rule repeats a quarter number when an annual period is missing or the fiscal year end changes, and "fail the symbol" then blocks that symbol's repair for good. FR-4, FR-5. Measured: JEF (10-KT filed 2019-01-29 moving the year end from December to November) gets four `Q1-2019` labels. | yes | open |
| O-4 | 1 | A label can change after it is stored (first 10-K of a new filer; a fiscal-year-end change), leaving a current-version orphan row that a version-gated replace never removes: one period missing, another stored twice. FR-4, FR-5; feature 198 `@AC-1` intent. | yes | open |
| O-5 | 1 | An empty or shrunken fresh set (all filings on excluded forms; a ticker now resolving to another filer) deletes a symbol's history on any ordinary backfill. | yes | open |
| O-6 | 1 | `(period_type, filed_date)` is not a unique match key: several 10-Qs can be filed on one day. | no | open |
| O-7 | 1 | The proposed CHANGE to feature 216 `@AC-5` is broader than needed; keeping the in-place re-derive for rows whose identity is unchanged leaves 216 `@AC-3`/`@AC-4`/`@AC-5`, the 216 sign-off header and the 223 "upgraded in place" text literally true. The 216 header and the 223 text must be addressed either way. C-16. | no | open |
| O-8 | 1 | Duplicates of one period under two labels break the intent of feature 198 `@AC-1`. Resolved through O-4. C-16. | no | open |
| O-9 | 1 | Removing the re-derive path makes every future version bump delete and re-insert all rows; `services/xstockstrat-marketdata/docs/fundamentals.md:74-83`, MARKETDATA-13 (`docs/context-constitution.md:27`) and finding D-31 (`docs/context-constitution-findings.md:30`) are missing from the touchpoints. | no | open |
| O-10 | 1 | "Shares only at their own end date" is undefined: requiring the share fact at the period end drops the cover-page count (mass value → nil for `market_cap`, `pb_ratio`); per-filing first-seen changes a feature-340 residual. State the rule and test it. | no | open |
| O-11 | 1 | Excluding forms is a delete on every backfill, yet the no-write dry run is optional. Make a no-write derivation audit over each lane's symbol list a required step before a lane is enabled. | no | open |
| O-12 | 1 | No rollback: rows are deleted and the feature-340 export omits columns. Take a full-row export per lane before enabling it and document the restore step. | no | open |
| O-13 | 1 | While a lane is enabled, any user-triggered backfill runs the replace path; re-accept that risk explicitly. Two concurrent replaces of one symbol: say what happens. | no | open |
| O-14 | 1 | `histFundamentalsRepo` has 10 methods, not 11 (`marketdata_service.go:181-194`). C-01. | no | open |
| O-15 | 1 | Test-plan gaps: `@AC-7` has no RED-able test; the delete/insert SQL is proven only by pgxmock and a fake; CRWD missing as a fixture; no RED tests for the O-1, O-2, O-3, O-5 counter-examples; the AAPL lone-quarter labelling is hidden by adding an annual fact. C-08, C-15, P-06. | no | open |
| O-16 | 1 | Production grouping by `(accn, filed)` is shaped by a fixture quirk; give fixtures real accession numbers and group by accession; drop `FY`/`FP` from `unitDatum` once unread. C-18. | no | open |
| O-17 | 1 | "Latest balance-sheet anchor in the filing" can be a subsequent-event instant; cross-check against the filing's matching-duration flows. Measured caveat: CRWD's 10-K filed 2021-03-18 has anchor 2021-01-31 but no annual-length flow ending there among the read tags, so an equality check would false-fail. | no | open |
| O-18 | 1 | Raising `dividends.backfill_lookback_years` by hand during the repair is error-prone staging config; compute the dividend fetch start from the rows being written instead, or scope it to identity-changed rows. | no | open |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|
