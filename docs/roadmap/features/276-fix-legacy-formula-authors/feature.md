# Feature: fix-legacy-formula-authors

**Type**: bug
**Development Branch**: `feature/fix-legacy-formula-authors`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-22-indicators-legacy-username-formula-authors-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-22
**Last Updated**: 2026-10-22

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-22 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from the defect report; Track C |
| 2026-10-22 | `draft` → `spec-ready` | /sdd-review | Product spec approved (9 warnings) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-legacy-formula-authors`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Six staging formulas store the legacy username `davcs86` as `author` instead of the owner's user id, so the owner cannot list, read or execute them and any strategy using them fails evaluation. This is the root trigger of the 2026-10-15 backtest silent-skip defect (feature 275).

## Next Action

`/sdd-design fix-legacy-formula-authors` — recommended design depth: full (data rewrite on ownership rows, production unchecked); resolve OQ-1 to OQ-4 at design before `/sdd-spec`; see context.md
