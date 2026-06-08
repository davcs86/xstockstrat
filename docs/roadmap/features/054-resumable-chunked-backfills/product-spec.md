# Product Spec: resumable-chunked-backfills

**Created**: 2026-06-08
**Priority Bucket**: P2 — Scale & resumability

---

## Problem Statement

A large backfill is one monolithic `BackfillBars` RPC (`_run_backfill` →
`MarketDataService.BackfillBars` in `services/xstockstrat-ingest/app/handlers/servicer.py`). If it
dies at 80% — restart, crash, network blip, Alpaca timeout — all progress is lost and the operator
restarts from zero. The historical-backfill runbook works around this by telling operators to
manually split jobs into per-year `curl`/RPC loops. There is also no way to refresh only the
missing ranges: the only knob is a binary `overwrite` flag, so a routine "catch me up" re-fetches
everything or risks gaps.

## User Story

As a **platform operator backfilling years of multi-symbol history**, I want a large job to run in
resumable chunks and to be able to fetch only the gaps, so that an interruption costs me one chunk
instead of the whole job, and a routine refresh doesn't re-download data I already have.

## Functional Requirements

FR-1. A backfill job MUST be split server-side into chunks along symbol and/or time-window
boundaries (replacing the manual per-year loop in `docs/runbooks/historical-backfill.md`). Chunk
size is bounded (see Open Questions) to keep each chunk well under the runbook's "avoid >1M bars"
guidance.

FR-2. Per-chunk state MUST be persisted (status, range, bars written) so that on resume the job
re-runs only `PENDING`/`FAILED` chunks, never already-`COMPLETED` ones. This extends the P0
`ingest.backfill_jobs` model with an `ingest.backfill_chunks` table (or equivalent).

FR-3. On ingest restart, an interrupted job MUST **resume** from its incomplete chunks (this
supersedes P0 FR-3, which only marked interrupted jobs `FAILED`). Resume MUST be idempotent — a
chunk that partially wrote bars before dying must not double-count or corrupt
`bars_processed`/`bars_total`.

FR-4. Add a **"fill gaps only"** mode to `TriggerBackfill` (beyond the binary `overwrite`). In this
mode ingest calls `GetDataCoverage` (P1) to compute missing ranges per symbol and enqueues chunks
for only those gaps. This becomes the natural default for scheduled refreshes.

FR-5. `bars_total` (introduced in P0) MUST become a real sum across planned chunks, and
`bars_processed` MUST advance per completed chunk, so progress is monotonic and meaningful across a
resume.

FR-6. Chunk execution MUST respect the `ingest.backfill.max_concurrent_jobs` gate from P0 (or a
companion `ingest.backfill.max_concurrent_chunks` key) so chunking does not bypass the concurrency
limit and overwhelm Alpaca rate limits (`marketdata.backfill.rate_limit_rps`).

## Out of Scope

- The durable job table, lifecycle events, and notify alerts themselves — delivered by **P0**.
- The `GetDataCoverage` RPC and timeframe normalization themselves — delivered by **P1**; this
  feature *consumes* them.
- Cross-job global scheduling / cron of recurring backfills (the agent scheduler, feature 010,
  already covers scheduled triggers; this feature only makes each triggered job chunked/resumable).
- Distributing chunks across multiple ingest replicas (a single instance executes a job's chunks;
  multi-replica work-stealing is a future consideration).

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-ingest` — owns the change: chunk planner, chunk table, resume logic, fill-gaps mode.
- `xstockstrat-marketdata` — `BackfillBars` is called per chunk; must be idempotent under re-fetch;
  provides `GetDataCoverage` (from P1) for gap computation. Minimal/no new code beyond P1.

## Proto Contract Changes

- [ ] No proto changes required
- **Changes required (additive, non-breaking):**
  - `packages/proto/ingest/v1/ingest.proto` — add a fill-mode to `TriggerBackfillRequest` for FR-4
    (e.g. an enum field `FillMode { UNSPECIFIED, FULL, GAPS_ONLY }`, or reuse/augment the existing
    `overwrite` bool — prefer an explicit enum per repo proto governance). Next free field number.
  - Optionally surface per-chunk progress on `BackfillJob` (e.g. `chunks_total` / `chunks_completed`)
    for richer monitoring. Additive.

## Config Key Changes

- [ ] No new config keys
- **Possible new keys (decide at /sdd-spec):**
  - `ingest.backfill.chunk_max_bars` (int) — target max bars per chunk (chunk-size bound for FR-1).
  - `ingest.backfill.chunk_window_days` (int) — time-window chunk size for FR-1.
  - `ingest.backfill.max_concurrent_chunks` (int) — if chunk concurrency is gated separately from
    `max_concurrent_jobs` (FR-6).
  - All follow `<service>.<category>.<key>` and are documented in `xstockstrat-ingest/CLAUDE.md`.

## Database Changes

- [ ] No schema changes
- **New migration** in `services/xstockstrat-ingest/migrations/` (NNN after P0's
  `backfill_jobs` migration — coordinate run-order so this lands after P0):
  - Table `ingest.backfill_chunks`: `chunk_id` (uuid PK), `job_id` (FK → `ingest.backfill_jobs`),
    `symbols` (text[]), `range_start`, `range_end`, `status` (smallint), `bars_written`, `error`,
    `attempt_count`, `started_at`, `completed_at`. Index on `(job_id, status)` for resume queries.
  - Likely a plain table (operational state, uuid-keyed), DBA to confirm.

## Feature Workflow Notes

Branch to create: `feature/resumable-chunked-backfills` (branch from `main-dev`)
**Sequencing**: start only after P0 (`durable-observable-backfills`) is merged to `main-dev` — this
builds directly on the `ingest.backfill_jobs` table and the concurrency gate. P1 must be merged
before the "fill gaps only" mode (FR-4) can be implemented (needs `GetDataCoverage`).
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto + config change) — `xstockstrat-ingest` owner
- [ ] 2 service owners + platform lead (breaking proto change) — N/A, changes are additive
- [x] DBA review + service owner (schema migration) — new `ingest.backfill_chunks` table

## Acceptance Criteria

1. A multi-year, multi-symbol backfill is split into multiple chunks visible in
   `ingest.backfill_chunks`; `ListBackfillJobs`/`GetBackfillStatus` show monotonic progress.
2. Kill `xstockstrat-ingest` mid-job and restart — the job resumes and only incomplete chunks
   re-run; completed-chunk bars are not re-fetched or double-counted.
3. A `GAPS_ONLY` backfill over a symbol that already has most of its range fetches only the missing
   windows (verified against `GetDataCoverage` before/after).
4. Chunk concurrency honors the configured limit; Alpaca rate-limit errors do not spike under a
   large chunked job.
5. `docs/runbooks/historical-backfill.md` is updated — the manual "split into yearly jobs" `for`-loop
   is replaced with "trigger one job; the server chunks it".

## Open Questions

- [ ] Chunk boundary strategy: by time window (e.g. 1 year), by symbol batch (e.g. 20), or both?
      How does timeframe density (`1m` vs `1d`) drive chunk sizing?
- [ ] Resume idempotency: rely on marketdata `BackfillBars` upsert semantics, or have chunks write
      only after a clean fetch? What is marketdata's current behavior on partial-write + re-fetch?
- [ ] Separate `max_concurrent_chunks` key, or reuse `max_concurrent_jobs` for chunk-level gating?
- [ ] Retention/cleanup of `ingest.backfill_chunks` rows for completed jobs.
- [ ] Should `GAPS_ONLY` become the default mode for agent-scheduled (feature 010) refreshes?
