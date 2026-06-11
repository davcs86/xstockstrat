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
  new additive `CancelBackfill(job_id)` RPC on `IngestService`, cooperating with the durable
  job state and resumable-chunk logic from 052/054.
FR-5. **Delete backfilled data** — Delete previously backfilled OHLCV data for a ticker
  (full symbol or a date range). **No delete RPC exists** → requires a new additive,
  scoped `DeleteBackfilledData` RPC, owned by `xstockstrat-marketdata` (the OHLCV store).
  Destructive: requires a typed confirmation in the UI and a DBA-reviewed scoped delete.
FR-6. **Progress accuracy** — Surface the real `bars_total`/progress that feature 052 made
  truthful; do not show fabricated progress.

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
  — scoped by symbol + optional date range + timeframe.
- Run `./scripts/buf-gen.sh`; `buf breaking` must stay green (additive only).

## Config Key Changes

- [ ] None expected. (If a delete safety guard needs a tunable, e.g. max delete window,
  /sdd-spec will register a `marketdata.backfill.*` key with the config team.)

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
3. An operator can cancel a running backfill and see it transition to a canceled state
   without orphaning chunks.
4. An operator can delete backfilled data for a ticker (scoped), guarded by a typed
   confirmation, and the deletion is bounded and partition-safe.
5. `buf lint`/`buf breaking` pass; all proto changes additive.

## Open Questions

- [ ] Cancel semantics with resumable chunks (052/054): does cancel mark the job canceled
  and stop scheduling new chunks, or also roll back in-flight chunk writes?
- [ ] Delete scope: symbol-wide vs. date-range vs. timeframe-specific — which combinations
  must FR-5 support, and what is the maximum bounded window before a second confirmation?
- [ ] Which service owns the destructive delete — `xstockstrat-marketdata` (OHLCV store) is
  assumed; confirm ingest doesn't need to invalidate any derived state.
- [ ] Live progress transport: poll `GetBackfillStatus` on an interval (consistent with
  other trader pages) vs. add a streaming RPC.
- [ ] Who is the persona/authz scope for this page — operator/admin only? (Relates to the
  admin auth gates from `049-unify-admin-auth-gates`.)
