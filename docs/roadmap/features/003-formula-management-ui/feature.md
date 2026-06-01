# Feature: formula-management-ui

**Lifecycle Status**: `implementation-ready`
**Development Branch**: `feature/formula-management-ui`
**Created**: 2026-05-10
**Last Updated**: 2026-06-01

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-10 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-05-10 | `draft` → `spec-ready` | /sdd-review | Product spec approved (1 advisory warning) |
| 2026-05-10 | `spec-ready` → `implementation-ready` | /sdd-spec | Implementation spec generated with 12 steps |
| 2026-06-01 | `implementation-ready` (spec updated) | /sdd-review | Added to Stream 2 after 045; FR-13 corrected to gRPC + xstockstrat-ui target; impl spec Steps 6–10 flagged for regeneration after 044+045 land. |

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

| Role | Review Focus |
|---|---|
| Proto Reviewer | Field number uniqueness, backward compatibility (no field removal or type change without deprecation), `buf lint`/`buf breaking` passes, BSR publication readiness |
| DBA | Migration NNN numbering (no gaps, no conflicts), up+down pair present, index correctness, run-order compliance with `scripts/db-migrate.sh` |
| `xstockstrat-indicators` owner | Formula sandboxing, numeric precision, timeout enforcement (`indicators.sandbox.timeout_ms`), no side-effects from formula execution |
| `xstockstrat-insights` owner | Analytics display accuracy, SSE polling resilience, read-only access pattern |

## Next Action

Wait for `044-client-api-pattern` **and** `045-ui-consolidation-nextjs` to merge, then re-run `/sdd-spec formula-management-ui` to regenerate Steps 6–10 targeting `xstockstrat-ui`, then `/sdd-execute formula-management-ui`.
