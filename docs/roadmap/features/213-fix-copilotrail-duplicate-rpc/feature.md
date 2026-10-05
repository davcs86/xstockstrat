# Feature: fix-copilotrail-duplicate-rpc

**Type**: bug
**Development Branch**: `feature/fix-copilotrail-duplicate-rpc`
**Defect Report**: `docs/reports/2026-09-26-copilotrail-duplicate-listopportunities-rpc-defect.md` (pruned 2026-10-05; `git show 2ce8de0a:docs/reports/2026-09-26-copilotrail-duplicate-listopportunities-rpc-defect.md`) (GitHub Issues disabled on this repo)
**Severity**: SEV-3
**Created**: 2026-09-26
**Last Updated**: 2026-09-26
**Committed to main**: 5fd9faf88fa1a93f41adced9eebff0ad0852634c
**Launched date**: 2026-09-27

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-26 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from defect report (found during feature 187 QA back-fill). SEV-3, single service, clear root cause → design depth `skip`. |
| 2026-09-26 | `draft` → `design-approved` | /sdd-design | Design debated (1 round, quick) and approved; recon.md + design.md written. Recon found 5 hook callers (not 2) — chosen approach single-sources the default sort so the "minimal" pin-CopilotRail fix (which would relocate the duplicate RPC) is rejected. |
| 2026-09-26 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 2 steps (Step 1 service: align hook `sort` default; Step 2 test: `@AC-1` single-RPC regression). Scope-widening from product-spec's "single-file" fix to the shared hook flagged for user sign-off at the consolidated 189/213 impl-spec review. |
| 2026-09-26 | `implementation-ready` → `code-completed` | /sdd-execute (sequential) | Scope-widening signed off (F-10). Step 1 (hook `sort` default `UNSPECIFIED`→`CONVICTION` + CopilotRail comment) + Step 2 (single-RPC e2e regression) done. Red→green: 2→1 RPC; full `opportunities.spec.ts` 36/36 green (Open Risk resolved — set/order unchanged). |

| 2026-09-27 | `code-completed` → `launched` | CI workflow | Promoted via PR #1194; committed 5fd9faf88fa1a93f41adced9eebff0ad0852634c |
---

## Reviewers

| Step Category | Reviewer |
|---|---|
| `service`, `test` | xstockstrat-ui owner — analytics display accuracy, Connect-RPC call safety |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario (`@AC-*`, C-15)
- [Recon Dossier](recon.md) — codebase map, 5-caller finding, reuse patterns (C-16)
- [Design](design.md) — chosen approach (single-source default sort), rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md) — 2 steps (align hook sort default + `@AC-1` regression e2e)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

On `/insights/opportunities` two `ListOpportunities` RPCs fire because `CopilotRail`'s
`useOpportunities(0)` defaults `sort=UNSPECIFIED` while the page uses `sort=CONVICTION`, so their
React-Query keys differ and the intended page-1 cache share never happens. This violates feature
187's @AC-7 and doubles the read fan-out to `xstockstrat-analysis`.

## Next Action

Code-complete. Ships in the shared integration PR #1191 (`claude/pending-roadmap-features-9z01mn` → `main-dev`).
