# Product Spec: fix-ingest-seeded-config-keys

**Type**: bug
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-22-ingest-seeded-config-keys-never-read-defect.md`
**Severity**: SEV-3
**Created**: 2026-10-22

---

## Problem Statement

**Observed.** Config migrations `005_ingest_backfill_chunking` and `025_ingest_mcp_client_keys` seed five `ingest` keys with a namespace-stripped `key` column: `backfill.chunk_max_bars`, `backfill.chunk_window_days`, `backfill.max_concurrent_chunks`, `mcp_client.poll_interval_seconds` and `mcp_client.request_timeout_seconds` (staging `list_config_keys(namespace="ingest")`, 2026-10-22). The config service builds each snapshot as `values[row.key]`, and ingest's `ConfigWatcher.get_*` does a raw `values.get(key)`, but ingest reads all five as `ingest.<key>` (`app/config/watcher.py`, `app/engine/mcp_client_loop.py`). The reads miss and the hard-coded defaults apply, so an operator editing a seeded row sees no effect and gets no error. `ingest.backfill.max_concurrent_jobs` and `ingest.backfill.retry_on_failure` are read but never seeded.

**Expected.** Every seeded ingest key is read under the exact key the snapshot carries, so changing a seeded value changes ingest behaviour on the next snapshot. The seed form and the reader form agree, and the INGEST-9 rule states the form that is actually correct.

## Reproduction Steps

1. On staging, `list_config_keys(namespace="ingest")` returns the five bare keys above.
2. `set_config` the `mcp_client.request_timeout_seconds` row to a value other than 30 and let an `mcp_client` source poll a slow endpoint.
3. The per-call timeout stays 30 seconds (inferred from code; not yet run on a live deployment).

## Root Cause Hypothesis

The seed convention is mixed: newer migrations seed the full dotted path, older ones (including ingest's) seed namespace-stripped keys. The 2026-09-03 change that added the `ingest.` prefix to the `mcp_client` reads moved them away from the seeded shape. Fix by re-keying the seeds to the full dotted form or by changing the readers; the design must pick one and also sweep other namespaces' older bare seeds against their readers.

## Affected Services

xstockstrat-ingest, xstockstrat-config.

## Functional Requirements

- **FR-1** Each of the five seeded ingest keys is stored under the full dotted form `ingest.<category>.<key>` (target: `ingest.backfill.chunk_max_bars`, `ingest.backfill.chunk_window_days`, `ingest.backfill.max_concurrent_chunks`, `ingest.mcp_client.poll_interval_seconds`, `ingest.mcp_client.request_timeout_seconds`), matching the exact string ingest reads (CONFIG-9 / Constitution C-05).
- **FR-2** Re-keying preserves operator-edited rows: an existing row's value, `value_type`, environment and scope carry over unchanged to the new key; none is reset to the seeded default or double-prefixed. Precedent: `services/xstockstrat-config/migrations/029_heal_config_keys_full_dotted.up.sql` (feature 189).
- **FR-3** After the fix, changing a seeded ingest value changes ingest behaviour on the next snapshot; a lookup of each seeded key against a snapshot built from the seeds never falls back to the code default.
- **FR-4** `ingest.backfill.max_concurrent_jobs` and `ingest.backfill.retry_on_failure` (read by ingest, never seeded) get an explicit design-time decision (seed or leave code-default-only), recorded in context.md.
- **FR-5** INGEST-9 (`services/xstockstrat-ingest/docs/context-constitution.md`) currently says every read must pass the FULL `<namespace>.`-prefixed key because the getter does a raw `values.get(key)`. After the fix it must state the form that matches the real snapshot shape (the stored `key` column, served verbatim), and the 2026-09-03 findings entry is reconciled with it.
- **FR-6** The design reports a platform-wide sweep of every seeded config key against its reader (all namespaces, both snapshot key forms). Fixing other namespaces stays out of scope unless the operator extends it at the design gate.

## Consumer Surface(s)

Operator-facing config surfaces: the agent `set_config` / `list_config_keys` / `get_config` tools and the config-ui segment of `xstockstrat-ui`, where an operator edits ingest MCP-poll and backfill-chunking values. Visible change: key names listed for namespace `ingest` become the full dotted form, and edits now take effect. No new page, route or tool.

## Fix Scope

- [x] No proto changes anticipated
- [x] Database migration required: a new config migration (NNN must be 033 or later: the config tip is `030_marketdata_edgar_snapshot_keys`, and features 243 and 244 already claim 031 and 032; re-derive across remote branches at spec time) with an up/down pair that re-keys the five seeded rows in place (FR-2). It must not blind-UPDATE onto an existing dotted row (unique key tuple; Open Question 2), and carries migration 029's guards (`is_secret=false`, `NOT LIKE` guard) with `ingest` added to scope. Seeds 005/025 cover the `dev` and `production` environment rows; reconcile with the staging wording at spec time. Applied migrations 005 and 025 are not edited.
- [x] Config key changes required: the five keys above change from bare to full dotted form (FR-1). The re-key-seeds vs change-readers fork is open (see Open Questions).

## Open Questions (for /sdd-design)

1. Re-key the seeds to the dotted form (leading option, per migration 029 precedent) or change the readers to the bare form? Must be settled with the final key strings agreed with feature `244-fix-python-config-stored-zero`, which rewrites the same readers (`watcher.py`, `mcp_client_loop.py`) to `int_positive` over the `ingest.`-prefixed keys.
2. Handling of rows where both a bare and a dotted row already exist (conflict rule).
3. Seed or not: `ingest.backfill.max_concurrent_jobs`, `ingest.backfill.retry_on_failure` (FR-4).
4. Sweep results for other namespaces and whether the operator extends scope (FR-6).

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on dev.

## Out of Scope

- Changing reader semantics for these keys (zero/stored-zero handling belongs to feature 244)
- Changing the config service snapshot-key construction (`values[row.key]`)
- Fixing other namespaces' bare seeds unless the design's sweep finds the same inert-key defect there and the operator extends the scope
