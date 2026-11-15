# Feature: fix-fundamentals-roe-unit

**Type**: bug
**Development Branch**: `feature/fix-fundamentals-roe-unit`
**GitHub Issue**: n/a (Issues disabled) — report `docs/reports/2026-11-15-marketdata-roe-value-implausible-defect.md`
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
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-fundamentals-roe-unit`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Staging serves `roe ≈ 3.66` for LYFT (rendered `+366.34%`), inconsistent with its market cap, P/B and EPS; suspected percent-vs-fraction unit error on one fundamentals provider path.

## Next Action

`/sdd-design fix-fundamentals-roe-unit` — full design recommended (untraced root cause, comment-only proto edit, file-level overlap with 317/320)
