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

```
Claude.ai ──(1) GET /.well-known/oauth-protected-resource (RFC 9728)──► agent  → points to agent as AS
Claude.ai ──(2) GET /.well-known/oauth-authorization-server (RFC 8414)► agent  → advertises endpoints, S256, DCR
Claude.ai ──(3) POST /oauth/register (RFC 7591 DCR)──────────────────► agent  → returns client_id (+ exact redirect_uris)
Claude.ai ──(4) GET /oauth/authorize?client_id&redirect_uri&state&code_challenge(S256)&response_type=code
   agent validates client_id + EXACT redirect_uri + PKCE → 302 to {UI_BASE_URL}/auth/oauth-login?...&agent_cb=/oauth/callback&state
User ─────(5) submits email/password on UI page → UI BFF /api/auth/login → identity AuthenticateUser (gRPC)
   UI ──(6) on success, 302 back to agent /oauth/callback with a one-time login proof + state
   agent ──(7) identity CreateApiKey (gRPC) → mints xss_ key; issues single-use PKCE-bound auth code
   agent ──(8) 302 to client redirect_uri?code=<code>&state=<state>
Claude.ai ──(9) POST /oauth/token (grant_type=authorization_code, code, code_verifier, redirect_uri, client_id)
   agent verifies PKCE S256 + exact redirect_uri + client_id + single-use + TTL → {access_token=xss_ key, token_type:Bearer, expires_in}
Claude.ai ──(10) GET /sse  Authorization: Bearer <access_token> → existing validate_api_key (unchanged)
```

### Functional Requirements — Part B

- **FR-B1 (RFC 9728)** `GET /.well-known/oauth-protected-resource` returns Protected Resource Metadata
  naming the agent's resource identifier and its `authorization_servers` (the agent itself).
- **FR-B2 (RFC 8414)** `GET /.well-known/oauth-authorization-server` returns AS metadata with
  `authorization_endpoint`, `token_endpoint`, `registration_endpoint`,
  `code_challenge_methods_supported: ["S256"]`, `response_types_supported: ["code"]`,
  `grant_types_supported: ["authorization_code"]`. Absolute URLs built from `AGENT_PUBLIC_URL`.
- **FR-B3 (RFC 7591 DCR)** `POST /oauth/register` accepts a client registration (redirect_uris, etc.),
  validates that every `redirect_uri` is `https://` (or the configured allowlist), persists the client,
  and returns `client_id` (public client — no secret; PKCE is the proof). Storage per OQ-B.
- **FR-B4** `GET /oauth/authorize` validates `response_type=code`, `code_challenge_method=S256`
  (**PKCE required**), a registered `client_id`, and an **exact-match** `redirect_uri` (OAuth 2.1 — no
  wildcards, no "allow any https" default). On success it 302-redirects the browser to
  `{UI_BASE_URL}/auth/oauth-login` carrying the agent callback, `state`, and the PKCE challenge context.
- **FR-B5 (UI login delegation)** Complete the existing `xstockstrat-ui`
  `/auth/oauth-login/page.tsx`: on successful `/api/auth/login`, redirect back to the **agent callback**
  (not directly to the external client) so the agent can mint the API key and issue the OAuth code.
- **FR-B6** Agent `GET /oauth/callback` receives the authenticated login result + state, calls identity
  `CreateApiKey` (**gRPC**, scopes per policy), issues a single-use, PKCE-bound, ≤60 s auth code, and
  302-redirects to the client's registered `redirect_uri` with `code` + `state`.
- **FR-B7** `POST /oauth/token` (`grant_type=authorization_code`) verifies PKCE `code_verifier` (S256),
  **exact** `redirect_uri` and `client_id` match, single-use, and TTL; returns
  `{access_token: <xss_ key>, token_type: "Bearer", expires_in}`. Any failure → `invalid_grant` (400).
  No access tokens are ever returned in a query string (OAuth 2.1).
- **FR-B8** The access token IS the xstockstrat API key; the unchanged `validate_api_key` gRPC path
  authenticates the subsequent `/sse` connection. No separate token store for validation.
- **FR-B9** All identity interactions (`AuthenticateUser` via the UI BFF, `CreateApiKey`,
  `ValidateApiKey`) are **gRPC**. No `IDENTITY_HTTP_ENDPOINT`, no nginx, no `80xx` ports.
- **FR-B10** Legacy `Authorization: Bearer <api_key>` remains fully supported. `?api_key=` query-param
  auth is retained for Claude Desktop **but marked deprecated/legacy** (OAuth 2.1 discourages
  credentials in query strings); documented as Desktop-only fallback.
- **FR-B11** Config keys (namespace `agent`, category `oauth`): `agent.oauth.allowed_redirect_uris`
  (exact-match allowlist; **no allow-any-https default** — empty = registration-time `https://` check
  only), and a registration policy key per OQ-B. Documented in `docs/patterns/config-governance.md`.
- **FR-B12** Discovery reachability: `AGENT_PUBLIC_URL` and the `.well-known` placement are chosen so
  Claude.ai can discover the agent under the DO `/agent` route rule (OQ-E). `claude_mcp_config.json` and
  `docs/runbooks/mcp-tools.md` updated to document the OAuth 2.1 flow as the recommended method.

## Out of Scope

- Re-architecting the JWT/identity system or the UI BFF JWT auth.
- Refresh-token issuance / rotation, token revocation endpoint, OIDC/ID tokens, implicit or
  client-credentials/password grants (excluded by OAuth 2.1 anyway).
- Multi-instance horizontal scaling of the agent's OAuth state (in-memory stores assume
  `instance_count: 1` — see OQ-F).
- Touching trading/portfolio/config/ledger/notify internal gates (Part A is ingest + indicators only).
- Resource-indicator/audience-bound JWT access tokens (API-key-as-token is used; see OQ-D).

## Affected Services

- `xstockstrat-agent` (Python) — Part A tool-layer entry validation (`tools.py`, `client.py`); Part B
  OAuth 2.1 AS/RS endpoints (`main.py` Starlette routes + new `oauth_*` modules), gRPC `CreateApiKey`.
- `xstockstrat-ingest` (Python) — Part A `ManageSignalSource` gate swap; remove `identity_channel`.
- `xstockstrat-indicators` (Python) — Part A formula gate decision + `RegisterFormula` gap.
- `xstockstrat-identity` (Node.js) — Part B consumes `CreateApiKey`/`AuthenticateUser`/`ValidateApiKey`,
  **plus (OQ-B resolved) new additive DCR RPCs** `RegisterOAuthClient`/`GetOAuthClient` + the
  `oauth_clients` table (migration `003`).
- `xstockstrat-ui` (Next.js) — Part B: complete `/auth/oauth-login` to carry the auth code back to the
  agent callback. Part A: no change (BFF already forwards `x-access-scope`).

## Proto Contract Changes

**OQ-B resolved (2026-06-06): durable DCR store in identity → proto change IS required.**

- Add **additive, non-breaking** identity RPCs for Dynamic Client Registration:
  `RegisterOAuthClient(RegisterOAuthClientRequest) → OAuthClient` and
  `GetOAuthClient(GetOAuthClientRequest) → OAuthClient`, plus the `OAuthClient` message
  (`client_id`, `redirect_uris[]`, `client_name`, `created_at`), in
  `packages/proto/identity/v1/identity.proto`. New field numbers only; no existing field/RPC changes.
- Run `./scripts/buf-gen.sh`; `buf lint` + `buf breaking` must pass (additive → non-breaking).
- Approval: identity owner + config/proto team (additive). Exact field numbers fixed at `/sdd-spec`.

## Config Key Changes

New keys (namespace `agent`, category `oauth`):
- `agent.oauth.allowed_redirect_uris` — string (comma-separated, **exact** URIs); empty = require
  `https://` at registration. **No allow-any default** (OAuth 2.1 exact-match).
- `agent.oauth.registration_enabled` — bool (default `true`); gates open Dynamic Client Registration.

## Database Changes

**OQ-B resolved (2026-06-06): durable DCR store in identity → migration IS required.**

- Add `services/xstockstrat-identity/migrations/003_oauth_clients.up.sql` (+ matching
  `003_oauth_clients.down.sql`), NNN-sequenced after the existing `002`. Table `identity.oauth_clients`
  (`client_id` PK, `redirect_uris text[]`, `client_name`, `created_at`); run via `scripts/db-migrate.sh`
  (golang-migrate). Never edit an applied migration — this is a new numbered one.
- Auth codes (OQ-C) remain **in-memory** in the agent (single-use, PKCE-bound, ≤60 s) — no table.

## Governance Gates

- **Security review (heavy)** — Part B is outward-facing edge auth: PKCE enforcement, exact redirect-URI
  matching, DCR abuse/SSRF surface, single-use + short-TTL codes, no tokens in query strings, login
  delegation/CSRF (state binding), API-key scoping of minted tokens. Part A: trust-boundary change in
  ingest (confirm ingress strips client-supplied `x-access-scope`).
- **Service owners** — agent, ingest, indicators, identity, UI.
- **Platform Lead** — OQ-A (formula model), OQ-B/D (DCR + token-type architecture), service-registry /
  port / route consistency.
- **Config team** — new `agent.oauth.*` keys.

## Feature Workflow Notes

Branch: `feature/unify-admin-auth-gates` (from `main-dev`).
Dependencies satisfied: 047 (#581) + 048 (#596) merged; UI unified-login (019) + `oauth-login` page +
`UI_BASE_URL` plumbing present. **Supersedes feature 018** (its OAuth 2.0 spec is folded here and its
impl spec is retired as stale).
Approval gates (per `docs/runbooks/feature-workflow.md`) — OQ-B resolved (durable DCR) activates the
proto + migration gates:
- [x] 1 service owner per affected service (gate-logic + additive edge auth).
- [x] **Additive proto change** (identity DCR RPCs) → identity owner + config/proto team
      (`buf breaking` must pass — non-breaking; not the 2-owner+lead breaking-change path).
- [x] **DB migration** (`identity/migrations/003_oauth_clients`) → DBA + identity owner.
- [x] Security review (edge OAuth 2.1 + ingest trust-boundary).

## Acceptance Criteria

- **AC-A1** Non-admin `x-access-scope` to ingest `ManageSignalSource` → `PERMISSION_DENIED`; admin
  scope succeeds; no identity `ValidateApiKey` call by ingest for the gate.
- **AC-A2** agent `manage_signal_source` rejects a non-admin key at the entry; forwards `x-access-scope`
  for an admin key. `credentials_ref` never echoed.
- **AC-A3** indicators formula decision (OQ-A) implemented + documented, including `RegisterFormula`.
- **AC-A4** `identity_channel`/`_identity` removed from ingest (FR-A3 verification holds).
- **AC-B1** `GET /.well-known/oauth-protected-resource` (RFC 9728) and
  `/.well-known/oauth-authorization-server` (RFC 8414) return valid metadata advertising S256, the
  three endpoints, and the registration endpoint.
- **AC-B2** `POST /oauth/register` (DCR) returns a usable `client_id`; a subsequent authorize→login→
  callback→token exchange completes end-to-end and the resulting `access_token` authenticates `/sse`.
- **AC-B3** PKCE is enforced (bad `code_verifier` → `invalid_grant`); auth codes are single-use and
  expire ≤60 s; a `redirect_uri` not exactly matching the registered value → 400.
- **AC-B4** Legacy `Authorization: Bearer` still authenticates `/sse`; `?api_key=` still works but is
  documented as deprecated/Desktop-only.
- **AC-B5** UI `/auth/oauth-login` redirects back to the agent callback (not the external client) and
  the agent issues the code — verified by an E2E/integration test.
- **AC-X** Existing agent/ingest/indicators tests pass; new unit tests cover the gate changes and the
  OAuth store + endpoints (PKCE, single-use, expiry, exact-redirect, DCR happy path). Coverage ≥40%.

## Open Questions — with recommendations (advisory; owners decide)

- **OQ-A (formula gate; Platform Lead + Security):** keep author-ownership, **add an admin-scope
  override**, and close the `RegisterFormula` gap (require authenticated `x-user-id`; default `author`
  to it). *Recommended.*
- **OQ-B — RESOLVED (2026-06-06, user): durable store in identity.** DCR clients persist in the
  `identity.oauth_clients` table (migration `003`) behind additive gRPC RPCs
  `RegisterOAuthClient`/`GetOAuthClient`. Survives agent restarts and is not bound to `instance_count: 1`
  for client storage (auth codes remain in-memory — see OQ-C/OQ-F). Adds the proto + migration
  governance gates above.
- **OQ-C (auth-code store):** in-memory dict, single-use, PKCE-bound, ≤60 s TTL (018's choice — keep).
- **OQ-D (access-token type; Security):** reuse the xstockstrat **API key** as the bearer token
  (works with the unchanged `validate_api_key`; no new infra). *Recommended.* A resource-indicator/
  audience-bound JWT is deferred (Out of Scope).
- **OQ-E (discovery reachability under DO `/agent` route; Platform Lead):** confirm where Claude.ai
  fetches `/.well-known/oauth-protected-resource` relative to the MCP server URL, and set
  `AGENT_PUBLIC_URL` + route rules so discovery resolves to the agent. Resolve at `/sdd-spec`.
- **OQ-F (single-instance constraint):** with OQ-B resolved to a DB-backed DCR store, only the
  **in-memory auth-code store** (OQ-C) requires `instance_count: 1`. Codes are short-lived (≤60 s) and
  consumed within a single OAuth round-trip; document the constraint. A Redis/DB code store is the
  scale-out path (deferred).
- **OQ-G (`?api_key=` deprecation):** keep for Claude Desktop, mark legacy/deprecated; do not remove in
  this feature.
