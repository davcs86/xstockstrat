# Context: agent-mcp-server

**Feature**: `docs/roadmap/features/009-agent-mcp-server/feature.md`
**Product Spec**: `docs/roadmap/features/009-agent-mcp-server/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/009-agent-mcp-server/implementation-spec.md`

---

## Session 2026-05-16T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Phase 1 of two-phase AI agent rollout. Phase 2 is agent-scheduler (scheduled cronjob).
- No scheduler, no Gmail API — operator pastes email content into Claude.ai manually.
- All tool calls go via existing HTTP webhook endpoints; no new gRPC connections from this service.
- MCP server sends x-webhook-secret header on all downstream calls — first caller to honour the documented-but-unimplemented webhook secret convention.
- Prerequisite: signal-source-registry (008) must ship first so list_signal_sources returns valid slugs.
- Port 9000 assigned; requires Platform Lead approval as new service addition.

## Session 2026-05-21T00:00:00Z — sdd-spec

- Generated implementation-spec.md with 7 steps. Status → implementation-ready.
- Key codebase findings:
  - Ingest webhook endpoint for signal ingestion confirmed at `services/xstockstrat-ingest/app/http_server.py:L72` (`/webhooks/ingest-signal`). Valid directions are `{"buy", "sell", "hold", "watchlist"}` per `servicer.py:L167`.
  - Notify webhook endpoint confirmed at `services/xstockstrat-notify/src/webhooks/router.ts:L46` (`/webhooks/emit-alert`).
  - Analysis webhook endpoint confirmed at `services/xstockstrat-analysis/app/http_server.py:L46` (`/webhooks/run-backtest`).
  - `ListSignalSources` Connect-RPC route is NOT YET in the ingest service — it is added by feature 008 Step 7. Feature 009 depends on 008 being merged first.
  - `N8N_WEBHOOK_SECRET` is absent from `.env.example`, `docker-compose.yml`, `.do/app.dev.yaml`, and `.do/app.yaml` — Step 4 adds it to docker-compose and `.env.example`. DO specs are intentionally omitted (agent is local-only in Phase 1 per product-spec Open Questions).
  - No MCP library currently present in any service — `mcp>=1.0.0` must be added fresh in `pyproject.toml`.
  - Ingest service pattern (asyncio + FastAPI + uvicorn) confirmed as the layout model for the new service scaffold.

## Session 2026-05-21T12:00:00Z — sdd-spec (regenerated)

- Regenerated implementation-spec.md with 11 steps. Status → implementation-ready.
- Key codebase findings:
  - `ValidateApiKey` is implemented in `services/xstockstrat-identity/src/grpc/identityServiceImpl.ts:L235` but is NOT registered in `services/xstockstrat-identity/src/connect/connectRouter.ts`. The agent must call identity via gRPC (port 50058), not HTTP. `IDENTITY_ENDPOINT` defaults to `xstockstrat-identity:50058`.
  - Python gRPC stubs for identity confirmed at `packages/proto/gen/python/identity/v1/identity_pb2_grpc.py:L62–64` — `IdentityServiceStub.ValidateApiKey` uses `/xstockstrat.identity.v1.IdentityService/ValidateApiKey`.
  - Agent Dockerfile must use `context: .` (repo root) — not `./services/xstockstrat-agent` — because the proto stubs layer (`COPY ../../packages/proto/gen/python`) reaches outside the service directory. Pattern matches how ledger/notify/config services are built in docker-compose (L120–145).
  - `XSTOCKSTRAT_AGENT_PRIVATE_URL` must be added to nginx service environment in docker-compose (to match docker-entrypoint.sh `envsubst`) and to nginx `envs:` in both DO specs.
  - nginx `/agent/sse` and `/agent/messages` location blocks need `proxy_read_timeout 3600s` for long-lived SSE connections (default 60s would drop connections).
  - All new env vars (`xstockstrat-agent` section and nginx `XSTOCKSTRAT_AGENT_PRIVATE_URL`) confirmed absent from docker-compose.yml, .do/app.dev.yaml, .do/app.yaml via grep → no match.
  - `N8N_WEBHOOK_SECRET` confirmed absent from `.env.example`: grep → no match.
  - Step 7 (nginx) and Step 8 (DO specs + docker-compose nginx env var) are coupled and should be executed together.

## Session 2026-05-21T00:02:00Z — scope change: nginx routing + auth

- Decision: SSE transport exposed via xstockstrat-nginx at `/agent/sse`, not directly on port 9000.
- Decision: `xstockstrat-agent` added to `.do/app.dev.yaml` and `.do/app.yaml` — not local-only.
- Decision: SSE endpoint requires API key auth validated via identity service `ValidateApiKey` RPC (same pattern as ManageSignalSource in feature 008). HTTP 401 on missing/invalid key.
- New env var: `IDENTITY_ENDPOINT` (default `xstockstrat-identity:50058`).
- New affected services: `xstockstrat-nginx` (upstream + location block), `xstockstrat-identity` (no source changes, called at runtime).
- Both open questions in product-spec.md resolved and closed.
- Implementation spec generated before this decision is now stale — must re-run `/sdd-spec agent-mcp-server`.
- Status reverted to `spec-ready`.

## Session 2026-05-21T00:03:00Z — sdd-review impl-spec

- Impl-spec reviewed. 4 failures found and fixed. Mode B — advisory only, no lifecycle change.
- **Fix 1 (Step 1 Files)**: Added `services/xstockstrat-agent/uv.lock` — generated by `uv lock` in Instructions but was absent from Files.
- **Fix 2 (Step 6 Files)**: Added `.do/app.dev.yaml` and `.do/app.yaml` with explicit env var list (`INGEST_HTTP_URL`, `NOTIFY_HTTP_URL`, `ANALYSIS_HTTP_URL`, `IDENTITY_ENDPOINT`, `MCP_TRANSPORT`, `MCP_SSE_PORT`, `N8N_WEBHOOK_SECRET`) — these 7 env vars are introduced for the agent service here; DO spec Instructions are in Step 8.
- **Fix 3 (Step 8 Files)**: Added `docker-compose.yml` scoped narrowly to only `XSTOCKSTRAT_AGENT_PRIVATE_URL` on the nginx service environment block (Instruction point 4). Agent service env vars are Step 6's responsibility — Step 8 only adds the single nginx env var.
- **Fix 4 (Step Dependencies)**: Added notes clarifying that Steps 7–8 (nginx/infrastructure) are verified by `docker nginx -t` + integration test (not pytest), and Step 9 (JSON file) is verified by json.load check.
- Overlap warnings: Feature 008 (`signal-source-registry`) and Feature 014 (`trader-chart-panel`) also modify deployment config files — coordinate merge order (008 must merge before 009 per existing prerequisite).
- Next action: `/sdd-execute agent-mcp-server`

## Session 2026-05-21T00:04:00Z — env var naming corrections

- `N8N_WEBHOOK_SECRET` removed from product-spec and impl-spec. Feature 011 (`remove-n8n-references`, launched 2026-05-18) deleted this env var entirely — grep confirmed zero remaining usage in services and deployment files. Replaced with `WEBHOOK_SECRET` (no N8N prefix).
- `INGEST_HTTP_URL`, `NOTIFY_HTTP_URL`, `ANALYSIS_HTTP_URL` renamed to `INGEST_HTTP_ENDPOINT`, `NOTIFY_HTTP_ENDPOINT`, `ANALYSIS_HTTP_ENDPOINT` to match the established `<SERVICE>_HTTP_ENDPOINT` pattern used by all other services.
- `IDENTITY_ENDPOINT` was already correct — no change.
- `XSTOCKSTRAT_AGENT_PRIVATE_URL` was already correct (nginx-only pattern) — no change.
- Documented the three env var naming patterns (`_ENDPOINT`, `_HTTP_ENDPOINT`, `XSTOCKSTRAT_<SERVICE>_PRIVATE_URL`) in root `CLAUDE.md` under a new "Environment Variable Naming Convention" section so future features follow the convention automatically.

## Session 2026-05-21T00:05:00Z — rename WEBHOOK_SECRET → MCP_AGENT_SECRET

- `WEBHOOK_SECRET` / `x-webhook-secret` — "webhook" no longer describes the purpose after feature 011 removed the n8n integration.
- Renamed in product-spec, implementation-spec (all 11 steps), and CLAUDE.md:
  - Env var: `WEBHOOK_SECRET` → `MCP_AGENT_SECRET`
  - Header: `x-webhook-secret` → `x-mcp-secret`
- Prior session notes in this context.md retain the old names — they are the historical decision log and are not rewritten.

## Session 2026-05-21T00:10:00Z — move x-mcp-secret enforcement into scope

- Service-side header enforcement was previously Out of Scope; moved in scope at operator request.
- Added FR-9: ingest, notify, and analysis must reject `/webhooks/*` requests with an absent or mismatched `x-mcp-secret` header when `MCP_AGENT_SECRET` is set on the receiving service. Check is skipped when env var is empty (safe gradual rollout).
- Removed Out of Scope bullet that exempted service-side enforcement.
- Updated Affected Services: ingest, notify, analysis now marked as requiring code changes.
- Fixed stale `N8N_MCP_AGENT_SECRET` → `MCP_AGENT_SECRET` in AC-7 (missed by previous rename session).
- Added AC-13: receiving services return 401 when enforcement is active and header is invalid.
- Added Step 12 to implementation-spec (total steps 11 → 12): Starlette `@app.middleware("http")` guard on ingest and analysis; inline check in notify's webhook router; `MCP_AGENT_SECRET` env var added to all three service blocks in docker-compose and DO specs.
- Step 12 is independent of Steps 1–11 and can execute at any point during the feature.

## Session 2026-05-21T00:15:00Z — add docs/runbooks/mcp-tools.md to scope

- Added FR-10: tool reference doc at `docs/runbooks/mcp-tools.md` covering all four tools with parameter tables, return shapes, and error cases; also covers transport modes and `MCP_AGENT_SECRET` enforcement.
- Added AC-14.
- Added Step 13 to implementation spec (total steps 12 → 13): creates the runbook, adds an entry to `docs/runbooks/CLAUDE.md`, and adds a row to the root `CLAUDE.md` Context Guide table.
- Step 13 requires Steps 4 and 5 to be final (tool signatures and system prompt content); otherwise independent.

## Session 2026-05-22T00:00:00Z — sdd-spec (re-run)

- Regenerated implementation-spec.md with 13 steps (same count, but Steps 4, 5, 10, 13 substantially updated). Status remains implementation-ready.
- Key codebase findings:
  - Product spec now defines 6 MCP tools (FR-2): `list_signal_sources`, `extract_email_content`, `extract_website_content`, `ingest_signal`, `emit_alert`, `run_backtest`. Previous spec only had 4 — `extract_email_content` and `extract_website_content` were missing.
  - `list_signal_sources` must enrich the response with `extractor_tool` field derived via type-level mapping: `mediated_email_attachment`/`mediated_linked_email` → `"extract_email_content"`; `mediated_simple_website`/`mediated_authenticated_website` → `"extract_website_content"`; all others → null. Mapping lives in `_EXTRACTOR_TOOL_MAP` in `app/tools.py`.
  - `extract_email_content` requires `pymupdf>=1.24.0` (PyMuPDF, `import fitz`) for password-protected PDF decryption. `pypdf2` and `pymupdf` confirmed absent from all pyproject.toml files.
  - Credential resolution uses one-shot `GetConfig` gRPC call to xstockstrat-config (not WatchConfig stream). `ConfigServiceStub.GetConfig` confirmed in `packages/proto/gen/python/config/v1/config_pb2_grpc.py:L45–47`. `CONFIG_ENDPOINT` added as required env var to docker-compose, `.do/app.dev.yaml`, and `.do/app.yaml`.
  - `build_app` factory pattern confirmed in both `services/xstockstrat-ingest/app/http_server.py:L18` and `services/xstockstrat-analysis/app/http_server.py:L18` — `@app.middleware("http")` decorator must be placed inside `build_app()` after `FastAPI()` instantiation at L19. Module-level `_MCP_AGENT_SECRET` reads env var once at startup.
  - `os` import absent from `services/xstockstrat-ingest/app/http_server.py` — must be added when adding middleware in Step 12.
  - `services/xstockstrat-notify/src/webhooks/router.ts` webhook guard goes after `readBody` at L43, before `url` variable at L44 (inside `createWebhookRouter` function's `webhookHandler`).
  - `credentials_ref` from feature 008's `ingest.signal_sources` table must never be exposed in any tool response — confirmed by stripping it in `list_signal_sources` enrichment loop and not including it in `extract_email_content`/`extract_website_content` return values.
  - `xstockstrat-agent` service directory does NOT yet exist — confirmed `ls services/xstockstrat-agent` → NOT FOUND. All 13 steps remain pending.

### Step 1 — service: Scaffold xstockstrat-agent service directory [done]
- Created pyproject.toml with mcp>=1.0.0, httpx, anyio, starlette, uvicorn, grpcio>=1.80.0, protobuf>=5.26.0, pymupdf>=1.24.0; dev deps include respx for httpx mocking.
- Created Dockerfile with python:3.12-slim base, uv toolchain, proto stubs layer, EXPOSE 9000.
- Created empty package init files: app/__init__.py, app/config/__init__.py, app/prompts/__init__.py, tests/__init__.py.
- Created tests/conftest.py with autouse fixture setting all required env vars.
- Ran uv lock — resolved 49 packages, uv.lock committed.
- Files modified: `services/xstockstrat-agent/pyproject.toml`, `services/xstockstrat-agent/Dockerfile`, `services/xstockstrat-agent/uv.lock`, `services/xstockstrat-agent/app/__init__.py`, `services/xstockstrat-agent/app/config/__init__.py`, `services/xstockstrat-agent/app/prompts/__init__.py`, `services/xstockstrat-agent/tests/__init__.py`, `services/xstockstrat-agent/tests/conftest.py`
- Deviations: grpcio>=1.80.0 used instead of spec's >=1.63.0 (matches ingest reference service, operator approved Option A)

## Session 2026-05-24T00:00:00Z — sdd-execute (Step 1)
**Steps this session**: [1]
**Progress**: 1 done / 13 total
**Stopped at**: Step 1 (STEP COMMIT + PR — awaiting merge before next step)
**Next**: /sdd-execute agent-mcp-server next

### Step 2 — service: Implement HTTP and gRPC client wrapper [done]
- Created app/client.py with post_ingest, post_notify, post_analysis (httpx, 30s timeout, raise_for_status) and get_config_value (one-shot GetConfig gRPC call, returns None on any error).
- _headers() injects x-mcp-secret when MCP_AGENT_SECRET is set; omits header when empty.
- All four env vars (INGEST_HTTP_ENDPOINT, NOTIFY_HTTP_ENDPOINT, ANALYSIS_HTTP_ENDPOINT, CONFIG_ENDPOINT) read at module level with correct defaults.
- Files modified: `services/xstockstrat-agent/app/client.py`
- Deviations: none

## Session 2026-05-24T00:01:00Z — sdd-execute (Step 2)
**Steps this session**: [2]
**Progress**: 2 done / 13 total
**Stopped at**: Step 2 (STEP COMMIT + PR — awaiting merge before next step)
**Next**: /sdd-execute agent-mcp-server next

### Step 3 — service: Implement SSE API-key auth middleware [done]
- Created app/auth.py with validate_api_key() — parses Bearer token, calls IdentityServiceStub.ValidateApiKey via grpc.aio, returns True/False, never raises.
- AioRpcError logged at INFO; unexpected errors logged at ERROR — both return False.
- Files modified: `services/xstockstrat-agent/app/auth.py`
- Deviations: none

## Session 2026-05-24T00:02:00Z — sdd-execute (Step 3)
**Steps this session**: [3]
**Progress**: 3 done / 13 total
**Stopped at**: Step 3 (STEP COMMIT + PR — awaiting merge before next step)
**Next**: /sdd-execute agent-mcp-server next

### Step 4 — service: Implement MCP server tools and main entry point [done]
- Created app/tools.py with register_tools() containing all six @server.tool() definitions and _EXTRACTOR_TOOL_MAP.
- credentials_ref resolved via get_config_value() and used as password internally; never included in any return value.
- _extract_from_bytes() attempts fitz/PyMuPDF PDF parse first, falls back to UTF-8 decode.
- _fetch_url() uses Bearer auth header when password is set.
- Created app/main.py with stdio and SSE transports; SSE guarded by validate_api_key() returning HTTP 401.
- Files modified: `services/xstockstrat-agent/app/tools.py`, `services/xstockstrat-agent/app/main.py`
- Deviations: none

## Session 2026-05-24T00:03:00Z — sdd-execute (Step 4)
**Steps this session**: [4]
**Progress**: 4 done / 13 total
**Stopped at**: Step 4 (STEP COMMIT + PR — awaiting merge before next step)
**Next**: /sdd-execute agent-mcp-server next

### Step 5 — service: Add system prompt file [done]
- Created app/prompts/signal_extraction.md covering both email and website ingestion flows, signal field extraction table, conviction scoring guidance, emit_alert vs skip rules, and error handling for all six tools.
- extractor_tool routing is the authoritative directive — doc explicitly forbids inferring from source_type.
- Files modified: `services/xstockstrat-agent/app/prompts/signal_extraction.md`
- Deviations: none

## Session 2026-05-24T00:04:00Z — sdd-execute (Step 5)
**Steps this session**: [5]
**Progress**: 5 done / 13 total
**Stopped at**: Step 5 (STEP COMMIT + PR — awaiting merge before next step)
**Next**: /sdd-execute agent-mcp-server next

## Session 2026-05-24T00:05:00Z — design correction (Steps 4+5)
- Operator raised: conviction-threshold alerting should be deterministic code, not model-driven.
- Modified tools.py: ingest_signal now auto-calls post_notify when conviction >= 0.6. Alert failure is caught/logged; signal result still returned.
- Modified signal_extraction.md: removed "When to Call emit_alert vs. Skip" section; replaced with "Alerting" note explaining auto-emit and when to use emit_alert directly.
- Recorded in Deviation Log (Steps 4+5 entry).
- Changes pushed onto feature-steps/agent-mcp-server-step-5 branch (updates open PR #343).

## Session 2026-05-25T00:00:00Z — review feedback (PR #343)
- Operator comment: hardcoded 0.6 threshold should be configurable.
- Added `_ALERT_THRESHOLD = float(os.environ.get("MCP_ALERT_THRESHOLD", "0.6"))` at module level in tools.py.
- Replaced hardcoded 0.6 with `_ALERT_THRESHOLD` in ingest_signal auto-emit check.
- Updated signal_extraction.md to reference MCP_ALERT_THRESHOLD env var.
- MCP_ALERT_THRESHOLD will be added to docker-compose.yml and .env.example in Step 6.

## Session 2026-05-25T00:10:00Z — review feedback follow-up (PR #343, config-service threshold)
- Operator clarified: threshold should come from xstockstrat-config service, not env var.
- Removed `_ALERT_THRESHOLD` env-var constant and `os` import from tools.py.
- Added `_ALERT_THRESHOLD_DEFAULT = 0.6` and `_ALERT_THRESHOLD_CONFIG_KEY = "xstockstrat-agent.signal.alert_threshold"` constants.
- ingest_signal now calls `client.get_config_value(_ALERT_THRESHOLD_CONFIG_KEY)` on each ingest; parses float with 0.6 fallback.
- Updated signal_extraction.md Alerting section to reference config key instead of env var.
- Config key `xstockstrat-agent.signal.alert_threshold` must be seeded in Step 6.
- Deviation recorded in impl-spec Deviation Log.
