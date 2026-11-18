# Feature: fix-replace-tif-before-intent

**Type**: bug
**Development Branch**: `feature/fix-replace-tif-before-intent`
**GitHub Issue**: none (Issues disabled) — report: `docs/reports/2026-11-16-replace-order-tif-validation-after-intent-claim-defect.md` (pruned 2026-11-18; `git show d0eea65f:docs/reports/2026-11-16-replace-order-tif-validation-after-intent-claim-defect.md`)
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
| 2026-11-16 | `draft` → `spec-ready` | /sdd-review | Product spec approved (4 warnings, all folded into the spec) |
| 2026-11-16 | `spec-ready` → `design-approved` | /sdd-design | Design debated (1 round, quick) and approved under the operator's handover; recon.md + debate.md + design.md written |
| 2026-11-16 | `implementation-ready` → `in-progress` | /sdd-execute | Steps 1+2 done (sequential) |
| 2026-11-16 | `in-progress` → `code-completed` | /sdd-execute | All 3 steps done; integration PR to `main-dev` |
| 2026-11-16 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 3 steps |

| 2026-11-17 | `code-completed` → `launched` | CI workflow | Promoted via PR #1573; committed dd41417dd5798a5133a4c963c60f556e79b499a5 |
| 2026-11-18 | `launched` | /sdd-archiver | Archived: synthesis → context.md + Ledger insights(0)/fails(0); pruned 5 specs; pruned defect report 2026-11-16-replace-order-tif-validation-after-intent-claim-defect |
---

## Artifacts

- Product Spec — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15); promoted to services/xstockstrat-trading/acceptance/fix-replace-tif-before-intent.feature (C-16)
- Recon, Debate Register, Design — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- Implementation Spec — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

`ReplaceOrder` claims its dedup intent and marks the order PENDING before it validates the requested
time-in-force, so a TIF the broker does not allow strands a PENDING intent for a request that never
reached the broker. The fix validates the TIF before any intent is claimed.

## Reviewers

_(Snapshot finalized by /sdd-spec on 2026-11-16 from docs/runbooks/reviewer-registry.md and the
per-step `**Reviewers**` lines. Re-run /sdd-spec if the registry changes.)_

| Role | Review Focus | Steps |
|---|---|---|
| `xstockstrat-trading` owner | Order execution correctness, broker API safety, fill detection, paper-only dev invariant, position limit enforcement | 1, 2 |

## Next Action

Review and merge the integration PR into `main-dev` (operator); the fix rides the next `/promote`.
