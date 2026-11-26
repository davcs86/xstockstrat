# Feature: fix-a-filtered-listopportunities

**Type**: bug
**Development Branch**: `feature/fix-a-filtered-listopportunities`
**GitHub Issue**: none (Issues disabled) — defect report `docs/reports/2026-11-25-analysis-filtered-empty-opportunity-read-kicks-full-recompute-defect.md`
**Severity**: SEV-3
**Created**: 2026-11-25
**Last Updated**: 2026-11-25

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-25 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from defect report `docs/reports/2026-11-25-analysis-filtered-empty-opportunity-read-kicks-full-recompute-defect.md` |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-a-filtered-listopportunities`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

A ListOpportunities read whose filters match no rows takes the no-rows branch and kicks a full
background recompute even though the user's queue holds unexpired rows.

## Next Action

`/sdd-spec fix-a-filtered-listopportunities` — recommended design depth (skip) from triage; see context.md
