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
