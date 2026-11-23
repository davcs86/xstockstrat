# Defect: EDGAR historical fundamentals rows hold a different period's data than their label and filed date say (period-label collision for non-calendar fiscal years)

**Recorded**: 2026-11-16
**Severity**: SEV-2
**Impact type**: wrong-fundamentals-point-in-time
**Environment**: staging (homelab, main-dev)
**Affected service(s)**: xstockstrat-marketdata
**Config-only fix possible**: no

## Observed

After the feature 340 re-derive of the homelab `marketdata.fundamentals_history` table (all 362
symbols at `derivation_version` 2), 104 of 6,157 rows (1.7%) in 61 of 362 symbols have a
`period_end` later than their `filed_date` by more than 30 days; 39 of them by more than 300 days.
A period cannot end after it was filed. Examples from the post-repair export:

| Row | `filed_date` | `period_end` | Stored values |
|---|---|---|---|
| ORCL `Q1-2026` | 2025-09-10 | 2026-09-07 | net income 4,760M, equity 66,772M — equity is above the later `FY2026` row's 42,508M, so the row holds the quarter one year after its label |
| CLSK `Q1-2025` | 2025-02-06 | 2026-01-29 | net income −378.7M; no `Q1-2026` row exists |
| CRWD `Q1-2025` | 2024-06-05 | 2025-05-29 | no `Q1-2026` row exists; annual labels run `FY2022`, `FY2023`, `FY2024`, `FY2026` with no `FY2025` |
| FLXS `Q1-2025`, `Q2-2025`, `Q3-2025` | 2025 | 2026 | each a year late |

Most affected symbols: JAZZ (5 rows), GURE, SCKT, UCTT, DXLG, PNNT, EVI, FLXS, BHR (4 each).

The same impossible dates are present in the pre-repair export (taken at `derivation_version` 1), so
the collision predates feature 340. What changed is the content of the collided rows: at version 1
they held values from an earlier period than the label (ORCL `Q1-2026` held 2,929M / 20,451M); at
version 2 they hold the latest period that landed on the label, under the earliest filed date.

One period per collision is also missing, which the feature 340 closing check surfaced as "only
three of the last four quarters found" on 23 symbols.

## Expected

Each `(symbol, fiscal_period, period_type)` row holds one fiscal period's as-reported values, its
`period_end` is that period's end, and its `filed_date` is the date those values were first filed.
A point-in-time read at date D never returns values filed after D.

## Reproduction

1. On a database re-derived at `derivation_version` 2, run:
   `SELECT symbol, fiscal_period, period_type, period_end, filed_date FROM marketdata.fundamentals_history WHERE period_end > filed_date + interval '30 days' ORDER BY 1,2;`
2. For ORCL, compare the `Q1-2026` row's equity with the `FY2026` row's equity.

## Evidence

`services/xstockstrat-marketdata/internal/edgar/edgar_client.go:370`
> func periodKey(fy int, fp string) string { return fmt.Sprintf("%d-%s", fy, fp) }

`services/xstockstrat-marketdata/internal/edgar/edgar_client.go:423`
> key := periodKey(d.FY, d.FP)

`services/xstockstrat-marketdata/internal/edgar/edgar_client.go:430-435`
> if filed.Before(agg.filed) { agg.filed = filed }
> if end.After(agg.periodEnd) { agg.periodEnd = end }

Operator-run audit of the homelab lane, 2026-11-16 (exports stay on the operator's machine):
`docs/roadmap/features/340-fix-fundamentals-roe-unit/audit-lane-a-homelab.md`.

## Root cause hypothesis

A period's identity is the fact's EDGAR `fy`/`fp` pair, which describes the filing, not the fact's
own period. When two filings a year apart carry the same pair, their facts share one bucket that
keeps the earliest `filed` and the latest `end`; own-period selection then takes the latest values.

## Confidence

high (the symptom and the bucket code are confirmed; why specific filings repeat an `fy` value was
not traced)
