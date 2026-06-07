# Context: auth2-authorized-apps-ui

**Feature**: `docs/roadmap/features/049-auth2-authorized-apps-ui/feature.md`
**Product Spec**: `docs/roadmap/features/049-auth2-authorized-apps-ui/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/049-auth2-authorized-apps-ui/implementation-spec.md`

---

## Session 2026-06-07 — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- User story: "add a UI module for auth2.1 authorized apps. I want to see a button or the URL to connect Claude.ai from my web app."
- Grounding decisions:
  - The OAuth 2.1 server work is already done by feature `018-agent-mcp-oauth` (agent exposes `/.well-known/oauth-authorization-server`, `/oauth/authorize`, `/oauth/token`). This feature is the **UI surface only** in `xstockstrat-ui`.
  - Single affected service: `xstockstrat-ui`. No proto/DB/backend changes.
  - Agent public URL to be sourced from env (candidate `AGENT_PUBLIC_URL`) per config governance — finalize at /sdd-spec.
  - Related: `019-unified-login-page` (login UI, out of scope here).
- Open questions captured re: Claude.ai deep-link mechanics, nav placement (config-ui recommended), env-var vs config-key, and optional health status.
