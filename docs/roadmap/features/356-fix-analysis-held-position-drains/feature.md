# Feature: fix-analysis-held-position-drains

**Type**: bug
**Development Branch**: `feature/fix-analysis-held-position-drains`
**GitHub Issue**: none — Issues disabled; defect report `docs/reports/2026-11-17-analysis-held-position-drains-trust-page-token-defect.md` (pruned 2026-11-18; `git show d0eea65f:docs/reports/2026-11-17-analysis-held-position-drains-trust-page-token-defect.md`)
**Severity**: SEV-3
**Created**: 2026-11-17
**Last Updated**: 2026-11-17
**Committed to main**: 634a6c402de0dfb7624ba086c14a2562f0770588
**Launched date**: 2026-11-18
**Archived**: 2026-11-18

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-17 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-11-17-analysis-held-position-drains-trust-page-token-defect.md` (pruned 2026-11-18; `git show d0eea65f:docs/reports/2026-11-17-analysis-held-position-drains-trust-page-token-defect.md`) |
| 2026-11-17 | `draft` → `spec-ready` | /sdd-review | Product spec approved (5 warnings) |
| 2026-11-17 | `spec-ready` → `design-approved` | /sdd-design | Design debated (5 rounds, full) and approved; recon.md + debate.md + design.md written |
| 2026-11-17 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 9 steps |
| 2026-11-17 | `implementation-ready` → `in-progress` | /sdd-execute | → in-progress (sdd-batch-execute setup); main-dev `756a24a7` merged, steps 1-7 re-specced (line drift) |
| 2026-11-17 | `in-progress` → `code-completed` | /sdd-execute | All 9 steps done; `check-config-wiring.mjs --final` exit=0 |

| 2026-11-18 | `code-completed` → `launched` | CI workflow | Promoted via PR #1580; committed 634a6c402de0dfb7624ba086c14a2562f0770588 |
| 2026-11-18 | `launched` | /sdd-archiver | Archived: synthesis → context.md + Ledger insights(1)/fails(1); pruned 5 specs; pruned defect report 2026-11-17-analysis-held-position-drains-trust-page-token-defect |
---

## Artifacts

- Product Spec — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15); promoted to services/xstockstrat-analysis/acceptance/fix-analysis-held-position-drains.feature (C-16)
- Recon — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- Debate Register — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- Design — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- Implementation Spec — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- [Context Log](context.md) — session history, decisions, deviations

---

## Reviewers

| Reviewer | Focus | Steps |
|---|---|---|
| xstockstrat-analysis service owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias | 2, 3, 4, 5, 6, 7 |

Steps 1, 8 and 9 are `docs` steps (no reviewer).

---

## Summary

Harden the two analysis consumers that page portfolio `ListPositions` (`live_loop._drain_held`, `servicer._drain_held_symbols`): reject a repeated token, make a page-cap hit visible, and stop returning a partial or duplicated held set as success.

## Next Action

`/sdd-review fix-analysis-held-position-drains impl-spec` — validate implementation spec, then `/sdd-execute fix-analysis-held-position-drains`
