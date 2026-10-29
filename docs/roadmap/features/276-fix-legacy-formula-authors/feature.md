# Feature: fix-legacy-formula-authors

**Type**: bug
**Development Branch**: `feature/fix-legacy-formula-authors`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-22-indicators-legacy-username-formula-authors-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-22
**Last Updated**: 2026-10-29

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-22 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from the defect report; Track C |
| 2026-10-22 | `draft` → `spec-ready` | /sdd-review | Product spec approved (9 warnings) |
| 2026-10-22 | `spec-ready` → `design-approved` | /sdd-design | Design debated (2 rounds, full) and approved; recon.md + design.md written |
| 2026-10-22 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 9 steps |
| 2026-10-28 | `implementation-ready` (unchanged) | /sdd-execute (sdd-batch-execute) | Re-spec: Steps 1-9 evidence aligned with current codebase after merging main-dev |
| 2026-10-28 | `implementation-ready` → `in-progress` | /sdd-execute sequential (sdd-batch-execute) | Up-front confirmation by operator standing authorization (session_01NpS3HShZK6pSnogA7CFo2f) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier
- [Design](design.md) — approved design (operator-run maintenance CLI)
- [Implementation Spec](implementation-spec.md) — Numbered steps with codebase evidence
- [Context Log](context.md) — session history, decisions, deviations

---

## Reviewers

| Reviewer | Focus |
|---|---|
| xstockstrat-indicators owner | Formula read authorization unchanged; DB data-change safety; no side-effects from formula execution |
| DBA | Data rewrite correctness and the DBA change record (no migration; approval flow) |
| Security | PII minimisation in the users export and plan/result files |

## Summary

Six staging formulas store the legacy username `davcs86` as `author` instead of the owner's user id, so the owner cannot list, read or execute them and any strategy using them fails evaluation. This is the root trigger of the 2026-10-15 backtest silent-skip defect (feature 275).

## Next Action

`/sdd-execute fix-legacy-formula-authors sequential` — Steps 1-7 done; Steps 8-9 pending
