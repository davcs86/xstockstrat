# Feature: fix-stored-edgar-periods

**Type**: bug
**Development Branch**: `feature/fix-stored-edgar-periods`
**GitHub Issue**: n/a — Issues disabled; defect report `docs/reports/2026-10-06-edgar-stored-de-predates-financial-debt-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-06
**Last Updated**: 2026-10-06
**Committed to main**: 595bd1d4effdc73153752d8dce5cee69d1a6f656
**Launched date**: 2026-10-08

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-06 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from defect report `docs/reports/2026-10-06-edgar-stored-de-predates-financial-debt-defect.md` |
| 2026-10-06 | `draft` → `implementation-ready` → `in-progress` → `code-completed` | /sdd-spec + /sdd-execute sequential | derivation_version + guarded in-place upgrade + edgar snapshot invalidation + golden drift guard |

| 2026-10-08 | `code-completed` → `launched` | CI workflow | Promoted via PR #1233; committed 595bd1d4effdc73153752d8dce5cee69d1a6f656 |
---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — steps + deviation log
- [Design](design.md) — operator decision + approach
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Stored EDGAR historical periods (and the snapshot projected from them) still carry the pre-feature-211
total-liabilities D/E (AXP ≈ 8.8) instead of the launched financial-debt D/E (AXP ≈ 1.73, 211 `@AC-3`);
existing rows were apparently never re-derived after 211 shipped.

## Next Action

Merged (222 rode in with this squash; 217 renumbered to migration 009); then run the single fundamentals re-backfill (`docs/runbooks/historical-backfill.md` § Re-deriving stored periods) and calibrate 217's sector `de_bad`/`roe_bad`.
