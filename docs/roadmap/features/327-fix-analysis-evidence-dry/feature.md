# Feature: fix-analysis-evidence-dry

**Type**: bug
**Development Branch**: `feature/fix-analysis-evidence-dry`
**GitHub Issue**: none (Issues disabled) — reports: docs/reports/2026-10-19-analysis-fingerprint-ignores-formula-version-defect.md, docs/reports/2026-10-19-analysis-live-gate-sql-duplicated-defect.md
**Severity**: SEV-3
**Created**: 2026-11-10
**Last Updated**: 2026-11-10

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-10 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from 2 defect report(s) (clustered triage) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-analysis-evidence-dry`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Two analysis single-source-of-truth gaps: the evidence-eligibility fingerprint ignores the content of referenced custom formulas (stale evidence keeps feeding the grade), and the boot entry-backfill re-types the live-enabled gate SQL instead of using `LIVE_ENABLED_PREDICATE_SQL`.

## Next Action

`/sdd-design fix-analysis-evidence-dry` — recommended design depth (full) from triage; see context.md
