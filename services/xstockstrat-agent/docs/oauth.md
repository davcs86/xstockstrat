# xstockstrat-agent — OAuth 2.1 Edge Auth

Detail moved here from `CLAUDE.md` (feature 049 Part B). Read this when touching the agent's OAuth
flow, routes, or discovery metadata.

The agent is the OAuth 2.1 **Resource Server + Authorization-Server HTTP facade** for its MCP
endpoint, and is **stateless**: all durable OAuth state (clients, auth codes, refresh tokens) lives
in `xstockstrat-identity` and is reached over gRPC (`app/client.py`). The only cross-request linkage
is the HMAC-signed `txn` blob carried in URLs (`app/oauth_server.py`, signed with `MCP_AGENT_SECRET`),
so there is **no in-memory store** and `instance_count > 1` is safe (FR-B13).

## Routes

Registered in `app/main.py` `build_http_app`:

| Route | Purpose |
|---|---|
| `/.well-known/oauth-protected-resource` | RFC 9728 protected-resource metadata |
| `/.well-known/oauth-authorization-server` | RFC 8414 authorization-server metadata |
| `POST /oauth/register` | RFC 7591 Dynamic Client Registration (public client, https-only) |
| `GET /oauth/authorize` | PKCE/S256 + exact-redirect validation; delegates login to the UI |
| `GET /oauth/callback` | Derives user from the same-origin `access_token` cookie; mints the code |
| `POST /oauth/token` | `authorization_code` + `refresh_token` grants (tokens in JSON body only) |
| `/` (GET/POST) | **Streamable HTTP** MCP endpoint (Claude.ai remote connector) |
| `/sse` + `/messages` | **Removed** (feature 079) — return `404 text/plain` naming the replacement URL, *before* the auth gate |
| `GET /api/tools` | Tool catalog (name/description/inputSchema) — **unauthenticated**, capability metadata only; powers the `xstockstrat-ui` `/accounts/mcp-tools` page |

## `aud` binding and discovery path insertion

The MCP endpoint (root Streamable HTTP) requires an **`aud`-bound JWT** (`aud` ==
`AGENT_PUBLIC_URL`); unauthenticated requests get `401` with a
`WWW-Authenticate: Bearer resource_metadata=…` discovery pointer.

**RFC 8414/9728 path insertion quirk**: because `AGENT_PUBLIC_URL` has a path (`/agent`),
spec-compliant clients fetch the AS/PR metadata at
`https://<host>/.well-known/oauth-authorization-server/agent`, which lands on `xstockstrat-ui` (the
`/` catch-all), so the UI also serves that canonical metadata (UI `next.config.js` rewrites →
`/api/oauth/*`). `AGENT_PUBLIC_URL` builds all absolute discovery/endpoint URLs (in DO it is
`${APP_URL}/agent`).
