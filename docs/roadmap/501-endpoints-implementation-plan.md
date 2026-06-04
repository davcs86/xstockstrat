# Plan: Implement the remaining "501 Not Implemented" endpoints

**Author:** platform (via Claude Code session)
**Date:** 2026-06-04
**Status:** proposal — for review before execution

---

## 1. What "501" means in this platform

The `xstockstrat-ui` BFF maps gRPC status codes to HTTP for the browser. The only mapping that
produces **HTTP 501 (Not Implemented)** is gRPC `Code.Unimplemented` (code 16):

```ts
// services/xstockstrat-ui/src/lib/connectClients.ts:57
case Code.Unimplemented:
  return 501;
```

A backend RPC returns `Unimplemented` only when a method declared in a `.proto` is **not
overridden** in the service handler and falls through to the generated
`Unimplemented<Service>Server` / `Unimplemented<Service>Handler` embed (Go), the
`NotImplementedError` stub (Python), or is simply absent from the Node.js service router.

## 2. Audit result: backend gRPC surface is 100% implemented

I cross-referenced every `rpc` declared in `packages/proto/<svc>/v1/*.proto` against its handler
implementation across all 10 backend services. **All 61 declared RPCs are implemented** — there
are no methods that fall through to the `Unimplemented*` embeds at runtime.

| Service | RPCs | Implemented | Missing/Stub |
|---|---|---|---|
| xstockstrat-trading | 8 | 8 | 0 |
| xstockstrat-portfolio | 7 | 7 | 0 |
| xstockstrat-marketdata | 6 | 6 | 0 |
| xstockstrat-indicators | 8 | 8 | 0 |
| xstockstrat-ingest | 8 | 8 | 0 |
| xstockstrat-analysis | 4 | 4 | 0 |
| xstockstrat-ledger | 4 | 4 | 0 |
| xstockstrat-identity | 8 | 8 | 0 |
| xstockstrat-notify | 4 | 4 | 0 |
| xstockstrat-config | 4 | 4 | 0 |
| **Total** | **61** | **61** | **0** |

**Conclusion:** No gRPC endpoint currently returns 501. The genuinely *unimplemented* endpoints
are HTTP endpoints that were specced but never built — the **OAuth 2.0 flow for the MCP agent**.

## 3. The actual unimplemented endpoints

These come from feature **`018-agent-mcp-oauth`**, which reached lifecycle status
`implementation-ready` (impl-spec written, 7 steps) but was **never executed**. Its follow-up,
feature **`019-unified-login-page`**, *did* land (`launched` 2026-06-04) and deliberately left a
wiring stub behind for 018:

```python
# services/xstockstrat-agent/app/main.py:28
# TODO(019): when feature 018's /oauth/authorize handler lands, redirect the browser to
# f"{UI_BASE_URL}/auth/oauth-login?redirect_uri={redirect_uri}&state={state}" instead of the
# old identity HTTP login URL.
```

The endpoints that need to be implemented on `xstockstrat-agent` (Starlette ASGI app, SSE mode):

| # | Endpoint | Purpose | Status today |
|---|---|---|---|
| E1 | `GET /.well-known/oauth-authorization-server` | RFC 8414 metadata discovery for Claude.ai Connect apps | **missing** |
| E2 | `GET /oauth/authorize` | Validate `client_id`/`redirect_uri`/PKCE; bounce browser to the unified login page | **missing** |
| E3 | `GET /oauth/callback` | Receive the authenticated browser back from the UI; mint API key; issue auth code; redirect to client | **missing** (new — see §4) |
| E4 | `POST /oauth/token` | PKCE `code_verifier` check; exchange auth code → xstockstrat API key as `access_token` | **missing** |

The UI side already exists and is live: `services/xstockstrat-ui/src/app/auth/oauth-login/page.tsx`
(`/auth/oauth-login`) plus `UI_BASE_URL` wired into the agent's env in `docker-compose.yml`,
`.do/app.yaml`, and `.do/app.dev.yaml`.

## 4. Why the 018 impl-spec is stale and must be revised before execution

The 018 implementation spec was authored 2026-05-25, **before** two architectural changes landed.
Executing it verbatim would reintroduce removed patterns. The required reconciliations:

### 4a. nginx is gone (feature 045)
- **018 Step 5** ("Nginx routing for OAuth endpoints", edits `nginx.conf`) is **obsolete**. nginx
  was removed by feature `045-ui-consolidation-nextjs`. Routing is now DO App Platform path rules:
  `/agent` → `xstockstrat-agent`, `/` → `xstockstrat-ui`.
- **Impact on E1:** Claude.ai requires `/.well-known/oauth-authorization-server` at the **domain
  root**, but the agent is served under `/agent`. We must either (a) add a root-level DO path rule
  that maps `/.well-known/oauth-authorization-server` to the agent, or (b) have the UI serve/proxy
  the well-known document. The metadata document's `authorization_endpoint` / `token_endpoint`
  values are absolute URLs built from `AGENT_PUBLIC_URL`, so they can point at `/agent/oauth/*`.
  **Recommended: option (a)** — one DO route rule, no UI code. Confirm DO App Platform allows a
  more-specific path rule for the well-known path ahead of the `/` catch-all.

### 4b. Backends are gRPC-only (no HTTP/Connect-RPC 80xx ports)
- **018 Steps 2 & 3** call identity's `AuthenticateUser` / `CreateApiKey` over **HTTP Connect-RPC**
  on `IDENTITY_HTTP_ENDPOINT` (port 8058). That port no longer exists. Per root CLAUDE.md,
  `<SERVICE>_HTTP_ENDPOINT` is removed and must not be reintroduced.
- **Replacement:** the agent already speaks gRPC to identity (`app/auth.py` uses
  `IdentityServiceStub.ValidateApiKey`). Reuse `IDENTITY_ENDPOINT` (gRPC `host:port`) and call
  `CreateApiKey` (and, if needed, `ValidateToken`) over gRPC. **Do not add `IDENTITY_HTTP_ENDPOINT`
  or `AGENT`-HTTP vars.**

### 4c. The agent must not serve its own login form (feature 019)
- **018 FR-9 / Step 2** had the agent render its own HTML login form and POST credentials. Feature
  019 replaced that with the shared `/auth/oauth-login` page in `xstockstrat-ui`. The agent now
  **redirects the browser** to `{UI_BASE_URL}/auth/oauth-login?...` instead.

### 4d. The login page needs to hand control back to the agent (the missing `code`)
- The live `/auth/oauth-login` page currently authenticates (POST `/api/auth/login`, sets the
  platform JWT cookie) and then redirects straight to `redirect_uri?state=...` **with no
  authorization `code`**. That is fine as a placeholder but is **not** a complete OAuth Authorization
  Code flow — the client (Claude.ai) needs a `code` to exchange at `/oauth/token`.
- **Fix:** the agent's `GET /oauth/authorize` must pass **its own callback** as the
  `redirect_uri` it hands to the UI login page (not the client's `redirect_uri`). After login, the
  browser lands on the agent's `GET /oauth/callback` (E3), where the agent mints the API key and
  issues the short-lived code, then 302s to the **client's** original `redirect_uri?code=...&state=...`.
  Because the consolidated app and the agent share one public domain and the JWT cookie is
  `path: '/'`, the browser sends the platform JWT cookie to `/agent/oauth/callback`, so the agent
  can resolve the authenticated user via identity `ValidateToken` and then call `CreateApiKey`.

> Net effect: 018's 7-step plan becomes the revised 8-step plan below. The PKCE store (018 Step 1),
> token endpoint (018 Step 3), config keys (018 Step 4), docs (018 Step 6), and tests (018 Step 7)
> carry over largely unchanged; 018 Step 2 splits into authorize+callback; 018 Step 5 (nginx) is
> replaced by a DO routing step.

## 5. Revised implementation plan

All code lives in `xstockstrat-agent` unless noted. No proto changes, no DB migrations.

### Step 1 — OAuth in-memory authorization-code store
- **Create** `services/xstockstrat-agent/app/oauth_store.py`.
- `AuthCode` dataclass: `code`, `client_id`, `redirect_uri`, `code_challenge` (S256, raw),
  `api_key` (the minted xstockstrat API key), `expires_at` (`time.monotonic()+60`), `used=False`.
- `async issue_code(client_id, redirect_uri, code_challenge, api_key) -> str` →
  `secrets.token_urlsafe(32)`.
- `async consume_code(code, code_verifier) -> AuthCode | None`: enforce single-use, 60s TTL, and
  PKCE S256 (`base64.urlsafe_b64encode(sha256(verifier)).rstrip("=") == code_challenge`).
- `async _cleanup_expired()` background sweep (60s).
- Stdlib only (`secrets`, `hashlib`, `base64`, `asyncio`). Module-level singleton dict — safe at
  `instance_count: 1` (a Redis store is the documented future scaling path).

### Step 2 — Metadata + authorize endpoints
- **Create** `services/xstockstrat-agent/app/oauth_routes.py`:
  - `oauth_metadata(request)` (E1): JSON from RFC 8414 using `AGENT_PUBLIC_URL`:
    `issuer`, `authorization_endpoint`, `token_endpoint`, `response_types_supported:["code"]`,
    `code_challenge_methods_supported:["S256"]`, `grant_types_supported:["authorization_code"]`.
  - `oauth_authorize(request)` (E2, GET): validate `response_type=code`,
    `code_challenge_method=S256`, `client_id` (vs `agent.oauth.client_id`, default
    `xstockstrat-agent`), and `redirect_uri` (vs `agent.oauth.allowed_redirect_uris`; empty ⇒
    require `https://`). On success, **302 to**
    `{UI_BASE_URL}/auth/oauth-login?redirect_uri={AGENT_PUBLIC_URL}/oauth/callback&state={opaque}`
    where `{opaque}` is a signed/opaque handle the agent stores mapping back to the original
    `client_id` + client `redirect_uri` + client `state` + `code_challenge`. (Reuse the store or a
    sibling short-TTL dict for this "pending authorization" record.)
- **Modify** `services/xstockstrat-agent/app/main.py`: append routes to the `Starlette(...)` list
  in `_run_sse()` and replace the `TODO(019)` comment with the real redirect.

### Step 3 — OAuth callback endpoint (new)
- Add `oauth_callback(request)` (E3, GET) to `oauth_routes.py`:
  - Look up the pending-authorization record by the returned `state` handle; 400 if unknown/expired.
  - Read the platform JWT from the request cookie; call identity `ValidateToken` (gRPC) to confirm
    the browser is authenticated and resolve the user. If invalid, 302 back to `/auth/oauth-login`.
  - Call identity `CreateApiKey` (gRPC) → mint an API key scoped for MCP use.
  - `issue_code(client_id, client_redirect_uri, code_challenge, api_key)`.
  - 302 to the **client's** `redirect_uri?code=<code>&state=<client_state>`.
- Reuse `IDENTITY_ENDPOINT` (gRPC). Header propagation per `docs/patterns/header-propagation.md`.

### Step 4 — Token endpoint
- Add `oauth_token(request)` (E4, POST form-urlencoded) to `oauth_routes.py`:
  - Require `grant_type=authorization_code` (else `unsupported_grant_type`/400).
  - `entry = consume_code(code, code_verifier)`; `None` ⇒ `invalid_grant`/400 (covers unknown,
    used, expired, PKCE mismatch).
  - Verify `redirect_uri`==`entry.redirect_uri` (`invalid_grant`) and `client_id`==`entry.client_id`
    (`invalid_client`).
  - Return `{"access_token": entry.api_key, "token_type": "Bearer", "expires_in": 3600}`.
- The `access_token` IS a valid xstockstrat API key, so the existing `validate_api_key` SSE path
  (`app/auth.py`) accepts it unchanged — **FR-4, FR-5 preserved**.

### Step 5 — Config keys
- Register in `xstockstrat-config` (namespace `agent`) via `SetConfig`:
  `agent.oauth.client_id` (string, default `xstockstrat-agent`),
  `agent.oauth.allowed_redirect_uris` (comma-separated, default empty ⇒ any `https://`).
- Document both in `docs/patterns/config-governance.md` and the agent's `CLAUDE.md` defaults table.

### Step 6 — Routing / deployment wiring (replaces 018 Step 5 nginx)
- **`.do/app.yaml` and `.do/app.dev.yaml`:** add a path rule mapping
  `/.well-known/oauth-authorization-server` → `xstockstrat-agent` (more specific than the `/`
  catch-all to `xstockstrat-ui`). Confirm DO App Platform honors the precedence.
- **Env vars:** ensure `AGENT_PUBLIC_URL` is set on the agent in all three deploy files
  (`docker-compose.yml`, `.do/app.yaml`, `.do/app.dev.yaml`). `UI_BASE_URL` is already wired (019).
  **Do not** add `IDENTITY_HTTP_ENDPOINT` (gRPC-only). Verify `IDENTITY_ENDPOINT` is present in the
  agent block (add if missing).

### Step 7 — Docs
- Update `services/xstockstrat-agent/claude_mcp_config.json`: keep the `?api_key=` SSE entry as the
  Claude-Desktop fallback; add an `xstockstrat-oauth` entry describing the Connect-apps flow.
- Add an `## OAuth 2.0 Remote Auth` section to `docs/runbooks/mcp-tools.md` (discovery URL, authorize/
  token paths, PKCE S256, `AGENT_PUBLIC_URL`, the two config keys, and the FR-5 note that
  `?api_key=` / `Authorization: Bearer` still work).

### Step 8 — Tests
- **Create** `services/xstockstrat-agent/tests/test_oauth.py` (pattern: `tests/test_auth.py`,
  `respx` for HTTP, `AsyncMock`/`patch` for gRPC):
  - store: issue→consume happy path, single-use, expiry, bad-verifier (PKCE).
  - metadata endpoint returns `code_challenge_methods_supported:["S256"]`.
  - authorize rejects non-`https` redirect_uri and wrong `client_id` (400).
  - callback: unauthenticated cookie → bounce; authenticated → 302 with `code`.
  - token: unknown code → `invalid_grant`/400; happy path → `access_token` present.
  - regression: `validate_api_key` still works for Bearer/`?api_key=` (FR-5).
- Keep agent coverage ≥ 40% (CI threshold).

## 6. End-to-end flow (target)

```
Claude.ai ──GET /agent/oauth/authorize?client_id&redirect_uri&state&code_challenge&S256
  agent: validate → store pending(handle) → 302
       └─> {UI_BASE_URL}/auth/oauth-login?redirect_uri={AGENT}/oauth/callback&state=handle
  user submits creds → UI POST /api/auth/login (identity AuthenticateUser, gRPC) → sets JWT cookie
       └─> 302 {AGENT}/oauth/callback?state=handle
  agent /oauth/callback: read JWT cookie → identity ValidateToken (gRPC) → CreateApiKey (gRPC)
       → issue_code(...) → 302 client redirect_uri?code&state(client)
Claude.ai ──POST /agent/oauth/token (grant_type, code, code_verifier, redirect_uri, client_id)
  agent: consume_code (PKCE) → {access_token=api_key, token_type:Bearer, expires_in:3600}
Claude.ai ──GET /agent/sse  (Authorization: Bearer <api_key>)  → validate_api_key → connected
```

## 7. Governance & gates (per feature 018 product-spec)

- Approvals: `xstockstrat-agent` owner + **Security review** (PKCE enforcement, redirect-URI
  allowlist, code expiry/single-use, no secrets in config state, minimal API-key scope).
- Branch: `feature/agent-mcp-oauth` from `main-dev`; per-step stacked PRs per SDD execute loop.
- No proto changes (OAuth is HTTP; identity's existing gRPC RPCs suffice).
- Update the 018 impl-spec Deviation Log + `context.md` to record the §4 reconciliations before
  `/sdd-execute` runs (the on-disk 018 Step 2/3/5 instructions are stale).

## 8. Open questions for review

1. **Well-known routing (4a):** add a DO root path rule to the agent, or have the UI serve the
   metadata doc? (Recommended: DO path rule — no app code.)
2. **API-key minting authority (3/4c):** confirm the agent may call `CreateApiKey` on behalf of the
   cookie-authenticated user via `ValidateToken`, vs. having the UI mint the key and pass a one-time
   handle to the agent callback. (Recommended: agent reads JWT cookie + `ValidateToken` — fewer
   moving parts, shared `path:'/'` cookie + single domain make it reliable.)
3. **Scaling:** in-memory code + pending-auth stores are `instance_count: 1` only. Acceptable for
   now (documented), or block on a Redis store?

## 9. Out of scope (unchanged from 018)

Refresh tokens, token revocation endpoint, multi-user OAuth, OIDC/ID tokens, client-credentials/
implicit flows.
