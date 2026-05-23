# Feature: signal-source-weighting

**Lifecycle Status**: `implementation-ready`
**Development Branch**: `feature/signal-source-weighting`
**Created**: 2026-05-16
**Last Updated**: 2026-05-23

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-16 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-05-23 | `draft` → `spec-ready` | /sdd-review | Product spec approved (2 warnings) |
| 2026-05-23 | `spec-ready` → `implementation-ready` | /sdd-spec | Implementation spec generated with 4 steps |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Add per-source reliability weights to the signal aggregation in the analysis service so that higher-trust sources (e.g. Goldman) have proportionally more influence on the combined conviction score than low-quality newsletters. Weights are configurable via the config service without code changes.

## Reviewers

_(Snapshot finalized by /sdd-spec on 2026-05-23 — re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-analysis` owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias |
| `xstockstrat-config` owner | Config key naming (`<service>.<category>.<key>`), environment/trading_mode scoping, WatchConfig stream stability |

## Next Action

`/sdd-review signal-source-weighting impl-spec` — validate implementation spec, then `/sdd-execute signal-source-weighting`
