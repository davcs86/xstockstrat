# Feature: signal-source-weighting

**Lifecycle Status**: `spec-ready`
**Development Branch**: `feature/signal-source-weighting`
**Created**: 2026-05-16
**Last Updated**: 2026-05-16

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-16 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-05-23 | `draft` → `spec-ready` | /sdd-review | Product spec approved (2 warnings) |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec signal-source-weighting`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Add per-source reliability weights to the signal aggregation in the analysis service so that higher-trust sources (e.g. Goldman) have proportionally more influence on the combined conviction score than low-quality newsletters. Weights are configurable via the config service without code changes.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-analysis` owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias |
| `xstockstrat-config` owner | Config key naming (`<service>.<category>.<key>`), environment/trading_mode scoping, WatchConfig stream stability |

## Next Action

`/sdd-spec signal-source-weighting` — generate implementation spec from the approved product spec
