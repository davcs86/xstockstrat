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
