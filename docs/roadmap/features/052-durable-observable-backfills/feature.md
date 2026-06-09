# Feature: durable-observable-backfills

**Lifecycle Status**: `code-completed`
**Development Branch**: `feature/durable-observable-backfills`
**Created**: 2026-06-08
**Last Updated**: 2026-06-09

**Priority Bucket**: P0 — Make backfills trustworthy (1 of 3 in the backfill-hardening initiative)

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-06-08 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-06-08 | `draft` → `spec-ready` | /sdd-review | Product spec approved; 4 open questions resolved (retry impl, marketdata bars_total, drop in-memory dict, retain jobs) |
| 2026-06-08 | `spec-ready` → `implementation-ready` | /sdd-spec | Implementation spec generated with 12 steps |
| 2026-06-09 | `implementation-ready` → `in-progress` | /sdd-execute | Sequential stacked run started; Steps 1–2 (proto + regen) done |
| 2026-06-09 | `in-progress` → `code-completed` | /sdd-execute | All 12 steps done; ingest pytest 108 passed (cov 69.5%), marketdata go test ok + golangci-lint 0 issues |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Make historical-backfill jobs durable and observable: persist job state to a new
`ingest.backfill_jobs` table (replacing the in-memory dict), emit the full
queued/running/completed/failed ledger lifecycle, alert via notify on failure, report
real `bars_total` progress, and either implement or remove the `retry_on_failure` /
`max_concurrent_jobs` config keys that are currently documented but inert.

## Reviewers

_(Snapshot finalized at /sdd-spec time from docs/runbooks/reviewer-registry.md and the
per-step Reviewers in implementation-spec.md. Re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Proto Reviewer | Field number uniqueness, no breaking changes without deprecation, `buf lint`/`buf breaking` pass (Steps 1–2: adds `BackfillJob.failed_symbols` field 11 + `BackfillBarsResponse.expected_bars` field 3) |
| DBA | Migration NNN numbering (no gaps — new migration is `003`, not `002`), up+down pair present, plain-table (not hypertable) choice for `ingest.backfill_jobs`, index correctness (Step 3) |
| `xstockstrat-ingest` (service owner) | Job-state durability, concurrency-gate correctness, no lost jobs across restart, idempotent ingestion, config key naming/defaults (Steps 3–8, 10, 12) |
| `xstockstrat-marketdata` (service owner) | OHLCV ingestion integrity, Alpaca feed idempotency, `expected_bars` estimate correctness (Steps 1–2, 9, 11) |

_Downstream-only (not modified, called as a dependency): `xstockstrat-notify`, `xstockstrat-ledger`._

## Next Action

`/sdd-review durable-observable-backfills impl-spec` — validate implementation spec, then `/sdd-execute durable-observable-backfills`
