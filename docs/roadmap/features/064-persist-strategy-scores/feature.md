# Feature: persist-strategy-scores

**Lifecycle Status**: `implementation-ready`
**Development Branch**: `feature/persist-strategy-scores`
**Created**: 2026-07-03
**Last Updated**: 2026-07-03

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-07-03 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-07-03 | `draft` → `spec-ready` | /sdd-review | Product spec approved (1 warning: 3 open questions deferred to /sdd-design) |
| 2026-07-03 | `spec-ready` → `design-approved` | /sdd-design | Design debated (1 round, quick) and approved; recon.md + design.md written |
| 2026-07-03 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 6 steps |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Recon](recon.md) — grounded codebase dossier (Phase 0)
- [Design](design.md) — debated & approved architecture (Phase 1)
- [Implementation Spec](implementation-spec.md) — 6 numbered steps with codebase evidence
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Persist strategy scores computed by `ScoreStrategy` in `xstockstrat-analysis` to a DB-backed
table so `ListStrategies` / `GetStrategyReport` (and the insights views that consume them) survive
an analysis-service restart, instead of being lost from the in-memory `self._strategies` dict.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-analysis` (service owner) | Backtest reproducibility, strategy scoring determinism, no look-ahead bias |
| DBA | Migration NNN numbering (no gaps/conflicts), up+down pair present, index correctness, run-order compliance |

## Next Action

`/sdd-review persist-strategy-scores impl-spec` — validate implementation spec, then `/sdd-execute persist-strategy-scores`
