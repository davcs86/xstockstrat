# Feature: fundamentals-formula-inputs

**Development Branch**: `feature/fundamentals-formula-inputs`
**Created**: 2026-09-21
**Last Updated**: 2026-09-21

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-21 | `idea` → `draft` | /sdd-story | Product spec generated (initial scope: formula signal producer) |
| 2026-09-21 | `draft` → `draft` | /sdd-story | Rescoped after user correction: NOT a producer/loop — a fundamentals-fed custom formula usable as a strategy component; renamed from `formula-signal-producer` |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fundamentals-formula-inputs`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Let a **custom formula used as a strategy component** (`COMPONENT_KIND_CUSTOM_FORMULA`) consume
**fundamentals as inputs** — the same input/output contract as the fundamentals *scoring formula*
(feature 063: fundamentals `input_data` → composite score `output`) — so a strategist can author one
fundamentals-scoring formula and use it directly in a strategy's entry/exit rules. The fundamentals
fed are **context-dependent**: point-in-time as-of each bar (feature 198's PIT store) in a backtest,
current snapshot in live/screener. No background loop or signal emission.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-analysis` owner | Backtest reproducibility, strategy scoring determinism, **no look-ahead bias** (PIT-as-of-bar fundamentals feeding a formula component) |
| `xstockstrat-indicators` owner | `ExecuteFormula` input_data/output contract stability (consumed unchanged; confirm no new formula-declaration surface is needed) |
| `xstockstrat-ui` owner | ComponentEditor affordance for fundamentals-scoring formulas (if any) |
| `xstockstrat-agent` owner | `manage_strategy` formula-component contract (already supports formula components) |

## Next Action

`/sdd-review fundamentals-formula-inputs product-spec` — AI review of product spec before running /sdd-spec
