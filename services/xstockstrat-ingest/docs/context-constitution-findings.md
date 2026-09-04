# xstockstrat-ingest — Constitution Findings

Defects and drift surfaced by `/context-constitution` on 2026-07-24; refreshed 2026-09-02 (branch
`claude/loaded-plugins-list-d120nl` @ `82a0549`). For triage/fixing, not
governance. The config zero-trap and the `client_id="indicators-…"` copy-paste are repeated patterns
also recorded at the root.

## Documentation that lies (docs claim behavior the code lacks)

| What the docs say | What the code does | Evidence | Suggested action |
|---|---|---|---|
| **Updated 2026-08-07**: this row previously claimed CLAUDE.md documents 9 `ingest.signals.*` config keys (per-source enabled, default_window_days, default_conviction, dedup_window_hours), none read anywhere | Stale — CLAUDE.md now documents only one `ingest.signals.*` key, `dedup_window_hours`, and it *is* read and genuinely enforced: bound as `$7` in the dedup claim query's `WHERE` clause (feature 111, migration `009_signal_dedup_keys.up.sql`), gating whether a matching signal is treated as a duplicate | `CLAUDE.md:92` vs `servicer.py:786-830` (claim query), `app/config/watcher.py:161-162` | Resolved — row kept for history, not an open action |
| `ingest.backfill.default_timeframe` documented | No reader; servicer hardcodes `"1d"` literally | `CLAUDE.md` config table (self-flagged "not yet wired") vs `servicer.py:125` (also `:240,509`); grep for `default_timeframe` in `app/` = zero readers | Remove the key, or wire it |
| ~~CLAUDE.md "Ledger Events Emitted" lists `ingest.data.normalized`~~ **STALE premise (resolved 2026-08-27):** the current CLAUDE.md table lists only the 5 real events (no `ingest.data.normalized`), so the documentation no longer lies. The underlying code fact still holds — `NormalizeRawData` counts rows and emits no ledger event (`servicer.py:691-704`) — but it is no longer a doc contradiction; kept for history / a maintainer note on whether normalize *should* emit | `CLAUDE.md` "Ledger Events Emitted" (no `data.normalized`) vs `servicer.py:691-704` | Closed as doc-lie; optionally decide whether normalize should emit |

## Dead / orphaned code

| What | Why it looks dead | Evidence |
|---|---|---|
| `signal_sources.get_active_source` | called only by tests; `IngestSignal` does its own inline SELECT | `signal_sources.py:34` vs `servicer.py:774` (`IngestSignal` inline SELECT) |
| `app/extractors/*` — **PARTIALLY RESOLVED (2026-09-02)**: `base.py` + `mcp_client.py` are now runtime-live (`McpClientExtractor()` constructed at `mcp_client_loop.py:130`). Still dead: `example_simple_email.py`, `noop.py`, and the non-Mcp dataclasses in `base.py:9-39` (SimpleEmail/EmailAttachment/LinkedEmail/SimpleWebsite/AuthenticatedWebsite — no runtime extractor constructs them) | no runtime dispatch constructs the remaining ones | `app/extractors/example_simple_email.py`, `app/extractors/noop.py`, `app/extractors/base.py:9-39` |

## Latent bugs (looks broken, not merely non-obvious)

| Issue | Impact | Evidence |
|---|---|---|
| **`ConfigWatcher` carries indicators identity** (worse 2026-09-02): module docstring still "Config watcher for xstockstrat-**indicators**" (`watcher.py:2`) and `client_id=f"indicators-{id(self)}"` (`:75`); the file also still carries dead indicators-only helpers `sandbox_timeout_ms`/`sandbox_memory_bytes`/`sandbox_allowed_imports` (`watcher.py:152-165`) that no ingest code calls | ingest registers with the config service under an "indicators-…" client id (copy-paste) + dead helpers | `app/config/watcher.py:2,75,152-165` |

## Open questions (unresolved *why* — needs a maintainer)

- The `mcp_client` loop drives `_ingest_external_signal` with **no `propagation_meta`** (`mcp_client_loop.py:124`), so loop-emitted `ingest.signal.ingested` ledger events carry empty `x-user-id`/`x-trace-id` (`servicer.py:915`). Likely intentional (server-initiated, no inbound request) — confirm whether ledger/analysis expect a trace id on these rows. — status: **open**

## Resolved

- **RESOLVED 2026-09-03 — the two `ingest.mcp_client.*` config keys were read without the `ingest.` prefix (latent bug, 2026-09-02).** Both reads now carry the full prefix: `app/engine/mcp_client_loop.py:134` (`"ingest.mcp_client.request_timeout_seconds"`) and `:163` (`"ingest.mcp_client.poll_interval_seconds"`), guarded by a regression test `tests/test_mcp_client_loop.py:109-124` ("defect 2026-09-03"). This also un-lies the CLAUDE.md "clamped ≥1 / config-tunable" claim and gives seed migration `025_ingest_mcp_client_keys` effective readers. Confirmed by re-resolving both citations against current code (they now include the prefix) plus the new test. The generalized rule now lives as INGEST-9 in the constitution.

---
_Surfaced by [context-forge](https://github.com/davcs86/agent-plugins). Defects to action, not rules. Re-run `/context-constitution` to refresh._
