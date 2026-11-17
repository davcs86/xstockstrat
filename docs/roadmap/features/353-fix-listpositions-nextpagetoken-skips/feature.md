# Feature: fix-listpositions-nextpagetoken-skips

**Type**: bug
**Development Branch**: `feature/fix-listpositions-nextpagetoken-skips`
**Defect Report**: `docs/reports/2026-11-16-portfolio-listpositions-page-token-skips-boundary-row-defect.md`
**Severity**: SEV-2
**Created**: 2026-11-16
**Last Updated**: 2026-11-17
**Committed to main**: dd41417dd5798a5133a4c963c60f556e79b499a5
**Launched date**: 2026-11-17

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-16 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from the defect report |
| 2026-11-16 | `draft` → `design-approved` | /sdd-design | Design debated (2 rounds, full) and approved; recon.md + debate.md + design.md written |
| 2026-11-17 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 4 steps |
| 2026-11-17 | `implementation-ready` → `in-progress` | /sdd-execute | Step 1 done (sequential mode, no checkpoints) |
| 2026-11-17 | `in-progress` → `code-completed` | /sdd-execute | Steps 1-4 done; integration PR next |

| 2026-11-17 | `code-completed` → `launched` | CI workflow | Promoted via PR #1573; committed dd41417dd5798a5133a4c963c60f556e79b499a5 |
---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier
- [Debate Register](debate.md) — decisions, rejected alternatives, objections
- [Design](design.md) — approved architecture
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Reviewers

| Reviewer | Focus | Steps |
|---|---|---|
| Service owner (`xstockstrat-portfolio`) | P&L calculation accuracy, position snapshot consistency, concurrent write safety | 1, 2, 3, 4 |

---

## Summary

`PortfolioRepo.ListPositions` returns the look-ahead row's symbol as `next_page_token` (boundary row skipped) and keysets on `symbol` alone although the table is unique on (user_id, symbol, trading_mode, account_id), so multi-account symbols lose rows across page boundaries.

## Next Action

Integration PR `feature/fix-listpositions-nextpagetoken-skips` → `main-dev`; after merge + promotion, file the three follow-up defect reports (context.md Open Threads)
