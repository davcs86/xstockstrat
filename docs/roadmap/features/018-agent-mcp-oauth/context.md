# Context: agent-mcp-oauth

**Feature**: `docs/roadmap/features/018-agent-mcp-oauth/feature.md`
**Product Spec**: `docs/roadmap/features/018-agent-mcp-oauth/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/018-agent-mcp-oauth/implementation-spec.md`

---

## Session 2026-05-25T01:20:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Context: spawned from 009-agent-mcp-server execution. During Step 9 (claude_mcp_config.json), operator asked how MCP auth works. Identified that query-param (?api_key=) covers Claude Desktop but OAuth 2.0 is the correct path for Claude.ai remote MCP connections.
- The ?api_key= fallback was added to main.py in the same session (pushed onto Step 9 PR #347).
- OAuth 2.0 is a meaningful separate feature — kept out of 009 scope deliberately.
- Key design decision: use PKCE (S256) Authorization Code flow; access token IS the xstockstrat API key (no separate token store); in-memory code store (safe at instance_count: 1).
- Open question: identity login UI may be needed for the redirect flow — to be resolved at /sdd-spec time.

## Session 2026-05-25 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings: FR-9 flow description slightly ambiguous — "authorization code" from identity is not the same token as the OAuth code the agent issues to the client. impl-spec should clarify that identity redirects to an agent callback URL (e.g. `/oauth/callback`) with a short-lived identity credential; agent then issues the OAuth code to the client's redirect_uri.
- Overlap findings: none (formula-management-ui is the only active concurrent feature; touches xstockstrat-indicators and xstockstrat-insights — no overlap).
- OQ-1 resolved: minimal server-rendered GET /login form in xstockstrat-identity scoped into this feature (FR-9). Unified login page deferred to follow-up feature 019-unified-login-page.
- OQ-2 resolved: module-level singleton dict for authorization code store. Safe for instance_count: 1.

## Session 2026-05-25T00:00:00Z — sdd-spec

- Generated implementation-spec.md with 7 steps. Status → implementation-ready.
- Key codebase findings:
  - `xstockstrat-identity` has NO login form/OAuth UI: `src/index.ts` serves only Connect-RPC
    and `/health`. The agent's `GET /oauth/authorize` must serve its own minimal HTML login form
    and POST to identity's `AuthenticateUser` Connect-RPC HTTP endpoint (port 8058).
  - `IDENTITY_HTTP_ENDPOINT` is absent from the agent's environment in `docker-compose.yml`
    (lines 515–524) and both DO spec files — must be added as a new env var in Step 2.
  - `AuthCode` dataclass needs an `api_key` field: the API key returned by `CreateApiKey` in the
    authorize POST handler must be stored in the code store and retrieved in the token endpoint
    (avoids a second identity round-trip at token exchange time).
  - nginx `agent_backend` upstream already exists (line 39); new OAuth paths added as two
    location blocks: `= /.well-known/oauth-authorization-server` at root and
    `/agent/oauth/` proxied to agent's `/oauth/`.
  - `AGENT_PUBLIC_URL` is a new env var needed in the metadata document to build absolute
    `authorization_endpoint` and `token_endpoint` URLs.

## Session 2026-06-04 — "501 endpoints" audit + revised plan (no code change)

- Triggered by a request to "find all 501 not implemented endpoints and write a plan." Audited the
  whole platform: all 61 declared gRPC RPCs across the 10 backend services are implemented (nothing
  falls through to the `Unimplemented*` embeds → no runtime 501s). The only genuinely unimplemented
  endpoints are this feature's OAuth HTTP endpoints, which never executed.
- **The on-disk impl-spec is STALE** and must not be executed verbatim. Three reconciliations,
  caused by features that landed after 2026-05-25, are documented in the new revised plan:
  - **nginx removed (045):** Step 5 (`nginx.conf`) is obsolete → replace with a DO App Platform
    path rule mapping `/.well-known/oauth-authorization-server` to the agent.
  - **gRPC-only backends:** Steps 2/3 call identity over HTTP Connect-RPC (`IDENTITY_HTTP_ENDPOINT`,
    port 8058) — that port is gone. Use `IDENTITY_ENDPOINT` gRPC (`AuthenticateUser`/`ValidateToken`/
    `CreateApiKey`). Do NOT reintroduce `IDENTITY_HTTP_ENDPOINT`.
  - **Unified login (019 launched):** the agent must NOT serve its own login form (FR-9 obsolete).
    It redirects to `{UI_BASE_URL}/auth/oauth-login`. A NEW `GET /oauth/callback` step is required so
    the agent regains control after login to mint the API key and issue the auth `code` (the live
    `/auth/oauth-login` page currently redirects back with `state` only, no `code`).
- Revised 8-step plan written at `docs/roadmap/501-endpoints-implementation-plan.md`. This feature
  stays `implementation-ready`; update Step 2/3/5 + the Deviation Log here when `/sdd-execute` runs.
