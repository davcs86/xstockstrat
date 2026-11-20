# Feature: fix-ci-enforcement-gaps

**Type**: bug
**Development Branch**: `feature/fix-ci-enforcement-gaps`
**GitHub Issue**: none (Issues disabled) — reports: docs/reports/2026-10-28-node-leaf-c8-check-coverage-unenforced-defect.md, docs/reports/2026-10-29-scripts-ruff-lint-gap-defect.md
**Severity**: SEV-2
**Created**: 2026-11-10
**Last Updated**: 2026-11-20

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-10 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from 2 defect report(s) (clustered triage) |
| 2026-11-10 | `draft` → `spec-ready` | /sdd-review | Product spec approved (3 warnings) |
| 2026-11-20 | `spec-ready` → `design-approved` | /sdd-design | Design debated (4 rounds, full) and approved; recon.md + debate.md + design.md written |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier
- [Debate Register](debate.md) — settled decisions, rejected alternatives, objections
- [Design](design.md) — approved design
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-ci-enforcement-gaps`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Two CI gates are declared but not enforced: the Node leaves' 40% c8 line threshold (no `--check-coverage`)
and ruff lint/format over `scripts/` Python (no CI job; 9 findings, 4 files unformatted).

## Next Action

`/sdd-spec fix-ci-enforcement-gaps` — generate implementation spec from the approved design
