# xstockstrat-ingest — Constitution

Derived by `/context-constitution` (context-forge) on 2026-07-24. Captures the **non-obvious** local
invariants of the ingest service (backfill orchestration, signal persistence, `QuerySignals` producer,
gRPC 50055). Does not restate documented/CI-enforced rules (see `## Pointers`).

> Inherits all rules of the root constitution (`../../../docs/context-constitution.md`). This file lists only
> what is specific to **xstockstrat-ingest**.

## Rules (`INGEST-*`) — binding, easy-to-miss conventions

| ID | Rule | Why | Evidence | Example (canonical `path:line`) |
|---|---|---|---|---|
| **INGEST-1** | **Repositories are proto-free; the servicer maps rows ↔ protos and passes enum *ints* (not proto objects) into repos.** A repo function must not `import ingest_pb2`. | The deliberate proto isolation is what makes repos unit-testable without gen stubs; the servicer owns all proto↔row conversion. | `app/repositories/backfill_jobs.py:36-49`, `backfill_chunks.py:18-22`; mapper `servicer.py:70` | `app/repositories/backfill_chunks.py:18-22` |
| **INGEST-2** | **Dynamic SQL builds a parameterized WHERE/SET by tracking an incrementing placeholder index; column names are allow-listed (`_UPDATABLE_COLUMNS`), never interpolated from input.** | f-stringing a user value is injection; adding an updatable column without extending the allow-list is silently rejected with `ValueError`. | `app/repositories/backfill_jobs.py:52-70,95-108`; `servicer.py:725-788` | `app/repositories/backfill_jobs.py:52-70` |
| **INGEST-3** | **`page_token` is a raw integer offset, not an opaque cursor.** | Treating it as a base64/opaque token breaks pagination continuity. | `servicer.py:768,525`; `list_jobs(offset=)` | `app/handlers/servicer.py:768` |
| **INGEST-4** | **`0.0`/`0` mean "unset" for `conviction` on both write and read** — write stores `None` when `conviction <= 0`; read returns `0.0` when NULL. Consumers must read `0.0` as *unknown confidence*, not zero. | The proto documents the sentinel; treating 0.0 as a real confidence misweights signals. | `servicer.py:656,800`; proto `ingest.proto:109` | `app/handlers/servicer.py:656` |
| **INGEST-5** | **`QuerySignals` producer semantics** (consumed by indicators + analysis): results are `ORDER BY ingested_at DESC` (arrival order, and `ingested_at` is **not** returned); the active/expiry filter is **opt-in** (no `active_window` → all signals returned regardless of `valid_until`, despite the "Query active signals" docstring); `symbol` is upper-cased on write and query. | Consumers that assume expiry is always applied, or that sort by validity, get wrong results. | `servicer.py:718-822,668,736`; proto `ingest.proto:120-131` | `app/handlers/servicer.py:718-822` |

## Gotchas & scars

- **The `validate_config_json` allow-list is a deliberate superset of the DB CHECK constraint** (signal `source_type`) — tightening it to match a single migration wrongly rejects valid mediated types. Evidence: `app/repositories/signal_sources.py:78-117,114`.
- **`_STR_TO_ENUM` / `_BARS_PER_DAY` deliberately omit 1m/5m** ("no longer resolve") — 15m is the product floor. Evidence: `servicer.py:32-35`, `backfill_chunks.py:14-16`.

## Pointers (already documented or CI-enforced — not restated here)

| What | Where |
|---|---|
| Header propagation via `_propagation_meta(context)` | `servicer.py:134-140`; `docs/patterns/header-propagation.md` (root PLAT-4) |
| asyncpg pool cap 2 / `DB_POOL_MAX` | `app/main.py:55-60`; root pool budget |
| WatchConfig subscribe + `wait_for_snapshot(90s)` before serving | `app/main.py:45-46`, `app/config/watcher.py:51` |
| Admin scope bit `0x04` check | `servicer.py:119` (root PLAT-5) |

---
_Forged by [context-forge](https://github.com/davcs86/agent-plugins). It captures the
non-obvious — nothing here is invented; re-run `/context-constitution` to refresh after the code changes._
