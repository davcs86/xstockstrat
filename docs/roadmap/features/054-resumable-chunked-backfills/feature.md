# Feature: resumable-chunked-backfills

**Lifecycle Status**: `draft`
**Development Branch**: `feature/resumable-chunked-backfills`
**Created**: 2026-06-08
**Last Updated**: 2026-06-08

**Priority Bucket**: P2 — Scale & resumability (3 of 3 in the backfill-hardening initiative)

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-06-08 | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec resumable-chunked-backfills`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Make large backfills scale and survive interruption: split a job into server-side chunks
(by symbol / time window), track per-chunk progress so a restart resumes instead of restarting
from zero, and add a "fill gaps only" mode that uses the P1 `GetDataCoverage` primitive to fetch
only missing ranges. Eliminates the runbook's manual per-year `for`-loop.

## Depends On

- **P0 `durable-observable-backfills`** — requires the durable `ingest.backfill_jobs` table; chunk
  tracking extends it. Do not start until P0 is merged.
- **P1 `backfill-backtest-coverage`** — "fill gaps only" mode consumes the `GetDataCoverage` RPC.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Proto Reviewer | Field number uniqueness, no breaking changes without deprecation, `buf lint`/`buf breaking` pass (adds a fill-mode field to `TriggerBackfillRequest`; possible per-chunk progress fields) |
| DBA | Migration NNN numbering (no gaps), up+down pair present, `ingest.backfill_chunks` partitioning/index correctness, run-order vs. P0's migration |
| `xstockstrat-ingest` (service owner) | Idempotent chunk execution, resume-after-restart correctness, concurrency-gate interaction, no double-fetch |
| `xstockstrat-marketdata` (service owner) | OHLCV ingestion idempotency under chunked re-fetch, hypertable write safety |

## Next Action

`/sdd-review resumable-chunked-backfills product-spec` — AI review of product spec before running /sdd-spec
