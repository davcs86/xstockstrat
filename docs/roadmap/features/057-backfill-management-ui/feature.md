# Feature: backfill-management-ui

**Lifecycle Status**: `spec-ready`
**Development Branch**: `feature/backfill-management-ui`
**Created**: 2026-06-10
**Last Updated**: 2026-06-10

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-06-10 | — → `idea` | backlog capture | Feature captured in backlog |
| 2026-06-10 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-06-10 | `draft` → `spec-ready` | /sdd-review | Product spec approved; open questions resolved (cancel=stop+keep bars, delete=symbol+range+timeframe bounded w/ 2nd confirm, poll progress, admin-only access FR-7) |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec backfill-management-ui`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

A dedicated UI page to manage per-ticker historical backfills — create, monitor live
progress, cancel in-flight jobs, and delete backfilled data — built on the durable backfill
job state from features 052–054, requiring new additive `CancelBackfill` and
`DeleteBackfilledData` RPCs (the latter a destructive marketdata op with a DBA gate).

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed. Snapshot finalized at /sdd-spec time — re-run /sdd-spec if
the registry changes.)_

| Role | Review Focus |
|---|---|
| Proto Reviewer | Field number uniqueness, additive-only changes (new `CancelBackfill` / `DeleteBackfilledData` RPCs + ticker filter), `buf lint`/`buf breaking` pass |
| `xstockstrat-ingest` (service owner) | Backfill job control correctness, idempotent ingestion, job-state durability, cancel without orphaned jobs |
| `xstockstrat-marketdata` (service owner) | OHLCV ingestion integrity, TimescaleDB hypertable partitioning, safe scoped deletion of backfilled bars |
| `xstockstrat-ui` (service owner) | UI correctness, Connect-RPC call safety, confirmation UX for destructive delete, admin-scope gating (per 049) so non-admins cannot reach the page |
| DBA | Scoped delete safety on the OHLCV hypertable (no full-table deletes), index/partition correctness |
| Security | Admin/operator access-scope enforcement on the page + mutating RPCs (FR-7), reusing `049-unify-admin-auth-gates` |

## Next Action

`/sdd-spec backfill-management-ui` — generate implementation spec from the approved product spec
