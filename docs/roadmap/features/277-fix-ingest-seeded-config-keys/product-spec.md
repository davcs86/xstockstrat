# Product Spec: fix-ingest-seeded-config-keys

**Type**: bug
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-22-ingest-seeded-config-keys-never-read-defect.md`
**Severity**: SEV-3
**Created**: 2026-10-22

---

## Problem Statement

**Observed.** Config migrations `005_ingest_backfill_chunking` and `025_ingest_mcp_client_keys` seed five `ingest` keys with a namespace-stripped `key` column: `backfill.chunk_max_bars`, `backfill.chunk_window_days`, `backfill.max_concurrent_chunks`, `mcp_client.poll_interval_seconds` and `mcp_client.request_timeout_seconds` (staging `list_config_keys(namespace="ingest")`, 2026-10-22). The config service builds each snapshot as `values[row.key]`, and ingest's `ConfigWatcher.get_*` does a raw `values.get(key)`, but ingest reads all five as `ingest.<key>` (`app/config/watcher.py`, `app/engine/mcp_client_loop.py`). The reads miss and the hard-coded defaults apply, so editing a seeded row has no effect and raises no error. `ingest.backfill.max_concurrent_jobs` and `ingest.backfill.retry_on_failure` are read but never seeded.

**Expected.** Every seeded ingest key is read under the exact key the snapshot carries, so changing a seeded value changes ingest behaviour on the next snapshot. The seed form and the reader form agree, and the INGEST-9 rule states the form that is actually correct.

## Reproduction Steps

1. On staging, `list_config_keys(namespace="ingest")` returns the five bare keys above.
2. `set_config` the `mcp_client.request_timeout_seconds` row to a value other than 30 and let an `mcp_client` source poll a slow endpoint.
3. The per-call timeout stays 30 seconds (inferred from code; not yet run on a live deployment).

## Root Cause Hypothesis

The seed convention is mixed: newer migrations seed the full dotted path, older ones (including ingest's) seed namespace-stripped keys. The 2026-09-03 change that added the `ingest.` prefix to the `mcp_client` reads moved them away from the seeded shape. Fix by re-keying the seeds to the full dotted form or by changing the readers; the design must pick one and also sweep other namespaces' older bare seeds against their readers.

## Affected Services

xstockstrat-ingest, xstockstrat-config.

## Fix Scope

- [ ] No proto changes anticipated
- [ ] No database migrations anticipated (re-keying seeds is a config migration; operator-edited rows must be preserved)
- [ ] No config key changes anticipated

(Update after investigation — remove or replace each item as needed)

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on dev.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
- Fixing other namespaces' bare seeds unless the design's sweep finds the same inert-key defect there and the operator extends the scope
