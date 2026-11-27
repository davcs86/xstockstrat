# xstockstrat-agent — OAuth 2.1 Edge Auth

Detail moved here from `CLAUDE.md` (feature 049 Part B). Read this when touching the agent's OAuth
flow, routes, or discovery metadata.

The agent is the OAuth 2.1 **Resource Server + Authorization-Server HTTP facade** for its MCP
endpoint, and is **stateless**: all durable OAuth state (clients, auth codes, refresh tokens) lives
in `xstockstrat-identity` and is reached over gRPC (`app/client.py`). The only cross-request linkage
is the HMAC-signed `txn` blob carried in URLs (`app/oauth_server.py`, signed with `JWT_SECRET` since
feature 147, which removed the dedicated `MCP_AGENT_SECRET`), so there is **no in-memory store** and
`instance_count > 1` is safe (FR-B13).

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

## `oidc` mode (feature 345)

In `identity` / `auth.mode` `oidc` the agent is a resource server for the issuer in `agent` / `oidc.issuer`
(`app/main.py#_handle_oidc` → `app/sso_auth.py#authenticate`); the table above applies in `local` and `both`.

- **Legacy routes**: `/.well-known/oauth-authorization-server` and the four `/oauth/*` routes stay registered but answer
  `404 text/plain` (`_legacy_only`); an identity-minted token gets `401`.
- **PRM by mode**: `local`/`both` → today's document; `oidc` → `{resource: AGENT_PUBLIC_URL, authorization_servers:
  [<issuer>], scopes_supported}`, or `503 text/plain no-store` while the issuer is invalid or empty
  (`app/oauth_metadata.py`). The UI's `/.well-known/oauth-protected-resource/agent` copy follows the same rule.
- **Token checks**: header `kid`, an RS/PS/ES `alg`, `typ` `at+jwt`, `iss` == the issuer, then the signature on a key
  from a JWKS fetched within `_JWKS_MAX_AGE_S` (3600 s, no stale grace), `aud` == `AGENT_PUBLIC_URL` (string or
  one-element list), unexpired `exp`, non-empty `sub`; then `ResolveExternalIdentity` (60 s success-only cache), all
  inside one `client.rpc_timeout_s()` budget.
- **Statuses**: `401` + `WWW-Authenticate` pointer for a missing or invalid token (`wrong_audience`, `invalid_token`);
  `403 text/plain` `not linked` / `account inactive`; `503` without `WWW-Authenticate` for `jwks_unavailable`,
  `identity_unavailable`, an invalid issuer, or an unexpected Resolve refusal.

## `aud` binding and discovery path insertion

The MCP endpoint (root Streamable HTTP) requires an **`aud`-bound JWT** (`aud` ==
`AGENT_PUBLIC_URL`); unauthenticated requests get `401` with a
`WWW-Authenticate: Bearer resource_metadata=…` discovery pointer. If identity cannot be reached in
time during token validation, the endpoint returns `503` **without** `WWW-Authenticate`, so the
client retries instead of re-authorizing; an invalid token still returns `401` with the pointer.

**RFC 8414/9728 path insertion quirk**: because `AGENT_PUBLIC_URL` has a path (`/agent`),
spec-compliant clients fetch the AS/PR metadata at
`https://<host>/.well-known/oauth-authorization-server/agent`, which lands on `xstockstrat-ui` (the
`/` catch-all), so the UI also serves that canonical metadata (UI `next.config.js` rewrites →
`/api/oauth/*`). `AGENT_PUBLIC_URL` builds all absolute discovery/endpoint URLs (in DO it is
`${APP_URL}/agent`).
