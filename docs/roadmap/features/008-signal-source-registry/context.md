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
