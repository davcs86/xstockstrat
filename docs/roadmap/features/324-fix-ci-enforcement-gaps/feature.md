# Feature: fix-ci-enforcement-gaps

**Type**: bug
**Development Branch**: `feature/fix-ci-enforcement-gaps`
**GitHub Issue**: none (Issues disabled) — reports: docs/reports/2026-10-28-node-leaf-c8-check-coverage-unenforced-defect.md, docs/reports/2026-10-29-scripts-ruff-lint-gap-defect.md
**Severity**: SEV-2
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
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-ci-enforcement-gaps`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Two CI gates are declared but not enforced: the Node leaves' 40% c8 line threshold (no `--check-coverage`)
and ruff lint/format over `scripts/` Python (no CI job; 9 findings, 4 files unformatted).

## Next Action

`/sdd-design fix-ci-enforcement-gaps` — recommended design depth: full (SEV-2, ≥2 affected services); see context.md
