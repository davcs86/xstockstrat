# Feature: fix-listpositions-nextpagetoken-skips

**Type**: bug
**Development Branch**: `feature/fix-listpositions-nextpagetoken-skips`
**Defect Report**: `docs/reports/2026-11-16-portfolio-listpositions-page-token-skips-boundary-row-defect.md` (pruned 2026-11-18; `git show d0eea65f:docs/reports/2026-11-16-portfolio-listpositions-page-token-skips-boundary-row-defect.md`)
**Severity**: SEV-2
**Created**: 2026-11-16
**Last Updated**: 2026-11-17
**Committed to main**: dd41417dd5798a5133a4c963c60f556e79b499a5
**Launched date**: 2026-11-17
**Archived**: 2026-11-18

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
| 2026-11-18 | `launched` | /sdd-archiver | Archived: synthesis → context.md + Ledger insights(1)/fails(0); pruned 5 specs; pruned defect report 2026-11-16-portfolio-listpositions-page-token-skips-boundary-row-defect |
---

## Artifacts

- Product Spec — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15); promoted to services/xstockstrat-portfolio/acceptance/fix-listpositions-nextpagetoken-skips.feature (C-16)
- Recon — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- Debate Register — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- Design — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- Implementation Spec — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
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
