# Feature: fix-getpnl-source-service

**Type**: bug
**Development Branch**: `feature/fix-getpnl-source-service`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-20-portfolio-getpnl-source-service-mismatch-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-20
**Last Updated**: 2026-10-30

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-20 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-20-portfolio-getpnl-source-service-mismatch-defect.md` |
| 2026-10-20 | `draft` → `spec-ready` | /sdd-review | Product spec approved (6 warnings, 4 notes; overlap WARN, 10 same-file collisions, no FAIL) |
| 2026-10-21 | `spec-ready` → `design-approved` | /sdd-design | Design debated (9 rounds, full) and approved under operator standing authorization; recon.md + design.md written |
| 2026-10-21 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 14 steps; AC-4..AC-22 + FR-4/FR-5 appended per design.md §6F |
| 2026-10-30 | `implementation-ready` (re-spec) | sdd-execute sequential | Steps re-specced against `main-dev` after 257 merged (`079870fa`): Steps 1-3 superseded, GetPnL/UI/docs steps realigned |
| 2026-10-30 | `implementation-ready` → `in-progress` | sdd-execute sequential (sdd-batch-execute) | Execution started under the operator's standing authorization; see context.md |
| 2026-10-30 | `in-progress` (step 5 done) | sdd-execute sequential | Step 5: trading fill payloads carry `side`; Step 4 test GREEN |
| 2026-10-30 | `in-progress` (steps 6-7 done) | sdd-execute sequential | Steps 6+7 merged (standing rule): portfolio ledger fake, shim, fold tests and GetPnL canonical source/side/sequence fold GREEN |
| 2026-10-30 | `in-progress` (step 8 done) | sdd-execute sequential | Step 8: portfolio wire tests and error-mapping tables added, RED until Step 9 |
| 2026-10-30 | `in-progress` (step 9 done) | sdd-execute sequential | Step 9: ctx-first classifyGetPnLError and explicit toGRPCError codes, Step 8 GREEN |
| 2026-10-30 | `in-progress` (step 10 done) | sdd-execute sequential | Step 10: UI lineage RED (vitest + Playwright), lineage fixtures and mock backend, until Step 11 |
| 2026-10-30 | `in-progress` (step 11 done) | sdd-execute sequential | Step 11: positionLineage.ts per-order lineage via ListOrders, hook and truncation notice, Step 10 GREEN |
| 2026-10-30 | `in-progress` (step 12 done) | sdd-execute sequential | Step 12: teardown docs reconciled (stream-key drift, ctx-first wording, side resolution, findings); plugin refresh done by hand |
| 2026-10-30 | `in-progress` (step 13 done) | sdd-execute sequential | Step 13: rebase-only note 251 ↔ 249 added to merge-order.md; 241 launched (dropped), 252 context note dropped per re-spec |
| 2026-10-30 | `in-progress` → `code-completed` | sdd-execute sequential (sdd-batch-execute) | All steps done; acceptance scenarios promoted to per-service suites (C-16); PG-1 remains an operator gate |

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md`, taken by /sdd-spec on 2026-10-21. It is the canonical
per-step assignment and stays stable unless `/sdd-spec` re-runs.

| Reviewer | Focus | Steps |
|---|---|---|
| `xstockstrat-ledger` owner | Append-only invariant (no deletes or updates), event ordering, hypertable partition safety | 1, 2, 3 |
| `xstockstrat-trading` owner | Order execution correctness, broker API safety, fill detection, paper-only dev invariant, position limit enforcement | 4, 5 |
| `xstockstrat-portfolio` owner | P&L calculation accuracy, position snapshot consistency, concurrent write safety | 6, 7, 8, 9 |
| `xstockstrat-ui` owner | Trading UI correctness, analytics display accuracy, config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI, no direct DB access (except audit log) | 10, 11 |
| none (docs) | — | 12, 13, 14 |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier (Phase 0)
- [Design](design.md) — debated, approved architecture (9 rounds, full)
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

`PortfolioService.GetPnL` queries ledger fills with `SourceService: "trading"`, but trading stamps
`"xstockstrat-trading"` and the ledger filters by exact match, so `realized_pnl` is always 0 with no error.

## Next Action

`/sdd-review fix-getpnl-source-service impl-spec` — validate implementation spec, then `/sdd-execute fix-getpnl-source-service`
