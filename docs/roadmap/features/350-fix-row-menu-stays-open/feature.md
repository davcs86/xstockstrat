# Feature: fix-row-menu-stays-open

**Type**: bug
**Development Branch**: `feature/fix-row-menu-stays-open`
**GitHub Issue**: none (Issues disabled) — report: `docs/reports/2026-11-16-ui-row-menu-stays-open-after-confirm-defect.md` (pruned 2026-11-18; `git show d0eea65f:docs/reports/2026-11-16-ui-row-menu-stays-open-after-confirm-defect.md`)
**Severity**: SEV-3
**Created**: 2026-11-16
**Last Updated**: 2026-11-16
**Committed to main**: dd41417dd5798a5133a4c963c60f556e79b499a5
**Launched date**: 2026-11-17
**Archived**: 2026-11-18

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-16 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from the defect report (`--from-report`) |
| 2026-11-16 | `draft` → `spec-ready` | /sdd-review | Product spec approved (5 warnings, all folded into the spec) |
| 2026-11-16 | `spec-ready` → `design-approved` | /sdd-design | Design debated (3 rounds, quick extended twice by the operator) and approved; recon.md + debate.md + design.md written |
| 2026-11-16 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 9 steps |
| 2026-11-16 | `implementation-ready` → `in-progress` | /sdd-execute | Steps 1+2 done (sequential) |
| 2026-11-16 | `in-progress` → `code-completed` | /sdd-execute | All 9 steps done; integration PR to `main-dev` |

| 2026-11-17 | `code-completed` → `launched` | CI workflow | Promoted via PR #1573; committed dd41417dd5798a5133a4c963c60f556e79b499a5 |
| 2026-11-18 | `launched` | /sdd-archiver | Archived: synthesis → context.md + Ledger insights(0)/fails(1); pruned 5 specs; pruned defect report 2026-11-16-ui-row-menu-stays-open-after-confirm-defect |
---

## Artifacts

- Product Spec — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15); promoted to services/xstockstrat-ui/acceptance/fix-row-menu-stays-open.feature (C-16)
- Recon, Debate Register, Design — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- Implementation Spec — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

A row action that asks for confirmation (cancel an order, resume an account, and every other
`confirm` action on the shared row menu) leaves the row's three-dots menu open and modal after the
dialog is confirmed or cancelled, so the user's next click only closes the menu. The fix closes the
menu when the item is chosen and leaves the page interactive, with focus back on the row's actions
trigger, once the dialog resolves.

## Reviewers

_(Snapshot finalized by /sdd-spec on 2026-11-16 from docs/runbooks/reviewer-registry.md and the
per-step `**Reviewers**` lines. Re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-ui` owner | Trading UI correctness, analytics display accuracy, config mutation safety, Connect-RPC call safety, environment (`production`/`staging`) scope correctness, no secret values rendered in UI, no direct DB access (except audit log) |

## Next Action

Integration PR `feature/fix-row-menu-stays-open` → `main-dev` — merge when CI passes and the owner approves.
