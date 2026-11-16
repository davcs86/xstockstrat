# Feature: fix-row-menu-stays-open

**Type**: bug
**Development Branch**: `feature/fix-row-menu-stays-open`
**GitHub Issue**: none (Issues disabled) — report: `docs/reports/2026-11-16-ui-row-menu-stays-open-after-confirm-defect.md`
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
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-row-menu-stays-open`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

A row action that asks for confirmation (cancel an order, resume an account, and every other
`confirm` action on the shared row menu) leaves the row's three-dots menu open and modal after the
dialog is confirmed or cancelled, so the user's next click only closes the menu. The fix closes the
menu when the item is chosen and leaves the page interactive, with focus back on the row's actions
trigger, once the dialog resolves.

## Next Action

`/sdd-design fix-row-menu-stays-open quick` — design depth chosen by the operator; see context.md
