# Feature: fix-legacy-formula-authors

**Type**: bug
**Development Branch**: `feature/fix-legacy-formula-authors`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-22-indicators-legacy-username-formula-authors-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-22
**Last Updated**: 2026-10-29
**Committed to main**: df521ff51091a86e813950b34afff09ac4e8821b
**Launched date**: 2026-10-30

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
| 2026-10-29 | `in-progress` (unchanged) | /sdd-execute sequential | Step 9 done (docs: indicators `## Maintenance`, `INDICATORS-12`); Steps 1-9 done |
| 2026-10-29 | `in-progress` → `code-completed` | /sdd-execute sequential (ALL-DONE PATH) | C-16 promotion applied (8 scenarios to `services/xstockstrat-indicators/acceptance/fix-legacy-formula-authors.feature`; @AC-6 skipped as OVERLAP with 224 @AC-1); integration PR opened |

| 2026-10-30 | `code-completed` → `launched` | CI workflow | Promoted via PR #1368; committed df521ff51091a86e813950b34afff09ac4e8821b |
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

`/sdd-execute fix-legacy-formula-authors sequential` — Steps 1-9 done; mark the feature code-completed and open the integration PR (§5.6). The PR body records that the context-forge refresh was done by hand.
