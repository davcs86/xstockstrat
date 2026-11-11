# Feature: fix-marketdata-miss-path-noise

**Type**: bug
**Development Branch**: `feature/fix-marketdata-miss-path-noise`
**GitHub Issue**: none (Issues disabled) — reports: docs/reports/2026-11-04-cancel-warn-remaining-sites-defect.md, docs/reports/2026-11-04-marketdata-getbars-miss-path-refetch-every-call-defect.md
**Severity**: SEV-3
**Created**: 2026-11-10
**Last Updated**: 2026-11-10

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-10 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from 2 defect report(s) (clustered triage) |
| 2026-11-10 | `draft` → `spec-ready` | /sdd-review | Product spec approved (4 warnings) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-marketdata-miss-path-noise`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Repeated WARN noise masks real failures: cancel-caused WARN sites feature 290 left in marketdata and portfolio, and
`GetBars` live-refetching (plus a WARN) on every call for symbols that have no stored bars and return none.

## Next Action

`/sdd-design fix-marketdata-miss-path-noise` — full design recommended (marketdata + portfolio)
