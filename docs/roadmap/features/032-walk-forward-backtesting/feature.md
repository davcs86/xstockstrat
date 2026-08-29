# Feature: walk-forward-backtesting

**Development Branch**: `feature/walk-forward-backtesting`
**Created**: 2026-05-26
**Last Updated**: 2026-08-29

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-26 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-08-29 | `draft` (unchanged) | product-spec rescope | **Rescoped walk-forward → regime-segmented backtest.** The platform has no strategy-parameter optimizer (confirmed by grep), so the in-sample/out-of-sample "walk-forward" framing was a misnomer — with nothing tuned, each window is just an independent backtest. Reframed the value honestly as *regime-consistency* stats (per-window + worst-window Sharpe, consistency ratio, Sharpe dispersion); true walk-forward recorded as a Future Extension gated on an optimizer. Proto/config renamed (`RunSegmentedBacktest`, `analysis.segmentedbacktest.max_total_window_days`). See context.md 2026-08-29. |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec walk-forward-backtesting`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Adds a **regime-segmented backtest** to the analysis service: partition history into rolling windows, run the existing backtest on each independently (fixed strategy parameters — the platform has no optimizer), and report per-window and aggregate consistency statistics (mean/worst-window Sharpe, consistency ratio, Sharpe dispersion) so an operator can tell a strategy that worked across many regimes from one carried by a single lucky stretch — fast, and covering downturns paper mode hasn't sampled yet. **Not** walk-forward optimization and **not** an overfitting guard (both require a parameter optimizer that does not exist); true walk-forward is a documented Future Extension gated on that optimizer.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-analysis` owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias |
| `xstockstrat-insights` owner | Analytics display accuracy, SSE polling resilience, read-only access pattern |

## Next Action

`/sdd-review walk-forward-backtesting product-spec` — AI review of product spec before running /sdd-spec
