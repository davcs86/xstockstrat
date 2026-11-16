# Feature: fix-edgar-historical-fundamentals

**Type**: bug
**Development Branch**: `feature/fix-edgar-historical-fundamentals`
**GitHub Issue**: n/a (Issues disabled) — report `docs/reports/2026-11-16-marketdata-edgar-period-label-collision-defect.md`
**Severity**: SEV-2
**Created**: 2026-11-16
**Last Updated**: 2026-11-16

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

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier and data findings
- [Debate Register](debate.md) — settled decisions, locked rejected alternatives, objections
- [Design](design.md) — approved approach, operator procedure, business rules touched
- [Implementation Spec](implementation-spec.md) — 15 numbered steps with codebase evidence
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

EDGAR historical fundamentals rows are keyed by the filing's `fy`/`fp` pair, which filers repeat
across years, so two fiscal periods a year apart can share one row: it carries the earlier filing's
date and the later period's values (look-ahead for point-in-time reads), and one period is missing.
The fix derives a row's identity, period end and filed date from the fact's own period.

## Next Action

Post-deploy repair from `docs/runbooks/historical-backfill.md` (canary, chunks, pass conditions), on the operator's word.
