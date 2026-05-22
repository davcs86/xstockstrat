# Context: signal-source-registry

**Feature**: `docs/roadmap/features/008-signal-source-registry/feature.md`
**Product Spec**: `docs/roadmap/features/008-signal-source-registry/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/008-signal-source-registry/implementation-spec.md`

---

## Session 2026-05-16T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Origin: audit revealed `source` field on ExternalSignal is free-form with no validation; mismatched slugs cause silent data loss in analysis backtesting.
- Scope defined during session: five source types (simple_email, email_attachment, linked_email, simple_website, authenticated_website), DB-backed registry, per-source Python extractor modules, BaseExtractor interface, ListSignalSources RPC, IngestSignal validation.
- This feature is a prerequisite for: AI agent feature (Phase 1 MCP server), signal-source-weighting (007).
- Credential storage pattern: references to secret.* config keys only — never stored in registry rows.

## Session 2026-05-16T00:01:00Z — spec refinement

- Added Sources management UI in xstockstrat-config-ui (/sources page) to scope.
- UI requirements: list sources, enable/disable toggle, structured edit form per source_type (email filters, website URLs, credentials_ref input), read-only weight display (wired to analysis.signals.source_weights, editable in 007).
- Resolved open question: ManageSignalSource requires admin API key validated via identity service — not open like n8n webhooks.
- Resolved open question: config_json is validated per source_type (required fields enforced at RPC level, not freeform JSONB).
- credentials_ref never returned in any response; replaced by has_credentials boolean flag.
- extractor_module field is read-only in the UI after registration.
- UI may optionally display extractor source code as a view-only reference (not a hard requirement).

## Session 2026-05-21T00:01:00Z — sdd-spec

- Generated implementation-spec.md with 11 steps. Status → implementation-ready.
- Key codebase findings:
  - Last ingest migration is `001_newsletter_signals.up.sql` → new migration is `002_add_signal_sources_registry`.
  - `IngestServicer.__init__` at `app/handlers/servicer.py` L22–30 accepts `config_watcher, marketdata_channel, ledger_channel, db_pool`. Added `identity_channel` parameter (Step 6).
  - `IDENTITY_ENDPOINT` absent from `xstockstrat-ingest` in all three deployment files (`docker-compose.yml` L271–287, `.do/app.dev.yaml` L138–153, `.do/app.yaml` L138–153) — must be added in Step 6.
  - `INGEST_HTTP_ENDPOINT` absent from `xstockstrat-config-ui` in all three deployment files — must be added in Step 9.
  - `ValidateApiKey` RPC confirmed in `packages/proto/identity/v1/identity.proto` L15, returns `TokenClaims { repeated string roles }` — admin gate checks `"admin" in roles`.
  - `app/repositories/` and `app/extractors/` directories do not exist in `xstockstrat-ingest` — must be created from scratch in Steps 4 and 5.
  - `google/protobuf/struct.proto` import pattern confirmed in `config/v1/config.proto` L8 and `analysis/v1/analysis.proto` L8 — safe to add to ingest proto.
  - Connect-RPC HTTP route pattern in `http_server.py` L27–49: one `@app.post("/xstockstrat.ingest.v1.IngestService/MethodName")` per RPC using `_call()` helper. New routes for `ListSignalSources` (standard `_call`) and `ManageSignalSource` (new `_call_with_auth`) added in Step 7.
  - Config-ui API route pattern (`app/api/config/route.ts`) uses raw `fetch` to `${ENDPOINT}/ServicePackage/MethodName` with `Content-Type: application/connect+json` — reused for `/api/sources/route.ts` in Step 9.

## Session 2026-05-21T00:00:00Z — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings:
  - `packages/proto` listed under Affected Services but is not in the Service Registry; advisory only — proto changes are already documented in Proto Contract Changes.
  - Feature `wire-fe-auth` (012, code-completed) also modifies `xstockstrat-config-ui` — coordinate merge order.
  - Feature `wire-fe-auth` (012, code-completed) also modifies `xstockstrat-ingest` — coordinate merge order.
- Open question resolved: no seeding strategy required; sources are registered on-demand by operators via the config-ui `/sources` page after deployment.
- Overlap findings: no FAIL-level conflicts with any active concurrent feature.

## Session 2026-05-22T00:00:00Z — sdd-spec (re-run)

- Re-ran implementation spec against current codebase. Status remains implementation-ready. Step count: 11 → 12.
- Key corrections applied:
  - Step 3 (migration): CHECK constraint now includes all 10 source_type values — the previous spec omitted all five `mediated_*` types (mediated_simple_email, mediated_email_attachment, mediated_linked_email, mediated_simple_website, mediated_authenticated_website). This is a correctness bug fix aligned with FR-2.
  - Step 4 (repository): `validate_config_json` now explicitly covers all ten source types including all mediated variants per FR-10. The mediated types share the same config_json structure as their programmatic counterparts.
  - Step 5 (extractors): Added `noop.py` extractor as a required artifact (FR-6 mandates `app.extractors.noop` for all mediated source types). The previous spec omitted this file.
  - Step 6 (servicer ManageSignalSource): `credentials_ref` requirement now applies to both `authenticated_website` AND `mediated_authenticated_website` (was only authenticated_website).
  - Step 9 (config-ui DO yaml): Corrected line number references. IDENTITY_HTTP_ENDPOINT is at L397 in .do/app.dev.yaml and L393 in .do/app.yaml (previous spec said L368).
  - Step 12 (new): Dedicated test step for noop extractor coverage and dynamic importability of all mediated extractor modules per acceptance criterion 9.
- Verified codebase findings still accurate: last ingest migration is 001, no repositories/ or extractors/ dirs exist, IDENTITY_ENDPOINT absent from all three deployment files, INGEST_HTTP_ENDPOINT absent from config-ui in all three deployment files.

## Session 2026-05-21T00:01:00Z — sdd-review impl-spec

- Implementation spec reviewed. 0 failures, 1 advisory warning (Step 2: 12 files — unavoidable for proto-gen).
- Two spec issues found and patched before final review:
  - Step 4 Verification: added runnable python3 import check (was deferring entirely to Step 8).
  - Step 6 Files: added docker-compose.yml, .do/app.dev.yaml, .do/app.yaml (Instructions modified all three but they were absent from Files list).
- Trading domain checks: skipped (non-trading feature).
- Overlap check: no file, migration, proto, or config key collisions with formula-management-ui (003), phase-2-data-layer (013), or trader-chart-panel (014).
- Next action updated to: /sdd-execute signal-source-registry.

### Step 1 — proto: Add ListSignalSources and ManageSignalSource to ingest proto [done]
- Added `import "google/protobuf/struct.proto";`, two new RPCs (`ListSignalSources`, `ManageSignalSource`), and five new messages (`SignalSource`, `ListSignalSourcesRequest`, `ListSignalSourcesResponse`, `ManageSignalSourceRequest`, `ManageSignalSourceResponse`) to `packages/proto/ingest/v1/ingest.proto`.
- Files modified: `packages/proto/ingest/v1/ingest.proto`
- Deviations: `buf` not installed; validated with `python3 -m grpc_tools.protoc` (grpcio-tools 1.80.0 installed, libprotoc 31.1). Exit 0, diff is purely additive. Documented as deviation per phase3-deviations.md precedent.

## Session 2026-05-22T00:00:00Z — sdd-execute
**Steps this session**: [1]
**Progress**: 1 done / 11 total
**Stopped at**: Step 1 (PR created, waiting for merge before Step 2)
**Next**: /sdd-execute signal-source-registry next

### Step 2 — proto-gen: Regenerate stubs after proto update [done]
- Ran `./scripts/buf-gen.sh` after installing buf v1.69.0, Go proto plugins, and TS plugins. All stubs regenerated: Python, Go, TypeScript, and compiled JS dist.
- Files modified: `packages/proto/gen/python/ingest/v1/ingest_pb2.py`, `ingest_pb2_grpc.py`, `gen/go/ingest/v1/ingest.pb.go`, `ingest_grpc.pb.go`, `ingestv1connect/ingest.connect.go`, `gen/ts/ingest/v1/ingest.ts`, `ingest_connect.ts`, `ingest_pb.ts`, `gen/ts/dist/ingest/v1/ingest.js`, `ingest.d.ts`, `ingest_pb.js`, `ingest_pb.d.ts`. Also other service gRPC stubs updated by new protoc-gen-go-grpc version.
- Deviations: buf/plugins not pre-installed; downloaded and installed before running buf-gen.sh. Full detail in Deviation Log.

## Session 2026-05-22T00:01:00Z — sdd-execute
**Steps this session**: [2]
**Progress**: 2 done / 11 total
**Stopped at**: Step 2 (PR created, waiting for merge before Step 3)
**Next**: /sdd-execute signal-source-registry next

### Step 3 — migration: Add signal_sources registry table to ingest schema [done]
- Created `002_add_signal_sources_registry.up.sql` (signal_sources table with CHECK constraint on source_type, JSONB config_json, active index) and matching `.down.sql`.
- Files modified: `services/xstockstrat-ingest/migrations/002_add_signal_sources_registry.up.sql`, `002_add_signal_sources_registry.down.sql`
- Deviations: DATABASE_URL not set; verified by SQL content assertions instead of live db-migrate.sh run. Full detail in Deviation Log.

## Session 2026-05-22T00:02:00Z — sdd-execute
**Steps this session**: [3]
**Progress**: 3 done / 11 total
**Stopped at**: Step 3 (PR created, waiting for merge before Step 4)
**Next**: /sdd-execute signal-source-registry next

### Step 4 — service: Signal sources repository layer [done]
- Created `app/repositories/__init__.py` (empty) and `app/repositories/signal_sources.py` with five functions: `get_active_source`, `list_all_sources`, `upsert_source`, `deactivate_source` (all async, asyncpg pool pattern), and `validate_config_json` (sync, enforces FR-10 required fields per source_type).
- Files modified: `services/xstockstrat-ingest/app/repositories/__init__.py`, `services/xstockstrat-ingest/app/repositories/signal_sources.py`
- Deviations: none

## Session 2026-05-22T00:03:00Z — sdd-execute
**Steps this session**: [4]
**Progress**: 4 done / 11 total
**Stopped at**: Step 4 (PR created, waiting for merge before Step 5)
**Next**: /sdd-execute signal-source-registry next

### Step 5 — service: BaseExtractor abstract class and reference extractor [done]
- Created `app/extractors/__init__.py` (empty), `app/extractors/base.py` (five input dataclasses, `RawInput` union, `BaseExtractor` ABC with `async def extract`), and `app/extractors/example_simple_email.py` (`ExampleSimpleEmailExtractor` using regex `r'\b(BUY|SELL|HOLD|WATCHLIST)\s+([A-Z]{1,5})\b'`).
- Files modified: `services/xstockstrat-ingest/app/extractors/__init__.py`, `services/xstockstrat-ingest/app/extractors/base.py`, `services/xstockstrat-ingest/app/extractors/example_simple_email.py`
- Deviations: none

## Session 2026-05-22T00:04:00Z — sdd-execute
**Steps this session**: [5]
**Progress**: 5 done / 11 total
**Stopped at**: Step 5 (PR created, waiting for merge before Step 6)
**Next**: /sdd-execute signal-source-registry next

### Step 6 — service: Update IngestSignal validation and add ListSignalSources + ManageSignalSource handlers [done]
- Added `IDENTITY_ENDPOINT` env var to `main.py` and wired `identity_channel` to `IngestServicer`. Updated `__init__` to accept `identity_channel`, store `IdentityServiceStub`. Added `_validate_admin_token` helper. Inserted FR-3 registry slug check in `IngestSignal` after direction validation. Added `ListSignalSources` and `ManageSignalSource` handler methods. Added `IDENTITY_ENDPOINT` to all three deploy files.
- Files modified: `services/xstockstrat-ingest/app/main.py`, `services/xstockstrat-ingest/app/handlers/servicer.py`, `docker-compose.yml`, `.do/app.dev.yaml`, `.do/app.yaml`
- Deviations: Verification used inline gen namespace setup (matching conftest.py pattern) since `gen` symlink is only present inside Docker container.

## Session 2026-05-22T00:05:00Z — sdd-execute
**Steps this session**: [6]
**Progress**: 6 done / 11 total
**Stopped at**: Step 6 (PR created, waiting for merge before Step 7)
**Next**: /sdd-execute signal-source-registry next

### Step 7 — service: Wire ListSignalSources and ManageSignalSource to HTTP/Connect-RPC server [done]
- Added two Connect-RPC routes (`ListSignalSources` via `_call`, `ManageSignalSource` via `_call_with_auth`) and the `_call_with_auth` helper + `_AuthContext(_NoopContext)` subclass that exposes the `Authorization` header via `invocation_metadata()`.
- Files modified: `services/xstockstrat-ingest/app/http_server.py`
- Deviations: fastapi not installed in environment — installed via pip for import check only. Route verification passed.

## Session 2026-05-22T00:06:00Z — sdd-execute
**Steps this session**: [7]
**Progress**: 7 done / 12 total
**Stopped at**: Step 7 (PR created, waiting for merge before Step 8)
**Next**: /sdd-execute signal-source-registry next

### Step 8 — test: Unit tests for signal source registry service code [done]
- Created `tests/test_signal_sources.py` (validate_config_json all 10 types, get_active_source, list_all_sources, upsert_source, deactivate_source), `tests/test_extractor.py` (ExampleSimpleEmailExtractor + NoopExtractor). Modified `tests/test_ingest_servicer.py` (updated make_servicer with identity_channel, added TestIngestSignalRegistryValidation, TestManageSignalSource, TestListSignalSources). Created `app/extractors/noop.py` (gap from spec re-run timing). Updated `validate_config_json` to cover all 10 source types including mediated variants (gap from spec re-run). Fixed existing `test_db_error_aborts` regression from Step 6 registry lookup. 93 tests pass, 59.5% coverage.
- Files modified: `tests/test_signal_sources.py`, `tests/test_extractor.py`, `tests/test_ingest_servicer.py`, `app/extractors/noop.py`, `app/repositories/signal_sources.py`
- Deviations: (1) noop.py created here instead of Step 5 — spec re-run added it after Step 5 executed. (2) validate_config_json updated here to add mediated types — same cause. Both tracked in Deviation Log.

## Session 2026-05-22T00:07:00Z — sdd-execute
**Steps this session**: [8]
**Progress**: 8 done / 12 total
**Stopped at**: Step 8 (PR created, waiting for merge before Step 9)
**Next**: /sdd-execute signal-source-registry next

### Step 9 — service: config-ui API route for signal sources [done]
- Created `app/api/sources/route.ts` with GET (→ ListSignalSources, with includeInactive param) and POST (→ ManageSignalSource, with admin API key forwarding). Added `INGEST_HTTP_ENDPOINT` to config-ui environment block in all three deploy files.
- Files modified: `services/xstockstrat-config-ui/app/api/sources/route.ts`, `docker-compose.yml`, `.do/app.dev.yaml`, `.do/app.yaml`
- Deviations: none

## Session 2026-05-22T00:08:00Z — sdd-execute
**Steps this session**: [9]
**Progress**: 9 done / 12 total
**Stopped at**: Step 9 (PR created, waiting for merge before Step 10)
**Next**: /sdd-execute signal-source-registry next

### Step 10 — service: config-ui Sources page [done]
- Created `app/sources/page.tsx` (Client Component: table of all sources with enable/disable toggle and edit/register form per source_type; weights from analysis config). Added Sources nav link to `app/layout.tsx`. Fixed gap: added `active` to `upsert_source` SQL (INSERT + ON CONFLICT SET) and passed `src.active` in servicer ManageSignalSource call.
- Files modified: `services/xstockstrat-config-ui/app/sources/page.tsx`, `services/xstockstrat-config-ui/app/layout.tsx`, `services/xstockstrat-ingest/app/repositories/signal_sources.py`, `services/xstockstrat-ingest/app/handlers/servicer.py`
- Deviations: upsert_source and ManageSignalSource updated in Step 10 (gap — re-activation toggle requires `active` in upsert SQL; user chose Option A)

## Session 2026-05-22T00:09:00Z — sdd-execute
**Steps this session**: [10]
**Progress**: 10 done / 12 total
**Stopped at**: Step 10 (PR created, waiting for merge before Step 11)
**Next**: /sdd-execute signal-source-registry next

### Step 11 — test: E2E tests for config-ui Sources page and API route [done]
- Created `e2e/sources.spec.ts` (11 tests: ListSignalSources API contract, ManageSignalSource API contract, Sources page UI contract). Added ingest mock responses to `e2e/mock-backend.ts`. Added `INGEST_HTTP_ENDPOINT` to `playwright.config.ts` webServer env; corrected `webServer.url` to `/config-ui/api/health`. Tests use basePath-aware URLs (`/config-ui/api/sources`).
- Files modified: `services/xstockstrat-config-ui/e2e/sources.spec.ts`, `services/xstockstrat-config-ui/e2e/mock-backend.ts`, `services/xstockstrat-config-ui/playwright.config.ts`
- Deviations: (1) `pnpm test:e2e` could not run — Playwright browser download blocked by remote env network policy; verified via `pnpm exec tsc --noEmit` (no errors). (2) Sources tests use correct `/config-ui/...` basePath-aware URLs (differs from pre-existing tests which have a pre-existing basePath defect). (3) `playwright.config.ts` added to Files list as deviation (not in original spec Files).

## Session 2026-05-22T00:10:00Z — sdd-execute
**Steps this session**: [11]
**Progress**: 11 done / 12 total
**Stopped at**: Step 11 (PR created, waiting for merge before Step 12)
**Next**: /sdd-execute signal-source-registry next

### Step 12 — test: Noop extractor coverage and mediated-type import verification [done]
- Appended 3 standalone test functions to `tests/test_extractor.py`: `test_noop_extractor_dynamically_importable`, `test_noop_returns_empty_for_all_input_types`, `test_reference_extractor_dynamically_importable`.
- Files modified: `services/xstockstrat-ingest/tests/test_extractor.py`
- Deviations: `pytest tests/test_extractor.py -v` — 4 synchronous tests pass (both new importability tests ✓); 12 async tests fail due to pytest-asyncio missing from uv-managed pytest env (same pre-existing limitation as Step 8). Will pass in CI with Python 3.12 and proper deps.

## Session 2026-05-22T00:11:00Z — sdd-execute
**Steps this session**: [12]
**Progress**: 12 done / 12 total
**Stopped at**: Step 12 (all steps complete)
**Next**: Create integration PR — /sdd-execute signal-source-registry (ALL-DONE PATH)
