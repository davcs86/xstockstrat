# Feature: fix-edgar-historical-fundamentals

**Type**: bug
**Development Branch**: `feature/fix-edgar-historical-fundamentals`
**GitHub Issue**: n/a (Issues disabled) — report `docs/reports/2026-11-16-marketdata-edgar-period-label-collision-defect.md` (pruned 2026-11-18; `git show f6ce9e7c:docs/reports/2026-11-16-marketdata-edgar-period-label-collision-defect.md`)
**Severity**: SEV-2
**Created**: 2026-11-16
**Last Updated**: 2026-11-16
**Committed to main**: dd41417dd5798a5133a4c963c60f556e79b499a5
**Launched date**: 2026-11-17
**Archived**: 2026-11-18

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-16 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from the defect report |
| 2026-11-16 | `draft` → `spec-ready` | /sdd-review | Product spec approved (4 warnings) |
| 2026-11-16 | `spec-ready` → `design-approved` | /sdd-design | Design debated (3 rounds, full) and approved; recon.md + debate.md + design.md written |
| 2026-11-16 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 15 steps |
| 2026-11-16 | `implementation-ready` → `in-progress` | /sdd-execute (sequential) | Step 1 done; 14 steps pending |
| 2026-11-16 | `in-progress` | /sdd-execute (sequential) | Steps 1–14 done; scenarios promoted; Step 15 (operator gate) open — lane A frozen, audit pending |
| 2026-11-16 | `in-progress` → `code-completed` | /sdd-execute (sequential) | All 15 steps done; lane A audited; lane B audit waived by the operator; merge instructed by the operator |

| 2026-11-17 | `code-completed` → `launched` | CI workflow | Promoted via PR #1573; committed dd41417dd5798a5133a4c963c60f556e79b499a5 |
| 2026-11-18 | `launched` | /sdd-archiver | Archived: synthesis → context.md + Ledger insights(2)/fails(1); pruned 5 specs; pruned defect report 2026-11-16-marketdata-edgar-period-label-collision-defect |
---

## Artifacts

- Product Spec — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15); promoted to services/xstockstrat-marketdata/acceptance/fix-edgar-historical-fundamentals.feature (C-16)
- Recon — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- Debate Register — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- Design — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- Implementation Spec — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

EDGAR historical fundamentals rows are keyed by the filing's `fy`/`fp` pair, which filers repeat
across years, so two fiscal periods a year apart can share one row: it carries the earlier filing's
date and the later period's values (look-ahead for point-in-time reads), and one period is missing.
The fix derives a row's identity, period end and filed date from the fact's own period.

## Next Action

Post-deploy repair from `docs/runbooks/historical-backfill.md` (canary, chunks, pass conditions), on the operator's word.
