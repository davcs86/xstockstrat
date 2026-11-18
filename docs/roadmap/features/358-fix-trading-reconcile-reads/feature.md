# Feature: fix-trading-reconcile-reads

**Type**: bug
**Development Branch**: `feature/fix-trading-reconcile-reads`
**GitHub Issue**: none — Issues disabled; defect report `docs/reports/2026-11-17-trading-reconcile-reads-first-500-positions-defect.md` (pruned 2026-11-18; `git show 351e6fd0:docs/reports/2026-11-17-trading-reconcile-reads-first-500-positions-defect.md`)
**Severity**: SEV-2
**Created**: 2026-11-17
**Last Updated**: 2026-11-17
**Committed to main**: 634a6c402de0dfb7624ba086c14a2562f0770588
**Launched date**: 2026-11-18
**Archived**: 2026-11-18

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-17 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-11-17-trading-reconcile-reads-first-500-positions-defect.md` (pruned 2026-11-18; `git show 351e6fd0:docs/reports/2026-11-17-trading-reconcile-reads-first-500-positions-defect.md`) |
| 2026-11-17 | `draft` → `spec-ready` | /sdd-review | Product spec approved (5 warnings) |
| 2026-11-17 | `spec-ready` → `design-approved` | /sdd-design | Design debated (6 rounds, full) and approved; recon.md + debate.md + design.md written |
| 2026-11-17 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 5 steps; FR-5 and @AC-4 appended per operator decision (design gate r6) |
| 2026-11-17 | `implementation-ready` → `in-progress` | /sdd-execute | → in-progress (sdd-batch-execute setup) |
| 2026-11-17 | `in-progress` → `in-progress` | /sdd-execute | Re-spec c36086186: Steps 1-4 Verification lines wrapped in `( ... )` subshells (operator Option B); Step 1 done |
| 2026-11-17 | `in-progress` → `code-completed` | /sdd-execute | All 5 steps done (Step 5 docs last); `check-config-wiring.mjs --final` exit 0 |

| 2026-11-18 | `code-completed` → `launched` | CI workflow | Promoted via PR #1580; committed 634a6c402de0dfb7624ba086c14a2562f0770588 |
| 2026-11-18 | `launched` | /sdd-archiver | Archived: synthesis → context.md + Ledger insights(2)/fails(1); pruned 5 specs; pruned defect report 2026-11-17-trading-reconcile-reads-first-500-positions-defect |
---

## Artifacts

- Product Spec — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15); promoted to services/xstockstrat-trading/acceptance/fix-trading-reconcile-reads.feature (C-16)
- Recon — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- Debate Register — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- Design — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- Implementation Spec — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- [Context Log](context.md) — session history, decisions, deviations

---

## Reviewers

| Role | Steps | Review Focus |
|---|---|---|
| xstockstrat-trading service owner | 1, 2, 3, 4 | Order execution correctness, broker API safety, fill detection, paper-only dev invariant, position limit enforcement |

Step 5 (`docs`) has no reviewer.

---

## Summary

`reconcileTick` reads one 500-row `ListPositions` page per broker account and drops the token; a held symbol past row 500 reads as platform qty 0 and can raise a false quantity-discrepancy finding that halts the account.

## Next Action

`/sdd-review fix-trading-reconcile-reads impl-spec` — validate implementation spec, then `/sdd-execute fix-trading-reconcile-reads`
