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

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-trader-position-fundamentals`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

The trader position page's Fundamentals card stays on "Loading fundamentals…" forever when
`GetFundamentals` stalls, because neither the trader BFF nor the browser transport sets a deadline;
the card's existing error branch is never reached.

## Next Action

`/sdd-spec fix-trader-position-fundamentals` — recommended design depth (skip / quick / full) from triage; see context.md
