# Feature: durable-observable-backfills

**Lifecycle Status**: `draft`
**Development Branch**: `feature/durable-observable-backfills`
**Created**: 2026-06-08
**Last Updated**: 2026-06-08

**Priority Bucket**: P0 — Make backfills trustworthy (1 of 3 in the backfill-hardening initiative)

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-06-08 | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec durable-observable-backfills`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Make historical-backfill jobs durable and observable: persist job state to a new
`ingest.backfill_jobs` table (replacing the in-memory dict), emit the full
queued/running/completed/failed ledger lifecycle, alert via notify on failure, report
real `bars_total` progress, and either implement or remove the `retry_on_failure` /
`max_concurrent_jobs` config keys that are currently documented but inert.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Proto Reviewer | Field number uniqueness, no breaking changes without deprecation, `buf lint`/`buf breaking` pass (adds `failed_symbols` + `bars_total` population to `BackfillJob`) |
| DBA | Migration NNN numbering (no gaps), up+down pair present, hypertable vs. plain-table choice for `ingest.backfill_jobs`, index correctness |
| `xstockstrat-ingest` (service owner) | Idempotent ingestion, job-state durability, concurrency-gate correctness, no lost jobs across restart |

_Downstream-only (not modified, called as a dependency): `xstockstrat-notify`, `xstockstrat-ledger`._

## Next Action

`/sdd-review durable-observable-backfills product-spec` — AI review of product spec before running /sdd-spec
