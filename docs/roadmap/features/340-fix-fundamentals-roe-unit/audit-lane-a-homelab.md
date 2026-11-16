# Feature 340 — post-deploy repair audit, lane A (homelab staging)

**Date**: 2026-11-16 · **Database**: `xstockstrat-staging` on the homelab DB host · **Outcome**: accepted by the
operator with one open defect filed (`docs/reports/2026-11-16-marketdata-edgar-period-label-collision-defect.md`).
Lane B (DO staging) is **not run**: the operator holds it, frozen, until that defect is fixed.

The operator ran every SQL statement (read-only sessions) and the local audit script; the main session ran
the config flips, backfill triggers and served-value checks through the `xstockstrat_homelab_staging` MCP.
Raw exports stay on the operator's machine (R-16).

## Config flips (`marketdata` / `fundamentals.history.enabled`, homelab)

| Time (UTC) | Value | Reason |
|---|---|---|
| 05:38:01 | `true` → `false` | Step 10 freeze (both stagings; DO staging at 05:38:02) |
| 06:42:59 | `true` | lane start |
| 07:16:11 | `false` | lane processing complete, pending acceptance |
| 07:20:35 | `true` | operator accepted the lane; pre-freeze value restored |

DO staging remains `false`.

## Runs

`trigger_backfill(data_kind="fundamentals", overwrite=true)`; every job `COMPLETED` with `failed_symbols: []`.

| Chunk | Symbols | `start` | Job |
|---|---|---|---|
| 1 (canary) | LYFT, AXP, AAPL | 2022-01-01 | `adb86986-7022-4299-bdd7-eb342a45b464` |
| 2 | 10 | 2022-01-07 | `e9118000-0dd4-440b-8626-87c9b67004e3` |
| 3 | 50 | 2022-01-26 | `0d5f3068-7955-4a39-9608-e9b9fd76798a` |
| 4 | 50 | 2022-02-01 | `9126405b-589e-4aae-b439-d4cad3d618ac` |
| 5 | 50 | 2022-02-16 | `4d7b11a0-4b9d-4022-b97a-7beec3c94269` |
| 6 | 50 | 2022-02-24 | `3bf5c477-e3fd-41f6-bb29-299677861d4f` |
| 7 | 50 | 2022-03-15 | `be8db394-e34d-4603-909b-83dda50c6bd0` |
| 8 | 50 | 2022-03-31 | `e8d7c6aa-75e6-40b4-8d44-d56f4309cf3c` |
| 9 | 49 | 2022-12-31 | `11832b58-60f2-439d-8972-089e23b9a98f` |

Pre-freeze Q-pre: 361 symbols, 6,113 rows, all at version 1. Symbols were ordered by `min(period_end)` and
each chunk started at its own minimum. After chunk 9: 362 symbols (the 361 plus AXP), 6,157 rows, all at
version 2; Q-v1 returned 0 rows. After every chunk the set of version-2 symbols equalled the set processed.

**Deviations from design § Step 5.**
- The canary used one start (2022-01-01) below LYFT's earliest stored period (2023-12-31), so LYFT gained
  7 earlier periods. AXP had no stored rows before the lane and so has no pre-export baseline.
- A chunk start below a symbol's own earliest period adds rows: 7 (canary), 1 (chunk 7), 16 (chunk 9).
- Lane A's pre-export was taken minutes before the freeze, not after it.
- Rules (a) and (b) were computed by a local script over the operator's exports; rule (c) (revenue deltas
  against the canary) and the seeded 20-symbol TTM sample were not run — Q-ttm was run on every chunk instead.

## Canary (hard checks)

| Check | Before | After | Target |
|---|---|---|---|
| LYFT `Q3-2026` roe | 3.663373 | 0.942632 | 0.942632 |
| LYFT `FY2025` roe | −0.875606 | 0.868791 | 0.868791 |
| LYFT `Q3-2026` equity | 767,016,000 | 2,980,873,000 | 2,980,873,000 |
| AXP `Q2-2026` debt-to-equity | no rows | 1.7225 | ≈ 1.73 |

Q-ttm: LYFT, AXP, AAPL all `pass` (n = 4, implied = ttm: 2,809,866,000 / 12,255,000,000 / 128,930,000,000).

## Audit rules per chunk

Rule (a): values going from non-nil to nil, limit 5% of previously non-nil rows. Rule (b): rows where
`|equity − (assets − liabilities)| > 1%` of assets; trips only if the share rises.

| Chunk | Rows pre → post | (a) net income | (a) revenue | (a) eps | (a) roe | (a) D/E | (b) pre | (b) post | Q-ttm pass / fail / skipped |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 32 → 39 | 0/32 | 0/32 | 0/32 | 0/32 | 0/32 | 28/32 | 0/32 | 3 / 0 / 0 |
| 2 | 200 → 200 | 1/172 | 1/175 | 3/191 | 1/182 | 0/136 | 100/145 | 4/145 | 6 / 0 / 4 |
| 3 | 967 → 967 | 0/856 | 0/796 | 0/920 | 0/854 | 1/637 | 421/697 | 77/697 | 41 / 5 / 4 |
| 4 | 991 → 991 | 0/974 | 1/927 | 0/960 | 0/925 | 11/653 | 485/696 | 105/695 | 43 / 3 / 4 |
| 5 | 983 → 983 | 2/941 | 0/900 | 0/960 | 0/884 | 1/647 | 582/791 | 127/791 | 44 / 1 / 5 |
| 6 | 960 → 960 | 1/911 | 16/780 | 0/921 | 1/905 | 0/520 | 609/805 | 157/805 | 43 / 2 / 5 |
| 7 | 912 → 913 | 2/857 | 9/773 | 3/804 | 0/813 | 7/408 | 683/810 | 148/808 | 35 / 4 / 8 |
| 8 | 751 → 751 | 0/658 | 3/566 | 3/582 | 0/627 | 2/353 | 374/523 | 70/523 | 27 / 7 / 10 |
| 9 | 317 → 333 | 0/289 | 0/226 | 0/276 | 0/275 | 2/146 | 246/286 | 52/286 | 29 / 10 / 3 |

No rule tripped. The worst rule (a) share was revenue in chunk 6 (2.05%). Chunk 1 compares LYFT and AAPL only.
The stale-ratio count was 0 in every chunk.

**Values lost (rule (a) rows printed by the script; it prints at most ten per field).** WOLF `FY2026`
(net income, revenue, eps, roe); JEF `Q2-2026`, `Q3-2026` (eps); UNP `Q1-2023` (D/E); BTLN `Q1-2027`
(revenue), `FY2022`, `Q2-2022`, `Q3-2022` (D/E); GMED `FY2024`, `Q1`–`Q3-2024` (D/E); INBS `FY2024`–`FY2026`
(D/E); FOXF `Q1-2022`, `Q1-2023` (net income); UCTT `FY2023` (D/E); UP `FY2021` (net income, roe); CAPR
`Q1-2022`, `Q2-2022`, `Q1`–`Q3-2025`, CYPH `FY2022`, `Q1`–`Q3-2022`, MVIS `Q3-2022` (revenue); SCKT
`Q1-2022`, `Q1-2024` (net income, revenue, eps); ASTS `FY2023`, `Q2-2023`, `Q3-2023`, ATNM `FY2024`,
`Q1`–`Q3-2023` (revenue); DTST `Q1-2025` (eps), `FY2021` (D/E); JILL `FY2024`, METC `Q2-2026`, `Q3-2026`,
MVST `FY2021`, PRSO `FY2021`, SRXH `Q1-2026` (D/E); STI `FY2024`, `Q1-2024`, `Q3-2024` (revenue); CLSK
`FY2024`, `FY2025`, `Q1-2022` (eps); DXLG `FY2021`, XTIA `Q3-2025`, FBLG `FY2023`, `FY2024` (D/E).

## Balance-sheet identity after the repair (rule (b) residual)

Chunks 2–9: 3,500 of 4,753 checked rows failed before; 740 of 4,750 fail after (15.6%). The failures are
concentrated: 75 of 289 symbols have any failing row and 29 fail on every row (CBRE, EXR, PZZA, COTY, MAS,
BHR, USPH, VATE, AMG, ATI, GTES, BROS, BX, VIRT, FCEL, MTN, PLAB, STZ, NUTX, UCTT, NEE and others). That
pattern fits filers that carry equity outside `StockholdersEquity` (non-controlling or redeemable
interests); it was not traced per symbol.

## Q-ttm outside the canary (advisory)

Chunks 2–9: 268 pass, 32 fail, 43 skipped.

- **Fail, n = 3 (23):** CI, RHP, NTCT, APA, ALNY, WWW, NTNX, GDDY, SCKT, SRXH, UPS, CRWD, EDBL, PNNT, TBLA,
  CLSK, PFLT, MLCI, SN, WLTH, FIGR, ELWT, NTSK. The query found three of the four quarters and scaled by
  4/3; inconclusive, not a verified error. The missing quarter is, where checked, the period lost to the
  label collision below.
- **Fail, n < 3 (4):** FBDT, CAST, BULL, ELMT — short histories.
- **Fail, n = 4 (5):** FLXS, INBS, HOPE, ORCL, GURE. ORCL: the query's sum (18,043M) includes the `Q1-2026`
  row, which holds a later period; the stored roe implies 16,210M, consistent with the other three quarters.
  FLXS and INBS show the same row pattern. HOPE (2.3%) and INBS (2.9%) fit the known Q4-derivation / PIT
  false-fail class. **GURE (−7.5M implied against −41.3M) is unexplained**; it has late and amended filings
  in 2026.
- **Skipped (43):** 11 symbols with no quarterly net income at all (JEF, BMO, ETR, SABR, TXNM, AVGO, FMS, BE,
  RAIL, TRIN, VG); 13 with nil roe or equity on the latest quarter (CARR, ET, MTRX, PFSI, FOXF, CCI, ASTS,
  KMX, SNOW, HSY, UWMC, USAR, AVPT); the rest partial quarters. Rule (a) shows these gaps predate the repair.

## Open defect found by this audit

104 of 6,157 rows (1.7%), in 61 of 362 symbols, have a `period_end` more than 30 days after their
`filed_date` (39 by more than 300 days). The dates are identical in the pre-export, so the cause predates
feature 340; at version 2 those rows hold a later period's values under an earlier filed date, which is
look-ahead for point-in-time reads. Recorded as
`docs/reports/2026-11-16-marketdata-edgar-period-label-collision-defect.md` (status `open`).

## Not done

- Lane B (DO staging): held by the operator; still frozen and at version 1.
- PIT drift for backtests (design § Open Risks) was not measured.
- `@AC-4 @feature-216` was not re-checked against the database.
