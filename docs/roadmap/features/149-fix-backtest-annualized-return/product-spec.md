# Product Spec: fix-backtest-annualized-return

**Type**: bug
**Defect Report**: `docs/reports/2026-08-23-backtest-annualized-return-underscaled-defect.md`
**Severity**: SEV-2
**Created**: 2026-08-23

---

## Problem Statement

Multi-symbol `RunBacktest` runs report an `annualized_return` roughly **30× smaller** than
`total_return`, even over a full ~1-year window where the two should be nearly equal. Observed
pairs: `-0.0650→-0.00207`, `+0.2152→+0.00603`, `-0.2126→-0.00735`; live this session
`dip_buyer_vol_stop_m25` reported `total_return=1.3634` but `annualized_return=0.0269`.

Expected: over a ~1-year window `annualized_return ≈ total_return` (annualization exponent ≈ 1).

## Reproduction Steps

1. `RunBacktest` any registered strategy over an explicit ~1-year window with a multi-symbol list
   (e.g. the 33-symbol staging cohort), `initial_capital=100000`.
2. Compare `total_return` and `annualized_return` in the compact summary.
3. Observe `annualized_return ≈ total_return / ~30`.

## Root Cause Hypothesis

`_compute_metrics` (`services/xstockstrat-analysis/app/handlers/servicer.py:3630-3632`) derives
`n_days = len(daily_equity) - 1` and annualizes `(1+total_return) ** (252/n_days) - 1`. The formula
is correct, but for the **aggregate** call (`servicer.py:623`) `daily_equity` is the concatenation
of all per-symbol curves (`servicer.py:522,525-529,571`), so `n_days ≈ N_symbols × window_days ≈
33 × 248 ≈ 8170` instead of ~252 — the exponent is ~33× too small. Back-solving the three observed
pairs yields a constant `n_days ≈ 8170`, confirming the cause.

Sharpe is unaffected (flat `sqrt(252)`, `servicer.py:3636`). Per-symbol evidence cells are
unaffected (single-symbol curve, `servicer.py:558`) and the feature-065 grade reads only
sharpe/max-drawdown/win-rate from those cells (`servicer.py:3307-3333`), so `annualized_return` is
not a grade input — a fix scoped to the aggregate call is grade-neutral.

## Affected Services

- xstockstrat-analysis (only)

## Fix Scope

- [x] No proto changes anticipated (`annualized_return` field already exists on `BacktestResult`)
- [x] No database migrations anticipated (forward-only; historical rows untouched)
- [x] No config key changes anticipated

## Acceptance Criteria

See `acceptance.feature` — a regression scenario that fails on the buggy code and passes after the
fix. Plus: existing analysis tests pass; per-symbol evidence-cell metrics and the derived grade are
unchanged (grade-neutral); Sharpe unchanged.

## Out of Scope

- The serial-parlay `total_return` aggregation (finding #2 — separate feature; changing it breaks
  banked-backtest comparability).
- The same-bar-close fill model (finding #3 — separate feature).
- Backfilling historical `analysis.backtest_runs.annualized_return` rows (forward-only fix).
- Any change to Sharpe periodization.
