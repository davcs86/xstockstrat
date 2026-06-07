# Product Spec: auth2-authorized-apps-ui

**Created**: 2026-06-07

---

## Problem Statement

Feature `018-agent-mcp-oauth` made `xstockstrat-agent` a fully OAuth 2.1-capable remote MCP server, but there is no in-product way to discover how to connect it. Today an operator must know the agent's `/.well-known/oauth-authorization-server` URL by heart and hand-assemble the connector entry in Claude.ai. Operators want a button or copyable URL inside their own web app (`xstockstrat-ui`) that gets them to a connected Claude.ai in one step.

## User Story

As an operator, I want to see a "Connect Claude.ai" button (and the underlying MCP server URL) inside the xstockstrat web app, so that I can add xstockstrat-agent as a remote MCP connector in Claude.ai without manually constructing OAuth URLs.

## Functional Requirements

FR-1. `xstockstrat-ui` adds an "Authorized Apps" view (e.g. under the config-ui segment, or a dedicated `/config-ui/authorized-apps` route) reachable from the existing authenticated navigation.

FR-2. The view displays a primary "Connect Claude.ai" action that takes the operator to Claude.ai's "Connect apps" / add-connector flow pre-filled with (or accompanied by) the xstockstrat-agent MCP server URL.

FR-3. The view displays the agent's public MCP server URL (the base used by Claude.ai for OAuth discovery, i.e. the host serving `/.well-known/oauth-authorization-server`) as a read-only, copy-to-clipboard field, so operators who prefer to paste it manually can do so.

FR-4. The agent's public base URL is provided to the UI via an environment variable (no hardcoded URLs in source, per platform config governance). The exact var name and whether a config key is also needed is to be finalized at `/sdd-spec` time — candidate: `AGENT_PUBLIC_URL` (an `_ENDPOINT` suffix is not appropriate here because this is a browser-facing HTTPS URL, not a gRPC `host:port`).

FR-5. The view renders only OAuth/connection metadata (URLs, status). It MUST NOT render any API keys, JWTs, client secrets, or other secret values (per `xstockstrat-ui` review focus).

FR-6. The view is gated behind the existing `xstockstrat-ui` JWT auth/middleware like all other authenticated pages; unauthenticated users are redirected to login.

FR-7. The page provides brief inline guidance (1–3 sentences) describing what connecting Claude.ai does and what the operator will be asked to authorize, linking to the OAuth flow surfaced by feature 018.

## Out of Scope

- Building or changing the OAuth server itself (delivered by `018-agent-mcp-oauth`).
- Listing, auditing, or revoking previously authorized OAuth clients/tokens (no revocation endpoint exists — see 018 Out of Scope). Could be a follow-up feature.
- Per-user / multi-tenant connector management (single operator persona).
- The unified login page (delivered by `019-unified-login-page`).
- Any proto, gRPC, or backend service changes.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-ui` — new "Authorized Apps" route/component(s) in the config-ui segment; reads the agent public URL from an env var and renders the connect button + copyable URL.

## Proto Contract Changes

- [x] No proto changes required — this is a presentational UI surface over existing OAuth metadata.

## Config Key Changes

- [x] No new config keys (tentative) — the agent public URL is expected to come from an environment variable (FR-4). To be confirmed at `/sdd-spec`: if the value should be live-tunable it would instead become an `xstockstrat-config` key (`ui.<category>.<key>`).

## Database Changes

- [x] No schema changes.

## Feature Workflow Notes

Branch to create: `feature/auth2-authorized-apps-ui` (branch from `main-dev`)
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
- [ ] Should the agent public URL be an env var (FR-4) or a live `xstockstrat-config` key? Recommended: env var unless live tuning is needed.
- [ ] Should the page show connection/health status of the agent's OAuth discovery endpoint, or just the static URL? (Status is a nice-to-have, possibly defer.)
