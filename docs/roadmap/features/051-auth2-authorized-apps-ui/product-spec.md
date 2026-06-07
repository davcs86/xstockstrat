# Product Spec: auth2-authorized-apps-ui

**Created**: 2026-06-07

---

## Problem Statement

Feature `049-unify-admin-auth-gates` (Part B — which supersedes and re-specs `018-agent-mcp-oauth`) makes `xstockstrat-agent` a fully OAuth 2.1-capable remote MCP server: RFC 9728/8414 discovery, `401 + WWW-Authenticate` trigger, RFC 7591 dynamic client registration, PKCE, audience-bound JWTs, and login delegated to the UI's `/auth/oauth-login` page. But there is no in-product way to *discover how to connect*. Today an operator must know the agent's public MCP URL (the host serving `/.well-known/oauth-protected-resource`) by heart and hand-assemble the connector entry in Claude.ai. Operators want a button or copyable URL inside their own web app (`xstockstrat-ui`) that gets them to a connected Claude.ai in one step.

**Dependency:** this feature is the operator-facing front door to the OAuth 2.1 flow built in `049-unify-admin-auth-gates`. It should be specced/executed after 049 Part B lands (the agent must actually serve the OAuth discovery endpoints and `AGENT_PUBLIC_URL` must be defined). 049 completes the `/auth/oauth-login` *login delegation* page; this feature adds the separate operator-facing *connect/discovery* page — they do not overlap.

## User Story

As an operator, I want to see a "Connect Claude.ai" button (and the underlying MCP server URL) inside the xstockstrat web app, so that I can add xstockstrat-agent as a remote MCP connector in Claude.ai without manually constructing OAuth URLs.

## Functional Requirements

FR-1. `xstockstrat-ui` adds an "Authorized Apps" view (e.g. under the config-ui segment, or a dedicated `/config-ui/authorized-apps` route) reachable from the existing authenticated navigation.

FR-2. The view displays a primary "Connect Claude.ai" action that takes the operator to Claude.ai's "Connect apps" / add-connector flow pre-filled with (or accompanied by) the xstockstrat-agent MCP server URL.

FR-3. The view displays the agent's public MCP server URL (the base Claude.ai uses for OAuth discovery, i.e. the host serving `/.well-known/oauth-protected-resource` / `/.well-known/oauth-authorization-server`) as a read-only, copy-to-clipboard field, so operators who prefer to paste it manually can do so.

FR-4. The agent's public base URL is provided to the UI via an environment variable (no hardcoded URLs in source, per platform config governance). Feature 049 already establishes **`AGENT_PUBLIC_URL`** as the canonical agent public base URL (FR-B2/FR-B12); this feature reuses that same value rather than inventing a new var. (An `_ENDPOINT` suffix is not appropriate here — this is a browser-facing HTTPS URL, not a gRPC `host:port`.) Whether the UI receives it as its own env var or via a small BFF route is a `/sdd-spec` detail.

FR-5. The view renders only OAuth/connection metadata (URLs, status). It MUST NOT render any API keys, JWTs, client secrets, or other secret values (per `xstockstrat-ui` review focus).

FR-6. The view is gated behind the existing `xstockstrat-ui` JWT auth/middleware like all other authenticated pages; unauthenticated users are redirected to login.

FR-7. The page provides brief inline guidance (1–3 sentences) describing what connecting Claude.ai does and what the operator will be asked to authorize (the OAuth 2.1 consent/login delivered by feature 049).

## Out of Scope

- Building or changing the OAuth server itself (delivered by `049-unify-admin-auth-gates` Part B).
- The OAuth *login delegation* page `/auth/oauth-login` (completed by feature 049) — this feature adds a distinct operator-facing *connect/discovery* page.
- Listing, auditing, or revoking previously authorized OAuth clients/tokens (no revocation endpoint exists — see 049 Out of Scope, RFC 7009 excluded). Could be a follow-up feature.
- Per-user / multi-tenant connector management (single operator persona).
- The unified login page (delivered by `019-unified-login-page`).
- Any proto, gRPC, or backend service changes.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-ui` — new "Authorized Apps" route/component(s) in the config-ui segment; reads the agent public URL from an env var and renders the connect button + copyable URL.

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

1. An authenticated operator can navigate to the "Authorized Apps" view in `xstockstrat-ui` and see a "Connect Claude.ai" button plus the agent's MCP server URL.
2. Clicking the button takes the operator into Claude.ai's add-connector / OAuth flow for xstockstrat-agent.
3. The MCP server URL field can be copied to the clipboard with one click.
4. The agent base URL is sourced from configuration/env, not hardcoded; the page renders no API keys or secrets.
5. The view is unreachable without authentication (redirects to login), consistent with other `xstockstrat-ui` pages.

## Open Questions

- [ ] What is the exact Claude.ai deep link for "Connect apps" (does it accept a prefilled MCP server URL query param, or does the operator paste the URL into Claude.ai)? If no deep link exists, FR-2 degrades to "open Claude.ai connectors page + copy URL".
- [ ] Which segment/nav should host this — config-ui (operator/admin settings) or a new top-level "Apps" area? Recommended: config-ui.
- [x] Should the agent public URL be an env var or a live config key? **Resolved**: reuse `AGENT_PUBLIC_URL` (established by feature 049). Env var unless live tuning becomes necessary.
- [ ] Should the page show connection/health status of the agent's OAuth discovery endpoint (e.g. probe `/.well-known/oauth-protected-resource`), or just the static URL? (Status is a nice-to-have, possibly defer.)
- [ ] Confirm 049 Part B will have merged before this is executed (hard dependency on the agent OAuth endpoints existing).
