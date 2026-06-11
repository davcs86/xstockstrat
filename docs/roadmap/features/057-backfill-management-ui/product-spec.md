# Product Spec: backfill-management-ui

**Created**: 2026-06-10

---

## Problem Statement

Historical backfills are now durable and observable at the backend (features 052–054), but
there is no UI to drive them. Operators must use the agent/CLI/gRPC to trigger backfills,
cannot watch progress in a dashboard, cannot cancel a runaway job, and have no way to delete
bad/duplicate backfilled data for a ticker.

## User Story

As a platform operator, I want a Backfills page where I can start a backfill for a ticker,
watch its progress, cancel it, and delete previously backfilled data, so that I can manage
historical OHLCV coverage without touching the API directly.

## Functional Requirements

FR-1. **Create backfill** — Form to trigger a backfill (symbol(s), timeframe, date range)
  via `IngestService.TriggerBackfill`.
FR-2. **Job list + monitor** — Paginated list of backfill jobs via
  `IngestService.ListBackfillJobs`, showing status (queued/running/completed/failed/
  partial), `bars_processed`/`bars_total`, `chunks_completed`/`chunks_total`, failed
  symbols, and error — all already on `BackfillJob` (from features 052/054). Live progress
  via polling `GetBackfillStatus` (or streaming if available).
FR-3. **Filter jobs** — Filter the job list by status (`ListBackfillJobs.status_filter`
  exists) and by ticker/symbol (**requires an additive symbol filter field** on
  `ListBackfillJobsRequest`).
FR-4. **Cancel job** — Cancel an in-flight backfill. **No cancel RPC exists** → requires a
  new additive `CancelBackfill(job_id)` RPC on `IngestService`. Cancel marks the job
  `CANCELED` and **stops scheduling further chunks**; bars already written by completed
  chunks are **retained** (consistent with the resumable-chunk model from feature 054).
  Cancel does not delete data — purging is the separate FR-5 path.
FR-5. **Delete backfilled data** — Delete previously backfilled OHLCV data for a ticker.
  **No delete RPC exists** → requires a new additive, scoped `DeleteBackfilledData` RPC,
  owned by `xstockstrat-marketdata` (the OHLCV store). Scope: **symbol + optional date range
  + optional timeframe**, always bounded. A whole-symbol delete (symbol with no date range)
  requires a **second typed confirmation** in the UI. Destructive: DBA-reviewed,
  partition-safe, bounded delete (never a full-table wipe).
FR-6. **Progress accuracy** — Surface the real `bars_total`/progress that feature 052 made
  truthful; do not show fabricated progress.
FR-7. **Access scope** — The Backfills page and its mutating RPCs are restricted to
  **admin/operator access scope**, reusing the admin auth gates established in
  `049-unify-admin-auth-gates`. Non-admin users do not see the page.

## Out of Scope

- Changing backfill durability/resumability/coverage internals (already shipped in 052–054).
- Backfilling non-OHLCV data (signals, fundamentals).
- Scheduling/recurring backfills (one-shot trigger only for this cut).
- Backtest coverage gap analysis (cf. `053-backfill-backtest-coverage`).

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-ui` — new Backfills page (create/list/monitor/cancel/delete); BFF route(s)
  to ingest and marketdata.
- `xstockstrat-ingest` — additive `CancelBackfill` RPC + ticker filter on
  `ListBackfillJobsRequest`.
- `xstockstrat-marketdata` — additive `DeleteBackfilledData` RPC (scoped, destructive).
- `packages/proto` — the new RPCs/messages + additive filter field.

## Proto Contract Changes

- [ ] ~~No proto changes required~~
- **`ingest/v1/ingest.proto`** (additive): new RPC `CancelBackfill(CancelBackfillRequest)
  returns (BackfillJob)`; additive `string symbol` (or `repeated string symbols`) filter on
  `ListBackfillJobsRequest` (next free field number).
- **`marketdata/v1/marketdata.proto`** (additive): new RPC
  `DeleteBackfilledData(DeleteBackfilledDataRequest) returns (DeleteBackfilledDataResponse)`
  — request scoped by `symbol` + optional `TimeRange` + optional `Timeframe`; response
  returns rows-deleted count. Server rejects an unbounded request (no symbol).
- Run `./scripts/buf-gen.sh`; `buf breaking` must stay green (additive only).

## Config Key Changes

- One key registered during /sdd-spec: **`marketdata.backfill.max_delete_days`** (int,
  default `0` = no cap) — optional safety guard bounding the FR-5 delete window. Follows the
  `<service>.<category>.<key>` convention within the existing `marketdata.backfill.*`
  namespace; safe disabled-by-default value means no rollout is required to ship.

## Database Changes

- [x] No new tables — `ingest.backfill_jobs` already exists (feature 052). FR-5 performs a
  **scoped DELETE** against the marketdata OHLCV hypertable; this is a destructive data op,
  not a schema migration, but **requires DBA review** for partition-safe, bounded deletes
  (no full-table wipes).

## Feature Workflow Notes

Branch to create: `feature/backfill-management-ui` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto) — Proto Reviewer + `xstockstrat-ingest`
  owner + `xstockstrat-marketdata` owner + `xstockstrat-ui` owner
- [ ] 2 service owners + platform lead (breaking proto change) — N/A (additive only)
- [x] DBA review — for the scoped OHLCV delete path (FR-5)

## Acceptance Criteria

1. An operator can trigger a backfill for a ticker/timeframe/range from the UI and see the
   job appear.
2. The job list shows live, truthful progress (bars + chunks) and status, filterable by
   status and ticker.
3. An operator can cancel a running backfill; it transitions to `CANCELED`, stops
   scheduling new chunks, and retains bars already written by completed chunks.
4. An operator can delete backfilled data scoped by symbol + range + timeframe, guarded by a
   typed confirmation (and a second confirmation for a whole-symbol delete); the deletion is
   bounded and partition-safe, and the server rejects an unbounded (no-symbol) request.
5. `buf lint`/`buf breaking` pass; all proto changes additive.
6. A non-admin user cannot reach the Backfills page or its mutating RPCs.

## Open Questions

_Resolved during /sdd-review 2026-06-10:_

- [x] **Cancel semantics** → cancel marks `CANCELED`, stops scheduling new chunks, and
  **retains** bars from completed chunks (no rollback). Purging is the separate FR-5 path.
- [x] **Delete scope** → **symbol + optional date range + optional timeframe**, always
  bounded; whole-symbol delete needs a second typed confirmation; unbounded requests
  rejected server-side.
- [x] **Live progress transport** → **poll `GetBackfillStatus`** on an interval, consistent
  with other trader pages (no new streaming RPC).
- [x] **Access scope** → **admin/operator only**, reusing `049-unify-admin-auth-gates` (FR-7).

_Resolved during /sdd-spec (no longer open):_

- `xstockstrat-ingest` holds **no derived state** to invalidate on a marketdata bar delete —
  ingest owns the job records, marketdata owns the bars; cancel only flips job state.
- The max-window guard **was** registered as `marketdata.backfill.max_delete_days` (int,
  default `0` = no cap) — see Config Key Changes above.
