# Context: auth2-authorized-apps-ui

**Feature**: `docs/roadmap/features/051-auth2-authorized-apps-ui/feature.md`
**Product Spec**: `docs/roadmap/features/051-auth2-authorized-apps-ui/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/051-auth2-authorized-apps-ui/implementation-spec.md`

---

## Session 2026-06-07 — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- User story: "add a UI module for auth2.1 authorized apps. I want to see a button or the URL to connect Claude.ai from my web app."
- **Renumbered 049 → 051**: the initial draft was created on a stale `main-dev` checkout and picked `049`, but `origin/main-dev` already has `049-unify-admin-auth-gates` and `050-strategy-creation-flow`. Re-numbered this feature to `051` (dir + internal references) after fetching `origin/main-dev`.
- **Regrounded on feature 049, not 018**: feature `049-unify-admin-auth-gates` (Part B) absorbed and re-specced `018-agent-mcp-oauth` (whose impl spec is stale post-045) and is the real, current OAuth 2.1 source of truth. Key facts pulled from 049's product-spec:
  - Agent becomes the OAuth 2.1 Resource Server + AS facade; identity is the durable OAuth backend over gRPC.
  - Endpoints: `/.well-known/oauth-protected-resource` (RFC 9728), `/.well-known/oauth-authorization-server` (RFC 8414), `/oauth/register` (DCR), `/oauth/authorize`, `/oauth/callback`, `/oauth/token`.
  - `AGENT_PUBLIC_URL` is the established env var for the agent's public base URL (049 FR-B2/B12) → this feature reuses it; no new var/config key invented.
  - 049 completes the UI `/auth/oauth-login` **login delegation** page; THIS feature adds a separate operator-facing **connect/discovery** page (button + copyable MCP URL). No overlap.
- Grounding decisions:
  - Single affected service: `xstockstrat-ui`. No proto/DB/backend changes.
  - **Hard dependency**: 049 Part B must merge first (agent must actually serve OAuth discovery endpoints). Note in merge-order.md at /sdd-spec.
  - Related: `019-unified-login-page` (login UI, out of scope here).
- Open questions captured: Claude.ai deep-link mechanics, nav placement (config-ui recommended), optional discovery-endpoint health status, 049-merge sequencing. Env-var question resolved (reuse `AGENT_PUBLIC_URL`).
