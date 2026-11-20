# Feature 348 — lane A (homelab staging) pre-enable audit

No raw rows are in this file. Rows file and JSON report stay in the session scratch directory and are not committed.

## Run

- Date: 2026-11-16. Lane: homelab staging (`xstockstrat_homelab_staging`), stored derivation version 2.
- Audit code: feature branch commit `21e3f7f7` (`cmd/fundamentals-audit plan -stored-version 2 -rate-limit-rps 5`, open range, the lane's `marketdata/edgar.user_agent`). `internal/edgar/` and `internal/reconcile/` are unchanged since `b9d84113`.
- Freeze: `marketdata/fundamentals.history.enabled` set `true` → `false` at 12:00:54 UTC, read back `false`, before any row was read.
- Symbols: union of the 2 watchlists = **355**. Stored rows read through `query_fundamentals` (historical mode, limit 50, one page per symbol; every `next_page_token` was empty) by 12 read-only workers; the rows file was rebuilt from their raw tool results by script, nothing was retyped. 355 of 355 symbols read, none empty, none failed.
- Operator figures (full-row export, version histogram, `period_end > filed_date` count, distinct symbol count): **not received yet**. To compare: this audit read **6060 rows** for 355 symbols; a different `count(*)` or distinct count means stored symbols outside the watchlists.

## Stored rows today

| Figure | Value |
|---|---|
| Rows read | 6060 |
| Rows with `period_end` after `filed_date` | 116 |
| (symbol, period type, `period_end`) groups with more than one row | 8 |
| Earliest stored `period_end` | 2022-01-07 |
| Most rows for one symbol | 21 |

## What a full-history backfill would do

| Figure | Value |
|---|---|
| Symbols planned | 355 of 355 |
| Symbols whose derive failed | 0 |
| Guard trips | 0 |
| Derived periods | 15713 |
| Stored rows identical to a derived period (upgraded in place) | 1182 |
| Stored rows deleted | 4878 |
| Periods inserted (open range) | 14531 |
| Symbols with no deleted row | 53 |
| Symbols with no change at all | 13 |
| Derived periods with `period_end` after `filed_date` | 0 |
| Single-metric balance-sheet anchors | 469 |

Reading these numbers:

- About four of five stored rows (4878 of 6060) are replaced, mostly because their `period_end` was a cover-page date.
- The insert count is for an **open range**. The repair runs with `start=<lane minimum period_end>` (2022-01-07 here): the 302 symbols with at least one stale row get their whole SEC history (rule (c)), the 53 symbols with no deleted row get only periods from that date on. The table grows from about 6,000 rows to roughly 15,000.
- The audit does not see bar or dividend coverage, so it cannot say how many inserted rows will have empty price columns. Periods older than the stored daily bars will have none.
- Symbols with no change: AVEX, BACC, BULL, BUUU, CAST, CRWV, FIGR, IBTA, LB, NAVI, SPCX, VG, VZLA.

## Rows deleted without replacement (20 rows, 18 symbols)

These stored periods would no longer exist after the repair. The service logs each at INFO; it reports `no_period_derived` where this audit says `left_out` (none here).

| Category | Rows |
|---|---|
| `merged` | 1 |
| `no_period_derived` | 12 |
| `period_type_changed` | 7 |

| Symbol | Label | Type | `period_end` | `filed_date` | Category |
|---|---|---|---|---|---|
| ARAY | Q2-2026 | quarterly | 2026-01-30 | 2026-02-17 | `merged` |
| AGRO | FY2025 | annual | 2025-12-31 | 2026-04-29 | `no_period_derived` |
| BVN | FY2025 | annual | 2025-12-31 | 2026-04-30 | `no_period_derived` |
| CLBT | FY2023 | annual | 2024-03-11 | 2024-04-12 | `no_period_derived` |
| CSWC | Q1-2023 | quarterly | 2022-07-29 | 2022-08-02 | `no_period_derived` |
| EC | FY2025 | annual | 2025-12-31 | 2026-04-30 | `no_period_derived` |
| EDBL | FY2026 | annual | 2026-04-27 | 2026-04-30 | `no_period_derived` |
| IAUX | FY2022 | annual | 2022-12-31 | 2023-03-14 | `no_period_derived` |
| PAM | FY2025 | annual | 2025-12-31 | 2026-04-09 | `no_period_derived` |
| PFLT | Q3-2022 | quarterly | 2022-08-03 | 2022-11-21 | `no_period_derived` |
| PNNT | Q3-2022 | quarterly | 2022-08-03 | 2022-11-21 | `no_period_derived` |
| TNMG | FY2025 | annual | 2025-12-31 | 2026-04-30 | `no_period_derived` |
| TRIN | Q2-2022 | quarterly | 2022-08-03 | 2022-08-04 | `no_period_derived` |
| CLVT | FY2021 | annual | 2022-01-31 | 2021-05-10 | `period_type_changed` |
| CLVT | FY2022 | annual | 2023-01-31 | 2022-05-09 | `period_type_changed` |
| CLVT | FY2023 | annual | 2024-01-31 | 2023-05-09 | `period_type_changed` |
| DELL | FY2024 | annual | 2024-02-02 | 2023-06-12 | `period_type_changed` |
| SNOW | FY2023 | annual | 2023-03-17 | 2022-06-03 | `period_type_changed` |
| UWMC | FY2023 | annual | 2023-12-31 | 2023-05-10 | `period_type_changed` |
| VATE | FY2021 | annual | 2022-02-28 | 2021-05-07 | `period_type_changed` |

## Derived periods left out (10 periods, 7 symbols)

| Symbol | Label | Type | `period_end` | `filed_date` | Reason |
|---|---|---|---|---|---|
| MOS | Q3-2013 | quarterly | 2013-09-30 | 2013-11-05 | `label_collision` |
| MOS | FY2013 | annual | 2013-12-31 | 2014-02-18 | `label_collision` |
| SKYE | Q1-2014 | quarterly | 2014-04-30 | 2014-06-05 | `label_collision` |
| SRXH | FY2018 | annual | 2018-12-31 | 2019-07-25 | `label_collision` |
| BABA | Q4-2017 | quarterly | 2017-03-31 | 2017-11-24 | `year_end_quarter` |
| BABA | Q4-2019 | quarterly | 2019-03-31 | 2019-11-13 | `year_end_quarter` |
| BABA | Q4-2020 | quarterly | 2020-03-31 | 2021-02-02 | `year_end_quarter` |
| IAUX | Q4-2022 | quarterly | 2022-12-31 | 2023-03-14 | `year_end_quarter` |
| NUTX | Q4-2013 | quarterly | 2013-12-31 | 2014-05-14 | `year_end_quarter` |
| TEO | Q4-2024 | quarterly | 2024-12-31 | 2026-02-10 | `year_end_quarter` |

## Canary symbols

| Symbol | Stored | Derived | Identical | Deletes | Inserts |
|---|---|---|---|---|---|
| ORCL | 18 | 69 | 0 | 18 | 69 |
| CRWD | 17 | 30 | 9 | 8 | 21 |
| JEF | 20 | 70 | 2 | 18 | 68 |
| BMO | 17 | 30 | 17 | 0 | 13 |
| AAPL | 20 | 70 | 0 | 20 | 70 |
| LYFT | 19 | 31 | 14 | 5 | 17 |
| AXP | not in a watchlist, not audited | | | | |

ORCL today holds `Q1-2026` with `period_end` 2026-09-07, `filed_date` 2025-09-10 and `stockholders_equity` 66,772,000,000 — the reported defect, seen live.

## Not covered

- Stored symbols that are in no watchlist (the MCP cannot list them); the operator's distinct-symbol count settles whether any exist.
- The stored `derivation_version` of each row (the MCP does not return it); version 2 was assumed for every row, as the brief states for this lane.
- Price-column outcomes (see above).

## Operator review

Pending.
