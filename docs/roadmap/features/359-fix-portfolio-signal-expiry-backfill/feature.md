# Feature: fix-portfolio-signal-expiry-backfill

**Type**: bug
**Development Branch**: `feature/fix-portfolio-signal-expiry-backfill`
**GitHub Issue**: none (Issues disabled) — defect report `docs/reports/2026-11-17-portfolio-signal-expiry-backfill-mark-ingest-race-defect.md` (pruned 2026-11-18; `git show d0eea65f:docs/reports/2026-11-17-portfolio-signal-expiry-backfill-mark-ingest-race-defect.md`)
**Severity**: SEV-3
**Created**: 2026-11-17
**Last Updated**: 2026-11-17
**Committed to main**: 37d41f42aaa3c2b7f27a1a06a4630c7d4d72c35f
**Launched date**: 2026-11-17
**Archived**: 2026-11-18

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-17 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from the defect report |
| 2026-11-17 | `draft` → `spec-ready` | /sdd-review | Product spec approved (5 warnings) |
| 2026-11-17 | `spec-ready` → `design-approved` | /sdd-design | Design debated (3 rounds, full) and approved; recon.md + debate.md + design.md written |
| 2026-11-17 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 7 steps |
| 2026-11-17 | `implementation-ready` → `in-progress` | /sdd-execute | → in-progress (sdd-batch-execute setup) |
| 2026-11-17 | `in-progress` → `code-completed` | /sdd-execute | All 7 steps done (sequential); dbtest RED/GREEN deferred to CI per operator decision B |

| 2026-11-17 | `code-completed` → `launched` | CI workflow | Promoted via PR #1576; committed 37d41f42aaa3c2b7f27a1a06a4630c7d4d72c35f |
| 2026-11-18 | `launched` | /sdd-archiver | Archived: synthesis → context.md + Ledger insights(2)/fails(1); pruned 5 specs; pruned defect report 2026-11-17-portfolio-signal-expiry-backfill-mark-ingest-race-defect |
---

## Artifacts

- Product Spec — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15); promoted to services/xstockstrat-portfolio/acceptance/fix-portfolio-signal-expiry-backfill.feature, services/xstockstrat-portfolio/acceptance/signal-watchlist-expiry-pruning.feature (C-16)
- Recon — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- Debate Register — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- Design — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- Implementation Spec — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- [Context Log](context.md) — session history, decisions, deviations

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at /sdd-spec (2026-11-17).

| Reviewer | Focus | Steps |
|---|---|---|
| xstockstrat-portfolio service owner | Concurrent write safety (P&L calculation accuracy, position snapshot consistency, concurrent write safety) | 1, 2, 3, 4 |

Steps 5–7 are `docs` (no reviewer).

---

## Summary

Portfolio's `backfill-signal-expiry` APPLY can mark a SIGNAL watchlist entry as an untracked, already-due expiry row while a concurrent signal add commits for the same binding. The prune tick then removes a watchlist entry whose signal is still live.

## Next Action

Merge integration PR #1575 (`feature/fix-portfolio-signal-expiry-backfill` → `main-dev`) once CI's `Portfolio DB test (TimescaleDB)` job is green. It carries the deferred DB-test evidence for DEV-1..DEV-3. The fix then ships to production with the next `/promote`.
