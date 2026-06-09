# Product Spec: durable-observable-backfills

**Created**: 2026-06-08
**Priority Bucket**: P0 — Make backfills trustworthy

---

## Problem Statement

Historical-backfill jobs are demo-grade, not operations-grade. Job state lives only in an
in-memory dict (`self._jobs` in `services/xstockstrat-ingest/app/handlers/servicer.py`), so
`GetBackfillStatus` / `ListBackfillJobs` lose all jobs on restart and break entirely if ingest
runs more than one replica. Worse, several behaviors that the docs and config keys *promise* do
not exist in code — operators reasonably assume retries and failure alerts are happening when
they are not. This is a correctness/trust problem: a failed overnight backfill is silent, and the
first symptom is an empty backtest.

## User Story

As a **platform operator running historical backfills**, I want job state to survive restarts and
the system to actually retry, throttle, and alert as documented, so that I can trust a backfill
either completed or that I was told why it didn't — without reverse-engineering the ledger or
querying TimescaleDB by hand.

## Functional Requirements

**Durability**

FR-1. Backfill job state MUST be persisted to a new `ingest.backfill_jobs` table. The in-memory
`self._jobs` dict is replaced by (or write-through cached over) the table.

FR-2. `GetBackfillStatus(job_id)` and `ListBackfillJobs(status_filter, page)` MUST read from the
table, so they return correct results after an ingest restart and regardless of which replica
serves the request.

FR-3. On ingest startup, any job left in `RUNNING` or `QUEUED` from a previous process MUST be
reconciled — marked `FAILED` with an `"interrupted by restart"` error (P0 scope: no automatic
resume; resumption is P2 / `resumable-chunked-backfills`).

**Observability**

FR-4. The full ledger lifecycle MUST be emitted, matching what `xstockstrat-ingest/CLAUDE.md`
already documents: `ingest.backfill.queued`, `ingest.backfill.running`, `ingest.backfill.completed`,
and `ingest.backfill.failed` — all on `stream_key = backfill:<job_id>`. Today only `completed` is
emitted. A `PARTIAL` outcome emits `completed` with `failed_symbols` populated (existing behavior),
plus a `failed` event is NOT emitted for partials (partial ≠ total failure).

FR-5. On `FAILED` or `PARTIAL` outcome, ingest MUST emit an alert to `xstockstrat-notify` (the
dependency table in `xstockstrat-ingest/CLAUDE.md` already claims "Alert on backfill failures").
The alert MUST include `job_id`, the failing symbols, and the error string.

FR-6. `BackfillJob.bars_total` MUST be populated so progress is meaningful (`bars_processed /
bars_total`). The estimate is computed at job start (e.g. `marketdata` returns an expected bar
count, or ingest derives it from `symbols × trading-day count × bars-per-day for the timeframe`).
Today `bars_total` is never set and progress is always `X / 0`.

FR-7. `BackfillJob` MUST expose `failed_symbols` so a `PARTIAL` job is diagnosable from the RPC
alone, not only from the ledger payload. (New repeated-string field on the proto message.)

**Honesty (implement or remove)**

FR-8. `ingest.backfill.retry_on_failure` (default `true`) MUST be **implemented** (decision:
implement, not remove — sdd-review 2026-06-08): on a transient `BackfillBars` failure, retry per a
bounded policy — max attempts governed by the new `ingest.backfill.max_retry_attempts` key
(default `3`), exponential backoff `2s / 4s / 8s`, retrying only the failed symbols of the job. When
`retry_on_failure=false`, the first failure is terminal (no retry).

FR-9. `ingest.backfill.max_concurrent_jobs` (default `3`) MUST be **implemented** (decision:
implement, not remove — sdd-review 2026-06-08): enforce a real concurrency gate (asyncio semaphore /
queue) around `_run_backfill`. Today every `TriggerBackfill` fires an unbounded
`asyncio.create_task`. Jobs above the limit stay `QUEUED` until a slot frees.

## Out of Scope

- Resumable / chunked execution of a single large job — that is **P2** (`resumable-chunked-backfills`).
- Coverage-gap awareness and the backtest↔backfill coupling — that is **P1**
  (`backfill-backtest-coverage`).
- Any change to how `xstockstrat-marketdata` fetches from Alpaca beyond optionally returning an
  expected-bar-count estimate for FR-6.
- A backfill management UI (the agent/operator drives this via gRPC for now).

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-ingest` — owns the change: new table, durable job repo, lifecycle events, notify
  alert, concurrency gate, retry policy.
- `xstockstrat-marketdata` — (light) optionally returns an expected-bar-count estimate from
  `BackfillBars` to support FR-6; no schema change.
- `xstockstrat-notify` — call target only (FR-5); not modified.
- `xstockstrat-ledger` — call target only (FR-4); not modified.

## Proto Contract Changes

- [ ] No proto changes required
- **Changes required (non-breaking, additive):**
  - `packages/proto/ingest/v1/ingest.proto` — add `repeated string failed_symbols` to `BackfillJob`
    (next free field number — currently fields 1–10, so `11`). Populates FR-7.
  - `packages/proto/marketdata/v1/marketdata.proto` — add an expected-bar-count field to
    `BackfillBarsResponse` (decision: marketdata returns the estimate — sdd-review 2026-06-08).
    Ingest sets `BackfillJob.bars_total` from this value (FR-6). Next free field number.
  - Both are additive field additions → non-breaking; `buf breaking` must still pass.

## Config Key Changes

- [ ] No new config keys
- **Existing keys whose behavior changes (now implemented, not inert):**
  - `ingest.backfill.retry_on_failure` (bool, default `true`) — implemented (FR-8).
  - `ingest.backfill.max_concurrent_jobs` (int, default `3`) — implemented (FR-9).
- **New key:**
  - `ingest.backfill.max_retry_attempts` (int, default `3`) — bounds FR-8 retries. Follows
    `<service>.<category>.<key>`; documented in `xstockstrat-ingest/CLAUDE.md` Config Keys table.

## Database Changes

- [ ] No schema changes
- **New migration** in `services/xstockstrat-ingest/migrations/` (next NNN after `001_newsletter_signals`):
  `NNN_backfill_jobs.up.sql` / `.down.sql`.
  - Table `ingest.backfill_jobs`: `job_id` (uuid PK), `symbols` (text[]), `timeframe`, `range_start`,
    `range_end`, `status` (smallint, mirrors `BackfillStatus` enum), `bars_processed`, `bars_total`,
    `failed_symbols` (text[]), `error`, `started_at`, `completed_at`, `created_at`.
  - Likely a **plain table, not a hypertable** — it is low-volume operational state keyed by uuid,
    not time-series data (DBA to confirm). Index on `status` and `created_at` for `ListBackfillJobs`.

## Feature Workflow Notes

Branch to create: `feature/durable-observable-backfills` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto + config change) — `xstockstrat-ingest` owner
- [ ] 2 service owners + platform lead (breaking proto change) — N/A, changes are additive
- [x] DBA review + service owner (schema migration) — new `ingest.backfill_jobs` table

## Acceptance Criteria

1. Trigger a backfill, restart `xstockstrat-ingest` mid-job, then call `GetBackfillStatus` — the
   job is still present and shows a terminal/reconciled status (not `NOT_FOUND`).
2. A backfill that Alpaca rejects produces an `ingest.backfill.failed` ledger event **and** a
   notify alert containing the `job_id` and error.
3. `GetBackfillStatus` returns `bars_processed` and a non-zero `bars_total` during/after a run.
4. A `PARTIAL` job returns its `failed_symbols` list directly from `GetBackfillStatus`.
5. With `max_concurrent_jobs=1`, triggering two jobs leaves the second `QUEUED` until the first
   finishes (verifiable via `ListBackfillJobs`). _(If FR-9 is implemented rather than removed.)_
6. `ingest.backfill.retry_on_failure` visibly changes behavior in tests: with it `true`, a transient
   `BackfillBars` failure is retried up to `max_retry_attempts` with backoff; with it `false`, the
   first failure is terminal. No documented-but-inert key remains.
7. `xstockstrat-ingest/CLAUDE.md` "Ledger Events Emitted" table matches what the code actually emits.

## Resolved Decisions

_(Resolved during /sdd-review product-spec, 2026-06-08.)_

- [x] **Retry policy**: implement (FR-8). Max attempts via new `ingest.backfill.max_retry_attempts`
      (default `3`); exponential backoff `2s / 4s / 8s`; retry only the failed symbols of the job.
- [x] **`bars_total` source** (FR-6): `marketdata` returns an expected-bar-count from
      `BackfillBarsResponse`; ingest sets `bars_total` from it. (Authoritative; avoids ingest owning
      a market calendar.)
- [x] **Job-state model**: drop the in-memory `self._jobs` dict entirely and read/write
      `ingest.backfill_jobs` on every RPC — required for multi-replica correctness, not a
      write-through cache.
- [x] **`ingest.backfill_jobs` retention**: retain indefinitely for now (low-volume operational
      state keyed by uuid). A retention/cleanup policy is explicitly out of scope here and noted as a
      future ops concern (revisit alongside P2 `ingest.backfill_chunks` retention).
