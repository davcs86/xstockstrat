# xstockstrat-ingest — Constitution Findings

Defects and drift surfaced by `/context-constitution` on 2026-07-24. For triage/fixing, not
governance. The config zero-trap and the `client_id="indicators-…"` copy-paste are repeated patterns
also recorded at the root.

## Documentation that lies (docs claim behavior the code lacks)

| What the docs say | What the code does | Evidence | Suggested action |
|---|---|---|---|
| **Updated 2026-08-07**: this row previously claimed CLAUDE.md documents 9 `ingest.signals.*` config keys (per-source enabled, default_window_days, default_conviction, dedup_window_hours), none read anywhere | Stale — CLAUDE.md now documents only one `ingest.signals.*` key, `dedup_window_hours`, and it *is* read and genuinely enforced: bound as `$7` in the dedup claim query's `WHERE` clause (feature 111, migration `009_signal_dedup_keys.up.sql`), gating whether a matching signal is treated as a duplicate | `CLAUDE.md:92` vs `servicer.py:786-830` (claim query), `app/config/watcher.py:163-164` | Resolved — row kept for history, not an open action |
| `ingest.backfill.default_timeframe` documented | No reader; servicer hardcodes `"1d"` literally | `CLAUDE.md` config table (self-flagged "not yet wired") vs `servicer.py:125` (also `:240,509`); grep for `default_timeframe` in `app/` = zero readers | Remove the key, or wire it |
| ~~CLAUDE.md "Ledger Events Emitted" lists `ingest.data.normalized`~~ **STALE premise (resolved 2026-08-27):** the current CLAUDE.md table lists only the 5 real events (no `ingest.data.normalized`), so the documentation no longer lies. The underlying code fact still holds — `NormalizeRawData` counts rows and emits no ledger event (`servicer.py:691-704`) — but it is no longer a doc contradiction; kept for history / a maintainer note on whether normalize *should* emit | `CLAUDE.md` "Ledger Events Emitted" (no `data.normalized`) vs `servicer.py:691-704` | Closed as doc-lie; optionally decide whether normalize should emit |

## Dead / orphaned code

| What | Why it looks dead | Evidence |
|---|---|---|
| `signal_sources.get_active_source` | called only by tests; `IngestSignal` does its own inline SELECT | `signal_sources.py:34` vs `servicer.py:720` (`IngestSignal`) |
| `app/extractors/*` (base/noop/example) | imported only by tests; no runtime dispatch constructs an extractor | `app/extractors/` (likely feature-008 scaffolding) |

## Latent bugs (looks broken, not merely non-obvious)

| Issue | Impact | Evidence |
|---|---|---|
| **`ConfigWatcher` carries indicators identity**: module docstring "Config watcher for xstockstrat-**indicators**" and `client_id=f"indicators-{id(self)}"` | ingest registers with the config service under an "indicators-…" client id (copy-paste) | `app/config/watcher.py:61` |

---
_Surfaced by [context-forge](https://github.com/davcs86/agent-plugins). Defects to action, not rules. Re-run `/context-constitution` to refresh._
