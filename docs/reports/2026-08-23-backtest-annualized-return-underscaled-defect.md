# Defect: Backtest `annualized_return` is ~30× under-scaled for multi-symbol runs

**Recorded**: 2026-08-23
**Severity**: SEV-2
**Impact type**: misleading-backtest-metric
**Environment**: dev (main-dev) / staging
**Affected service(s)**: xstockstrat-analysis
**Config-only fix possible**: no

## Observed

Multi-symbol `RunBacktest` runs report an `annualized_return` roughly **30× smaller** than the
run's `total_return`, even over a full ~1-year window where the two should be nearly equal.
Observed pairs (`total_return → annualized_return`):

| total_return | reported annualized_return |
|---|---|
| −0.0650 | −0.00207 |
| +0.2152 | +0.00603 |
| −0.2126 | −0.00735 |

Live confirmation this session (staging, frozen 1-year window 2025-08-01→2026-08-01, 33 symbols):
`dip_buyer_vol_stop_m25` reported `total_return=1.3634` but `annualized_return=0.0269` — a +136%
run annualized to +2.7%.

## Expected

Over a ~1-year window, `annualized_return` must be approximately equal to `total_return`
(exponent ≈ 1). The reported figure is off by a factor of ~30, making the field unusable for
comparing runs or interpreting a strategy's return profile.

## Reproduction

1. `RunBacktest` any registered strategy over an explicit ~1-year window with a multi-symbol list
   (e.g. the 33-symbol staging cohort), `initial_capital=100000`.
2. Compare the returned `total_return` and `annualized_return` in the compact summary.
3. Observe `annualized_return ≈ total_return / ~30` instead of `≈ total_return`.

## Evidence

`services/xstockstrat-analysis/app/handlers/servicer.py:3630-3632` (`_compute_metrics`):
```python
total_return = (equity[-1] - initial_equity) / initial_equity
n_days = len(daily_equity) - 1
annualized_return = (1 + total_return) ** (252.0 / max(n_days, 1)) - 1 if n_days > 0 else 0.0
```
The geometric annualization formula itself is correct, but `n_days` is derived from
`len(daily_equity)`. For the **aggregate** metrics call (`servicer.py:623`), `daily_equity` is the
**concatenation of all per-symbol equity curves** — `RunBacktest` loops symbols serially
(`servicer.py:522`), threads one running equity through each (`initial_equity=equity`,
`servicer.py:525-529`), and appends each symbol's curve end-to-end (`daily_equity.extend(daily_eq)`,
`servicer.py:571`). So `n_days ≈ N_symbols × window_days ≈ 33 × 248 ≈ 8170` instead of ~252, and the
exponent `252/n_days` is ~33× too small.

**Back-solved confirmation** — solving `(1+total)^x − 1 = annualized` for the exponent `x` on the
three observed pairs yields a *constant* `x ≈ 0.03084` → `n_days = 252/x ≈ 8170` in all three cases,
matching `33 × 248`. This proves the cause is the period count, not a flat divisor or a
geometric/arithmetic error.

**Sharpe is NOT affected** — `servicer.py:3636` uses a flat `math.sqrt(252)` factor that does not
depend on `n_days`, so its periodization is correct (its occasional sign divergence from
`total_return` is an arithmetic-mean-vs-compounded effect, not this bug). No Sharpe change is
warranted.

**Per-symbol evidence cells are NOT affected** — the per-symbol cell call
(`_compute_metrics(daily_eq, trades, daily_eq[0])`, `servicer.py:558`) passes a single symbol's
curve whose length ≈ the true window, so its `n_days` is already correct. The feature-065 derived
grade reads only `sharpe_ratio`/`max_drawdown`/`win_rate` from those cells
(`_score_from_metrics`, `servicer.py:3307-3333`) — `annualized_return` is not a grade input — so a
fix scoped to the aggregate call is **grade-neutral**.

## Root cause hypothesis

`_compute_metrics` conflates "number of periods in the equity series" with "number of trading days
in the backtest window." That equivalence holds for a single-symbol curve but breaks for the
multi-symbol aggregate, whose curve is a concatenation of N per-symbol curves. The fix is to
annualize the aggregate over the run's real calendar/window span (available from `request.range`),
independent of the concatenated curve length, while leaving the per-symbol cell path unchanged.

## Proposed fix

Scope the fix to the aggregate call only (per-symbol cells already correct):
- Add an optional `period_years` parameter to `_compute_metrics`; when provided, annualize as
  `(1 + total_return) ** (1.0 / period_years) - 1`.
- At the aggregate call site (`servicer.py:623`), compute `period_years` from
  `request.range.end - request.range.start` (already defaulted upstream) and pass it in.
- Leave the per-symbol cell calls unchanged (default → legacy curve-length behavior).
- Add a unit test asserting the three observed pairs annualize to ≈ their total_return over a
  1-year window, and that a 6-month window scales geometrically.

Forward-only: historical `analysis.backtest_runs.annualized_return` rows keep the old value until
re-run/backfilled. No derived-grade recompute is required (annualized is not a grade input).

Full analysis: `_tasks/x-backtest-metrics-audit.md` (Q3).

## Confidence

high
