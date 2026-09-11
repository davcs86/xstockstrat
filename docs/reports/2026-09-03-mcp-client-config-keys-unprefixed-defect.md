# Defect: mcp_client poll/timeout config keys read without the `ingest.` namespace prefix

**Recorded**: 2026-09-03
**Severity**: SEV-3
**Impact type**: config-not-applied
**Environment**: dev + production
**Affected service(s)**: xstockstrat-ingest
**Config-only fix possible**: no

## Observed

The two feature-166 tuning keys `ingest.mcp_client.poll_interval_seconds` and
`ingest.mcp_client.request_timeout_seconds` never take effect. The server-side `mcp_client` polling
loop reads them under the **namespace-less** key string, so the config snapshot lookup always misses
and the loop silently falls back to its hardcoded defaults (300s / 30s). Setting either key via
`set_config` / config-ui has no observable effect.

## Expected

An operator's `SetConfig` on `ingest.mcp_client.poll_interval_seconds` /
`ingest.mcp_client.request_timeout_seconds` retunes the loop's cadence / per-call timeout live (as
CLAUDE.md documents: "Clamped to ≥1 at read", config-tunable). Seed migration
`025_ingest_mcp_client_keys` should have effective readers.

## Reproduction

1. Register an `mcp_client` signal source so the poll loop runs.
2. `set_config ingest.mcp_client.poll_interval_seconds = 60` (or via config-ui).
3. Observe the loop cadence: it stays at the hardcoded 300s default, not 60s.

## Evidence

`services/xstockstrat-ingest/app/engine/mcp_client_loop.py:133`
> `get_int("mcp_client.poll_interval_seconds", …)`  — missing the `ingest.` prefix

`services/xstockstrat-ingest/app/engine/mcp_client_loop.py:160`
> `get_int("mcp_client.request_timeout_seconds", …)`  — same

`services/xstockstrat-ingest/app/config/watcher.py:170,178,183,196`
> every other consumed key passes the full `ingest.*` string

`services/xstockstrat-ingest/app/config/watcher.py:109-115`
> `get_int` does a raw `snapshot.values.get(key)` with **no** prefixing — the snapshot is keyed by the
> raw stored key (constitution CONFIG-9), so a namespace-less lookup can never match

## Root cause hypothesis

The two reads were written with a namespace-relative key string, but ingest's `get_int`/`get_str`
watcher helpers do no auto-prefixing — the stored/snapshot key is the full dotted `ingest.mcp_client.*`.
Fix: prefix both reads with `ingest.` (or add `mcp_client_*` watcher properties mirroring the existing
`ingest.backfill.*` helpers). Add a regression test asserting a set value reaches the loop.

## Confidence

high
