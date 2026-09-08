# Feature: fundamentals-blend-strategy-restrictions

**Development Branch**: `feature/fundamentals-blend-strategy-restrictions`
**Created**: 2026-09-08
**Last Updated**: 2026-09-08

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-08 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-09-08 | `draft` → `spec-ready` | /sdd-review | Product spec approved (0 warnings after fix) |
| 2026-09-08 | `spec-ready` → `design-approved` | /sdd-design | Design debated (3 rounds, quick) and approved; recon.md + design.md written |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon Dossier](recon.md) — grounded codebase discovery (Phase 0)
- [Design](design.md) — debated, user-approved architecture (Phase 1, 3 rounds)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fundamentals-blend-strategy-restrictions`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Harden the fundamentals blend strategy (configured via `analysis.engine.fundamentals_blend_strategy_id`) so it executes exclusively against the fundamentals signal universe and cannot be deactivated, toggled non-live, or soft-deleted via `ManageStrategy`/`SetStrategyLive` RPCs.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Service owner (`xstockstrat-analysis`) | Backtest reproducibility, strategy scoring determinism, no look-ahead bias |
| Service owner (`xstockstrat-analysis`) — config step | Config key naming (`<service>.<category>.<key>`), environment/global-per-user scoping |

## Next Action

`/sdd-spec fundamentals-blend-strategy-restrictions` — generate implementation spec from the approved design
