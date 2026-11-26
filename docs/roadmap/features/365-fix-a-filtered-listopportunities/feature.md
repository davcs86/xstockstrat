# Feature: fix-a-filtered-listopportunities

**Type**: bug
**Development Branch**: `feature/fix-a-filtered-listopportunities`
**GitHub Issue**: none (Issues disabled) — defect report `docs/reports/2026-11-25-analysis-filtered-empty-opportunity-read-kicks-full-recompute-defect.md`
**Severity**: SEV-3
**Created**: 2026-11-25
**Last Updated**: 2026-11-26

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-25 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from defect report `docs/reports/2026-11-25-analysis-filtered-empty-opportunity-read-kicks-full-recompute-defect.md` |
| 2026-11-26 | `draft` → `spec-ready` | /sdd-review | Product spec approved (5 warnings) |
| 2026-11-26 | `spec-ready` → `design-approved` | /sdd-design | Design debated (2 rounds, full) and approved; recon.md + debate.md + design.md written |
| 2026-11-26 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 3 steps |
| 2026-11-26 | `implementation-ready` → `in-progress` | /sdd-execute | → in-progress (sdd-batch-execute setup) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier (Phase 0)
- [Debate Register](debate.md) — D-1..D-6, R-1..R-6, O-1..O-8
- [Design](design.md) — approved design: `elif not await opps.has_fresh(user_id)` gate
- [Implementation Spec](implementation-spec.md) — 3 steps (Steps 1+2 one atomic unit: servicer `elif` gate + tests/stubs; Step 3 docs)
- [Context Log](context.md) — session history, decisions, deviations

---

## Reviewers

_Snapshot finalized by /sdd-spec on 2026-11-26 from the per-step **Reviewers**. Re-run /sdd-spec if the registry changes._

| Role | Review Focus |
|---|---|
| Service owner `xstockstrat-analysis` | Backtest reproducibility, strategy scoring determinism, no look-ahead bias (steps 1-2) |

---

## Summary

A ListOpportunities read whose filters match no rows takes the no-rows branch and kicks a full
background recompute even though the user's queue holds unexpired rows.

## Next Action

`/sdd-review fix-a-filtered-listopportunities impl-spec` — validate implementation spec, then `/sdd-execute fix-a-filtered-listopportunities`
