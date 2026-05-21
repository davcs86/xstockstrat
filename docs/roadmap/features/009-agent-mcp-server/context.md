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
