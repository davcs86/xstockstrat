# Feature: resumable-chunked-backfills

**Lifecycle Status**: `in-progress`
**Development Branch**: `feature/resumable-chunked-backfills`
**Created**: 2026-06-08
**Last Updated**: 2026-06-09

**Priority Bucket**: P2 — Scale & resumability (3 of 3 in the backfill-hardening initiative)

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-06-08 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-06-08 | `draft` → `spec-ready` | /sdd-review | Product spec approved; 5 open questions resolved (chunk strategy, resume idempotency, separate chunk-concurrency key, retention, GAPS_ONLY default); merge-order deps on 052+053 recorded |
| 2026-06-09 | `spec-ready` → `implementation-ready` | /sdd-spec | Implementation spec generated with 9 steps. Flagged hard prerequisite: 052 (backfill_jobs table + concurrency gate) and 053 (GetDataCoverage RPC) are NOT yet on main-dev; re-run /sdd-spec after they merge. Confirmed marketdata OHLCV write is an idempotent upsert (resume-safe). |
| 2026-06-09 | `implementation-ready` → `in-progress` | /sdd-execute | Sequential stacked run (on 053). Re-spec vs stacked base: BackfillJob chunks_total/completed=13/14 (052+053 took 11/12), TriggerBackfillRequest fill_mode=6 (053 took 5), ingest migration=004 (052 took 003), config migration=005 (052 added none). GetDataCoverage + backfill_jobs now present. |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — 9 steps; gated on features 052 + 053
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
| Proto Reviewer | Field number uniqueness, no breaking changes without deprecation, `buf lint`/`buf breaking` pass (adds `FillMode` enum + `fill_mode` field to `TriggerBackfillRequest`; `chunks_total`/`chunks_completed` on `BackfillJob`) — Steps 1, 2 |
| DBA | Migration NNN numbering (no gaps), up+down pair present, `ingest.backfill_chunks` FK/index correctness, run-order vs. feature 052's `backfill_jobs` migration — Step 4 |
| `xstockstrat-ingest` (service owner) | Additive proto fields, idempotent chunk execution, resume-after-restart correctness, concurrency-gate interaction, no double-fetch, chunk schema, config key naming, test coverage — Steps 1, 2, 4, 6, 7 |
| `xstockstrat-marketdata` (service owner) | No marketdata proto change in this feature; OHLCV ingestion idempotency under chunked re-fetch (confirmed: existing `ON CONFLICT DO UPDATE` upsert) — Steps 1, 2 |
| `xstockstrat-config` (service owner) | Config key naming (`<service>.<category>.<key>`), environment/trading_mode scoping for the three new `ingest.backfill.*` keys — Step 8 |

## Next Action

`/sdd-review resumable-chunked-backfills impl-spec` — validate the implementation spec. Then, **only after features 052 + 053 are merged and `launched`** (see merge-order.md), re-run `/sdd-spec resumable-chunked-backfills` to re-ground the 052/053-dependent references, then `/sdd-execute resumable-chunked-backfills`.
