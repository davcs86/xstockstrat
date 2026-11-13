# xstockstrat-ingest — Constitution Findings

Defects and drift surfaced by `/context-constitution` on 2026-07-24; last refreshed 2026-11-13 (`ccr-7e428591-3j2he0` @ `52f6d5a`). For triage/fixing, not
governance. The config zero-trap was resolved by feature 244 (root CF-N10), and the
`client_id="indicators-…"` copy-paste was resolved by feature 174.

## Documentation that lies (docs claim behavior the code lacks)

| What the docs say | What the code does | Evidence | Suggested action |
|---|---|---|---|
| **Updated 2026-08-07**: this row previously claimed CLAUDE.md documents 9 `ingest.signals.*` config keys (per-source enabled, default_window_days, default_conviction, dedup_window_hours), none read anywhere | Stale — CLAUDE.md now documents only one `ingest.signals.*` key, `dedup_window_hours`, and it *is* read and genuinely enforced: bound as `$7` in the dedup claim query's `WHERE` clause (feature 111, migration `009_signal_dedup_keys.up.sql`), gating whether a matching signal is treated as a duplicate | `CLAUDE.md` config table (~L131) vs `servicer.py#_ingest_external_signal` (claim query ~L1041-1070), `app/config/watcher.py` (`ingest.signals.dedup_window_hours` ~L215) | Resolved — row kept for history, not an open action |
| ~~CLAUDE.md "Ledger Events Emitted" lists `ingest.data.normalized`~~ **STALE premise (resolved 2026-08-27):** the current CLAUDE.md table lists only the 5 real events (no `ingest.data.normalized`), so the documentation no longer lies. The underlying code fact still holds — `NormalizeRawData` counts rows and emits no ledger event (`servicer.py#NormalizeRawData` (~L911-923)) — but it is no longer a doc contradiction; kept for history / a maintainer note on whether normalize *should* emit | `CLAUDE.md` "Ledger Events Emitted" (no `data.normalized`) vs `servicer.py#NormalizeRawData` (~L911-923) | Closed as doc-lie; optionally decide whether normalize should emit |
| `CLAUDE.md` Environment Variables lists `TRADING_MODE` (banner half resolved 2026-11-10, see Resolved) | `watcher.py#ConfigWatcher` still resolves `TRADING_MODE` — the repo-wide docs-vs-code disagreement in the root findings | `services/xstockstrat-ingest/CLAUDE.md` env block (~L176); `app/config/watcher.py#resolve_trading_mode` (~L40), `#_build_watch_request` (~L70) | Refresh the env block |
| `app/main.py` comments: the startup reconcile comment (~L66) says "to FAILED; no automatic resume", and the resume comment (~L117-118) says the reconcile pass "only flips chunk-less jobs to FAILED and leaves chunked ones" for resume (found 2026-10-29, feature 261) | Startup DOES auto-resume: `servicer.resume_incomplete_jobs()` (~L119) re-drives every job with `PENDING`/`FAILED` chunks, skipping a persisted `CANCELED` row. `reconcile_interrupted` flips EVERY `RUNNING`/`QUEUED` job to `FAILED`, chunked or not (`WHERE status IN ($3, $4)`), and resume then re-drives the chunked ones | `app/main.py` (~L66, ~L117-119) vs `app/handlers/servicer.py#resume_incomplete_jobs` (~L728), `#_resume_job` (~L737-743), `app/repositories/backfill_jobs.py#reconcile_interrupted` (~L123-144). `CLAUDE.md` § Database was corrected by feature 261 | Fix the two comments when `main.py` is next touched (feature 261 left `main.py` untouched) |
| `CLAUDE.md` "Ledger Events Emitted" omits `ingest.backfill.canceled` (found 2026-11-04) | `CancelBackfill` emits it (~L921-926); the table lists only queued, running, completed, failed, `signal.ingested` and `audit.admin_read` | `app/handlers/servicer.py#CancelBackfill` | Add the row |
| `tests/test_mcp_client_loop.py#test_cycle_reads_namespace_prefixed_request_timeout_key` (~L121): the test name and its comment (~L122-126) say the key must be read under its full `ingest.`-prefixed name (new 2026-11-10) | The body configures and asserts the bare `mcp_client.request_timeout_seconds` (~L132), which is the correct namespace-relative read since feature 304 (`app/engine/mcp_client_loop.py#run_one_cycle` ~L190-191) | `tests/test_mcp_client_loop.py` (~L121-136) | Rename the test and rewrite its comment to the namespace-relative contract |

## Dead / orphaned code

| What | Why it looks dead | Evidence |
|---|---|---|
| `app/extractors/*` — **PARTIALLY RESOLVED (2026-09-02)**: `base.py` + `mcp_client.py` are now runtime-live (`McpClientExtractor()` constructed at `mcp_client_loop.py#run_one_cycle` ~L131). Still dead at runtime (re-verified 2026-10-14: only `tests/test_extractor.py` imports them): `example_simple_email.py`, `noop.py`, and the non-Mcp dataclasses in `base.py` (~L9-39) (SimpleEmail/EmailAttachment/LinkedEmail/SimpleWebsite/AuthenticatedWebsite — no runtime extractor constructs them) | no runtime dispatch constructs the remaining ones | `app/extractors/example_simple_email.py`, `app/extractors/noop.py`, `app/extractors/base.py#SimpleEmailInput`..`#AuthenticatedWebsiteInput` (~L9-39) |
| `signal_sources.extractor_module` (found 2026-11-04) | Stored and echoed (`signal_sources.py#insert_source`, `servicer.py#_source_to_proto` ~L188) but never resolved: there is no `importlib` / `import_module` in `app/`, and `mcp_client_loop.py` hardcodes `McpClientExtractor()`, so a registered `extractor_module` has no runtime effect | `app/repositories/signal_sources.py#insert_source`, `app/engine/mcp_client_loop.py` |

## Latent bugs (looks broken, not merely non-obvious)

| Issue | Impact | Evidence |
|---|---|---|
| ~~**Dead indicators-only `sandbox_*` helpers**~~ **RESOLVED (feature 244)**: deleted with their tests; the file used to carry `sandbox_timeout_ms`/`sandbox_memory_bytes`/`sandbox_allowed_imports` (`watcher.py#sandbox_timeout_ms`/`#sandbox_memory_bytes`/`#sandbox_allowed_imports`, ~L168-178) that no ingest code calls (ingest runs no sandbox). ~~The identity clause (docstring + `client_id="indicators-…"`) was **RESOLVED by feature 174**~~: docstring is now "Config watcher for xstockstrat-**ingest**" and `client_id=f"ingest-{id(self)}"` via `_build_watch_request()`. | resolved | n/a (helpers removed) |
| **Restart re-drives already-finalized chunked jobs** (found 2026-11-04): `backfill_chunks.py#list_jobs_with_incomplete_chunks` selects `DISTINCT job_id … WHERE status IN (PENDING, FAILED)` with no job-status filter, and `_resume_job` skips only a persisted `CANCELED` row — so a job already finalized `PARTIAL` or `FAILED` (including one that failed on a permanent `INVALID_ARGUMENT`) is flipped back to `RUNNING` and re-spends provider quota on every restart. Fundamentals jobs have no chunks and are never resumed. | Repeated provider spend, and a finalized job silently re-opened. Action: filter on job status, or mark permanent chunk failures terminal. | `app/repositories/backfill_chunks.py#list_jobs_with_incomplete_chunks` (~L143), `app/handlers/servicer.py#resume_incomplete_jobs` (~L728), `#_resume_job` (~L737-743) |
| **`_canceled_jobs` entries are discarded only when a runner observes them** (found 2026-11-04, low): canceling a job whose runner has already exited leaves a stale id in the set until restart. | Harmless at `instance_count: 1` (INGEST-10). | `app/handlers/servicer.py#CancelBackfill`, `#_finalize_backfill` |
| **Resume-before-hand-off ordering is not guaranteed** (found 2026-11-13, low): `app/main.py#"a resumed job must be RUNNING again before"` (~L132) claims the hand-off loop starts only after resumed jobs are RUNNING, but `servicer.py#resume_incomplete_jobs` only `create_task`s each `_resume_job` (~L795-796); the RUNNING write (~L815) happens later inside each task, and the gRPC server is already serving (`main.py` ~L115), so a `CancelBackfill` or terminal write can set `_webhook_wake` first. | An early cycle can hand off `FAILED` for a reconciled job that is about to be re-driven — the once-per-job violation INGEST-12 exists to prevent; the window is small. | `app/main.py` ~L115/~L132; `app/handlers/servicer.py#resume_incomplete_jobs` (~L795), `#_resume_job` (~L815); fix: await the RUNNING writes before returning, or gate the first cycle |

## Open questions (unresolved *why* — needs a maintainer)

- `poll_one_source` discards the namespace half of `credentials_ref` (`_namespace, key = split_credentials_ref(...)`) and `resolve_secret` hardcodes `self.namespace`, so a non-`ingest` prefix silently resolves under `ingest` — intended? `app/engine/mcp_client_loop.py#poll_one_source`, `app/config/watcher.py#resolve_secret` — status: **open**
- `signal_sources.py#owner_scope_predicate` interpolates the `SYSTEM_OWNER` constant into SQL as a literal — does INGEST-2's "never interpolate" exempt module constants? — status: **open**
- The `mcp_client` loop drives `_ingest_external_signal` with **no `propagation_meta`** (`mcp_client_loop.py#poll_one_source` ~L148), so loop-emitted `ingest.signal.ingested` ledger events carry empty `x-user-id`/`x-trace-id` (`servicer.py#_ingest_external_signal` `AppendEvent(… metadata=propagation_meta)` ~L1143-1150). Likely intentional (server-initiated, no inbound request) — confirm whether ledger/analysis expect a trace id on these rows. — status: **open**
- `ListBackfillJobs` and `GetBackfillStatus` carry no admin or owner gate (`servicer.py` ~L849-885, no `_resolve_owner`), while `TriggerBackfill` and `CancelBackfill` are admin-only — is platform-wide read of backfill jobs intended for every authenticated caller? — status: **open** (found 2026-11-04)

## Resolved

- **RESOLVED 2026-11-10 — seeded `ingest.*` config keys never read (025/005 bare seed rows vs full-dotted readers)**: readers are now namespace-relative and match the bare seed rows — `app/engine/mcp_client_loop.py#run_one_cycle` (`"mcp_client.request_timeout_seconds"` ~L191), `#run_mcp_client_loop` (`"mcp_client.poll_interval_seconds"` ~L232), `app/config/watcher.py#backfill_chunk_max_bars` and siblings (`"backfill.*"` ~L111-140) (feature 304); config migration `041_heal_config_keys_to_reader_catalog` catalogs every ingest reader (~L129-136). INGEST-9 is retired with it.

- **RESOLVED 2026-11-10 — dead config key `ingest.backfill.default_timeframe`**: dropped from `CLAUDE.md` § Config Keys Consumed by commit `adf411c3`; `rg default_timeframe` over `services/xstockstrat-ingest/app`, `services/xstockstrat-ingest/CLAUDE.md` and `services/xstockstrat-config/migrations` = zero hits. The servicer's hardcoded `"1d"` is now undocumented rather than mis-documented.

- **RESOLVED 2026-11-10 — banner half of the banner / `TRADING_MODE` row**: the `CLAUDE.md` constitution banner no longer lists the stale "9 dead config keys, unimplemented dedup" defects; it names the restart re-drive latent bug instead (commit `adf411c3`). The `TRADING_MODE` half stays open above.

- **RESOLVED 2026-10-19 — doc-lie `ingest.backfill.default_timeframe` documented as live**: `CLAUDE.md` config table (~L125) now self-labels the key "**Documented, not yet wired** — the servicer hardcodes `"1d"`", so the docs no longer claim a behavior the code lacks. The underlying dead key is re-filed under Dead / orphaned code.

- **RESOLVED 2026-10-14 — dead code `signal_sources.get_active_source`**: grep for `get_active_source` across the service's `*.py` (including tests) returns zero hits; the function was deleted.

- **RESOLVED 2026-09-03, superseded by feature 304 (see above)** — the two `ingest.mcp_client.*` reads were later moved to bare namespace-relative keys; INGEST-9 is retired.


## Filed as defect reports (2026-10-19)

The open rows above were re-verified against `1302e6d` and recorded as `docs/reports/` defects
(status sidecar `open`) for `/sdd-triage --from-report`. A row stays here until its report is resolved.

| Report | Title |
|---|---|
| `2026-10-19-dead-config-keys-defect` (pruned 2026-11-10; `git show adf411c3:docs/reports/2026-10-19-dead-config-keys-defect.md`) | Documented config keys that no code reads (ledger, notify, trading, marketdata, ingest) |
| `2026-10-19-ingest-claude-md-drift-defect` (pruned 2026-11-10; `git show adf411c3:docs/reports/2026-10-19-ingest-claude-md-drift-defect.md`) | Ingest CLAUDE.md banner lists fixed defects; QuerySignals docstring says "active" |
| [`2026-10-19-ingest-mcp-loop-ledger-events-ownerless-defect`](../../../docs/reports/2026-10-19-ingest-mcp-loop-ledger-events-ownerless-defect.md) | mcp_client loop ledger events are stored with a NULL owner |
| [`2026-10-19-orphaned-code-defect`](../../../docs/reports/2026-10-19-orphaned-code-defect.md) | Orphaned modules, scripts and dependencies across services |

---
_Surfaced by [context-forge](https://github.com/davcs86/agent-plugins). Defects to action, not rules. Re-run `/context-constitution` to refresh._
