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

## Session 2026-06-01 — re-spec plan confirmed

- Decision: Option Y — wait for 044, 045, and 046 to all merge before executing any step of 003.
- Rationale: re-spec will regenerate all 12 steps targeting `xstockstrat-ui`; Steps 1–5 are valid now but merging them independently would create a short-lived PR that adds proto/DB/gRPC without any UI surface, increasing rebase overhead later.
- **Action**: after 044+045+046 merge to `main-dev`, rebase `feature/formula-management-ui` on `main-dev`, then re-run `/sdd-spec formula-management-ui` to regenerate the impl spec end-to-end against the consolidated service.
- @monaco-editor/react: the re-spec will include it in the `xstockstrat-ui/package.json` at Step 1 (alongside the connect-query-es deps from 044).
- Execution position in Stream 2: 044 → 046 → 045 → **003** → 019 → 016.

## Session 2026-06-02T00:00:00Z — sdd-spec (regeneration)

- Regenerated implementation-spec.md with 12 steps. Status remains `implementation-ready`.
- All 12 steps now target the post-consolidation `xstockstrat-ui` service and use the gRPC + connect-query-es pattern from feature 044.
- Key codebase findings:
  - `services/xstockstrat-ui` now exists with insights under `src/app/insights/`. The consolidated BFF pattern uses `createConnectRouter` in `src/lib/insightsBff.ts` — `IndicatorsService` is absent from it and must be registered (Step 7).
  - `services/xstockstrat-ui/src/lib/connectClients.ts` does not yet import `IndicatorsService` or define `INDICATORS_ENDPOINT` (Step 7).
  - Browser client pattern: `createConnectTransport({ baseUrl: '/insights/api' })` in `src/lib/browserClients/analysisClient.ts` — indicatorsClient follows this same pattern (Step 8).
  - Hook pattern: `useQuery`/`useMutation` from `@tanstack/react-query` in `src/hooks/useStrategies.ts` — confirmed, useFormulas.ts follows it (Step 8).
  - `@monaco-editor/react` absent from `services/xstockstrat-ui/package.json` — must add as `^4.6.0` (Step 10). Use `dynamic(() => import('@monaco-editor/react'), { ssr: false })` to avoid SSR issues.
  - `RegisterFormulaRequest` in the proto does NOT have an `author` field (only in `FormulaDefinition`). Step 1 adds `author = 6` to `RegisterFormulaRequest` — BFF overwrites it with `claims.user_id` in Step 7, preventing caller spoofing.
  - `services/xstockstrat-indicators/migrations/` directory does NOT exist — NNN starts at `001` (Step 3).
  - `docker-compose.yml` `xstockstrat-indicators` block (lines 260–286) does not use `*db-url` merge anchor and has no timescaledb/db-migrator depends_on — both must be added (Step 4).
  - `DATABASE_URL` is absent from `xstockstrat-indicators` envs in `.do/app.dev.yaml` and `.do/app.yaml` — must be added (Step 4).
  - The old `xstockstrat-insights` docker-compose block (line 457) still carries `INDICATORS_ENDPOINT` — no deployment file change needed for Steps 7–12 until 045's deployment wiring is also complete.

## Session 2026-06-02T00:01:00Z — sdd-execute

### Step 1 — proto: Add author to RegisterFormulaRequest and add ListFormulas, UpdateFormula, DeleteFormula RPCs [done]
- Added `author = 6` to `RegisterFormulaRequest`; added `ListFormulas`, `UpdateFormula`, `DeleteFormula` RPCs to `IndicatorsService`; appended 6 new messages after `GetFormulaRequest`.
- Files modified: `packages/proto/indicators/v1/indicators.proto`
- Deviations: `buf` not installed — verified proto syntax with `grpc_tools.protoc` and confirmed no lines removed (purely additive change). Documented as deviation per phase3-deviations.md precedent.

**Steps this session**: [1]
**Progress**: 1 done / 12 total
**Stopped at**: Step 1 complete — PR created
**Next**: /sdd-execute formula-management-ui next

## Session 2026-06-04T00:00:00Z — sdd-execute (re-spec + resume)

- Merged current `origin/main-dev` into `feature/formula-management-ui` (`merge -X ours`), bringing the unified-FE-E2E consolidation (PRs #513/#518/#520/#521) and feature 044 launch. `services/xstockstrat-insights/` no longer exists; insights e2e suite now lives at `services/xstockstrat-ui/e2e/insights/` (port 3000, mock gRPC on 9092).
- **Re-spec (targeted, "re-spec if needed")**: Step 12 was the only stale step — it targeted the deleted `services/xstockstrat-insights/e2e/formulas.spec.ts`. Rewrote Step 12 to target `services/xstockstrat-ui/e2e/insights/formulas.spec.ts`, modeled on the consolidated `dashboard.spec.ts` pattern (jose-signed `access_token` cookie + `page.route()` browser-level stub of `IndicatorsService/ListFormulas`, since `mock-backend.ts` does not mock IndicatorsService). Steps 1–11 verified still accurate against current main-dev (all `xstockstrat-ui` file paths confirmed present; `INDICATORS_ENDPOINT` already wired into ui docker-compose + DO specs by 045).
- Step 1 (proto) confirmed intact after merge.

### Step 2 — proto-gen: Regenerate proto stubs [done]
- Ran `./scripts/buf-gen.sh`; regenerated Go/Python/TS stubs + compiled TS dist. Verified new RPCs (`ListFormulas`/`UpdateFormula`/`DeleteFormula`) and `author=6` on `RegisterFormulaRequest` in all three languages.
- Files modified: 12 indicators stub files under `packages/proto/gen/{go,python,ts,ts/dist}/indicators/v1/`.
- Deviations: Docker codegen container blocked by Docker Hub 429 rate limit; installed the CI `proto-freshness` toolchain on the host (buf 1.69.0, protoc-gen-go@v1.36.11, protoc-gen-go-grpc@v1.6.2, protoc-gen-connect-go@v1.19.2, grpcio-tools==1.80.0 + protobuf==6.31.1). Confirmed diff scoped to indicators only — CI proto-freshness `git diff --exit-code` would pass. Full detail in Deviation Log.

### Step 3 — migration: Create indicators.formulas table migration [done]
- Created `migrations/001_formulas.up.sql` (schema + `indicators.formulas` table + author/partial-is_public indexes) and `001_formulas.down.sql`.
- Files modified: `services/xstockstrat-indicators/migrations/001_formulas.{up,down}.sql`.
- Deviations: `migrate` binary + TimescaleDB unavailable, so verified by applying both migrations against a throwaway `postgres:16-alpine` container (UP + DOWN both clean). Detail in Deviation Log.

### Step 4 — service: Add FormulasRepository and DB pool wiring [done]
- Created `app/services/formulas_repository.py` (asyncpg CRUD with `$1::uuid` casts + JSONB encode/decode); added `asyncpg>=0.29.0` to `pyproject.toml` + regenerated `uv.lock`; wired DB pool in `app/main.py` (DATABASE_URL env, `create_pool`, pass `db_pool=` to servicer, close on shutdown); docker-compose indicators block now merges `*db-url` + depends_on timescaledb/db-migrator; added `DATABASE_URL` to indicators block in both `.do/app.dev.yaml` and `.do/app.yaml`.
- Files modified: `app/services/formulas_repository.py`, `app/main.py`, `pyproject.toml`, `uv.lock`, `docker-compose.yml`, `.do/app.dev.yaml`, `.do/app.yaml`.
- Deviations: added `uv.lock` to scope (CLAUDE.md sync rule / CI `uv lock --check`); repo `::uuid` cast + JSONB handling implementation detail. Detail in Deviation Log.

### Step 5 — service: Add DB persistence and new CRUD RPCs to IndicatorsServicer [done]
- Servicer constructor takes `db_pool`; `RegisterFormula` sets author + persists to DB; `GetFormula`/`ExecuteFormula` fall back to DB on cache miss; added `ListFormulas`/`UpdateFormula`/`DeleteFormula` (PERMISSION_DENIED on author mismatch, UNAVAILABLE when no repo); added module-level `_row_to_formula`.
- Files modified: `app/handlers/servicer.py`.
- Verification: `from app.handlers.servicer import IndicatorsServicer, _row_to_formula` → OK (with proto pkg installed + gen symlink, both temporary). ruff clean.
- Deviations: set `author` on the cached FormulaDefinition; ruff UP017 `datetime.UTC`. Detail in Deviation Log.

### Step 6 — test: Unit tests for FormulasRepository and servicer CRUD [done]
- Added `tests/test_formulas.py` (5 repository tests with mocked asyncpg pool + 3 servicer in-memory-fallback tests); added `pytest-asyncio>=0.23.0` + `asyncio_mode = "auto"`; created `tests/conftest.py` (gen-path setup, mirrors ingest/analysis); regenerated `uv.lock`.
- Files modified: `tests/test_formulas.py`, `tests/conftest.py`, `pyproject.toml`, `uv.lock`.
- Verification: `uv run pytest --cov=app --cov-fail-under=50` → 22 passed, coverage 81.9%; ruff clean.
- Deviations: added `conftest.py` (required for servicer import in CI; sibling pattern) + `uv.lock`. Detail in Deviation Log.

### Step 7 — service: Wire IndicatorsService into xstockstrat-ui BFF [done]
- Added `INDICATORS_ENDPOINT` + `indicatorsClient` to `connectClients.ts`; registered `IndicatorsService` in `insightsBff.ts` (8 RPCs; BFF overwrites `author`/`userId` from JWT claims; reuses `backendHeaders` for x-user-id/x-access-scope/x-trace-id propagation).
- Files modified: `src/lib/connectClients.ts`, `src/lib/insightsBff.ts`.
- Verification: `pnpm run lint` clean; `tsc --noEmit` clean; grep confirms symbols.
- Deviations: merged `indicatorsClient` into existing connectClients import (avoids ESLint no-duplicates). Detail in Deviation Log.

### Step 8 — service: indicators browser client + formula hooks [done]
- Created `src/lib/browserClients/indicatorsClient.ts` (connect-web transport → `/insights/api`) and `src/hooks/useFormulas.ts` (useFormulas/useFormula/useRegisterFormula/useUpdateFormula/useDeleteFormula/useExecuteFormula, TanStack Query with cache invalidation).
- Files modified: `src/lib/browserClients/indicatorsClient.ts`, `src/hooks/useFormulas.ts`.
- Verification: `tsc --noEmit` clean; `pnpm run lint` clean.
- Deviations: typed `inputData` cast (vs `as any`); dropped unused `DeleteFormulaRequest` type import. Detail in Deviation Log.

### Step 9 — service: Add Formulas nav link to insights AppShell [done]
- Added `/insights/formulas` nav links to both desktop and mobile nav in `AppShell.tsx`, after Strategies, matching the active-state styling of siblings.
- Files modified: `src/components/insights/AppShell.tsx`.
- Verification: `pnpm run lint` clean; 5 formulas matches.
- Deviations: omitted the `Code2` import (unused → would fail lint); links are icon-less like Dashboard/Strategies. Detail in Deviation Log.

### Step 10 — service: FormulaEditor + formula pages [done]
- Added `@monaco-editor/react@^4.6.0` (+ pnpm-lock.yaml); created `FormulaEditor.tsx` (dynamic ssr:false Monaco), `formulas/page.tsx` (list + New button), `formulas/new/page.tsx` (create form), `formulas/[id]/page.tsx` (view/edit/delete + JSON test-execute).
- Files modified: `package.json`, `pnpm-lock.yaml`, `src/components/insights/FormulaEditor.tsx`, `src/app/insights/formulas/{page,new/page,[id]/page}.tsx`.
- Verification: `tsc --noEmit` clean; `pnpm run lint` clean.
- Deviations: added pnpm-lock.yaml to scope (frozen-lockfile CI). Detail in Deviation Log.
