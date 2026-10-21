# Product Spec: fix-ingest-poller-backfill

**Type**: bug
**GitHub Issue**: none. Defect report: `docs/reports/2026-10-21-ingest-poller-backfill-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-21

---

## Problem Statement

**Observed.**

- **D-09.** `poll_one_source` ingests parsed items in an unguarded loop
  (`services/xstockstrat-ingest/app/engine/mcp_client_loop.py:124-125`). The first item that raises ends the batch, and
  the caller marks the source errored (`:143-146`). The remaining signals are dropped and never retried.
- **D-34.** A job canceled while `QUEUED` is written `RUNNING` once `_backfill_sem` frees
  (`app/handlers/servicer.py:493-498`). A bars job is then left `RUNNING` with PENDING chunks (`run_one` skips them,
  `:759-760`; `_finalize_backfill` returns early, `:655-659`). A fundamentals job calls `BackfillFundamentals` and
  overwrites `CANCELED` with `COMPLETED`/`PARTIAL` (`:526-545`, no cancel check). `resume_incomplete_jobs` / `_resume_job` (`:714-737`) re-drive every job with
  PENDING/FAILED chunks (`app/repositories/backfill_chunks.py:143-146`) without checking job status, and write
  `RUNNING` (`:734`). `_canceled_jobs` is in-memory only (`:326`).
- **D-42.** `ConfigWatcher.resolve_secret` calls `GetSecret` with no deadline (`app/config/watcher.py:155-163`). It is
  awaited serially per source in the single poll task (`mcp_client_loop.py:116`, `:139-146`). A hung call stalls all
  sources with no recorded error.
- **D-59.** `_extract_result_items` returns the first list value of a dict result (`mcp_client_loop.py:41-45`), so
  `{"warnings": [], "signals": [...]}` ingests nothing.

**Expected.** Per-item isolation with a count of skipped items; a canceled job never runs and is never resumed; a
`GetSecret` deadline whose expiry is recorded as that source's error; an unambiguous result-list choice with an
ambiguous shape recorded as a source error.

**Who is affected.** Users who register `mcp_client` signal sources (via `/config-ui` or the agent
`manage_signal_source` tool): their signals are dropped or stop arriving, while the source looks healthy or shows an
unrelated error. Admins who cancel a backfill (agent `cancel_backfill`, `get_backfill_status`): the job shows `RUNNING`
again and spends vendor quota.

## Functional Requirements

- **FR-1 (D-09).** `poll_one_source` ingests each item returned by `McpClientExtractor.extract` in its own guard. An
  item that passed extraction but raises in `_build_external_signal` or `_ingest_external_signal` is skipped and
  logged with the source slug; the remaining items of the batch are still ingested. The poll emits one log record per
  source per poll carrying the slug and the skipped count, which counts only these guard-caught items (items the
  extractor already drops, e.g. a missing `symbol`, keep their existing per-item warning and are not counted). The
  regression test asserts that log record. A skipped item alone does not mark the source errored.
- **FR-2 (D-34).** A backfill job (bars or fundamentals) canceled while `QUEUED` stays `CANCELED` when a
  `_backfill_sem` slot frees: it is never written `RUNNING`, emits no `ingest.backfill.running` event, and makes no
  marketdata `BackfillBars` / `BackfillFundamentals` call.
- **FR-3 (D-34).** A fundamentals job canceled while `RUNNING` keeps status `CANCELED` after its in-flight
  `BackfillFundamentals` call returns; finalization never overwrites `CANCELED` with `COMPLETED` or `PARTIAL`.
- **FR-4 (D-34).** `resume_incomplete_jobs` never resumes a job whose persisted status is `CANCELED`, including after
  a restart (when the in-memory `_canceled_jobs` set is empty): its status stays `CANCELED` and none of its
  PENDING/FAILED chunks run.
- **FR-5 (D-42).** The `GetSecret` call made by `ConfigWatcher.resolve_secret` for an `mcp_client` source is bounded
  by `ingest.mcp_client.request_timeout_seconds`. On expiry the source's `last_error` (`ListSignalSources`) records a
  deadline error, and the remaining sources are still polled in the same cycle.
- **FR-6 (D-59).** The signal list is selected from a dict result by an unambiguous rule, not "first list value". A
  result that carries the signal list alongside other lists (e.g. `{"warnings": [], "signals": [...]}`) ingests the
  signals. A result whose signal list cannot be determined unambiguously (e.g. two non-empty candidate lists and no
  rule selecting one) ingests nothing and records an error in the source's `last_error`.

## Consumer Surface(s)

- [x] **UI — `/config-ui` signal-sources view** (feature 083 source-health list): an `mcp_client` source shows the
  correct `last_error` (FR-5 deadline error, FR-6 ambiguous-shape error) and a `signals_fed` count that includes the
  items no longer dropped (FR-1, FR-6). No layout or component change.
- [x] **Agent tools** — `manage_signal_source` / `list_signal_sources` surface the same `last_error` / `signals_fed`
  values; `get_backfill_status` and `cancel_backfill` report a canceled job as `CANCELED` instead of `RUNNING` /
  `COMPLETED` / `PARTIAL` (FR-2..FR-4). No tool schema change unless the FR-6 design adopts a per-source `result_key`
  (see Open Questions).

## Reproduction Steps

1. D-09: fetch result of three valid items; `_ingest_external_signal` raises for item 2. Only item 1 is ingested,
   item 3 is dropped, and the source is marked errored.
2. D-34: `max_concurrent_jobs=1`. Cancel the queued job B while A runs. B becomes `RUNNING` when A ends. Separately,
   cancel a job that still has PENDING chunks and restart. The job is resumed as `RUNNING`.
3. D-42: a `GetSecret` stub that never returns. `run_one_cycle` never completes.
4. D-59: `structured_content = {"warnings": [], "signals": [...]}`. Zero signals, no error.

## Root Cause Hypothesis

Error handling scoped per source rather than per item or per call; a first-match extraction heuristic; an in-memory
cancel flag with unconditional `RUNNING` writes on the queued-start and resume paths. See the report.

## Affected Services

- xstockstrat-ingest (fix site)
- xstockstrat-config (`GetSecret` server; read-only, no change expected)

## Fix Scope

- [x] No proto changes anticipated
- [x] No database migrations anticipated — FR-4 reads the already-persisted job status. If design instead adds a
  column, it adds a numbered `NNN_*.up.sql` + `.down.sql` pair in `services/xstockstrat-ingest/migrations/` and amends
  this box.
- [x] No config-service key changes — FR-5 reuses the existing `ingest.mcp_client.request_timeout_seconds`.

## Open Questions

- [x] **FR-6 selection rule** (resolved for review; mechanism deferred to `/sdd-design`): the observable contract is
  fixed by FR-6 either way. Candidate mechanisms are a well-known key (`signals`/`items`) or a per-source `result_key`
  inside `config_json` (not a config-service key). If design adopts `result_key`, it is a `config_json` contract
  change and design must add the `manage_signal_source` schema and the `/config-ui` source form to Consumer
  Surface(s).

## Coordination

- Feature 244 (`fix-python-config-stored-zero`) rewrites the `ingest.mcp_client.request_timeout_seconds` read in
  `mcp_client_loop.py`; FR-5 reuses that key, so rebase onto whichever lands first.
- Peers in this batch: `fix-python-loop-supervision` (259, ingest `ConfigWatcher` / poll loop) and
  `fix-config-stream-resilience` (`app/config/watcher.py`) share files with FR-1 and FR-5; features 242 and 260 touch
  disjoint regions of `app/handlers/servicer.py`. Design confirms no behavioral collision.

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
- The zero-value clamp on `ingest.mcp_client.*` keys (feature 244)
- The agent-side `get_config` deadline (feature 247)
- Config-service `GetSecret` grant hardening (debt-radar D-40)
