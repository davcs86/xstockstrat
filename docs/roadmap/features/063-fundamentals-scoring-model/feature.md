# Feature: fundamentals-scoring-model

**Lifecycle Status**: `spec-ready`
**Development Branch**: `feature/fundamentals-scoring-model`
**Created**: 2026-06-26
**Last Updated**: 2026-06-26

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-06-26 | `idea` → `draft` | /sdd-story | Product spec generated (feature 6 of 6 in the screener initiative) |
| 2026-06-26 | `draft` → `spec-ready` | /sdd-review | Product spec approved (3 warnings fixed: resolved weights→formula params (no config keys, closes 062 namespace risk); corrected typed-params dep 052→058-formula-parameters) |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fundamentals-scoring-model`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

The concrete value-plus-quality composite that turns a symbol's raw fundamentals into a single 0–1
score (and value/quality sub-scores) consumed by the Feature 062 producer. Delivered **as a formula**
— reusing the indicators sandbox via `ExecuteFormula` with fundamentals passed in `input_data` — so
the model is transparent, tunable via typed parameters (Feature 052), and swappable without a deploy.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-indicators` (service owner) | Formula sandboxing, numeric precision, missing-metric robustness, no side effects |
| `xstockstrat-analysis` (service owner) | Correct consumption of the composite + sub-scores, cross-sectional step correctness |
| `xstockstrat-config` (service owner) | Any `analysis.fundsignal.*` weight keys not already owned by 062 |

## Next Action

`/sdd-spec fundamentals-scoring-model` — generate implementation spec
