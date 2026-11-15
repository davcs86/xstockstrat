# Feature: fix-indicator-pane-warmup

**Type**: bug
**Development Branch**: `feature/fix-indicator-pane-warmup`
**GitHub Issue**: n/a (Issues disabled) — report `docs/reports/2026-11-15-indicator-panel-sma200-single-point-defect.md`
**Severity**: SEV-3
**Created**: 2026-11-15
**Last Updated**: 2026-11-15

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-15 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from the defect report |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-indicator-pane-warmup`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

On the symbol page indicator chart, a 200-period average over a ~190-bar window renders one dot because the series is computed without a warm-up prefix.

## Next Action

`/sdd-design fix-indicator-pane-warmup` — recommended design depth (full) from triage; see context.md
