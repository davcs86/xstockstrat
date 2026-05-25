# Product Spec: agent-mcp-oauth

**Created**: 2026-05-25

---

## Problem Statement

The current `xstockstrat-agent` SSE transport accepts API keys via `Authorization: Bearer` header or `?api_key=` query parameter. Claude.ai's remote MCP "Connect apps" integration uses OAuth 2.0 Authorization Code flow and cannot use either approach without operator workarounds. As a result, operators cannot add xstockstrat-agent as a production remote MCP server through claude.ai's standard UI.

## User Story

As an operator, I want to add xstockstrat-agent as a remote MCP server in Claude.ai's "Connect apps" interface using OAuth 2.0, so that I can authenticate securely without embedding raw API keys in URLs or relying on the Claude Desktop stdio transport.

## Functional Requirements

FR-1. The agent exposes an OAuth 2.0 Authorization Server Metadata document at `GET /.well-known/oauth-authorization-server` conforming to RFC 8414.

FR-2. The agent exposes an authorization endpoint (`GET /oauth/authorize`) that validates the `client_id`, `redirect_uri`, `state`, and `code_challenge` (PKCE, S256) parameters and redirects the user to `xstockstrat-identity` for authentication.

FR-3. The agent exposes a token endpoint (`POST /oauth/token`) that accepts an authorization code, verifies the PKCE `code_verifier`, exchanges the code for an xstockstrat identity API key, and returns a standard OAuth token response (`access_token`, `token_type: Bearer`, `expires_in`).

FR-4. The access token returned by the token endpoint is a valid xstockstrat API key that passes through the existing `validate_api_key` gRPC call to `xstockstrat-identity`. No separate token store is required.

FR-5. The existing `Authorization: Bearer <api_key>` header and `?api_key=` query-parameter auth paths remain fully supported and are not removed.

FR-6. The `claude_mcp_config.json` `xstockstrat-sse-nginx` entry is updated to document the OAuth flow as the recommended production auth method.

FR-7. The OAuth `client_id` is a configurable value (config key `agent.oauth.client_id`); the default is `xstockstrat-agent`. Redirect URIs are validated against a configurable allowlist (`agent.oauth.allowed_redirect_uris`).

FR-8. Authorization codes are short-lived (60 seconds), single-use, stored in-memory, and bound to the PKCE challenge. No database is required.

## Out of Scope

- Refresh token issuance (access tokens expire with the underlying API key TTL)
- Token revocation endpoint
- Multi-tenant or multi-user OAuth (single operator persona)
- OpenID Connect (OIDC) / ID tokens
- Client credential or implicit flows

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-agent` — new OAuth endpoints added to the Starlette ASGI app
- `xstockstrat-identity` — consulted for API key validation (existing `ValidateApiKey` RPC); no changes required to identity itself

## Proto Contract Changes

- [x] No proto changes required — OAuth is an HTTP protocol; identity's existing `ValidateApiKey` RPC is sufficient.

## Config Key Changes

New keys to register in `xstockstrat-config` (namespace `agent`):
- `agent.oauth.client_id` — string, default `xstockstrat-agent`
- `agent.oauth.allowed_redirect_uris` — string (comma-separated), default empty (any `https://` URI accepted)

## Database Changes

- [x] No schema changes — authorization codes stored in-memory with TTL.

## Feature Workflow Notes

Branch to create: `feature/agent-mcp-oauth` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking change to xstockstrat-agent; no proto changes)
- [ ] Security review — OAuth redirect URI validation, PKCE enforcement, code expiry

## Acceptance Criteria

1. `GET /.well-known/oauth-authorization-server` returns a valid RFC 8414 metadata document with `authorization_endpoint`, `token_endpoint`, and `code_challenge_methods_supported: ["S256"]`.
2. Claude.ai "Connect apps" flow completes end-to-end: user is redirected to identity login, code is issued, token is exchanged, SSE connection is authenticated.
3. Existing `?api_key=` and `Authorization: Bearer` auth paths continue to pass all Step 10 unit tests unchanged.
4. Authorization codes expire after 60 seconds and cannot be reused.
5. Requests with an invalid `redirect_uri` (not matching the allowlist when configured) are rejected with `400 Bad Request`.

## Open Questions

- [ ] Does `xstockstrat-identity` need a UI login page to complete the OAuth redirect, or can the operator pre-authenticate and provide a code directly? (Affects whether a login form is in scope for this feature or a follow-up.)
- [ ] Should the in-memory code store be replaced with a Redis/DB store if the agent runs with `instance_count > 1` on DO? (Currently instance_count: 1, so in-memory is safe.)
