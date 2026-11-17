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

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-trading-reconcile-reads`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

`reconcileTick` reads one 500-row `ListPositions` page per broker account and drops the token; a held symbol past row 500 reads as platform qty 0 and can raise a false quantity-discrepancy finding that halts the account.

## Next Action

`/sdd-design fix-trading-reconcile-reads quick` — recommended design depth (quick) from triage; see context.md
