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
| 2026-09-04 | `draft` → `spec-ready` | /sdd-review | Product spec approved (PASS, 0 warnings); overlap CLEAN; FRs + Consumer Surface added |
| 2026-09-04 | `spec-ready` → `design-approved` | /sdd-design | 4 rounds (quick base + 3 operator-elected); identity propagation.ts DELETE, @types/node bump widened to 5 services incl. ui (+@AC-4), verification mechanics locked; recon.md + design.md written; no Floor breach |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope (FR-3 = five services incl. ui + bounce rule)
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-1..4`, C-15)
- [Recon Dossier](recon.md) — grounded codebase facts (all four propagation.ts dead; shared config_test.go; vestigial per-service locks; 6 teardown docs)
- [Design](design.md) — debated, approved architecture (4 rounds; locked verification mechanics + 23-path landed-diff gate)
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

`/sdd-spec fix-dead-code-cleanup-batch` — generate the implementation spec from the approved design
