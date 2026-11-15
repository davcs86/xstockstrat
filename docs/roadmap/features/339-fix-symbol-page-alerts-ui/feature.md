# Feature: fix-symbol-page-alerts-ui

**Type**: bug
**Development Branch**: `feature/fix-symbol-page-alerts-ui`
**GitHub Issue**: n/a (Issues disabled) — report `docs/reports/2026-11-15-ui-symbol-page-and-alerts-drawer-defects-defect.md`
**Severity**: SEV-3
**Created**: 2026-11-15
**Last Updated**: 2026-11-15

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-15 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from the defect report |
| 2026-11-15 | `draft` → `spec-ready` | /sdd-review | Product spec approved (6 warnings) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-symbol-page-alerts-ui`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Four trader-segment display defects: the Fundamentals card overflows at mobile width, a strategy-less opportunity chip is labelled with the ticker, the header Alerts drawer never shows stored unread alerts, and a checked switch renders unchecked.

## Next Action

`/sdd-design fix-symbol-page-alerts-ui quick` — quick design recommended (SEV-3, single service, no proto/migration/config; one layout fork — the Fundamentals card redesign — to debate once)
