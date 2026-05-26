# Feature: walk-forward-backtesting

**Lifecycle Status**: `draft`
**Development Branch**: `feature/walk-forward-backtesting`
**Created**: 2026-05-26
**Last Updated**: 2026-05-26

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-26 | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec walk-forward-backtesting`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Extends the analysis service's existing backtesting with a walk-forward validation mode that runs rolling in-sample optimization and out-of-sample test windows, reporting per-window out-of-sample Sharpe ratios to detect overfitting before any live capital commitment.

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
