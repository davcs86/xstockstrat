# Feature: fix-reconciliation-false-halt

**Type**: bug
**Development Branch**: `claude/flow-investigation-4blorq`
**GitHub Issue**: n/a — Issues disabled on this repo; defect recorded at `docs/reports/2026-09-25-reconciliation-false-halt-defect.md` (pruned 2026-10-05; `git show 2ce8de0a:docs/reports/2026-09-25-reconciliation-false-halt-defect.md`)
**Severity**: SEV-2
**Created**: 2026-09-25
**Last Updated**: 2026-09-25
**Committed to main**: eee580622c92a27a5e6dc22e6919075924b01b84
**Launched date**: 2026-09-25
**Archived**: 2026-10-07

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-25 | `bug-reported` → `draft` | sdd-triage (manual) | Product spec pre-populated from defect report `2026-09-25-reconciliation-false-halt-defect.md` |
| 2026-09-25 | `draft` → `design-approved` | sdd-design quick (manual) | recon.md + design.md; one adversarial round (design-buddy:adversary, NEEDS WORK → resolved, incl. HIGH DISTINCT-ON dedup fix) |
| 2026-09-25 | `design-approved` → `in-progress` → `code-completed` | sdd-spec + execute (manual) | implementation-spec.md; both services build/vet/test green (GOWORK=off); context reconciled (PORTFOLIO-10 + both CLAUDE.md) |

| 2026-09-25 | `code-completed` → `launched` | CI workflow | Promoted via PR #1181; committed eee580622c92a27a5e6dc22e6919075924b01b84 |
| 2026-10-07 | `launched` | /sdd-archiver | Archived: synthesis → context.md + Ledger insights(1)/fails(1); pruned 4 spec(s); acceptance scenarios promoted to per-service suites (C-16) |
---

## Artifacts

- Product Spec — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15); promoted to services/xstockstrat-{trading,portfolio}/acceptance/fix-reconciliation-false-halt.feature (@AC-1..4); @AC-5 not promoted (overlaps feature 157 @AC-11) — see context.md (C-16)
- Recon — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- Design — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- Implementation Spec — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

The broker-state reconciliation poller (`xstockstrat-trading` feature 102) auto-halts an account on
a position-side `quantity_discrepancy` when `xstockstrat-portfolio.ListPositions` reads 0 for a
symbol the broker actually holds from the platform's own filled order — a false halt. The position
side has no `trading.orders` DB-grounding (unlike the order side), and `processPositionSync` can
transiently zero the projection on an empty broker snapshot.

## Next Action

Design approved. Next: `/sdd-spec fix-reconciliation-false-halt` (implementation-spec.md), then implement on `claude/flow-investigation-4blorq`.
