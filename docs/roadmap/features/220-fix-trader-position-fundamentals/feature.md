# Feature: fix-trader-position-fundamentals

**Type**: bug
**Development Branch**: `feature/fix-trader-position-fundamentals`
**GitHub Issue**: n/a — Issues disabled; defect report `docs/reports/2026-10-06-ui-fundamentals-infinite-loading-defect.md` (pruned 2026-10-14; `git show 09ec8d9a:docs/reports/2026-10-06-ui-fundamentals-infinite-loading-defect.md`)
**Severity**: SEV-3
**Created**: 2026-10-06
**Last Updated**: 2026-10-06
**Committed to main**: 595bd1d4effdc73153752d8dce5cee69d1a6f656
**Launched date**: 2026-10-08
**Archived**: 2026-10-14

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-06 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from defect report `docs/reports/2026-10-06-ui-fundamentals-infinite-loading-defect.md` (pruned 2026-10-14; `git show 09ec8d9a:docs/reports/2026-10-06-ui-fundamentals-infinite-loading-defect.md`) |
| 2026-10-06 | `draft` → `implementation-ready` → `in-progress` → `code-completed` | /sdd-spec + /sdd-execute sequential | BFF fundamentals deadline (15s) + stalled-upstream e2e regression |

| 2026-10-08 | `code-completed` → `launched` | CI workflow | Promoted via PR #1233; committed 595bd1d4effdc73153752d8dce5cee69d1a6f656 |
| 2026-10-14 | `launched` | /sdd-archiver | Archived: synthesis → context.md + Ledger insights(0)/fails(0); pruned 2 spec(s) |
---

## Artifacts

- Product Spec — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15); promoted to services/xstockstrat-ui/acceptance/fix-trader-position-fundamentals.feature (C-16)
- Implementation Spec — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

The trader position page's Fundamentals card stays on "Loading fundamentals…" forever when
`GetFundamentals` stalls, because neither the trader BFF nor the browser transport sets a deadline;
the card's existing error branch is never reached.

## Next Action

Merge the integration PR into `main-dev`.
