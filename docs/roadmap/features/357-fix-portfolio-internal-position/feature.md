# Feature: fix-portfolio-internal-position

**Type**: bug
**Development Branch**: `feature/fix-portfolio-internal-position`
**GitHub Issue**: none — Issues disabled; defect report `docs/reports/2026-11-17-portfolio-internal-position-reads-truncate-at-500-defect.md`
**Severity**: SEV-2
**Created**: 2026-11-17
**Last Updated**: 2026-11-17

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-17 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-11-17-portfolio-internal-position-reads-truncate-at-500-defect.md` |
| 2026-11-17 | `draft` → `spec-ready` | /sdd-review | Product spec approved (5 warnings) |
| 2026-11-17 | `spec-ready` → `design-approved` | /sdd-design | Design debated (3 rounds, full) and approved; recon.md + debate.md + design.md written |
| 2026-11-17 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 9 steps |
| 2026-11-17 | `implementation-ready` → `in-progress` | /sdd-execute (sdd-batch-execute setup) | main-dev 0558e377 merged; steps 1–7 and 9 re-specced for line drift (directive conditional) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier (Phase 0)
- [Debate Register](debate.md) — D-n / R-n / O-n / P-n register (3 full-mode rounds)
- [Design](design.md) — approved approach, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

`GetPortfolio`, `GetPnL`, `broadcastSnapshot` and `checkRiskLimits` read one 500-row `ListPositions` page and drop the token; users with more than 500 positions get truncated totals, snapshots and risk checks returned as success.

## Reviewers

| Role | Focus | Steps |
|---|---|---|
| Service owner (xstockstrat-portfolio) | P&L calculation accuracy, position snapshot consistency, concurrent write safety | 1–7 |

Steps 8–9 (`docs`): none.

---

## Next Action

`/sdd-review fix-portfolio-internal-position impl-spec` — validate implementation spec, then `/sdd-execute fix-portfolio-internal-position`
