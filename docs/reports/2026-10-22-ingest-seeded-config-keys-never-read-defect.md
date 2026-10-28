# Defect: Seeded ingest config keys are never read, so operators cannot tune MCP polling or backfill chunking

**Recorded**: 2026-10-22
**Severity**: SEV-3
**Impact type**: inert-tuning-knob
**Environment**: dev (staging app `xstockstrat-staging`); production uses the same seed migrations
**Affected service(s)**: xstockstrat-ingest, xstockstrat-config
**Config-only fix possible**: no

## Observed

The five `ingest` keys seeded by config migrations are stored namespace-stripped (`key` column without the `ingest.` prefix), but
ingest reads every one of them with the full `ingest.`-prefixed key, so the lookup misses and the hard-coded default is used.
An operator who edits the seeded row through `set_config` / config-ui sees no change in behaviour and no error.

Seeded rows (staging `list_config_keys(namespace="ingest")`, 2026-10-22):

| Seeded `key` | Read as (`app/config/watcher.py`, `app/engine/mcp_client_loop.py`) |
|---|---|
| `backfill.chunk_max_bars` | `ingest.backfill.chunk_max_bars` |
| `backfill.chunk_window_days` | `ingest.backfill.chunk_window_days` |
| `backfill.max_concurrent_chunks` | `ingest.backfill.max_concurrent_chunks` |
| `mcp_client.poll_interval_seconds` | `ingest.mcp_client.poll_interval_seconds` |
| `mcp_client.request_timeout_seconds` | `ingest.mcp_client.request_timeout_seconds` |

The config service builds each namespace snapshot as `values[row.key]` (the bare column value), and ingest's `ConfigWatcher.get_*`
resolves with a raw `self._snapshot.values.get(key)` and no prefixing. The 2026-09-03 change that added the `ingest.` prefix to the two
`mcp_client` reads (recorded as INGEST-9) therefore moved those reads away from the seeded key shape instead of onto it.
`ingest.backfill.max_concurrent_jobs` and `ingest.backfill.retry_on_failure` are read but not seeded at all.

## Expected

Every ingest config key that is seeded is read under the exact key the snapshot carries, so changing a seeded value changes ingest
behaviour on the next snapshot. The seed `key` column and the reader use one form, and the rule that states which form is correct matches
the config service's actual snapshot shape.

## Reproduction

1. On staging, `list_config_keys(namespace="ingest")` returns the five bare keys above.
2. `set_config` the `mcp_client.request_timeout_seconds` row to a value other than 30 (for example 5) and let an `mcp_client` source poll
   against a slow endpoint.
3. The per-call timeout stays 30 seconds, because `cfg_watcher.get_int("ingest.mcp_client.request_timeout_seconds", 30)` returns the default.

Step 3 is inferred from the code paths below and has not been run against a live deployment. The snapshot shape it depends on was
confirmed live (see Evidence).

## Evidence

- `services/xstockstrat-config/migrations/025_ingest_mcp_client_keys.up.sql:28-38`
  > `('ingest', 'mcp_client.request_timeout_seconds', 'int', '30', ...`
- `services/xstockstrat-config/src/grpc/configServiceImpl.ts:186-188`
  > `byKey[k].values[row.key] = buildConfigValue(row);`
- `services/xstockstrat-ingest/app/config/watcher.py:104-109` (`get_str`): `v = self._snapshot.values.get(key)`; no namespace prefixing.
- `services/xstockstrat-ingest/app/config/watcher.py:199-210` and `services/xstockstrat-ingest/app/engine/mcp_client_loop.py:133-136`:
  reads use `"ingest.…"` keys.
- `services/xstockstrat-ingest/docs/context-constitution.md` INGEST-9 and `context-constitution-findings.md` (2026-09-03 entry) state the
  prefixed form is required.
- Staging `list_config_keys(namespace="ingest")` on 2026-10-22: five bare keys, none prefixed.
- Staging `get_config(namespace="ingest")` on 2026-10-22 (the namespace snapshot the config service serves): `values` is keyed
  `mcp_client.poll_interval_seconds`, `mcp_client.request_timeout_seconds`, `backfill.chunk_window_days`,
  `backfill.max_concurrent_chunks`, `backfill.chunk_max_bars`. No `ingest.`-prefixed key is present, so ingest's
  `values.get("ingest.…")` cannot hit. Asking for `key="ingest.mcp_client.request_timeout_seconds"` returns the same whole snapshot,
  with no prefixed entry.

## Root cause hypothesis

The seed convention is mixed. Newer migrations seed the full dotted path in the `key` column (42 `analysis` rows carry the
`analysis.` prefix, the form INGEST-9 describes), while the older ingest migrations (`005`, `025`) seeded namespace-stripped keys. Some
other namespaces' older seeds are also namespace-stripped (for example `analysis` `backtest.max_duration_seconds`, `marketdata`
`alpaca.paper`, `indicators` `sandbox.timeout_ms`), so the same mismatch may exist outside ingest; a platform-wide sweep of seeded keys
against their readers belongs in the design. The fix is either to re-key the ingest seeds to the full dotted form (a config migration
with the usual rollout review, plus a data-safe re-key of any operator-edited rows) or to change the readers; the design must pick one and
correct the INGEST-9 wording.

## Confidence

high on the key mismatch and on the snapshot shape (live snapshot plus code); the end-to-end effect on ingest behaviour (an edited
value being ignored) is inferred and was not observed, because no ingest log or metric exposes the effective timeout
