# Feature: fix-replace-tif-before-intent

**Type**: bug
**Development Branch**: `feature/fix-replace-tif-before-intent`
**GitHub Issue**: none (Issues disabled) — report: `docs/reports/2026-11-16-replace-order-tif-validation-after-intent-claim-defect.md`
**Severity**: SEV-3
**Created**: 2026-11-16
**Last Updated**: 2026-11-16

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-16 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from the defect report (`--from-report`) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-replace-tif-before-intent`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

`ReplaceOrder` claims its dedup intent and marks the order PENDING before it validates the requested
time-in-force, so a TIF the broker does not allow strands a PENDING intent for a request that never
reached the broker. The fix validates the TIF before any intent is claimed.

## Next Action

`/sdd-review fix-replace-tif-before-intent product-spec`, then `/sdd-design fix-replace-tif-before-intent quick` — design depth chosen by the operator; see context.md
