# Feature: backfill-management-ui

**Lifecycle Status**: `implementation-ready`
**Development Branch**: `feature/backfill-management-ui`
**Created**: 2026-06-10
**Last Updated**: 2026-06-11

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-06-10 | — → `idea` | backlog capture | Feature captured in backlog |
| 2026-06-10 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-06-10 | `draft` → `spec-ready` | /sdd-review | Product spec approved; open questions resolved (cancel=stop+keep bars, delete=symbol+range+timeframe bounded w/ 2nd confirm, poll progress, admin-only access FR-7) |
| 2026-06-11 | `spec-ready` → `implementation-ready` | /sdd-spec | Implementation spec generated with 14 steps |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — 14 numbered steps with codebase evidence
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

A dedicated UI page to manage per-ticker historical backfills — create, monitor live
progress, cancel in-flight jobs, and delete backfilled data — built on the durable backfill
job state from features 052–054, requiring new additive `CancelBackfill` and
`DeleteBackfilledData` RPCs (the latter a destructive marketdata op with a DBA gate).

## Reviewers

_(Snapshot finalized at /sdd-spec time from the distinct per-step Reviewers in
implementation-spec.md. Re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Proto Reviewer | Field number uniqueness, additive-only changes (new `CancelBackfill` / `DeleteBackfilledData` RPCs, `BACKFILL_STATUS_CANCELED`, symbol filter), `buf lint`/`buf breaking` pass (Steps 1, 2) |
| `xstockstrat-ingest` (service owner) | Backfill job control correctness, idempotent ingestion, job-state durability, cancel without orphaned jobs (Steps 1, 3, 4) |
| `xstockstrat-marketdata` (service owner) | OHLCV ingestion integrity, TimescaleDB hypertable partitioning, safe scoped deletion of backfilled bars, config key naming (Steps 1, 5, 6, 7) |
| `xstockstrat-ui` (service owner) | UI correctness, Connect-RPC call safety, confirmation UX for destructive delete, admin-scope gating (per 049) so non-admins cannot reach the page (Steps 1, 8–13) |
| DBA | Scoped delete safety on the OHLCV hypertable (no full-table deletes), index/partition correctness (Steps 5, 6) |
| Security | Admin/operator access-scope enforcement on the page + mutating RPCs (FR-7), reusing `049-unify-admin-auth-gates` (Steps 8, 11) |

## Next Action

`/sdd-review backfill-management-ui impl-spec` — validate implementation spec, then `/sdd-execute backfill-management-ui`
