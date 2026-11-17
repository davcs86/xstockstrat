# Feature: fix-trading-reconcile-reads

**Type**: bug
**Development Branch**: `feature/fix-trading-reconcile-reads`
**GitHub Issue**: none — Issues disabled; defect report `docs/reports/2026-11-17-trading-reconcile-reads-first-500-positions-defect.md`
**Severity**: SEV-2
**Created**: 2026-11-17
**Last Updated**: 2026-11-17

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-17 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-11-17-trading-reconcile-reads-first-500-positions-defect.md` |
| 2026-11-17 | `draft` → `spec-ready` | /sdd-review | Product spec approved (5 warnings) |
| 2026-11-17 | `spec-ready` → `design-approved` | /sdd-design | Design debated (6 rounds, full) and approved; recon.md + debate.md + design.md written |
| 2026-11-17 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 5 steps; FR-5 and @AC-4 appended per operator decision (design gate r6) |
| 2026-11-17 | `implementation-ready` → `in-progress` | /sdd-execute | → in-progress (sdd-batch-execute setup) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier (Phase 0)
- [Debate Register](debate.md) — settled decisions, locked rejected alternatives, objections
- [Design](design.md) — approved design (chosen approach, rejected alternatives, open risks)
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Reviewers

| Role | Steps | Review Focus |
|---|---|---|
| xstockstrat-trading service owner | 1, 2, 3, 4 | Order execution correctness, broker API safety, fill detection, paper-only dev invariant, position limit enforcement |

Step 5 (`docs`) has no reviewer.

---

## Summary

`reconcileTick` reads one 500-row `ListPositions` page per broker account and drops the token; a held symbol past row 500 reads as platform qty 0 and can raise a false quantity-discrepancy finding that halts the account.

## Next Action

`/sdd-review fix-trading-reconcile-reads impl-spec` — validate implementation spec, then `/sdd-execute fix-trading-reconcile-reads`
