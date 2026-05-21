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
