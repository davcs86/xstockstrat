# Feature: fix-trader-position-fundamentals

**Type**: bug
**Development Branch**: `feature/fix-trader-position-fundamentals`
**GitHub Issue**: n/a — Issues disabled; defect report `docs/reports/2026-10-06-ui-fundamentals-infinite-loading-defect.md`
**Severity**: SEV-3
**Created**: 2026-10-06
**Last Updated**: 2026-10-06

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-06 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from defect report `docs/reports/2026-10-06-ui-fundamentals-infinite-loading-defect.md` |
| 2026-10-06 | `draft` → `implementation-ready` → `in-progress` → `code-completed` | /sdd-spec + /sdd-execute sequential | BFF fundamentals deadline (15s) + stalled-upstream e2e regression |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — steps + deviation log
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

The trader position page's Fundamentals card stays on "Loading fundamentals…" forever when
`GetFundamentals` stalls, because neither the trader BFF nor the browser transport sets a deadline;
the card's existing error branch is never reached.

## Next Action

Merge the integration PR into `main-dev`.
