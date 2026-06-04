# Feature: formula-management-ui

**Lifecycle Status**: `launched`
**Committed to main**: 88268b2e90af291f3326d918d35f0c4986f92dcf
**Launched date**: 2026-06-04
**Development Branch**: `feature/formula-management-ui`
**Created**: 2026-05-10
**Last Updated**: 2026-06-04

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-10 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-05-10 | `draft` → `spec-ready` | /sdd-review | Product spec approved (1 advisory warning) |
| 2026-05-10 | `spec-ready` → `implementation-ready` | /sdd-spec | Implementation spec generated with 12 steps |
| 2026-06-01 | `implementation-ready` (spec updated) | /sdd-review | Added to Stream 2 after 045; FR-13 corrected to gRPC + xstockstrat-ui target; impl spec Steps 6–10 flagged for regeneration after 044+045 land. |
| 2026-06-02 | `implementation-ready` (spec regenerated) | /sdd-spec | Re-ran sdd-spec after 044+045+046 merged; all 12 steps regenerated targeting xstockstrat-ui with gRPC+connect-query pattern; Steps 1-5 carry forward from original spec with minor corrections (author field added to RegisterFormulaRequest in proto). |
| 2026-06-02 | `implementation-ready` → `in-progress` | /sdd-execute | Step 1 done — proto RPCs and author field added |
| 2026-06-04 | `in-progress` (Step 12 re-spec) | /sdd-execute | Merged current main-dev; targeted re-spec of Step 12 e2e path (xstockstrat-insights → xstockstrat-ui/e2e/insights) after unified-FE-E2E consolidation. Steps 1–11 reconfirmed valid. |
| 2026-06-04 | `in-progress` → `code-completed` | /sdd-execute | Steps 2–12 executed (Step 1 already done). Per-step PRs #525–#535 stacked sequentially. All verifications pass (proto regen, migration up/down on PG16, 22 pytest @ 81.9% cov, ui lint/tsc clean, formulas e2e 2 passed). |

| 2026-06-04 | `code-completed` → `launched` | CI workflow | Promoted via PR #554; committed 88268b2e90af291f3326d918d35f0c4986f92dcf |
---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Persist indicator formulas to TimescaleDB so they survive service restarts, scope them to the owning user (`author = user_id`), and add a full CRUD management UI inside `xstockstrat-insights`.

## Reviewers

_(Snapshot finalized by /sdd-spec on 2026-05-10. Re-run /sdd-spec to update if registry changes.)_

_(Snapshot finalized by /sdd-spec on 2026-06-02. Re-run /sdd-spec to update if registry changes.)_

| Role | Review Focus |
|---|---|
| Proto Reviewer | Field number uniqueness, backward compatibility (no field removal or type change without deprecation), `buf lint`/`buf breaking` passes, BSR publication readiness |
| DBA | Migration NNN numbering (no gaps, no conflicts), up+down pair present, index correctness, run-order compliance with `scripts/db-migrate.sh` |
| `xstockstrat-indicators` owner | Formula sandboxing, numeric precision, timeout enforcement (`indicators.sandbox.timeout_ms`), no side-effects from formula execution |
| `xstockstrat-insights` owner | Analytics display accuracy, SSE polling resilience, read-only access pattern |

## Next Action

`/sdd-review formula-management-ui impl-spec` — validate regenerated implementation spec, then `/sdd-execute formula-management-ui`
