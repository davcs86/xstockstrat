# Implementation Spec: agent-mcp-oauth

**Status**: `pending`
**Created**: 2026-05-25
**Feature**: `docs/roadmap/features/018-agent-mcp-oauth/feature.md`
**Total Steps**: 7
**Feature Branch**: `feature/agent-mcp-oauth`

---

## Execution Summary

This feature adds OAuth 2.0 Authorization Code flow with PKCE to `xstockstrat-agent`. All new
code is confined to the agent service; no proto changes and no DB migrations are required. The
implementation order is: (1) add the in-memory OAuth store module, (2) add the three HTTP
endpoints (`/.well-known/oauth-authorization-server`, `GET /oauth/authorize`,
`POST /oauth/token`) by wiring them into the existing Starlette app in `app/main.py`, (3) add the
config key registration step in `xstockstrat-config`, (4) update `claude_mcp_config.json` and
`nginx.conf` to document and route the new flow, then (5) write unit tests. The nginx routing
step must come after the Starlette routing step so the paths to proxy are known.

## Step Dependencies

- Step 2 (service: Starlette routes) requires Step 1 (service: OAuth store module) — the store
  module is imported by the route handlers
- Step 3 (service: token exchange) requires Steps 1 and 2 — reuses the same store and auth
  module
- Step 4 (config) is independent — registers keys that Step 3 reads at runtime
- Step 5 (service: nginx routing) requires Step 2 and Step 3 — the paths to proxy must exist
- Step 6 (docs) is independent
- Step 7 (test) covers Steps 1–3

---

### Step 1 — service: OAuth in-memory authorization code store

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/oauth_store.py` — create

**Reviewers**: `xstockstrat-agent` owner — Auth flow correctness, backward compatibility with
query-param and Bearer header auth; Security — No secrets in config service state, JWT claims
minimal, API key scoping correct, OAuth redirect URI validation

**Codebase Evidence**:
- Confirmed agent uses only stdlib + listed pyproject.toml deps; no external PKCE library
  present. `hashlib`, `secrets`, `base64` are stdlib and available. Confirmed via:
  `grep -n "hashlib\|secrets\|hmac" services/xstockstrat-agent/app/*.py` → no matches (not yet
  imported; will be added here using stdlib only).
- Existing `IDENTITY_ENDPOINT` pattern at `services/xstockstrat-agent/app/auth.py:16` —
  same pattern used for new config reads.
- FR-8: codes are short-lived (60 s), single-use, bound to PKCE challenge — no DB needed.

**Instructions**:

Create `services/xstockstrat-agent/app/oauth_store.py` from scratch (not yet present —
confirmed via `find services/xstockstrat-agent -name "oauth_store.py"` → no output).

The module must:

1. Define a dataclass `AuthCode` with fields:
   - `code: str` — the random single-use code
   - `client_id: str`
   - `redirect_uri: str`
   - `code_challenge: str` — raw S256 challenge string stored as-is
   - `expires_at: float` — `time.monotonic()` + 60 seconds at creation
   - `used: bool = False`

2. Define module-level `_store: dict[str, AuthCode] = {}` and a `_lock: asyncio.Lock`.

3. Implement `async def issue_code(client_id: str, redirect_uri: str, code_challenge: str) -> str`:
   - Generate `code = secrets.token_urlsafe(32)`
   - Store `AuthCode(code, client_id, redirect_uri, code_challenge, time.monotonic() + 60)` in `_store[code]`
   - Return `code`

4. Implement `async def consume_code(code: str, code_verifier: str) -> AuthCode | None`:
   - Acquire `_lock`
   - Look up `_store.get(code)` — return `None` if absent
   - Return `None` if `entry.used` is `True` (single-use enforcement)
   - Return `None` if `time.monotonic() > entry.expires_at` (60 s TTL)
   - Verify PKCE S256: compute
     `base64.urlsafe_b64encode(hashlib.sha256(code_verifier.encode()).digest()).rstrip(b"=").decode()`
     and compare to `entry.code_challenge`; return `None` on mismatch
   - Mark `entry.used = True`, delete from `_store`, release lock
   - Return the `AuthCode` on success

5. Implement `async def _cleanup_expired() -> None` that removes expired entries from `_store`
   (called at startup in Step 2 on a background task with a 60 s interval).

**Verification**:
```bash
cd services/xstockstrat-agent && python -c "
import asyncio, app.oauth_store as s
async def run():
    code = await s.issue_code('xstockstrat-agent', 'https://claude.ai/callback', 'challenge')
    # valid consume
    import hashlib, base64
    verifier = 'challenge'  # for test only; real verifier != challenge
    # Use consume_code with a proper verifier that hashes to 'challenge'
    print('store created, code issued:', code[:8], '...')
asyncio.run(run())
"
```
Output should print `store created, code issued:` without error.

---

### Step 2 — service: OAuth metadata + authorization endpoints

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/oauth_routes.py` — create
- `services/xstockstrat-agent/app/main.py` — modify

**Reviewers**: `xstockstrat-agent` owner — Auth flow correctness, backward compatibility with
query-param and Bearer header auth; Security — OAuth redirect URI validation, PKCE enforcement

**Codebase Evidence**:
- Existing Starlette app construction at `services/xstockstrat-agent/app/main.py:75`:
  ```python
  starlette_app = Starlette(
      routes=[
          Route("/sse", endpoint=handle_sse),
          Mount("/messages", app=sse.handle_post_message),
      ]
  )
  ```
- New routes are appended to this list: `Route("/.well-known/oauth-authorization-server", ...)`,
  `Route("/oauth/authorize", ...)`.
- Existing `parse_qs` import at `main.py:56` (inside `handle_sse`) — same pattern used for
  query-string parsing in the new authorize handler.
- Config pattern: `get_config_value` at `services/xstockstrat-agent/app/client.py:47` — reuse
  for reading `agent.oauth.client_id` and `agent.oauth.allowed_redirect_uris`.
- `IDENTITY_HTTP_ENDPOINT` absent from agent `docker-compose.yml` agent block (confirmed:
  `grep -n IDENTITY_HTTP_ENDPOINT docker-compose.yml` → lines 408, 439, 462 are trader,
  insights, config-ui only). Must be added to the agent environment block.

**Instructions**:

**A. Create `services/xstockstrat-agent/app/oauth_routes.py`:**

This module exposes two Starlette ASGI-compatible endpoint functions:

1. `async def oauth_metadata(request) -> JSONResponse` — serves
   `GET /.well-known/oauth-authorization-server`. Reads `AGENT_PUBLIC_URL` env var (new;
   default `http://localhost:9000`) to build absolute endpoint URLs. Returns:
   ```json
   {
     "issuer": "<AGENT_PUBLIC_URL>",
     "authorization_endpoint": "<AGENT_PUBLIC_URL>/oauth/authorize",
     "token_endpoint": "<AGENT_PUBLIC_URL>/oauth/token",
     "response_types_supported": ["code"],
     "code_challenge_methods_supported": ["S256"],
     "grant_types_supported": ["authorization_code"]
   }
   ```

2. `async def oauth_authorize(request) -> Response` — handles `GET /oauth/authorize`:
   - Extract `client_id`, `redirect_uri`, `state`, `response_type`, `code_challenge`,
     `code_challenge_method` from `request.query_params`.
   - Validate `response_type == "code"` — return HTTP 400 if not.
   - Validate `code_challenge_method == "S256"` — return HTTP 400 if not.
   - Validate `client_id` against the configured value: call
     `await client.get_config_value("oauth.client_id")` — if the config key returns a value,
     compare it; if absent, use default `"xstockstrat-agent"`. Return HTTP 400 if mismatch.
   - Validate `redirect_uri` against allowed list: call
     `await client.get_config_value("oauth.allowed_redirect_uris")`. If the config value is
     set and non-empty, split on commas and compare `redirect_uri` against the list; reject with
     HTTP 400 if not present. If the config value is absent or empty, require that `redirect_uri`
     starts with `"https://"` (any HTTPS URI is accepted per FR-7); reject HTTP 400 if not.
   - If validations pass, serve a minimal HTML login form (inline HTML string, no template
     engine) containing hidden fields: `redirect_uri`, `state`, `code_challenge`, `client_id`.
     The form `action` is `POST /oauth/authorize` and the form contains `email` and `password`
     fields. **Rationale**: `xstockstrat-identity` has no standalone login UI
     (`services/xstockstrat-identity/src/index.ts` serves only Connect-RPC and a `/health`
     endpoint); the agent must serve its own minimal login form and call identity's
     `AuthenticateUser` Connect-RPC on POST.

3. `async def oauth_authorize_post(request) -> Response` — handles `POST /oauth/authorize`:
   - Parse form body: `email`, `password`, `redirect_uri`, `state`, `code_challenge`, `client_id`.
   - Re-validate `redirect_uri` and `client_id` using the same logic as the GET handler (to
     guard against CSRF / tampered hidden fields).
   - Call `xstockstrat-identity` `AuthenticateUser` via HTTP Connect-RPC:
     `POST http://<IDENTITY_HTTP_ENDPOINT>/xstockstrat.identity.v1.IdentityService/AuthenticateUser`
     with JSON body `{"email": email, "password": password}`. Use `httpx.AsyncClient` (already
     a dependency at `pyproject.toml:7`).
   - If auth fails (non-2xx), redirect back to the login form with `?error=invalid_credentials`.
   - On success, extract `access_token` from the identity response. This JWT will be used to
     create an API key for the OAuth access token. Call identity's `CreateApiKey` Connect-RPC:
     `POST http://<IDENTITY_HTTP_ENDPOINT>/xstockstrat.identity.v1.IdentityService/CreateApiKey`
     with header `Authorization: Bearer <access_token>` and JSON body
     `{"name": "mcp-oauth", "scopes": ["mcp"]}`. Extract the `api_key` from the response — this
     becomes the xstockstrat API key that will be returned as the OAuth `access_token`.
   - Call `await oauth_store.issue_code(client_id, redirect_uri, code_challenge)` to get `code`.
   - Redirect to `redirect_uri?code=<code>&state=<state>` (HTTP 302).
   - Read `IDENTITY_HTTP_ENDPOINT` from env (new var, default
     `http://xstockstrat-identity:8058`).

**B. Modify `services/xstockstrat-agent/app/main.py`:**

In `_run_sse()` (line 43), extend the `routes` list passed to `Starlette(...)` at line 75:

```python
from app.oauth_routes import oauth_metadata, oauth_authorize, oauth_authorize_post  # add

starlette_app = Starlette(
    routes=[
        Route("/sse", endpoint=handle_sse),
        Mount("/messages", app=sse.handle_post_message),
        Route("/.well-known/oauth-authorization-server", endpoint=oauth_metadata),
        Route("/oauth/authorize", endpoint=oauth_authorize, methods=["GET"]),
        Route("/oauth/authorize", endpoint=oauth_authorize_post, methods=["POST"]),
        # /oauth/token added in Step 3
    ]
)
```

**C. Add `IDENTITY_HTTP_ENDPOINT` and `AGENT_PUBLIC_URL` to deployment files:**

`IDENTITY_HTTP_ENDPOINT`:
- `docker-compose.yml`: add `IDENTITY_HTTP_ENDPOINT: http://xstockstrat-identity:8058` to the
  `xstockstrat-agent` `environment:` block (lines 515–524; confirmed absent: see grep above).
- `.do/app.dev.yaml`: add `- key: IDENTITY_HTTP_ENDPOINT` /
  `value: ${xstockstrat-identity.PRIVATE_URL}` to the `xstockstrat-agent` `envs:` block
  (lines 212–229; confirmed absent from agent block).
- `.do/app.yaml`: same entry in the `xstockstrat-agent` `envs:` block (lines 212–229;
  confirmed absent from agent block).

`AGENT_PUBLIC_URL` (used in metadata document to build absolute URLs):
- `docker-compose.yml`: add `AGENT_PUBLIC_URL: http://localhost:9000` to the
  `xstockstrat-agent` `environment:` block.
- `.do/app.dev.yaml` and `.do/app.yaml`: add `- key: AGENT_PUBLIC_URL` /
  `value: https://<your-do-app-domain>/agent` (placeholder — operator must set per environment).
  Use `type: GENERAL`, `scope: RUN_TIME`.

**Verification**:
```bash
# Start agent in SSE mode and confirm endpoints are present
curl -s http://localhost:9000/.well-known/oauth-authorization-server | python3 -m json.tool
# Expected: JSON with authorization_endpoint, token_endpoint, code_challenge_methods_supported
curl -v "http://localhost:9000/oauth/authorize?client_id=xstockstrat-agent&redirect_uri=https://claude.ai/callback&response_type=code&code_challenge=abc&code_challenge_method=S256&state=xyz"
# Expected: HTTP 200 with HTML login form containing hidden fields
curl -v "http://localhost:9000/oauth/authorize?client_id=xstockstrat-agent&redirect_uri=http://evil.example.com/cb&response_type=code&code_challenge=abc&code_challenge_method=S256&state=xyz"
# Expected: HTTP 400 (redirect_uri rejected — not https:// with default empty allowlist)
```

---

### Step 3 — service: OAuth token endpoint

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/oauth_routes.py` — modify (add token endpoint)
- `services/xstockstrat-agent/app/main.py` — modify (add `/oauth/token` route)

**Reviewers**: `xstockstrat-agent` owner — Auth flow correctness, backward compatibility with
query-param and Bearer header auth; Security — PKCE enforcement, code expiry, API key scoping

**Codebase Evidence**:
- `oauth_store.consume_code` defined in Step 1 — called here to verify PKCE and consume code.
- Identity's `ValidateApiKey` RPC at `services/xstockstrat-agent/app/auth.py:35-36` — the API
  key returned from `CreateApiKey` in Step 2 is a valid xstockstrat API key that passes this
  call (FR-4: no separate token store needed).
- Existing `parse_qs` pattern at `main.py:56` — token endpoint reads form-urlencoded body using
  the same stdlib approach.

**Instructions**:

**A. Add `oauth_token` handler to `services/xstockstrat-agent/app/oauth_routes.py`:**

```python
async def oauth_token(request) -> JSONResponse:
```

Handler for `POST /oauth/token`:
1. Parse `application/x-www-form-urlencoded` body. Required fields:
   `grant_type`, `code`, `redirect_uri`, `code_verifier`, `client_id`.
2. Validate `grant_type == "authorization_code"` — return `{"error": "unsupported_grant_type"}`
   with HTTP 400 if not.
3. Call `entry = await oauth_store.consume_code(code, code_verifier)`:
   - If `None` — return `{"error": "invalid_grant"}` with HTTP 400. This covers: unknown code,
     already-used code, expired code (> 60 s), and PKCE mismatch — all are `invalid_grant`.
4. Validate `redirect_uri` matches `entry.redirect_uri` exactly — return
   `{"error": "invalid_grant"}` HTTP 400 if not.
5. Validate `client_id` matches `entry.client_id` exactly — return
   `{"error": "invalid_client"}` HTTP 400 if not.
6. The `access_token` is the xstockstrat API key that was stored at code issuance time. In Step
   2's POST handler, the API key returned by `CreateApiKey` must be stored alongside the code.
   **Correction to Step 1 dataclass**: add `api_key: str` field to `AuthCode` (set at
   `issue_code` time by passing it as a parameter). Update `issue_code` signature to:
   `async def issue_code(client_id, redirect_uri, code_challenge, api_key) -> str`.
7. Return standard OAuth token response:
   ```json
   {
     "access_token": "<api_key from entry>",
     "token_type": "Bearer",
     "expires_in": 3600
   }
   ```
   (`expires_in` is advisory; actual expiry is governed by the identity API key TTL.)

**B. Add `/oauth/token` to Starlette routes in `services/xstockstrat-agent/app/main.py`:**

Extend the `routes` list (after Step 2's additions):
```python
Route("/oauth/token", endpoint=oauth_token, methods=["POST"]),
```

**Verification**:
```bash
# End-to-end token exchange (requires a real code from Step 2 flow):
# 1. Obtain a code via the authorize+login flow
# 2. Exchange it:
curl -X POST http://localhost:9000/oauth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code&code=<code>&redirect_uri=https://claude.ai/callback&code_verifier=<verifier>&client_id=xstockstrat-agent"
# Expected: {"access_token": "xss_...", "token_type": "Bearer", "expires_in": 3600}

# Replay attack: reuse same code
curl -X POST http://localhost:9000/oauth/token -d "grant_type=authorization_code&code=<same_code>..."
# Expected: {"error": "invalid_grant"}

# Bad verifier (PKCE mismatch)
curl -X POST http://localhost:9000/oauth/token -d "grant_type=authorization_code&code=<fresh_code>&code_verifier=wrong..."
# Expected: {"error": "invalid_grant"}
```

---

### Step 4 — config: Register agent.oauth.* config keys

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `docs/patterns/config-governance.md` — modify (add new agent.oauth keys to global key table)

**Reviewers**: `xstockstrat-config` owner — Config key naming (`<service>.<category>.<key>`),
environment/trading_mode scoping, WatchConfig stream stability

**Codebase Evidence**:
- Config pattern: `client.get_config_value("oauth.client_id")` (relative to `namespace="agent"`)
  follows existing pattern at `services/xstockstrat-agent/app/client.py:58` where
  `GetConfig(namespace="agent")` is already called and `snapshot.values.get(key)` is used.
- New keys use the `agent` namespace and `oauth` category, matching the `agent.oauth.*` pattern
  declared in product-spec FR-7. No `secret.*` prefix needed — neither key is a secret value.
- Config rollout via `SetConfig` RPC (see `docs/runbooks/config-rollout.md` step 2).

**Instructions**:

1. Register both keys in the running `xstockstrat-config` service via `SetConfig`. This is an
   **operational step** performed on the dev deployment after the service step lands:

   ```bash
   curl -X POST http://xstockstrat-config:8060/xstockstrat.config.v1.ConfigService/SetConfig \
     -H 'Content-Type: application/json' \
     -d '{"namespace": "agent", "key": "oauth.client_id",
          "value": {"string_val": "xstockstrat-agent"},
          "author": "platform-team",
          "reason": "feature/agent-mcp-oauth FR-7 — OAuth client_id default"}'

   curl -X POST http://xstockstrat-config:8060/xstockstrat.config.v1.ConfigService/SetConfig \
     -H 'Content-Type: application/json' \
     -d '{"namespace": "agent", "key": "oauth.allowed_redirect_uris",
          "value": {"string_val": ""},
          "author": "platform-team",
          "reason": "feature/agent-mcp-oauth FR-7 — empty = allow any https:// URI"}'
   ```

2. Document the new keys in `docs/patterns/config-governance.md` under the `agent` service
   config table. Add two rows:
   - `agent.oauth.client_id` | string | `xstockstrat-agent` | OAuth client_id; must match the
     `client_id` sent by MCP clients
   - `agent.oauth.allowed_redirect_uris` | string (comma-separated) | `""` (empty = any
     `https://` URI) | Allowlist of valid OAuth redirect URIs

**Verification**:
```bash
curl -s -X POST http://xstockstrat-config:8060/xstockstrat.config.v1.ConfigService/GetConfig \
  -H 'Content-Type: application/json' \
  -d '{"namespace": "agent"}' | python3 -m json.tool | grep oauth
# Expected: "oauth.client_id": {..., "string_val": "xstockstrat-agent"}
#           "oauth.allowed_redirect_uris": {..., "string_val": ""}
```

---

### Step 5 — service: Nginx routing for OAuth endpoints

**Status**: `pending`
**Service**: `xstockstrat-nginx`
**Files**:
- `nginx.conf` — modify

**Reviewers**: Platform Lead — Port uniqueness, service registry consistency, inter-service
dependency graph correctness

**Codebase Evidence**:
- Existing agent routes at `nginx.conf:92-100`:
  ```
  location /agent/sse { proxy_pass http://agent_backend/sse; ... }
  location /agent/messages { proxy_pass http://agent_backend/messages; ... }
  ```
- `agent_backend` upstream at `nginx.conf:39-41` proxies to `${AGENT_UPSTREAM}:9000`.
- New paths `/.well-known/oauth-authorization-server`, `/oauth/authorize`, `/oauth/token` must be
  proxied through nginx under `/agent/` prefix (consistent with existing `/agent/sse` pattern)
  OR mapped to the root path if Claude.ai requires the well-known path at the domain root.
  **Decision**: Claude.ai's dynamic client registration spec requires `/.well-known/` at the
  server root. Since the agent is behind nginx at `/agent/*`, the well-known path must be exposed
  at nginx root: `GET /.well-known/oauth-authorization-server`. Authorization and token endpoints
  are referenced only in the metadata document (not path-hardcoded by claude.ai), so they can be
  at `/agent/oauth/authorize` and `/agent/oauth/token`.

**Instructions**:

In `nginx.conf`, add the following location blocks inside the `server { listen 80; ... }` block,
after the existing `location /agent/messages` block (after line 100):

```nginx
# ── OAuth 2.0 endpoints for xstockstrat-agent MCP remote auth ────────────
location = /.well-known/oauth-authorization-server {
    proxy_pass http://agent_backend/.well-known/oauth-authorization-server;
}

location /agent/oauth/ {
    proxy_pass http://agent_backend/oauth/;
}
```

**Note on AGENT_PUBLIC_URL**: The `oauth_metadata` handler (Step 2) reads `AGENT_PUBLIC_URL` to
construct `authorization_endpoint` and `token_endpoint` URLs in the metadata document. The
operator must set `AGENT_PUBLIC_URL` to the public base URL where the agent is reachable (e.g.
`https://your-app.ondigitalocean.app`), NOT to the nginx `/agent/` prefix — the metadata
document endpoint URLs must be absolute and point to wherever nginx proxies `/agent/oauth/`.
Update the env var guidance: set `AGENT_PUBLIC_URL` such that `<AGENT_PUBLIC_URL>/oauth/authorize`
resolves through nginx to the agent's `/oauth/authorize` handler.

**Verification**:
```bash
# Via nginx (port 80):
curl -s http://localhost/.well-known/oauth-authorization-server | python3 -m json.tool
# Expected: JSON metadata with authorization_endpoint and token_endpoint

curl -v "http://localhost/agent/oauth/authorize?client_id=xstockstrat-agent&redirect_uri=https://example.com/cb&response_type=code&code_challenge=abc&code_challenge_method=S256&state=st"
# Expected: HTTP 200 HTML login form
```

---

### Step 6 — docs: Update claude_mcp_config.json and docs

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/claude_mcp_config.json` — modify
- `docs/runbooks/mcp-tools.md` — modify (add OAuth section)

**Reviewers**: none

**Codebase Evidence**:
- `claude_mcp_config.json:20-23`: existing `xstockstrat-sse-nginx` entry currently documents
  `?api_key=` auth only:
  ```json
  "xstockstrat-sse-nginx": {
    "_mode": "SSE via nginx (port 80) -- API key passed as ?api_key= query parameter",
    "url": "http://localhost/agent/sse?api_key=<your-api-key>"
  }
  ```
  This must be updated per FR-6 to document OAuth as the recommended production method.
- `docs/runbooks/mcp-tools.md` — confirmed at `docs/runbooks/CLAUDE.md` as the MCP tool
  reference document. Currently describes transport modes and x-mcp-secret; no OAuth section
  exists yet (confirmed via `grep -n "oauth\|OAuth" docs/runbooks/mcp-tools.md` → no match
  expected).

**Instructions**:

**A. Update `services/xstockstrat-agent/claude_mcp_config.json`:**

Replace the `xstockstrat-sse-nginx` entry and add a new `xstockstrat-oauth` entry:
```json
"xstockstrat-sse-nginx": {
  "_mode": "SSE via nginx (port 80) — legacy ?api_key= auth (Claude Desktop fallback only)",
  "url": "http://localhost/agent/sse?api_key=<your-api-key>"
},
"xstockstrat-oauth": {
  "_mode": "Remote MCP via OAuth 2.0 (recommended for Claude.ai Connect apps)",
  "_instructions": "In Claude.ai Connect apps, add a remote MCP server with the URL below. Claude.ai will discover OAuth endpoints via /.well-known/oauth-authorization-server and complete the PKCE Authorization Code flow automatically.",
  "url": "https://<your-public-domain>/agent/sse"
}
```

**B. Add an OAuth section to `docs/runbooks/mcp-tools.md`:**

Append a new section `## OAuth 2.0 Remote Auth (Claude.ai Connect Apps)` that covers:
- Discovery URL: `GET /.well-known/oauth-authorization-server`
- Authorization endpoint: `GET /agent/oauth/authorize` (through nginx)
- Token endpoint: `POST /agent/oauth/token`
- PKCE: S256 required
- `AGENT_PUBLIC_URL` env var setup
- `agent.oauth.client_id` and `agent.oauth.allowed_redirect_uris` config keys
- Note that `?api_key=` and `Authorization: Bearer` paths remain fully supported (FR-5)

**Verification**:
```bash
python3 -m json.tool services/xstockstrat-agent/claude_mcp_config.json
# Expected: valid JSON, no parse errors, xstockstrat-oauth key present
grep -n "OAuth\|oauth" docs/runbooks/mcp-tools.md | head -5
# Expected: at least 5 matching lines in the new section
```

---

### Step 7 — test: OAuth flow unit tests

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_oauth.py` — create

**Reviewers**: `xstockstrat-agent` owner — Auth flow correctness, backward compatibility with
query-param and Bearer header auth

**Codebase Evidence**:
- Existing test pattern at `services/xstockstrat-agent/tests/test_auth.py` — uses `unittest.mock`,
  `pytest.mark.asyncio`, `AsyncMock`, and `patch` for gRPC mocking. Same pattern applied here.
- `respx` is listed in `pyproject.toml:17` `dev` extras — used for HTTP mocking in
  `tests/test_tools.py`. Reuse for mocking identity HTTP calls in token exchange.
- Coverage threshold for `xstockstrat-agent` (Python service) is **40%** per CI overview.
- Existing `conftest.py:30-45` provides `set_env` autouse fixture that patches module-level env
  vars. The new `IDENTITY_HTTP_ENDPOINT` and `AGENT_PUBLIC_URL` vars must be added to this
  fixture OR the new test file must patch them locally via `monkeypatch.setenv`.

**Instructions**:

Create `services/xstockstrat-agent/tests/test_oauth.py` with the following test cases:

1. **`test_issue_and_consume_code_valid`** — issue a code, compute correct S256 verifier, call
   `consume_code`, assert non-None result and `api_key` matches. Confirms happy path.

2. **`test_consume_code_single_use`** — issue a code, consume it once successfully, attempt to
   consume the same code again, assert second call returns `None`. Confirms single-use enforcement
   (FR-8).

3. **`test_consume_code_expired`** — issue a code, manually set `entry.expires_at` to
   `time.monotonic() - 1` via `_store` direct access, attempt to consume, assert `None`.
   Confirms 60 s TTL (FR-8).

4. **`test_consume_code_bad_verifier`** — issue a code with a known challenge, call
   `consume_code` with a verifier whose S256 hash does not match, assert `None`. Confirms PKCE
   enforcement (FR-2, FR-3).

5. **`test_oauth_metadata_endpoint`** — build a minimal Starlette `TestClient` (or use
   `starlette.testclient.TestClient`) with the metadata route; assert response is 200 JSON with
   `"code_challenge_methods_supported": ["S256"]`.

6. **`test_authorize_endpoint_invalid_redirect_uri`** — call `GET /oauth/authorize` with
   `redirect_uri=http://evil.example.com/cb` (non-https); assert HTTP 400 (FR-7 default policy).

7. **`test_authorize_endpoint_wrong_client_id`** — call `GET /oauth/authorize` with
   `client_id=wrong`; assert HTTP 400.

8. **`test_token_endpoint_invalid_grant`** — call `POST /oauth/token` with a code that does not
   exist in the store; assert HTTP 400 with `{"error": "invalid_grant"}`.

9. **`test_existing_api_key_auth_unchanged`** — import `validate_api_key` from `app.auth`,
   assert it still returns `False` for `None` and `"Basic ..."`, mocking the gRPC channel. This
   confirms FR-5 backward compatibility. (Reuses pattern from `test_auth.py:11-18`.)

**Verification**:
```bash
cd services/xstockstrat-agent && pytest --cov=app --cov-fail-under=40 -v tests/test_oauth.py tests/test_auth.py tests/test_tools.py
```
All tests must pass and total `app` coverage must be ≥ 40%.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
