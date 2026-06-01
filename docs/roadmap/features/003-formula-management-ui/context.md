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

## Session 2026-06-01T00:00:00Z — stream-2 context update

- Feature added to Stream 2 workstream. Execution order in Stream 2:
  044 → 046 → 003 → 045 → 019 → 016 (003 must execute before 045 absorbs xstockstrat-insights).
- **FR-13 corrected**: the indicators HTTP/Connect-RPC server (port 8054) was removed as part
  of the platform-wide gRPC-only migration. FR-13 updated to specify `@connectrpc/connect-node`
  gRPC transport on `INDICATORS_ENDPOINT` for BFF route handlers; typed `connect-query-es` +
  TanStack Query hooks for the client layer (per the 044 pattern).
- **Implementation spec pre-execution warning added**: Steps 6 and 7–10 reference
  `INDICATORS_HTTP_ENDPOINT` and `http_server.py` HTTP routes — both invalid after the gRPC
  migration. A `⚠ Pre-execution Revision Required` block was added at the top of the impl spec.
  Steps 1–5 (proto, migration, DB repository, gRPC servicer) remain valid and can execute now.
  Steps 6–10 must be regenerated after 044 merges: re-run `/sdd-spec formula-management-ui`
  to get accurate codebase evidence from the updated `xstockstrat-insights`.
- Merge-order dependencies added to product-spec.md:
  - After `044-client-api-pattern` (client layer pattern established)
  - After `045-ui-consolidation-nextjs` (003 now targets `xstockstrat-ui`; 045 must land first)
- Stream 2 execution order: 044 → 046 → 045 → 003 → 019 → 016

## Session 2026-06-01T00:01:00Z — stream-2 reorder

- 003 swapped to execute after 045, not before.
- Consequence: UI steps (Steps 7–10) target `services/xstockstrat-ui/` (post-consolidation),
  not `services/xstockstrat-insights/`. Affected services updated: `xstockstrat-ui` replaces
  `xstockstrat-insights` for the UI portion of this feature.
- Pre-execution note in impl spec updated: Steps 7–10 now require both a service path change
  (xstockstrat-insights → xstockstrat-ui) and an API pattern change (gRPC + connect-query-es).
- Re-run `/sdd-spec formula-management-ui` after both 044 and 045 merge.
