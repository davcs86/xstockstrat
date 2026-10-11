# Feature: private-by-default-enforce-contract

**Development Branch**: `feature/private-by-default-enforce-contract`
**Created**: 2026-10-07
**Last Updated**: 2026-10-11

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-07 | `idea` → `draft` | /sdd-story | Product spec generated (created by feature 224 Step 41 as its named follow-up) |
| 2026-10-08 | `draft` → `spec-ready` | /sdd-review | Product spec approved on run 2 (PASS WITH WARNINGS; run 1 FAIL fixed: FR-4 scoped to real objects, Open Questions closed with operator decisions — `UNAUTHENTICATED`, indicators stops writing `is_public` with the drop deferred). Run-2 warnings fixed in-place (Affected Services, AC-7/11/12, AC-13 added). Overlap CLEAN. |
| 2026-10-10 | `spec-ready` → `design-approved` | /sdd-design | Design debated (3 rounds — quick mode extended by the operator) and approved; recon.md + design.md written. Per-service decorator identity gate (headerless → UNAUTHENTICATED), bypass/fallback removal, fail-closed `owner_metadata`, QueryPnLPatterns owner filter (FR-7), contract migrations analysis 027 / ingest 014, is_public stop-writing with real-schema proof, db-migrate dirty guard (FR-8). |
| 2026-10-10 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 19 steps (tooling 1–2, contract migrations + rerun 3–5, analysis 6–11, indicators 12–16, ingest 17–18, docs/promotion 19); all 19 `@AC-*` covered |
| 2026-10-11 | `implementation-ready` → `in-progress` | /sdd-execute | Sequential run started (Steps 1–5 this session); Step 1 dirty guard done |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Release N+1 of feature 224 (`private-by-default-templates`). Once 224 is launched, this feature makes
the private-by-default ownership model fail-closed and contracts 224's expand-only schema.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| DBA | Migration NNN numbering, up+down pair present, index correctness, run-order compliance with `scripts/db-migrate.sh` — analysis `027` (D-1 re-backfill, NOT NULL, `strategy_scores` drop, bounded ACCESS EXCLUSIVE), ingest `014` (trigger/function/`signal_dedup_keys` drop), raising downs, contract-floor dirty guard, `migration-rerun.sh` (Steps 1–5, 16) |
| Service owner — xstockstrat-analysis | Backtest reproducibility, strategy scoring determinism, no look-ahead bias — `owner_metadata` builder, `owner_scoped` gate on 22 RPCs, QueryPnLPatterns owner filter, non-null `backtest_runs.user_id` writes (Steps 3, 5–11) |
| Service owner — xstockstrat-indicators | Formula sandboxing, no side-effects from formula execution — `analysis` reader-bypass removal, `owner_scoped` gate on 10 RPCs, `is_public` stop-writing (Steps 12–16) |
| Service owner — xstockstrat-ingest | Signal normalization correctness, idempotent ingestion, newsletter source schema stability — `owner_scoped` gate on 7 RPCs, slug-holder fallback removal, per-user `mcp_client` credential guard, dedup on `signal_dedup_claims` (Steps 4–5, 17–18) |

## Next Action

`/sdd-review private-by-default-enforce-contract impl-spec` — validate implementation spec, then `/sdd-execute private-by-default-enforce-contract`
