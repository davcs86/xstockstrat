# Context: formula-management-ui

**Feature**: `docs/roadmap/features/003-formula-management-ui/feature.md`
**Product Spec**: `docs/roadmap/features/003-formula-management-ui/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/003-formula-management-ui/implementation-spec.md`

---

## Session 2026-05-10T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Story: persist in-memory indicator formulas to TimescaleDB, scope to user identity, add CRUD UI in xstockstrat-insights.
- Identified affected services: `xstockstrat-indicators`, `xstockstrat-insights`, `packages/proto`.
- Proto changes are additive only (new RPCs + messages) — non-breaking.
- New DB table `indicators.formulas` requires DBA review gate.
- `author`/`user_id` treated as plain string in this phase; JWT integration deferred.

## Session 2026-05-10T00:01:00Z — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings: `packages/proto` listed under Affected Services (advisory — removed and noted inline).
- Overlap findings: `broker-accounts-ui` (code-completed) also modifies `xstockstrat-insights`. No migration/proto/config conflicts; merge order informational (broker-accounts-ui merges first).
- OQ-1 RESOLVED: `user_id` via `X-User-Id` header; `'dev-user'` fallback when absent.
- OQ-2 RESOLVED: offset+limit pagination added to ListFormulas (page_size / page_offset / total_count).
- OQ-3 RESOLVED: Monaco Editor (`@monaco-editor/react`) for formula source — chosen for CompletionItemProvider support to suggest numpy/pandas/indicators API calls.

## Session 2026-05-10T00:01:00Z — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings: `packages/proto` removed from Affected Services (advisory only — proto changes documented in Proto Contract Changes section).
- Overlap findings: `broker-accounts-ui` also modifies `xstockstrat-insights` — confirmed already merged/done, no merge-order action required.
- Open questions resolved:
  - OQ-1: `user_id` via `X-User-Id` header; fallback `'dev-user'` when absent in dev.
  - OQ-2: offset+limit pagination added to `ListFormulas` (`page_size`, `page_offset`, `total_count`).
  - OQ-3: Monaco Editor (`@monaco-editor/react`) chosen for formula source — richer custom `CompletionItemProvider` support over CodeMirror.

## Session 2026-05-10T00:02:00Z — sdd-spec

- Generated implementation-spec.md with 11 steps. Status → implementation-ready.
- Key codebase findings:
  - `services/xstockstrat-indicators/migrations/` does not exist — first migration NNN is `001`. `scripts/db-migrate.sh` line 122 already calls `migrate_service "xstockstrat-indicators" "indicators"` (with a comment noting "no migrations dir yet") — no change to the script is required.
  - `services/xstockstrat-indicators/app/handlers/servicer.py`: `IndicatorsServicer.__init__` takes only `config_watcher`; in-memory `self._formulas` dict is the current formula store (L20). `RegisterFormula` at L126 and `GetFormula` at L148 must be extended to use DB when pool is available.
  - `asyncpg` is NOT in `services/xstockstrat-indicators/pyproject.toml` — must be added as `>=0.29.0` (matches ingest service). DB pool wiring follows exact pattern from `services/xstockstrat-ingest/app/main.py` L17, L37–38, L61.
  - `services/xstockstrat-insights/src/app/api/` has `analysis/`, `health/`, `portfolio/` — no `formulas/` directory. New routes follow the `fetch` + `application/connect+json` pattern from `strategies/route.ts`. `INDICATORS_BASE_URL` is already defined in `src/lib/connectTransport.ts` L34 but routes use local env var reads (same as `analysis/` routes).
  - `@monaco-editor/react` not in `services/xstockstrat-insights/package.json` — must be added as `^4.6.0`.
  - `pytest-asyncio` not in indicators `pyproject.toml` dev deps — must be added for async test support.
