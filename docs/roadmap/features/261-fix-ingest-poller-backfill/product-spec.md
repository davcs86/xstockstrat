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

## Reproduction Steps

1. D-09: fetch result of three items, item 2 missing `symbol`. Only item 1 is ingested.
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
- [ ] No database migrations anticipated — the D-34 fix can read the persisted job status; a migration is needed only if design adds a column
- [ ] No config key changes anticipated — D-42 should reuse `ingest.mcp_client.request_timeout_seconds`; D-59 may add a per-source `result_key` inside `config_json` (not a config-service key); design decides

(Update after investigation — remove or replace each item as needed)

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
