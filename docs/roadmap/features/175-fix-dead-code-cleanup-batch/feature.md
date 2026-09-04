# Feature: fix-dead-code-cleanup-batch

**Type**: bug
**Development Branch**: `feature/fix-dead-code-cleanup-batch`
**Defect Report**: `docs/reports/2026-09-04-comment-audit-triage.md` (items 5, 6, 7) — GitHub Issues disabled on this repo
**Severity**: SEV-3
**Created**: 2026-09-04
**Last Updated**: 2026-09-04

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-04 | `bug-reported` → `draft` | /sdd-triage | Consolidated Cleanup batch from comment-audit report items 5–7 |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-dead-code-cleanup-batch`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Consolidated low-risk dead-code cleanup batching three "Cleanup"-track findings from the comment-audit
report: (5) the dead `getEnvBool` in the three Go services, (6) the dead `middleware/propagation.ts`
in the Node leaf services, and (7) the `@types/node ^20` pin against a Node 24 runtime. Item 6's
target set is **corrected** vs the report — triage evidence shows identity's copy is ALSO unused
(the report's "live via ledgerAudit" is not borne out), so identity is carried as an explicit open
decision, not a silent deletion.

## Next Action

`/sdd-design fix-dead-code-cleanup-batch quick` — recommended design depth (quick); see context.md
