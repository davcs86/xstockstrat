# Feature: fix-stored-edgar-periods

**Type**: bug
**Development Branch**: `feature/fix-stored-edgar-periods`
**GitHub Issue**: n/a — Issues disabled; defect report `docs/reports/2026-10-06-edgar-stored-de-predates-financial-debt-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-06
**Last Updated**: 2026-10-06

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-06 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from defect report `docs/reports/2026-10-06-edgar-stored-de-predates-financial-debt-defect.md` |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-stored-edgar-periods`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Stored EDGAR historical periods (and the snapshot projected from them) still carry the pre-feature-211
total-liabilities D/E (AXP ≈ 8.8) instead of the launched financial-debt D/E (AXP ≈ 1.73, 211 `@AC-3`);
existing rows were apparently never re-derived after 211 shipped.

## Next Action

`/sdd-design fix-stored-edgar-periods quick` — recommended design depth (skip / quick / full) from triage; see context.md
