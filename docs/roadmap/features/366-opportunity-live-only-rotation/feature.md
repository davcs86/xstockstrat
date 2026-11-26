# Feature: opportunity-live-only-rotation

**Development Branch**: `feature/opportunity-live-only-rotation`
**Created**: 2026-11-26
**Last Updated**: 2026-11-26

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-26 | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec opportunity-live-only-rotation`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Replace the opportunity compute's live-only truncation (only the top
`opportunity.max_live_only_symbols_per_compute` non-held signal symbols get live-strategy rows) with a
rotation across compute passes, so every live-covered signal symbol gets its strategy rows within a
bounded number of passes while per-compute cost stays capped.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| xstockstrat-analysis owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias |
| DBA (rotation-cursor migration in the `analysis` schema) | Schema ownership, migration run order, connection budget |

## Next Action

`/sdd-review opportunity-live-only-rotation product-spec` — AI review of product spec before running /sdd-spec
