# xstockstrat-ingest — Constitution

Derived by `/context-constitution` (context-forge) on 2026-07-24; citations re-grounded 2026-08-27;
refreshed 2026-09-02 (branch `claude/loaded-plugins-list-d120nl` @ `82a0549` — feature 166 added the
server-side `mcp_client` source; added INGEST-6/7/8, fixed INGEST-5's `ingested_at` clause); refreshed
2026-09-03 (branch `claude/watchlist-bulk-default-strategy-zxx6su` @ `d4cd327` — added INGEST-9
config-key-must-carry-full-namespace-prefix rule; re-grounded INGEST-8 after the mcp_client-loop config
fix shifted anchors).
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
| **INGEST-3** | **`page_token` is a raw integer offset, not an opaque cursor.** | Treating it as a base64/opaque token breaks pagination continuity. | `servicer.py:642` (`offset = int(request.page.page_token)`), `:988`; `list_jobs(offset=)` | `app/handlers/servicer.py:624` |
| **INGEST-4** | **`0.0`/`0` mean "unset" for `conviction` on both write and read** — write stores `None` when `conviction <= 0`; read returns `0.0` when NULL. Consumers must read `0.0` as *unknown confidence*, not zero. (Feature 092 F-9 additionally rejects `conviction` outside `[0.0, 1.0]` up front, `servicer.py:770`.) | The proto documents the sentinel; treating 0.0 as a real confidence misweights signals. | write `servicer.py:789` (`… else None`), read `:1020` (`… else 0.0`); proto `ingest.proto:110` | `app/handlers/servicer.py:767` |
| **INGEST-5** | **`QuerySignals` producer semantics** (consumed by indicators + analysis): results are `ORDER BY ingested_at DESC` (arrival order; feature 022 **now DOES return `sig.ingested_at`**, `servicer.py:1036`); the active/expiry filter is **opt-in** (no `active_window` → all signals returned regardless of `valid_until`, despite the "Query active signals" docstring); `symbol` is upper-cased on write (`symbol_upper`, one call reused across insert/dedup-claim/response) and query. | Consumers that assume expiry is always applied, or that sort by validity, get wrong results. | `servicer.py:938` (`QuerySignals`), `ORDER BY ingested_at DESC:1002`, `ingested_at` returned `:1036`, write `symbol_upper:791`, query-side upper `:956`; proto `ingest.proto:126-137` | `app/handlers/servicer.py:909` |
| **INGEST-6** | **Extractors are pure JSON parsers — `BaseExtractor.extract(RawInput) -> list[dict]` takes already-fetched data; all network I/O and secret resolution live in the poll loop, never in `extract()`** (feature 166). | Implementing a new source extractor that resolves secrets or does httpx I/O inside `extract()` breaks its no-network unit-testability — the whole reason the abstraction exists. | contract `app/extractors/base.py:43-46,60-64`; `McpClientExtractor` imports no network/secret code `app/extractors/mcp_client.py:1-7,21-49`; the credential-bearing fetch is in `poll_one_source` `app/engine/mcp_client_loop.py:120` | `app/extractors/base.py:43-46` |
| **INGEST-7** | **`credentials_ref` splits on the FIRST dot → `(namespace, dotted-key)`; the key legitimately contains dots and is passed verbatim to `GetSecret`** (e.g. `"ingest.mcp_credential.<slug>"` → `("ingest", "mcp_credential.<slug>")`). | A naive `ref.split(".")` unpack (or splitting on the last dot) mangles the secret key → `PERMISSION_DENIED`/not-found from the config `keyPrefixes` grant. | `split_credentials_ref` `app/config/watcher.py:22-27`, used `app/engine/mcp_client_loop.py:114` | `app/config/watcher.py:22-27` |
| **INGEST-8** | **The `mcp_client` poll loop sleeps BEFORE its first cycle** (`while True: interval = …; sleep(interval); run_one_cycle()` — interval recomputed each tick), so no poll fires at boot — the first fetch is one `poll_interval_seconds` (default 300s) after startup. | An integration test (or an operator) expecting sources to be polled immediately at service start is wrong — they are not. | `run_mcp_client_loop` `app/engine/mcp_client_loop.py:160-169` (`while True:160`, `sleep:167` before `run_one_cycle:169`) | `app/engine/mcp_client_loop.py:160-169` |
| **INGEST-9** | **`ConfigWatcher.get_int/get_str/get_bool/get_float` do NOT auto-prefix by namespace — every read must pass the FULL `<namespace>.`-prefixed dotted key** (`"ingest.mcp_client.poll_interval_seconds"`, not `"mcp_client.…"`), even though `namespace` IS sent on the WatchConfig request. The getter resolves via a raw `self._snapshot.values.get(key)` with zero prefixing. | Seeing `namespace=self.namespace` on the WatchConfig call, an agent assumes snapshot keys are namespace-relative and reads a bare `mcp_client.poll_interval_seconds`; it silently misses `values.get()` and falls back to the hardcoded default — a tuning knob that *looks* wired but is inert, with no error (the feature-166 defect this closed). | getter raw `values.get(key)` `app/config/watcher.py:102,112,120,128` (namespace sent on request `:74`); consumers pass fully-qualified keys `:170,174,178,183,187,191,196` and `app/engine/mcp_client_loop.py:134,163`; regression test `tests/test_mcp_client_loop.py:109-124` | `app/config/watcher.py:102` |

## Gotchas & scars

- **The `validate_config_json` allow-list is a deliberate superset of the DB CHECK constraint** (signal `source_type`) — tightening it to match a single migration wrongly rejects valid mediated types. Migration `011` widened the CHECK to include `mcp_client`/`derived`, both mirrored in the validator. Evidence: `app/repositories/signal_sources.py:186` (`validate_config_json`), `:219,:224`.
- **`_STR_TO_ENUM` and `_BARS_PER_DAY` no longer align** (feature 143). `_STR_TO_ENUM` still maps `15m`/`1h`/`1d` (it is dual-purposed — `job_row_to_proto`/`_row_timeframe` derive `timeframe_enum` for historical/resumed rows on the read path, so it must keep resolving stored `15m`/`1h`). But `_BARS_PER_DAY` was narrowed to `{"1d": 1}` and `_TF_ALIASES` to `{"1d","1Day"}`, because `TriggerBackfill` now rejects any non-`1d` request before a job is ever planned — so no chunk-planning or alias-normalization of `15m`/`1h` can occur going forward. The `_BARS_PER_DAY.get(tf, 1)` default keeps this safe for any leftover caller. `1m`/`5m` remain omitted from all three as before. Evidence: `servicer.py:93-102`, `backfill_chunks.py` (`_BARS_PER_DAY:18`).
- **`IngestSignal`'s dedup claim exception (`_DuplicateSignal`) must be caught before the generic `except Exception`** — since it's itself an `Exception` subclass, swapping the clause order would silently defeat the "must not insert a second row" guarantee while still reporting `deduplicated=true`. Already self-documented at the site; noted here because it's exactly the kind of ordering-fragility an agent could break while refactoring nearby error handling. The block now lives inside the shared `_ingest_external_signal` (`servicer.py:752`), driven by **both** `IngestSignal` and the new `mcp_client` loop. Evidence: `servicer.py:793` (definition), `:848-852` (comment), `:855` (`except _DuplicateSignal:` catch, before the generic handler).

## Pointers (already documented or CI-enforced — not restated here)

| What | Where |
|---|---|
| Header propagation via `_propagation_meta(context)` | `servicer.py:212`; `docs/patterns/header-propagation.md` (root PLAT-4) |
| asyncpg pool cap 2 / `DB_POOL_MAX`; PgBouncer `statement_cache_size=0` (root PLAT-7) | `app/main.py:54-61` (`create_pool:55`, `max_size DB_POOL_MAX:58`, `statement_cache_size:63`); root pool budget |
| WatchConfig subscribe + `wait_for_snapshot(90s)` before serving | `app/main.py:45-46`, `app/config/watcher.py:76` |
| Admin scope bit `0x04` check | `servicer.py:196` (`_has_admin_scope`), enforced e.g. `:226,658,1092` (root PLAT-5) |

---
_Forged by [context-forge](https://github.com/davcs86/agent-plugins). It captures the
non-obvious — nothing here is invented; re-run `/context-constitution` to refresh after the code changes._
