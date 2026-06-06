# Product Spec: unify-admin-auth-gates → **unify-agent-auth** (combined)

**Feature**: `049-unify-admin-auth-gates`
**Status**: `draft` (re-spec — scope expanded to absorb OAuth 2.1; supersedes feature 018)
**Owner**: Platform / Security

> **Scope note (2026-06-06):** This feature was broadened from the original internal admin-gate
> unification to a single **"unify agent auth"** effort covering two layers:
> **Part A — internal admin-scope gate unification** (the original 049 scope), and
> **Part B — edge OAuth 2.1 for the MCP transport** (absorbing and re-speccing feature
> `018-agent-mcp-oauth`, whose impl spec is stale post-045). The directory slug stays
> `unify-admin-auth-gates` for branch/PR continuity; the working title is **unify-agent-auth**.
>
> **"100% connect" revision (2026-06-06):** to make the Claude.ai remote-MCP connection fully seamless
> *and* spec-compliant, Part B targets a complete OAuth 2.1 Authorization Server (identity-backed):
> RFC 8414/9728 discovery + `401 WWW-Authenticate` trigger, RFC 7591 DCR, mandatory PKCE/S256, exact
> redirect matching, UI-delegated login, **audience-bound JWT access tokens (RFC 8707) + rotating
> refresh tokens**, and **durable OAuth state in identity** so the agent is stateless / multi-instance.
> See the per-item "connect impact" analysis logged in `context.md` (2026-06-06).

---

## Problem Statement

The agent's authorization story is fragmented across two layers, neither of which is consistent:

1. **Internal (service-to-service) admin gates** use *three* different mechanisms. 047/048 aligned
   `xstockstrat-analysis` to an `x-access-scope` role check; `xstockstrat-ingest` still re-authenticates
   internally, and `xstockstrat-indicators` uses author-ownership (with `RegisterFormula` ungated).
2. **Edge (Claude.ai → agent) authentication** has no standards-based path. The MCP SSE transport accepts
   only `Authorization: Bearer <api_key>` or `?api_key=` query param. Claude.ai's remote-MCP "Connect
   apps" integration requires **OAuth 2.1** (PKCE, dynamic client registration, protected-resource
   metadata), so operators cannot add the agent as a production remote MCP server through the standard UI.
   Feature 018 specced an OAuth 2.0 flow, but its implementation spec predates feature 045 and is stale
   (assumes nginx, HTTP/Connect-RPC `80xx` ports, and a non-existent `IDENTITY_HTTP_ENDPOINT`).

## User Story

As a **platform/security engineer and operator**, I want one coherent auth model for the agent —
*standards-based OAuth 2.1 at the edge, and a single `x-access-scope` role-check model internally* — so
that I can connect the agent to Claude.ai through the normal Connect-apps flow, and so the internal trust
boundary is consistent and auditable, with the one deliberate exception (formula author-ownership)
documented as intentional.

## Architecture grounding (current `main-dev`, post-045)

- Agent serves MCP over **FastMCP + Starlette + uvicorn** on port 9000; routes today are only `/sse` and
  `/messages` (`services/xstockstrat-agent/app/main.py:80-85`). No `/.well-known` or `/oauth` routes.
- Agent → identity is **gRPC-only** (`IDENTITY_ENDPOINT=…:50058`); `auth.py:36` calls `ValidateApiKey`,
  `client.py:374-392` `validate_admin` checks `"admin" in roles`. **No httpx-to-identity, no
  `IDENTITY_HTTP_ENDPOINT`.**
- Identity is **gRPC-only** (`src/index.ts:42-57`, port 50058); exposes `AuthenticateUser`,
  `CreateApiKey` (returns `xss_…` key), `ValidateApiKey` (returns `TokenClaims.roles`). **No HTTP/login
  routes.** Migrations are golang-migrate (`services/xstockstrat-identity/migrations/NNN_*.up/down.sql`,
  currently up to `002`).
- **No nginx** (`nginx.conf` deleted by 045). DO App Platform routes `/agent` → agent, `/` → UI.
- The intended login design is already half-wired: `agent/app/main.py:26-30` reads `UI_BASE_URL` with a
  `TODO(019)` to redirect OAuth login to `{UI_BASE_URL}/auth/oauth-login`. The UI page
  `services/xstockstrat-ui/src/app/auth/oauth-login/page.tsx` **exists** (feature 019) but is a **stub**:
  on successful `/api/auth/login` it redirects to `${redirect_uri}?state=…` with **no authorization
  code** — the agent code-issuance handshake was never built.

---

# Part A — Internal admin-scope gate unification

(Original 049 scope. Verified accurate against merged 047/048 code.)

### Current state

| Operation | Service | Gate today | Evidence | Model |
|---|---|---|---|---|
| `ManageStrategy` / `SetStrategyLive` | analysis | `_has_admin_scope(context)` → `x-access-scope & 0x04` | `xstockstrat-analysis/app/handlers/servicer.py:58,655,726` | **Aligned (target)** |
| `ManageSignalSource` | **ingest** | `_validate_admin_token` → `authorization: Bearer` + identity `ValidateApiKey` + `"admin" in roles` | `xstockstrat-ingest/app/handlers/servicer.py:47-58,427` | **Re-auth inside internal service** |
| `UpdateFormula` / `DeleteFormula` | **indicators** | author-ownership: `row["author"] != request.user_id` → `PERMISSION_DENIED` | `xstockstrat-indicators/app/handlers/servicer.py:211-213,236-238` | **Ownership (different concern)** |
| `RegisterFormula` | **indicators** | **effectively ungated** — `author` defaults to `"dev-user"` | `xstockstrat-indicators/app/handlers/servicer.py:135-150` | **Gap (no gate)** |

### Functional Requirements — Part A

- **FR-A1** ingest `ManageSignalSource` authorizes via an `x-access-scope` ADMIN-bit (`0x04`) role check
  mirroring analysis `_has_admin_scope`; returns `PERMISSION_DENIED` when the bit is absent. No identity
  `ValidateApiKey` call inside ingest for this RPC.
- **FR-A2** agent `manage_signal_source` tool calls `client.validate_admin(admin_api_key)` at the entry
  and forwards `x-access-scope` to ingest (mirrors `manage_strategy`/`set_strategy_live`).
- **FR-A3** ingest removes the `identity_channel`/`_identity` wiring if unused after FR-A1. Verified:
  `_validate_admin_token` has a **single** call site (`servicer.py:427`) → removal is clean.
- **FR-A4** indicators formula-management gate decision (OQ-A) is implemented and documented: keep
  author-ownership **and** add an admin-scope override; close the `RegisterFormula` gap (require an
  authenticated `x-user-id`; default `author` to it instead of `"dev-user"`).
- **FR-A5** `credentials_ref` is never echoed by `manage_signal_source` (unchanged from FR-12 of 047).
- **FR-A6** Docs updated: `docs/patterns/header-propagation.md` describes the single "entry
  authenticates, internal role-checks" model and lists the indicators ownership exception.

---

# Part B — Edge OAuth 2.1 for the MCP transport

The **agent acts as the OAuth 2.1 Authorization Server and Resource Server** for its own MCP endpoint.
Login is **delegated to `xstockstrat-ui`**; identity stays gRPC-only and is reached via existing gRPC
RPCs. The access token is the existing xstockstrat API key (validated by the unchanged `validate_api_key`
path) — no separate token store. All of 018's stale HTTP/nginx assumptions are dropped.

### Flow (target)

**Roles:** the **agent** is the OAuth 2.1 **Resource Server + Authorization-Server HTTP facade** (it owns
the public HTTP surface); **identity** is the durable **OAuth state + token backend** over gRPC (it owns
the `oauth_clients` + `oauth_auth_codes` tables and mints audience-bound JWT access tokens + rotating
refresh tokens, reusing its existing JWT/refresh infra). The agent holds **no OAuth state** → it can run
`instance_count > 1`.

```
Claude.ai ──(0) GET /sse  (no token) ──► agent ── 401 + WWW-Authenticate: resource_metadata="…/.well-known/oauth-protected-resource"
Claude.ai ──(1) GET /.well-known/oauth-protected-resource (RFC 9728)──► agent  → resource id + authorization_servers=[agent]
Claude.ai ──(2) GET /.well-known/oauth-authorization-server (RFC 8414)► agent  → endpoints, S256, DCR, refresh
Claude.ai ──(3) POST /oauth/register (RFC 7591 DCR)──► agent →(gRPC RegisterOAuthClient)→ identity DB → returns client_id
Claude.ai ──(4) GET /oauth/authorize?client_id&redirect_uri&state&code_challenge(S256)&response_type=code&resource=<agent URI>
   agent validates client_id + EXACT redirect_uri + PKCE + resource → 302 to {UI_BASE_URL}/auth/oauth-login?…&agent_cb&state
User ─────(5) submits email/password on UI page → UI BFF /api/auth/login → identity AuthenticateUser (gRPC); BFF sets the `access_token` session cookie (httpOnly, SameSite=Lax, path=/)
   UI ──(6) on success, 302 back to agent /oauth/callback with `txn`+`state` only (no token in URL); the same-origin `access_token` cookie rides along
   agent ──(7) verifies `txn` HMAC, reads the `access_token` cookie, validates it via identity ValidateToken → user_id; then (gRPC IssueAuthCode: user_id, client_id, redirect_uri, code_challenge, resource) → identity stores single-use ≤60s code
   agent ──(8) 302 to client redirect_uri?code=<code>&state=<state>
Claude.ai ──(9) POST /oauth/token (grant_type=authorization_code, code, code_verifier, redirect_uri, client_id, resource)
   agent →(gRPC ExchangeAuthCode)→ identity verifies PKCE S256 + exact redirect_uri + client_id + single-use + TTL,
        mints JWT access token (aud=<agent resource URI>, short TTL) + rotating refresh token
   agent → {access_token: <JWT>, token_type: "Bearer", expires_in, refresh_token}
Claude.ai ──(10) GET /sse  Authorization: Bearer <JWT> → agent (gRPC ValidateToken) + checks aud==<agent resource URI>
Claude.ai ──(11) POST /oauth/token (grant_type=refresh_token, refresh_token, resource) → agent →(gRPC RefreshOAuthToken)→
        identity rotates: new JWT (aud-bound) + new refresh token; old refresh invalidated  (seamless, no re-consent)
```

### Functional Requirements — Part B

- **FR-B0 (RFC 9728 §5.1 — discovery trigger)** An unauthenticated/invalid-token request to the
  protected `/sse` endpoint returns **HTTP 401 with a `WWW-Authenticate` header** whose
  `resource_metadata` parameter points to the agent's `/.well-known/oauth-protected-resource` URL. This
  is the **MUST** that lets Claude.ai auto-discover the auth server.
- **FR-B1 (RFC 9728)** `GET /.well-known/oauth-protected-resource` returns Protected Resource Metadata
  naming the agent's canonical **resource identifier** (the agent's public MCP URI) and its
  `authorization_servers` (the agent's own AS facade).
- **FR-B2 (RFC 8414)** `GET /.well-known/oauth-authorization-server` returns AS metadata with
  `authorization_endpoint`, `token_endpoint`, `registration_endpoint`,
  `code_challenge_methods_supported: ["S256"]`, `response_types_supported: ["code"]`,
  `grant_types_supported: ["authorization_code", "refresh_token"]`. Absolute URLs built from
  `AGENT_PUBLIC_URL`.
- **FR-B3 (RFC 7591 DCR)** `POST /oauth/register` accepts a client registration (redirect_uris, etc.),
  validates that every `redirect_uri` is `https://` (or the configured allowlist), **persists the client
  in identity** via gRPC `RegisterOAuthClient`, and returns `client_id` (public client — no secret; PKCE
  is the proof).
- **FR-B4** `GET /oauth/authorize` validates `response_type=code`, `code_challenge_method=S256`
  (**PKCE required**), a registered `client_id`, an **exact-match** `redirect_uri` (OAuth 2.1 — no
  wildcards, no "allow any https" default), and records the `resource` parameter. On success it
  302-redirects the browser to `{UI_BASE_URL}/auth/oauth-login` carrying the agent callback, `state`,
  the PKCE challenge context, and `resource`.
- **FR-B5 (UI login delegation)** Complete the existing `xstockstrat-ui`
  `/auth/oauth-login/page.tsx`: on successful `/api/auth/login`, redirect back to the **agent callback**
  with **`txn` + `state` only** (no token or user id in the URL) — not to the external client. The BFF's
  `access_token` session cookie (httpOnly, `SameSite=Lax`, `path=/`) is the authentication carrier;
  because the agent and UI are **same-origin** in the DO ingress (`/agent` and `/` under one domain), the
  cookie is delivered to the agent callback automatically.
- **FR-B6** Agent `GET /oauth/callback` verifies the `txn` HMAC + `state`, then **derives `user_id` from
  the same-origin `access_token` session cookie by validating it via identity `ValidateToken`** (never
  from a forgeable query param). It then calls identity `IssueAuthCode` (**gRPC**: `user_id`,
  `client_id`, `redirect_uri`, `code_challenge`, `resource`) → identity persists a single-use,
  PKCE-bound, ≤60 s code in `oauth_auth_codes`; the agent 302-redirects to the client's registered
  `redirect_uri` with `code` + `state`. *(Local docker-compose is cross-origin (UI `:3000` / agent
  `:9000`), so the full browser round-trip is only end-to-end testable in a prod-like single-origin
  setup; unit tests mock the identity stubs.)*
- **FR-B7 (token — auth code)** `POST /oauth/token` (`grant_type=authorization_code`) calls identity
  `ExchangeAuthCode`, which verifies PKCE `code_verifier` (S256), **exact** `redirect_uri` + `client_id`,
  single-use, and TTL, then **mints a JWT access token with `aud` = the agent's resource URI** (short
  TTL) **+ a rotating refresh token**. Returns `{access_token: <JWT>, token_type: "Bearer", expires_in,
  refresh_token}`. Any failure → `invalid_grant` (400). Tokens are **never** returned in a query string.
- **FR-B7b (token — refresh)** `POST /oauth/token` (`grant_type=refresh_token`) calls identity
  `RefreshOAuthToken`, which validates + **rotates** the refresh token (old one invalidated, OAuth 2.1
  public-client requirement) and mints a fresh `aud`-bound JWT. Enables seamless long-lived sessions
  with short-lived access tokens — no re-consent.
- **FR-B8 (RS audience validation — RFC 8707 MUST)** `/sse` authenticates the bearer JWT via identity
  `ValidateToken` (gRPC) **and verifies the `aud` claim equals the agent's resource URI**; a token whose
  audience is not the agent (e.g. a generic platform API key/JWT issued for another resource) is
  **rejected with 401**. This closes the "any valid token works" gap.
- **FR-B9** All identity interactions (`AuthenticateUser` via the UI BFF, `RegisterOAuthClient`,
  `GetOAuthClient`, `IssueAuthCode`, `ExchangeAuthCode`, `RefreshOAuthToken`, `ValidateToken`) are
  **gRPC**. No `IDENTITY_HTTP_ENDPOINT`, no nginx, no `80xx` ports.
- **FR-B10** Legacy `Authorization: Bearer <api_key>` (validated via `validate_api_key`/`ValidateApiKey`)
  remains supported for backward compatibility; `?api_key=` query-param auth is retained for Claude
  Desktop **but marked deprecated/legacy** (OAuth 2.1 forbids credentials in query strings); documented
  as Desktop-only fallback. The OAuth path (FR-B7/B8) is the recommended production method.
- **FR-B11** Config keys (namespace `agent`, category `oauth`): `agent.oauth.allowed_redirect_uris`
  (exact-match allowlist; **no allow-any-https default** — empty = registration-time `https://` check
  only) and `agent.oauth.registration_enabled` (bool). Documented in
  `docs/patterns/config-governance.md`.
- **FR-B12** Discovery reachability: `AGENT_PUBLIC_URL` and the `.well-known` placement are chosen so
  Claude.ai can discover the agent under the DO `/agent` route rule (OQ-E). `claude_mcp_config.json` and
  `docs/runbooks/mcp-tools.md` updated to document the OAuth 2.1 flow as the recommended method.
- **FR-B13 (stateless agent / multi-instance)** All OAuth state (clients, auth codes, tokens/refresh)
  lives in identity's DB; the agent holds none. The OAuth flow therefore works correctly with the agent
  at `instance_count > 1` (no in-memory code store to desync across instances).

## Out of Scope

Still excluded (none of these block or degrade a Claude.ai connection — verified against the MCP
authorization spec 2025-06-18):
- **Token revocation endpoint** (RFC 7009) — optional; not part of the connect flow.
- **OIDC / ID tokens** — MCP authorization does not use OIDC.
- **Implicit, password, and client-credentials grants** — forbidden by OAuth 2.1; Claude.ai uses only
  authorization-code + PKCE.
- **Re-architecting the UI BFF JWT auth** — the BFF login path is reused as-is for the delegated login.
- Touching trading/portfolio/config/ledger/notify internal gates (Part A is ingest + indicators only).

**Brought INTO scope for "100% connect" (2026-06-06 decision)** — previously out of scope, now required:
refresh-token issuance + rotation (FR-B7b), audience-bound JWT access tokens + RS audience validation
(FR-B7/FR-B8, RFC 8707), the `401 + WWW-Authenticate` discovery trigger (FR-B0), and a durable/shared
OAuth state store so the agent is stateless and not pinned to `instance_count: 1` (FR-B13).

## Affected Services

- `xstockstrat-agent` (Python) — Part A tool-layer entry validation (`tools.py`, `client.py`); Part B
  OAuth 2.1 RS + AS-facade HTTP endpoints (`main.py` Starlette routes + new `oauth_*` modules), all OAuth
  state delegated to identity over gRPC; `/sse` JWT + `aud` validation; stateless.
- `xstockstrat-ingest` (Python) — Part A `ManageSignalSource` gate swap; remove `identity_channel`.
- `xstockstrat-indicators` (Python) — Part A formula gate decision + `RegisterFormula` gap.
- `xstockstrat-identity` (Node.js) — **now the durable OAuth state + token backend.** New additive gRPC
  RPCs: `RegisterOAuthClient`/`GetOAuthClient` (DCR), `IssueAuthCode`/`ExchangeAuthCode` (PKCE-verified
  code → audience-bound JWT + refresh), `RefreshOAuthToken` (rotation). New tables `oauth_clients` +
  `oauth_auth_codes` (migration `003`). JWT mint extended with an `aud` claim; `ValidateToken`/
  `TokenClaims` expose `aud` for RS validation. Reuses existing JWT + `refresh_tokens` infra.
- `xstockstrat-ui` (Next.js) — Part B: complete `/auth/oauth-login` to redirect back to the agent
  callback (carry the login result), so the agent can issue the code. Part A: no change (BFF already
  forwards `x-access-scope`).

## Proto Contract Changes

**Additive, non-breaking identity RPCs** (OQ-B durable store + OQ-D JWT/refresh/audience), in
`packages/proto/identity/v1/identity.proto`:

- DCR: `RegisterOAuthClient(RegisterOAuthClientRequest) → OAuthClient`,
  `GetOAuthClient(GetOAuthClientRequest) → OAuthClient`; message `OAuthClient`
  (`client_id`, `redirect_uris[]`, `client_name`, `created_at`).
- Code + token: `IssueAuthCode(IssueAuthCodeRequest) → IssueAuthCodeResponse` (`code`);
  `ExchangeAuthCode(ExchangeAuthCodeRequest) → OAuthTokenResponse`
  (verifies PKCE + code; returns `access_token` JWT, `refresh_token`, `expires_in`, `token_type`);
  `RefreshOAuthToken(RefreshOAuthTokenRequest) → OAuthTokenResponse` (rotation).
- Audience: add an `aud` (audience/resource) field to the minted JWT and surface it on the existing
  `TokenClaims` (consumed by `ValidateToken`) so the agent RS can verify `aud`. Adding a field to
  `TokenClaims` is **additive** (new field number) — existing readers ignore it.
- New field numbers only; **no existing field/RPC changed or renumbered.** Run `./scripts/buf-gen.sh`;
  `buf lint` + `buf breaking` must pass (additive → non-breaking). Exact field numbers fixed at
  `/sdd-spec`.
- Approval: identity owner + config/proto team (additive — **not** the 2-owner+lead breaking path).

## Config Key Changes

New keys (namespace `agent`, category `oauth`):
- `agent.oauth.allowed_redirect_uris` — string (comma-separated, **exact** URIs); empty = require
  `https://` at registration. **No allow-any default** (OAuth 2.1 exact-match).
- `agent.oauth.registration_enabled` — bool (default `true`); gates open Dynamic Client Registration.

## Database Changes

Durable OAuth state in identity (OQ-B + shared-code-store decision). Add
`services/xstockstrat-identity/migrations/003_oauth.up.sql` (+ matching `003_oauth.down.sql`),
NNN-sequenced after the existing `002`; run via `scripts/db-migrate.sh` (golang-migrate). Never edit an
applied migration — this is a new numbered one. Tables (schema `identity`):

- `oauth_clients` — `client_id` PK, `redirect_uris text[]`, `client_name`, `created_at` (DCR).
- `oauth_auth_codes` — `code` PK (hashed), `client_id`, `user_id`, `redirect_uri`, `code_challenge`,
  `resource`, `expires_at`, `consumed_at` (single-use, ≤60 s; the **shared** code store that replaces
  the in-memory one so the agent is stateless / multi-instance-safe — FR-B13).

Refresh tokens reuse the **existing** `identity.refresh_tokens` table (no new migration for those).

## Governance Gates

- **Security review (heavy)** — Part B is outward-facing edge auth: PKCE enforcement, exact redirect-URI
  matching, **token audience binding + RS `aud` validation (RFC 8707)**, **refresh-token rotation**
  (public-client MUST), short-TTL access tokens, DCR abuse/SSRF surface, single-use + short-TTL codes, no
  tokens in query strings, login delegation/CSRF (state binding), `401 + WWW-Authenticate` correctness.
  Part A: trust-boundary change in ingest (confirm ingress strips client-supplied `x-access-scope`).
- **Service owners** — agent, ingest, indicators, identity, UI.
- **Platform Lead** — OQ-A (formula model), token/AS architecture (identity-backed AS, audience model),
  service-registry / port / route consistency.
- **Config team** — new `agent.oauth.*` keys.
- **DBA + identity owner** — migration `003` (`oauth_clients`, `oauth_auth_codes`).

## Feature Workflow Notes

Branch: `feature/unify-admin-auth-gates` (from `main-dev`).
Dependencies satisfied: 047 (#581) + 048 (#596) merged; UI unified-login (019) + `oauth-login` page +
`UI_BASE_URL` plumbing present. **Supersedes feature 018** (its OAuth 2.0 spec is folded here and its
impl spec is retired as stale).
Approval gates (per `docs/runbooks/feature-workflow.md`) — OQ-B resolved (durable DCR) activates the
proto + migration gates:
- [x] 1 service owner per affected service (gate-logic + additive edge auth).
- [x] **Additive proto change** (identity DCR + code/token/audience RPCs + `TokenClaims.aud`) → identity
      owner + config/proto team (`buf breaking` must pass — non-breaking; not the 2-owner+lead path).
- [x] **DB migration** (`identity/migrations/003_oauth` — `oauth_clients`, `oauth_auth_codes`) → DBA +
      identity owner.
- [x] Security review (edge OAuth 2.1 + ingest trust-boundary).

## Acceptance Criteria

- **AC-A1** Non-admin `x-access-scope` to ingest `ManageSignalSource` → `PERMISSION_DENIED`; admin
  scope succeeds; no identity `ValidateApiKey` call by ingest for the gate.
- **AC-A2** agent `manage_signal_source` rejects a non-admin key at the entry; forwards `x-access-scope`
  for an admin key. `credentials_ref` never echoed.
- **AC-A3** indicators formula decision (OQ-A) implemented + documented, including `RegisterFormula`.
- **AC-A4** `identity_channel`/`_identity` removed from ingest (FR-A3 verification holds).
- **AC-B0** An unauthenticated `GET /sse` returns `401` with a `WWW-Authenticate` header whose
  `resource_metadata` points to `/.well-known/oauth-protected-resource` (discovery trigger).
- **AC-B1** `GET /.well-known/oauth-protected-resource` (RFC 9728) and
  `/.well-known/oauth-authorization-server` (RFC 8414) return valid metadata advertising S256, the
  endpoints, the registration endpoint, and `refresh_token` in `grant_types_supported`.
- **AC-B2** `POST /oauth/register` (DCR) returns a usable `client_id` persisted in identity; a subsequent
  authorize→login→callback→token exchange completes end-to-end and the resulting **JWT** authenticates
  `/sse`.
- **AC-B3** PKCE is enforced (bad `code_verifier` → `invalid_grant`); auth codes are single-use and
  expire ≤60 s; a `redirect_uri` not exactly matching the registered value → 400.
- **AC-B4 (audience — RFC 8707)** A bearer JWT whose `aud` is **not** the agent's resource URI is
  **rejected with 401** at `/sse`; a JWT minted for the agent is accepted.
- **AC-B5 (refresh)** `grant_type=refresh_token` returns a new access JWT **and a new refresh token**;
  the **old refresh token is invalidated** (rotation); the new access token authenticates `/sse`.
- **AC-B6 (multi-instance)** With the durable identity-backed code store, the authorize/callback and the
  token-exchange can be served by **different agent instances** and the flow still succeeds (no
  `instance_count: 1` dependency).
- **AC-B7** Legacy `Authorization: Bearer <api_key>` still authenticates `/sse`; `?api_key=` still works
  but is documented as deprecated/Desktop-only.
- **AC-B8** UI `/auth/oauth-login` redirects back to the agent callback with `txn`+`state` only (no
  token/user id in the URL); the agent callback derives `user_id` by validating the `access_token`
  session cookie via `ValidateToken` and issues the code. A callback request with **no/invalid session
  cookie** does not issue a code (re-auth/401); a request carrying only a forged `login=ok`-style flag is
  **rejected** — verified by an E2E/integration test.
- **AC-X** Existing agent/ingest/indicators/identity tests pass; new tests cover the gate changes and the
  OAuth endpoints (PKCE, single-use, expiry, exact-redirect, DCR, audience reject, refresh rotation).
  Coverage ≥40% (identity Node ≥40%).

## Open Questions — with recommendations (advisory; owners decide)

- **OQ-A (formula gate; Platform Lead + Security):** keep author-ownership, **add an admin-scope
  override**, and close the `RegisterFormula` gap (require authenticated `x-user-id`; default `author`
  to it). *Recommended.*
- **OQ-B — RESOLVED (2026-06-06, user): durable store in identity.** DCR clients persist in
  `identity.oauth_clients` (migration `003`) behind additive gRPC RPCs `RegisterOAuthClient`/
  `GetOAuthClient`.
- **OQ-C — RESOLVED: durable, shared code store in identity.** Auth codes persist in
  `identity.oauth_auth_codes` (single-use, PKCE-bound, ≤60 s) instead of an in-memory dict — required to
  make the agent stateless / multi-instance-safe (FR-B13).
- **OQ-D — RESOLVED (2026-06-06, user): audience-bound JWT access token + rotating refresh token.**
  Identity mints a JWT with `aud` = the agent's resource URI (short TTL) plus a rotating refresh token,
  reusing its existing JWT + `refresh_tokens` infra. The agent RS validates the JWT via `ValidateToken`
  and checks `aud` (FR-B8). Chosen over API-key-as-token to satisfy the MCP/OAuth 2.1 audience-binding
  MUST and to give Claude.ai seamless long-lived sessions without re-consent.
- **OQ-E (discovery reachability under DO `/agent` route; Platform Lead):** confirm the canonical
  resource URI and where Claude.ai fetches `/.well-known/oauth-protected-resource` relative to the MCP
  server URL; set `AGENT_PUBLIC_URL` + route rules so discovery + the `WWW-Authenticate` pointer resolve
  to the agent. Resolve at `/sdd-spec`. *(Still open.)*
- **OQ-F — RESOLVED: no single-instance constraint.** All OAuth state is in identity's DB; the agent is
  stateless and may run `instance_count > 1` (FR-B13 / AC-B6).
- **OQ-G (`?api_key=` deprecation):** keep for Claude Desktop, mark legacy/deprecated; do not remove in
  this feature. *(Still open — disposition only.)*
- **OQ-H (refresh + access-token TTLs; Security):** pick concrete TTLs — recommend short access-token TTL
  (e.g. 1 h, reusing identity `accessTtlSeconds`) and a longer rotating refresh TTL (e.g. 30 d,
  `refreshTtlSeconds`). Confirm at `/sdd-spec`. *(Still open.)*
