# Feature: fix-replace-tif-before-intent

**Type**: bug
**Development Branch**: `feature/fix-replace-tif-before-intent`
**GitHub Issue**: none (Issues disabled) — report: `docs/reports/2026-11-16-replace-order-tif-validation-after-intent-claim-defect.md`
**Severity**: SEV-3
**Created**: 2026-11-16
**Last Updated**: 2026-11-16

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-16 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from the defect report (`--from-report`) |
| 2026-11-16 | `draft` → `spec-ready` | /sdd-review | Product spec approved (4 warnings, all folded into the spec) |
| 2026-11-16 | `spec-ready` → `design-approved` | /sdd-design | Design debated (1 round, quick) and approved under the operator's handover; recon.md + debate.md + design.md written |
| 2026-11-16 | `implementation-ready` → `in-progress` | /sdd-execute | Steps 1+2 done (sequential) |
| 2026-11-16 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 3 steps |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) · [Debate Register](debate.md) · [Design](design.md)
- [Implementation Spec](implementation-spec.md) — 3 numbered steps; Steps 1+2 are one atomic unit
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

`/sdd-review fix-replace-tif-before-intent impl-spec` — validate implementation spec, then `/sdd-execute fix-replace-tif-before-intent`
