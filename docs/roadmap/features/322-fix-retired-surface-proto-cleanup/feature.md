# Feature: fix-retired-surface-proto-cleanup

**Type**: bug
**Development Branch**: `feature/fix-retired-surface-proto-cleanup`
**GitHub Issue**: none (Issues disabled) — reports: docs/reports/2026-10-19-trading-mode-axis-retained-defect.md, docs/reports/2026-10-19-opportunity-sparkline-removal-residue-defect.md, docs/reports/2026-10-19-proto-contract-hygiene-defect.md
**Severity**: SEV-3
**Created**: 2026-11-10
**Last Updated**: 2026-11-10

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-10 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from 3 defect report(s) (clustered triage) |
| 2026-11-10 | `draft` → `spec-ready` | /sdd-review | Product spec approved (4 warnings) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-retired-surface-proto-cleanup`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Residue of retired surfaces (the `trading_mode` axis, the server-side opportunity sparkline) and proto
contract hygiene drift (stalled timeframe migration, orphaned common types, closed-set strings, a
mislabelled `user_id`) still mislead agents copying patterns from code, docs and contracts.

## Next Action

`/sdd-design fix-retired-surface-proto-cleanup` — full design recommended (proto (non-breaking) + config migration; many services)
