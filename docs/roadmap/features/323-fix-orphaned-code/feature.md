# Feature: fix-orphaned-code

**Type**: bug
**Development Branch**: `feature/fix-orphaned-code`
**GitHub Issue**: none (Issues disabled) — reports: docs/reports/2026-10-19-orphaned-code-defect.md
**Severity**: SEV-3
**Created**: 2026-11-10
**Last Updated**: 2026-11-20

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-10 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from 1 defect report(s) (clustered triage) |
| 2026-11-10 | `draft` → `spec-ready` | /sdd-review | Product spec approved (3 warnings) |
| 2026-11-20 | `spec-ready` → `design-approved` | /sdd-design | Design debated (3 rounds, full) and approved; recon.md + debate.md + design.md written |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier
- [Debate Register](debate.md) — settled decisions, rejected alternatives, objections
- [Design](design.md) — approved approach, open risks, rules touched
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-orphaned-code`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Ten orphaned modules, scripts, dependencies and code paths across nine services have no runtime caller;
one (portfolio `r.pool` stragglers) nil-panics under pgxmock and blocks unit testing.

## Next Action

`/sdd-spec fix-orphaned-code` — generate implementation spec from the approved design
