# Feature: fix-analysis-admin-formula-refusal

**Type**: bug
**Development Branch**: `feature/fix-analysis-admin-formula-refusal`
**Defect report**: `docs/reports/2026-11-04-analysis-admin-formula-refusal-misclassified-defect.md` (Issues disabled; no GitHub issue)
**Severity**: SEV-2
**Created**: 2026-11-04
**Last Updated**: 2026-11-04

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-04 | `bug-reported` -> `draft` | /sdd-triage | Product spec pre-populated from defect report |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-analysis-admin-formula-refusal`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Analysis folds indicators' deliberate PERMISSION_DENIED (admin may not execute another user's formula) into a data-unavailable row in `_compute_opportunities` and lets it escape as ERROR in `EvaluateReadiness`; feature 275 fixed only the backtest path.

## Next Action

`/sdd-design fix-analysis-admin-formula-refusal` — recommended design depth (full) from triage; see context.md
