# Feature: opportunities-pagination-drain

**Development Branch**: `feature/opportunities-pagination-drain`
**Created**: 2026-09-11
**Last Updated**: 2026-09-26
**Committed to main**: `aab3fa8d` (promotion PR #1137)
**Launched date**: 2026-09-11
**Archived**: 2026-10-07

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-11 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-09-11 | `draft` → `design-approved` | /sdd-design quick | Design approved — 3 user steers: page_size stays 50, server-side symbol grouping, manual Load More (no auto-drain) |
| 2026-09-11 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated — 10 steps across 3 services |
| 2026-09-11 | `implementation-ready` → `launched` | /sdd-execute (#1134) | Functional steps 1,2,3,5,6,9 (server SQL grouping, UI useInfiniteQuery+Load More+CopilotRail+stat-grid removal, agent page_token/page_size, docs) merged to main-dev via #1134, promoted to main via #1137. **Status not advanced at the time** — reconciled 2026-09-26. |
| 2026-09-26 | `in-progress` → `launched` | drift reconciliation | Bookkeeping catch-up: functional code shipped & live since 2026-09-11 but status.md stayed `in-progress`. Test steps **4, 7, 8, 10** were never completed and remain outstanding post-launch test debt (see Next Action). |
| 2026-09-26 | `launched` (test debt back-filled) | /sdd-qa | Steps 4/7/8/10 completed: added @AC-2/3/5/8 characterization guards to `opportunities.spec.ts` (35/35 green). @AC-7 NOT covered — genuinely violated on the shipped tree (duplicate ListOpportunities RPC); filed SEV-3 defect `docs/reports/2026-09-26-copilotrail-duplicate-listopportunities-rpc-defect.md`, guard deferred until the fix lands. |
| 2026-10-07 | `launched` | /sdd-archiver | Archived: synthesis → context.md + Ledger insights(1)/fails(1); pruned 4 spec(s); acceptance scenarios promoted to per-service suites (C-16) |

---

## Artifacts

- Product Spec — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15); promoted to services/xstockstrat-{analysis,ui,agent}/acceptance/opportunities-pagination-drain.feature; @AC-6 withheld (not enforced) — see context.md (C-16)
- Implementation Spec — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

The ListOpportunities RPC defaults to a 50-row page size and no consumer (UI or agent) consumes
subsequent pages, silently capping the surfaced queue at ~50 rows even when 150+ materialized
opportunities exist. This feature adds server-side symbol grouping (SQL window function) so page
boundaries respect symbol clusters, converts the UI to `useInfiniteQuery` with a manual "Load More"
button for progressive retrieval, and exposes `page_token`/`page_size` on the agent tool for MCP
caller pagination.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Service owner (`xstockstrat-analysis`) | Backtest reproducibility, strategy scoring determinism, no look-ahead bias |
| Service owner (`xstockstrat-ui`) | Analytics display accuracy, Connect-RPC call safety |
| Service owner (`xstockstrat-agent`) | MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity |

## Next Action

Feature is `launched` (live since 2026-09-11); the test debt (steps 4/7/8/10) was back-filled on
2026-09-26 — `opportunities.spec.ts` now guards @AC-2/3/5/8 (35/35 green). **One follow-up remains:**
@AC-7 (CopilotRail shares the page-1 cache / no separate RPC) is genuinely violated on the shipped
tree — see the SEV-3 defect `docs/reports/2026-09-26-copilotrail-duplicate-listopportunities-rpc-defect.md` (pruned 2026-10-05; `git show 2ce8de0a:docs/reports/2026-09-26-copilotrail-duplicate-listopportunities-rpc-defect.md`).
Route it via `/sdd-triage --from-report <that file>`; once the one-line CopilotRail sort-alignment fix
lands, add the strict single-RPC @AC-7 guard.
