# xstockstrat-ingest — Constitution Findings

Defects and drift surfaced by `/context-constitution` on 2026-07-24; refreshed 2026-09-02 (branch
`claude/loaded-plugins-list-d120nl` @ `82a0549`); re-verified 2026-10-14 (branch `ccr-fe84109f-0lwin8` @ `09ec8d9`); refreshed 2026-10-19 (branch `ccr-c386317f-6vt6t6` @ `a914f69` — line hints re-stamped; `default_timeframe` doc-lie resolved (CLAUDE.md now self-labels it) and re-filed as a dead config key; other findings re-checked still open). For triage/fixing, not
governance. The config zero-trap and the `client_id="indicators-…"` copy-paste are repeated patterns
also recorded at the root.

## Documentation that lies (docs claim behavior the code lacks)

| What the docs say | What the code does | Evidence | Suggested action |
|---|---|---|---|
| **Updated 2026-08-07**: this row previously claimed CLAUDE.md documents 9 `ingest.signals.*` config keys (per-source enabled, default_window_days, default_conviction, dedup_window_hours), none read anywhere | Stale — CLAUDE.md now documents only one `ingest.signals.*` key, `dedup_window_hours`, and it *is* read and genuinely enforced: bound as `$7` in the dedup claim query's `WHERE` clause (feature 111, migration `009_signal_dedup_keys.up.sql`), gating whether a matching signal is treated as a duplicate | `CLAUDE.md` config table (~L131) vs `servicer.py#_ingest_external_signal` (claim query ~L1041-1070), `app/config/watcher.py` (`ingest.signals.dedup_window_hours` ~L215) | Resolved — row kept for history, not an open action |
| ~~CLAUDE.md "Ledger Events Emitted" lists `ingest.data.normalized`~~ **STALE premise (resolved 2026-08-27):** the current CLAUDE.md table lists only the 5 real events (no `ingest.data.normalized`), so the documentation no longer lies. The underlying code fact still holds — `NormalizeRawData` counts rows and emits no ledger event (`servicer.py#NormalizeRawData` (~L911-923)) — but it is no longer a doc contradiction; kept for history / a maintainer note on whether normalize *should* emit | `CLAUDE.md` "Ledger Events Emitted" (no `data.normalized`) vs `servicer.py#NormalizeRawData` (~L911-923) | Closed as doc-lie; optionally decide whether normalize should emit |
| `CLAUDE.md` Constitution banner lists "9 dead config keys, unimplemented dedup" as defects; the env block lists `TRADING_MODE` | The 9-keys row is stale (above) and dedup is implemented (`app/handlers/servicer.py#_ingest_external_signal`, `signal_dedup_claims` claim query); `watcher.py#ConfigWatcher` still resolves `TRADING_MODE` — the repo-wide docs-vs-code disagreement in the root findings | `services/xstockstrat-ingest/CLAUDE.md` banner; `app/config/watcher.py#_build_watch_request` | Refresh the banner and env block |

## Dead / orphaned code

| What | Why it looks dead | Evidence |
|---|---|---|
| `app/extractors/*` — **PARTIALLY RESOLVED (2026-09-02)**: `base.py` + `mcp_client.py` are now runtime-live (`McpClientExtractor()` constructed at `mcp_client_loop.py#run_one_cycle` ~L131). Still dead at runtime (re-verified 2026-10-14: only `tests/test_extractor.py` imports them): `example_simple_email.py`, `noop.py`, and the non-Mcp dataclasses in `base.py` (~L9-39) (SimpleEmail/EmailAttachment/LinkedEmail/SimpleWebsite/AuthenticatedWebsite — no runtime extractor constructs them) | no runtime dispatch constructs the remaining ones | `app/extractors/example_simple_email.py`, `app/extractors/noop.py`, `app/extractors/base.py#SimpleEmailInput`..`#AuthenticatedWebsiteInput` (~L9-39) |
| **Dead config key `ingest.backfill.default_timeframe`** — documented in `CLAUDE.md` (self-labelled "Documented, not yet wired"), never seeded, never read; the servicer hardcodes `"1d"` (found 2026-10-19) | no reader in `app/` and no seed migration (`rg default_timeframe` over `services/xstockstrat-ingest/app` and `services/xstockstrat-config/migrations` = zero hits) | `CLAUDE.md` config table (~L125) vs `servicer.py` `"1d"` literals (`_canonical_timeframe` default ~L257, `TriggerBackfill` gate ~L414, `_resume_job` fallback ~L729) — remove the key or wire it |

## Latent bugs (looks broken, not merely non-obvious)

| Issue | Impact | Evidence |
|---|---|---|
| **Dead indicators-only `sandbox_*` helpers**: the file still carries `sandbox_timeout_ms`/`sandbox_memory_bytes`/`sandbox_allowed_imports` (`watcher.py#sandbox_timeout_ms`/`#sandbox_memory_bytes`/`#sandbox_allowed_imports`, ~L168-178) that no ingest code calls (ingest runs no sandbox). ~~The identity clause (docstring + `client_id="indicators-…"`) was **RESOLVED by feature 174**~~: docstring is now "Config watcher for xstockstrat-**ingest**" and `client_id=f"ingest-{id(self)}"` via `_build_watch_request()`. | dead helpers copy-pasted from the indicators template remain (a separate change class — dead-code deletion) | `app/config/watcher.py#sandbox_timeout_ms` (~L168-178) |

## Open questions (unresolved *why* — needs a maintainer)

- `poll_one_source` discards the namespace half of `credentials_ref` (`_namespace, key = split_credentials_ref(...)`) and `resolve_secret` hardcodes `self.namespace`, so a non-`ingest` prefix silently resolves under `ingest` — intended? `app/engine/mcp_client_loop.py#poll_one_source`, `app/config/watcher.py#resolve_secret` — status: **open**
- `signal_sources.py#owner_scope_predicate` interpolates the `SYSTEM_OWNER` constant into SQL as a literal — does INGEST-2's "never interpolate" exempt module constants? — status: **open**
- The `mcp_client` loop drives `_ingest_external_signal` with **no `propagation_meta`** (`mcp_client_loop.py#poll_one_source` ~L125), so loop-emitted `ingest.signal.ingested` ledger events carry empty `x-user-id`/`x-trace-id` (`servicer.py#_ingest_external_signal` `AppendEvent(… metadata=propagation_meta)` ~L1125-1132). Likely intentional (server-initiated, no inbound request) — confirm whether ledger/analysis expect a trace id on these rows. — status: **open**

## Resolved

- **RESOLVED 2026-10-19 — doc-lie `ingest.backfill.default_timeframe` documented as live**: `CLAUDE.md` config table (~L125) now self-labels the key "**Documented, not yet wired** — the servicer hardcodes `"1d"`", so the docs no longer claim a behavior the code lacks. The underlying dead key is re-filed under Dead / orphaned code.

- **RESOLVED 2026-10-14 — dead code `signal_sources.get_active_source`**: grep for `get_active_source` across the service's `*.py` (including tests) returns zero hits; the function was deleted.

- **RESOLVED 2026-09-03 — the two `ingest.mcp_client.*` config keys were read without the `ingest.` prefix (latent bug, 2026-09-02).** Both reads now carry the full prefix: `app/engine/mcp_client_loop.py#run_one_cycle` (~L135, `"ingest.mcp_client.request_timeout_seconds"`) and `#run_mcp_client_loop` (~L164, `"ingest.mcp_client.poll_interval_seconds"`), guarded by a regression test `tests/test_mcp_client_loop.py#test_cycle_reads_namespace_prefixed_request_timeout_key` (~L111) ("defect 2026-09-03"). This also un-lies the CLAUDE.md "clamped ≥1 / config-tunable" claim and gives seed migration `025_ingest_mcp_client_keys` effective readers. Confirmed by re-resolving both citations against current code (they now include the prefix) plus the new test. The generalized rule now lives as INGEST-9 in the constitution.


## Filed as defect reports (2026-10-19)

The open rows above were re-verified against `1302e6d` and recorded as `docs/reports/` defects
(status sidecar `open`) for `/sdd-triage --from-report`. A row stays here until its report is resolved.

| Report | Title |
|---|---|
| [`2026-10-19-dead-config-keys-defect`](../../../docs/reports/2026-10-19-dead-config-keys-defect.md) | Documented config keys that no code reads (ledger, notify, trading, marketdata, ingest) |
| [`2026-10-19-ingest-claude-md-drift-defect`](../../../docs/reports/2026-10-19-ingest-claude-md-drift-defect.md) | Ingest CLAUDE.md banner lists fixed defects; QuerySignals docstring says "active" |
| [`2026-10-19-ingest-mcp-loop-ledger-events-ownerless-defect`](../../../docs/reports/2026-10-19-ingest-mcp-loop-ledger-events-ownerless-defect.md) | mcp_client loop ledger events are stored with a NULL owner |
| [`2026-10-19-orphaned-code-defect`](../../../docs/reports/2026-10-19-orphaned-code-defect.md) | Orphaned modules, scripts and dependencies across services |

---
_Surfaced by [context-forge](https://github.com/davcs86/agent-plugins). Defects to action, not rules. Re-run `/context-constitution` to refresh._
