# xstockstrat-ingest — Constitution Findings

Defects and drift surfaced by `/context-constitution` on 2026-07-24. For triage/fixing, not
governance. The config zero-trap and the `client_id="indicators-…"` copy-paste are repeated patterns
also recorded at the root.

## Documentation that lies (docs claim behavior the code lacks)

| What the docs say | What the code does | Evidence | Suggested action |
|---|---|---|---|
| CLAUDE.md documents 9 `ingest.signals.*` config keys (per-source enabled, default_window_days, default_conviction, dedup_window_hours) | None are read anywhere | `CLAUDE.md` config table (grep zero in `app/`) | Wire them or delete |
| Dedup key: "Skip re-ingesting same symbol+source+direction within this window" | `IngestSignal` always INSERTs; migration 001 has no unique constraint | `CLAUDE.md:79` vs `servicer.py:659` | Implement dedup or remove the claim |
| `ingest.backfill.default_timeframe` documented | No reader; servicer falls back to `"1d"` literally | `CLAUDE.md` config table vs `servicer.py:53` | Remove the key |
| CLAUDE.md "Ledger Events Emitted" lists `ingest.data.normalized`; `NormalizeRawData` docstring says "into ledger events" | Handler only counts rows; no ledger `AppendEvent`, no persistence | `CLAUDE.md` vs `servicer.py:599-611` | Implement or correct |

## Dead / orphaned code

| What | Why it looks dead | Evidence |
|---|---|---|
| `signal_sources.get_active_source` | called only by tests; `IngestSignal` does its own inline SELECT | `signal_sources.py:6` vs `servicer.py:639` |
| `app/extractors/*` (base/noop/example) | imported only by tests; no runtime dispatch constructs an extractor | `app/extractors/` (likely feature-008 scaffolding) |

## Latent bugs (looks broken, not merely non-obvious)

| Issue | Impact | Evidence |
|---|---|---|
| **`ConfigWatcher` carries indicators identity**: module docstring "Config watcher for xstockstrat-**indicators**" and `client_id=f"indicators-{id(self)}"` | ingest registers with the config service under an "indicators-…" client id (copy-paste) | `app/config/watcher.py:38` |

---
_Surfaced by [context-forge](https://github.com/davcs86/agent-plugins). Defects to action, not rules. Re-run `/context-constitution` to refresh._
