# Defect: Ingest MCP-client poller drops or stalls signals (batch abort, no secret deadline, first-list extraction), and a canceled backfill is revived as RUNNING

**Recorded**: 2026-10-21
**Severity**: SEV-2
**Impact type**: silent-signal-loss
**Environment**: dev (main-dev) @ a053b0e
**Affected service(s)**: xstockstrat-ingest, xstockstrat-config
**Config-only fix possible**: no
**Source**: repo-surveyor debt-radar scan (`docs/repo-surveyor/debt-radar-findings.md` @ 4535695), findings D-09, D-34, D-42, D-59. Grouped by service + theme (ingest background work: the `mcp_client` poller and the backfill runner). The scan rated D-59 one level lower; it is grouped here because it is in the same poller file and has the same impact (a source silently ingests nothing). Config is listed because D-42 is a client call to its `GetSecret` RPC; no config-side change is expected.

## Observed

### D-09 — The MCP-client poller aborts a source's whole batch on the first bad item

`poll_one_source` ingests the parsed items in a plain `for` loop. If `_build_external_signal` (for example a
`KeyError` on a missing `symbol`) or `_ingest_external_signal` raises for one item, the exception leaves the loop. The
caller's per-source `except` records a source error. Every remaining signal in that batch is dropped. The next poll
fetches a fresh batch, so the dropped items are not retried.

### D-34 — Backfill cancel is overwritten to RUNNING, and resume revives canceled jobs

`CancelBackfill` accepts a `QUEUED` job. It adds the job to the in-memory `_canceled_jobs` set and writes `CANCELED`.
But a queued job's `_run_backfill` task is still waiting on `_backfill_sem`. When the semaphore frees, it writes
`RUNNING` unconditionally and emits `ingest.backfill.running`. Traced on a053b0e:

- bars job: chunks are planned and inserted as PENDING, then `run_one` skips each one (the job is in
  `_canceled_jobs`), and `_finalize_backfill` discards the flag and returns early. The job is left `RUNNING` with
  PENDING chunks;
- fundamentals job: `_execute_fundamentals_backfill` never checks the flag. It calls `BackfillFundamentals` (vendor
  quota) and overwrites `CANCELED` with `COMPLETED`/`PARTIAL`.

On restart, `resume_incomplete_jobs` re-drives every job that has PENDING/FAILED chunks. It does not check the job's
status. `_resume_job` writes `RUNNING` again, and `_canceled_jobs` is empty after a restart, so the chunks execute. A
canceled job comes back and spends vendor quota.

### D-42 — `resolve_secret` has no deadline and runs inside the serial MCP-client poll

`ConfigWatcher.resolve_secret` calls `GetSecret` with no `timeout=`. It is awaited inside `poll_one_source`, which runs
serially per source in the single background task. The only timeout covers `mcp_client.fetch`. One hung config call
blocks the task, so every user's `mcp_client` sources stop polling. No error is recorded on any source.

### D-59 — Result extraction takes the first list-valued key

`_extract_result_items` returns the first list value of a dict-shaped `structured_content`. A response such as
`{"warnings": [], "signals": [...]}` yields `[]`, so the source silently ingests nothing.

## Expected

- D-09: each item is ingested in its own guard. A bad item is logged and counted. The rest of the batch is ingested.
- D-34: a job canceled while `QUEUED` never moves to `RUNNING` and runs no chunks. Resume skips jobs whose status is
  `CANCELED` (or any terminal state), also after a restart.
- D-42: `GetSecret` has a deadline (for example from the existing `ingest.mcp_client.request_timeout_seconds`). A
  deadline error is recorded as that source's error, and the loop moves to the next source.
- D-59: the signal list is chosen unambiguously (for example the sole list key, a named `signals` key, or a configured
  `result_key`). An ambiguous shape is recorded as a source error, not as an empty batch.

## Reproduction

1. D-09: drive `poll_one_source` with a fetch result of three items, where item 2 has no `symbol`. Only item 1 is
   ingested, and the source is marked errored.
2. D-34 (queue): set `ingest.backfill.max_concurrent_jobs` to 1. Trigger job A (long) and job B. Cancel B while it is
   `QUEUED`. When A finishes, B's status becomes `RUNNING` and stays there with PENDING chunks (bars), or becomes
   `COMPLETED` after a `BackfillFundamentals` call (fundamentals).
3. D-34 (resume): cancel a running job that still has PENDING chunks, then restart ingest. `resume_incomplete_jobs`
   re-drives it and its status becomes `RUNNING`.
4. D-42: make the `GetSecret` stub never return. `run_one_cycle` never completes, and no source after the first is
   polled.
5. D-59: return `structured_content = {"warnings": [], "signals": [{"symbol": "AAPL", ...}]}`. No signal is ingested
   and no error is recorded.

## Evidence

### D-09

`services/xstockstrat-ingest/app/engine/mcp_client_loop.py:124-125` (unchanged), caller catch `:143-146` (scan `:145`)
> for item in parsed:
>     await servicer._ingest_external_signal(_build_external_signal(slug, item), owner=owner)

### D-34

`services/xstockstrat-ingest/app/handlers/servicer.py:493-498` (scan `:494-498`)
> async with self._backfill_sem:
>     await backfill_jobs.update_job(
>         self._db,
>         job_id,
>         status=ingest_pb2.BACKFILL_STATUS_RUNNING,

`services/xstockstrat-ingest/app/handlers/servicer.py:714-737` (resume; `RUNNING` write at `:734`, unchanged)
> job_ids = await backfill_chunks.list_jobs_with_incomplete_chunks(self._db)
> ...
> await backfill_jobs.update_job(self._db, job_id, status=ingest_pb2.BACKFILL_STATUS_RUNNING)

`services/xstockstrat-ingest/app/repositories/backfill_chunks.py:143-146` (unchanged)
> "SELECT DISTINCT job_id FROM ingest.backfill_chunks WHERE status IN ($1, $2)",

`services/xstockstrat-ingest/app/handlers/servicer.py:326` (in-memory only), `:883-902` (`CancelBackfill` accepts
`QUEUED`/`RUNNING`, adds to `_canceled_jobs`, writes `CANCELED`). `run_one` skips chunks of a flagged job (`:759-760`),
and `_finalize_backfill` discards the flag and returns without writing a status (`:655-659`).
`_execute_fundamentals_backfill` (`:526-545`) has no cancel check.

### D-42

`services/xstockstrat-ingest/app/config/watcher.py:155-163` (unchanged)
> resp = await self._stub.GetSecret(
>     config_pb2.GetSecretRequest(...),
>     metadata=((HEADER_INTERNAL_CALLER, INGEST_INTERNAL_CALLER_ID),),
> )

`services/xstockstrat-ingest/app/engine/mcp_client_loop.py:116` (call site), `:139-146` (serial per-source loop), `:121`
(the only timeout, on `mcp_client.fetch`).

### D-59

`services/xstockstrat-ingest/app/engine/mcp_client_loop.py:41-45` (unchanged)
> if isinstance(sc, dict):
>     for value in sc.values():
>         if isinstance(value, list):
>             return value

## Root cause hypothesis

The poller's error handling is per source, not per item or per call: one bad item or one hung RPC takes down a whole
batch or the whole loop. The extraction heuristic was written for single-key wrappers. Backfill cancellation is an
in-memory flag checked only between chunks, and the queued-start and resume paths write `RUNNING` without reading the
current status.

## Confidence

high
