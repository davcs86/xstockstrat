# Product Spec: auth2-authorized-apps-ui

**Created**: 2026-06-07

---

## Problem Statement

Feature `049-unify-admin-auth-gates` (Part B — which supersedes and re-specs `018-agent-mcp-oauth`) makes `xstockstrat-agent` a fully OAuth 2.1-capable remote MCP server: RFC 9728/8414 discovery, `401 + WWW-Authenticate` trigger, RFC 7591 dynamic client registration, PKCE, audience-bound JWTs, and login delegated to the UI's `/auth/oauth-login` page. But there is no in-product way to *discover how to connect*. Today an operator must know the agent's public MCP URL (the host serving `/.well-known/oauth-protected-resource`) by heart and hand-assemble the connector entry in Claude.ai. Operators want a button or copyable URL inside their own web app (`xstockstrat-ui`) that gets them to a connected Claude.ai in one step.

**Dependency:** this feature is the operator-facing front door to the OAuth 2.1 flow built in `049-unify-admin-auth-gates`. It should be specced/executed after 049 Part B lands (the agent must actually serve the OAuth discovery endpoints and `AGENT_PUBLIC_URL` must be defined). 049 completes the `/auth/oauth-login` *login delegation* page; this feature adds the separate operator-facing *connect/discovery* page — they do not overlap.

## User Story

As an operator, I want to see the xstockstrat MCP server URL inside the xstockstrat web app, so that I can add xstockstrat-agent as a remote MCP connector in Claude.ai (Settings → Connectors) without looking the URL up elsewhere or hand-constructing it.

## Functional Requirements

FR-1. `xstockstrat-ui` adds a **new "Accounts" segment** with a **"My Authorized Apps"** page (e.g. route `/accounts/authorized-apps`), reachable from the existing authenticated navigation. This is a new top-level segment alongside the existing `/trader`, `/insights`, and `/config-ui` segments.

FR-2. The "My Authorized Apps" page presents the **Claude.ai connector as a card/entry** with short instructions: copy the MCP server URL, then add it in Claude.ai under **Settings → Connectors → Add custom connector** (paste the URL; Claude.ai drives the OAuth 2.1 consent from there). There is **no in-app "Connect" button/deep-link** — Claude.ai has no documented query-param that pre-fills a custom MCP server URL, so the flow is copy-URL + paste-into-Claude.ai.

FR-3. The page displays the agent's public MCP server URL (the base Claude.ai uses for OAuth discovery, i.e. the host serving `/.well-known/oauth-protected-resource` / `/.well-known/oauth-authorization-server`) as a read-only, **copy-to-clipboard** field.

FR-4. The agent's public base URL is provided to the UI via an environment variable (no hardcoded URLs in source, per platform config governance). Feature 049 already establishes **`AGENT_PUBLIC_URL`** as the canonical agent public base URL (FR-B2/FR-B12); this feature reuses that same value rather than inventing a new var. (An `_ENDPOINT` suffix is not appropriate here — this is a browser-facing HTTPS URL, not a gRPC `host:port`.) Whether the UI receives it as its own env var or via a small BFF route is a `/sdd-spec` detail.

FR-5. The page renders only OAuth/connection metadata (the MCP URL and connection status). It MUST NOT render any API keys, JWTs, client secrets, or other secret values (per `xstockstrat-ui` review focus).

FR-6. The page is gated behind the existing `xstockstrat-ui` JWT auth/middleware like all other authenticated pages; unauthenticated users are redirected to login. The new `/accounts` segment is added to the protected-route matcher.

FR-7. The page provides brief inline guidance (1–3 sentences) describing what connecting Claude.ai does and what the operator will be asked to authorize (the OAuth 2.1 consent/login delivered by feature 049).

FR-8. **Connection health indicator.** The page shows a reachable/unreachable status for the agent's OAuth discovery endpoint. A **UI BFF route** (server-side, to avoid browser CORS against the agent) probes `${AGENT_PUBLIC_URL}/.well-known/oauth-protected-resource` and returns a simple status (e.g. `reachable` / `unreachable` + HTTP code). The probe response MUST NOT expose any secret or sensitive payload — only reachability/status. Probe failures degrade gracefully (the URL is still shown and copyable).

## Out of Scope

- Building or changing the OAuth server itself (delivered by `049-unify-admin-auth-gates` Part B).
- The OAuth *login delegation* page `/auth/oauth-login` (completed by feature 049) — this feature adds a distinct operator-facing *connect/discovery* page.
- Listing, auditing, or revoking previously authorized OAuth clients/tokens (no revocation endpoint exists — see 049 Out of Scope, RFC 7009 excluded). Could be a follow-up feature.
- Per-user / multi-tenant connector management (single operator persona).
- The unified login page (delivered by `019-unified-login-page`).
- Any proto, gRPC, or backend service changes.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-ui` — new `/accounts` segment with a "My Authorized Apps" page/component(s); reads the agent public URL from an env var (`AGENT_PUBLIC_URL`), renders the copyable MCP URL + Claude.ai instructions, and adds a server-side BFF route that probes the agent's `/.well-known/oauth-protected-resource` for the health indicator (FR-8). No backend service is modified.

## Proto Contract Changes

- [x] No proto changes required — this is a presentational UI surface over existing OAuth metadata.

## Config Key Changes

- [x] No new config keys — reuses `AGENT_PUBLIC_URL` (established by feature 049) for the agent public base URL. To be confirmed at `/sdd-spec`: if the value should be live-tunable it would instead become an `xstockstrat-config` key (`ui.<category>.<key>`).

## Database Changes

- [x] No schema changes.

## Feature Workflow Notes

Branch to create: `feature/auth2-authorized-apps-ui` (branch from `main-dev`)
**Dependency:** `049-unify-admin-auth-gates` Part B must be merged first (provides the agent OAuth 2.1 endpoints + `AGENT_PUBLIC_URL`). Track in `docs/roadmap/features/merge-order.md` at /sdd-spec time.
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (`xstockstrat-ui`) — non-breaking, UI-only change
- [ ] Security review — confirm no secrets rendered, connect-URL construction is safe

## Acceptance Criteria

1. An authenticated operator can navigate to the new `/accounts` segment's "My Authorized Apps" page in `xstockstrat-ui` and see the Claude.ai connector entry with the agent's MCP server URL and copy/paste instructions.
2. The MCP server URL field can be copied to the clipboard with one click.
3. The displayed URL is the value of `AGENT_PUBLIC_URL` (sourced from env, not hardcoded); the page renders no API keys or secrets.
4. The page shows a reachable/unreachable health indicator driven by the BFF probe of `${AGENT_PUBLIC_URL}/.well-known/oauth-protected-resource`; when the agent is up the indicator reads reachable, and when the probe fails the page still renders the URL (graceful degradation).
5. The `/accounts/authorized-apps` page is unreachable without authentication (redirects to login), consistent with other `xstockstrat-ui` pages (the `/accounts` segment is in the protected-route matcher).

## Open Questions

- [x] How does Claude.ai accept a custom MCP connector? **Resolved** (user, 2026-06-07): no in-app deep link — the page shows the copyable URL + instructions to paste it in Claude.ai Settings → Connectors. FR-2 reflects this (copy-URL only, no button).
- [x] Which segment/nav hosts this? **Resolved** (user, 2026-06-07): a **new "Accounts" segment** with a "My Authorized Apps" page (`/accounts/authorized-apps`) — not config-ui.
- [x] Should the agent public URL be an env var or a live config key? **Resolved**: reuse `AGENT_PUBLIC_URL` (established by feature 049). Env var unless live tuning becomes necessary.
- [x] Should the page show connection/health status? **Resolved** (user, 2026-06-07): yes — include a health probe via a UI BFF route (FR-8).
- [x] Confirm 049 Part B merges before this executes. **Resolved**: hard dependency recorded in Feature Workflow Notes; to be added to `merge-order.md` at `/sdd-spec` time.
