# xstockstrat-ingest — Constitution

Derived by `/context-constitution` (context-forge) on 2026-07-24; citations re-grounded 2026-08-27.
Captures the **non-obvious** local invariants of the ingest service (backfill orchestration, signal
persistence, `QuerySignals` producer, gRPC 50055). Does not restate documented/CI-enforced rules
(see `## Pointers`).

> Inherits all rules of the root constitution (`../../../docs/context-constitution.md`). This file lists only
> what is specific to **xstockstrat-ingest**.

## Rules (`INGEST-*`) — binding, easy-to-miss conventions

| ID | Rule | Why | Evidence | Example (canonical `path:line`) |
|---|---|---|---|---|
| **INGEST-1** | **Repositories are proto-free** — a repo function must not `import ingest_pb2`; the servicer owns all proto↔row conversion. Full rationale in the `backfill_jobs.py`/`backfill_chunks.py` module docstrings. | The deliberate proto isolation is what makes repos unit-testable without gen stubs. | `app/repositories/backfill_jobs.py:1-7` (module docstring, rationale `:3-6`) | `app/repositories/backfill_chunks.py:1-7` |
| **INGEST-2** | **Dynamic SQL column names are allow-listed (`_UPDATABLE_COLUMNS`), never interpolated from input** — see the `backfill_jobs.py:52-70` docstring for the placeholder-tracking mechanism. | f-stringing a user value is injection. | `app/repositories/backfill_jobs.py:52-70` docstring (`_UPDATABLE_COLUMNS` `:13-25`) | `app/repositories/backfill_jobs.py:52-70` |
| **INGEST-3** | **`page_token` is a raw integer offset, not an opaque cursor.** | Treating it as a base64/opaque token breaks pagination continuity. | `servicer.py:632` (`offset = int(request.page.page_token)`), `:974`; `list_jobs(offset=)` | `app/handlers/servicer.py:632` |
| **INGEST-4** | **`0.0`/`0` mean "unset" for `conviction` on both write and read** — write stores `None` when `conviction <= 0`; read returns `0.0` when NULL. Consumers must read `0.0` as *unknown confidence*, not zero. (Feature 092 F-9 additionally rejects `conviction` outside `[0.0, 1.0]` up front, `servicer.py:749`.) | The proto documents the sentinel; treating 0.0 as a real confidence misweights signals. | write `servicer.py:773` (`… else None`), read `:1006` (`… else 0.0`); proto `ingest.proto:110` | `app/handlers/servicer.py:773` |
| **INGEST-5** | **`QuerySignals` producer semantics** (consumed by indicators + analysis): results are `ORDER BY ingested_at DESC` (arrival order, and `ingested_at` is **not** returned); the active/expiry filter is **opt-in** (no `active_window` → all signals returned regardless of `valid_until`, despite the "Query active signals" docstring); `symbol` is upper-cased on write (`symbol_upper`, one call reused across insert/dedup-claim/response) and query. | Consumers that assume expiry is always applied, or that sort by validity, get wrong results. | `servicer.py:924` (`QuerySignals`), `ORDER BY ingested_at DESC:988`, write `symbol_upper:775`, query-side upper `:942`; proto `ingest.proto:126-137` | `app/handlers/servicer.py:924` |

## Gotchas & scars

- **The `validate_config_json` allow-list is a deliberate superset of the DB CHECK constraint** (signal `source_type`) — tightening it to match a single migration wrongly rejects valid mediated types. Evidence: `app/repositories/signal_sources.py:186` (`validate_config_json`).
- **`_STR_TO_ENUM` and `_BARS_PER_DAY` no longer align** (feature 143). `_STR_TO_ENUM` still maps `15m`/`1h`/`1d` (it is dual-purposed — `job_row_to_proto`/`_row_timeframe` derive `timeframe_enum` for historical/resumed rows on the read path, so it must keep resolving stored `15m`/`1h`). But `_BARS_PER_DAY` was narrowed to `{"1d": 1}` and `_TF_ALIASES` to `{"1d","1Day"}`, because `TriggerBackfill` now rejects any non-`1d` request before a job is ever planned — so no chunk-planning or alias-normalization of `15m`/`1h` can occur going forward. The `_BARS_PER_DAY.get(tf, 1)` default keeps this safe for any leftover caller. `1m`/`5m` remain omitted from all three as before. Evidence: `servicer.py:93-102`, `backfill_chunks.py` (`_BARS_PER_DAY:18`).
- **`IngestSignal`'s dedup claim exception (`_DuplicateSignal`) must be caught before the generic `except Exception`** — since it's itself an `Exception` subclass, swapping the clause order would silently defeat the "must not insert a second row" guarantee while still reporting `deduplicated=true`. Already self-documented at the site; noted here because it's exactly the kind of ordering-fragility an agent could break while refactoring nearby error handling. Evidence: `servicer.py:777` (definition), `:832-836` (comment), `:839` (`except _DuplicateSignal:` catch, before the generic handler).

## Pointers (already documented or CI-enforced — not restated here)

| What | Where |
|---|---|
| Header propagation via `_propagation_meta(context)` | `servicer.py:212`; `docs/patterns/header-propagation.md` (root PLAT-4) |
| asyncpg pool cap 2 / `DB_POOL_MAX`; PgBouncer `statement_cache_size=0` (root PLAT-7) | `app/main.py:55-63` (`create_pool:55`, `max_size DB_POOL_MAX:58`, `statement_cache_size:63`); root pool budget |
| WatchConfig subscribe + `wait_for_snapshot(90s)` before serving | `app/main.py:45-46`, `app/config/watcher.py:78` |
| Admin scope bit `0x04` check | `servicer.py:196` (`_has_admin_scope`), enforced e.g. `:226,658,1092` (root PLAT-5) |

---
_Forged by [context-forge](https://github.com/davcs86/agent-plugins). It captures the
non-obvious — nothing here is invented; re-run `/context-constitution` to refresh after the code changes._
