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

## Session 2026-06-07 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Criteria: all PASS except initial criterion-9 FAIL (4 open questions unresolved). Resolved via user decisions, then re-passed.
- User decisions (2026-06-07):
  - **Connect UX**: copy-URL only, no in-app button/deep-link (Claude.ai has no documented prefill deep-link; operator pastes URL in Settings → Connectors). → FR-2.
  - **Nav placement**: a NEW "Accounts" segment with a "My Authorized Apps" page (`/accounts/authorized-apps`) — NOT config-ui. → FR-1, FR-6 (add `/accounts` to protected matcher).
  - **Health status**: include a reachable/unreachable health indicator via a UI BFF probe of `${AGENT_PUBLIC_URL}/.well-known/oauth-protected-resource`. → FR-8, AC-4.
- All 5 open questions now resolved (`- [x]`).
- Warnings (advisory): overlap on `xstockstrat-ui` with `049-unify-admin-auth-gates` (hard dependency) and `050-strategy-creation-flow` (spec-ready, /insights — low risk). No proto/DB/config-key overlaps (this feature adds none).
- Note for /sdd-spec: adding a new top-level UI segment (`/accounts`) is more than a single page — confirm segment scaffolding, nav wiring, and middleware matcher against the post-045 consolidated `xstockstrat-ui` structure.
