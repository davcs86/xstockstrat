# xstockstrat-ingest — Constitution

Derived by `/context-constitution` (context-forge) on 2026-07-24. Captures the **non-obvious** local
invariants of the ingest service (backfill orchestration, signal persistence, `QuerySignals` producer,
gRPC 50055). Does not restate documented/CI-enforced rules (see `## Pointers`).

> Inherits all rules of the root constitution (`../../../docs/context-constitution.md`). This file lists only
> what is specific to **xstockstrat-ingest**.

## Rules (`INGEST-*`) — binding, easy-to-miss conventions

| ID | Rule | Why | Evidence | Example (canonical `path:line`) |
|---|---|---|---|---|
| **INGEST-1** | **Repositories are proto-free** — a repo function must not `import ingest_pb2`; the servicer owns all proto↔row conversion. Full rationale in the `backfill_jobs.py`/`backfill_chunks.py` module docstrings. | The deliberate proto isolation is what makes repos unit-testable without gen stubs. | `app/repositories/backfill_jobs.py:36-49` docstring | `app/repositories/backfill_chunks.py:18-22` |
| **INGEST-2** | **Dynamic SQL column names are allow-listed (`_UPDATABLE_COLUMNS`), never interpolated from input** — see the `backfill_jobs.py:52-70` docstring for the placeholder-tracking mechanism. | f-stringing a user value is injection. | `app/repositories/backfill_jobs.py:52-70` docstring | `app/repositories/backfill_jobs.py:52-70` |
| **INGEST-3** | **`page_token` is a raw integer offset, not an opaque cursor.** | Treating it as a base64/opaque token breaks pagination continuity. | `servicer.py:606,948` (`offset = int(request.page.page_token)`); `list_jobs(offset=)` | `app/handlers/servicer.py:606` |
| **INGEST-4** | **`0.0`/`0` mean "unset" for `conviction` on both write and read** — write stores `None` when `conviction <= 0`; read returns `0.0` when NULL. Consumers must read `0.0` as *unknown confidence*, not zero. (Feature 092 F-9 additionally rejects `conviction` outside `[0.0, 1.0]` up front, `servicer.py:723`.) | The proto documents the sentinel; treating 0.0 as a real confidence misweights signals. | `servicer.py:747,980`; proto `ingest.proto:109` | `app/handlers/servicer.py:747` |
| **INGEST-5** | **`QuerySignals` producer semantics** (consumed by indicators + analysis): results are `ORDER BY ingested_at DESC` (arrival order, and `ingested_at` is **not** returned); the active/expiry filter is **opt-in** (no `active_window` → all signals returned regardless of `valid_until`, despite the "Query active signals" docstring); `symbol` is upper-cased on write (`symbol_upper`, one call reused across insert/dedup-claim/response) and query. | Consumers that assume expiry is always applied, or that sort by validity, get wrong results. | `servicer.py:898` (`QuerySignals`), `ORDER BY ingested_at DESC:962`, `symbol_upper:749`, query-side `:916`; proto `ingest.proto:126-137` | `app/handlers/servicer.py:898` |

## Gotchas & scars

- **The `validate_config_json` allow-list is a deliberate superset of the DB CHECK constraint** (signal `source_type`) — tightening it to match a single migration wrongly rejects valid mediated types. Evidence: `app/repositories/signal_sources.py:174` (`validate_config_json`).
- **`_STR_TO_ENUM` / `_BARS_PER_DAY` deliberately omit 1m/5m** ("no longer resolve") — 15m is the product floor. Evidence: `servicer.py:85-86`, `backfill_chunks.py:14-16`.
- **`IngestSignal`'s dedup claim exception (`_DuplicateSignal`) must be caught before the generic `except Exception`** — since it's itself an `Exception` subclass, swapping the clause order would silently defeat the "must not insert a second row" guarantee while still reporting `deduplicated=true`. Already self-documented at the site; noted here because it's exactly the kind of ordering-fragility an agent could break while refactoring nearby error handling. Evidence: `servicer.py:751` (definition), `:806-810` (comment), `:813` (catch order before `:827`).

## Pointers (already documented or CI-enforced — not restated here)

| What | Where |
|---|---|
| Header propagation via `_propagation_meta(context)` | `servicer.py:201`; `docs/patterns/header-propagation.md` (root PLAT-4) |
| asyncpg pool cap 2 / `DB_POOL_MAX`; PgBouncer `statement_cache_size=0` (root PLAT-7) | `app/main.py:55-63`; root pool budget |
| WatchConfig subscribe + `wait_for_snapshot(90s)` before serving | `app/main.py:45-46`, `app/config/watcher.py:78` |
| Admin scope bit `0x04` check | `servicer.py:185` (`_has_admin_scope`), enforced e.g. `:215` (root PLAT-5) |

---
_Forged by [context-forge](https://github.com/davcs86/agent-plugins). It captures the
non-obvious — nothing here is invented; re-run `/context-constitution` to refresh after the code changes._
