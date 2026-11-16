# Product Spec: authelia-sso

**Created**: 2026-11-15

---

## Problem Statement

xstockstrat runs its own password login and its own OAuth 2.1 authorization server for MCP. The login has no MFA
and no lockout; the homelab edge's Caddy rate limits are its only brute-force control
(`davcs86/homelab-edge` `docs/decisions.md`, "Login hardening is upstream's gap"). The homelab now standardises on
Authelia as the single login and token issuer for every public app (homelab-edge `docs/decisions.md`, "SSO is
Authelia"; `docs/runbooks/sso.md`; PR davcs86/homelab-edge#77). xstockstrat must become an OIDC client and an OAuth
resource server of that Authelia without losing its own user store or per-environment roles.

## User Story

As a platform admin, I want xstockstrat (prod and staging, web UI and MCP agent) to authenticate users through the
homelab's Authelia instead of its own password login and OAuth server, while keeping `identity.users` and
per-environment roles authoritative, so family members get one login with passkey/TOTP 2FA and MCP connectors can be
narrowed to what they need.

## Functional Requirements

FR-1. **Web login via Authelia.** `xstockstrat-ui` logs users in with the OIDC authorization-code flow (confidential
client, PKCE S256). The callback rejects a mismatched `state` or `nonce`, or an ID token that fails
signature/`iss`/`aud`/`exp` checks, and creates no session. On success it calls `ResolveExternalIdentity` (FR-3) with
the ID token's `iss`, `sub` and `email`, and then receives the **existing** session token pair (identity-minted
access JWT + identity-backed refresh token, signed with env `JWT_SECRET` per IDENTITY-1) for the resolved user. The
session-cookie, middleware, header-propagation (`x-user-id`, `x-access-scope`, `x-trace-id`) and refresh paths are
unchanged. The login page shows a "Keep me signed in for 14 days (SSO)" checkbox next to "Sign in with SSO". Its value, and the post-login
redirect, travel bound to the OIDC `state`: they are stored in the encrypted, httpOnly SSO-transaction cookie keyed
by the random `state` value (owner decision 2026-11-16). The callback passes it to `setSessionCookies` exactly as the password path does today (UI-8). With an invalid configuration (FR-14), sign-in fails with "SSO not
configured" and no request reaches Authelia.

FR-2. **MCP as a resource server.** In SSO mode (FR-14), `xstockstrat-agent` accepts **only** Authelia-issued JWT access tokens on its MCP
endpoint. A token passes only if all of these hold, against Authelia's cached JWKS:
- a valid signature;
- `iss` equals the configured issuer;
- `exp` is in the future;
- `aud` equals `AGENT_PUBLIC_URL` (RFC 8707; the single source of the expected audience, IDENTITY-4/AGENT-8).

Any token defect (signature, `iss`, `exp`, `aud`, unknown key while Authelia's keys are reachable) returns HTTP 401
with a `WWW-Authenticate` header pointing at the agent's RFC 9728 protected-resource metadata. When the token's key
cannot be judged because Authelia's signing keys cannot be fetched, the agent returns HTTP 503 without
`WWW-Authenticate`, the same contract as an identity outage (owner sign-off 2026-11-16). That metadata names Authelia as the authorization server. The agent stops accepting identity-minted OAuth
tokens. It issues no tokens and keeps no per-request state (`instance_count > 1` stays safe). Clients are
pre-registered in Authelia; there is no dynamic client registration. Authelia is configured to include the `email`
claim in access tokens (spike item), and the agent never logs a token or its `email` claim. With an invalid issuer configuration (FR-14), the agent answers
503 without `WWW-Authenticate` before examining the token.

FR-3. **Account resolution per environment.** A new identity RPC
`ResolveExternalIdentity(issuer, subject, email)` returns `{user_id, roles, is_active, outcome}`. Email comparison is
case-insensitive throughout (lowercased before comparing), and a created user's email is stored lowercased. It
resolves in this order:
  1. An existing `(issuer, subject)` link to an **active** user returns that user (`outcome = LINKED_EXISTING`).
  2. Else, exactly one **active, unlinked** row matching the email is linked (`LINKED_BY_EMAIL`).
  3. Else, if no row of any state matches the email, a user is created with roles written explicitly as `{trader}`
     and linked (`CREATED`).
  4. Anything else is refused with gRPC `FAILED_PRECONDITION` (raw code 9, IDENTITY-3) and one of these details:
     - `email required`: the subject is unlinked and the token's `email` is absent or empty (nothing is created);
     - `account inactive`: the linked user is inactive, or the only match is an inactive unlinked row;
     - `account already linked`: the only match is linked to another subject;
     - `ambiguous email`: several rows match.

  Link and create are a single atomic write keyed on `(issuer, subject)` (IDENTITY-13). Concurrent first logins for one
  subject therefore yield exactly one link and at most one created user. A raw unique-constraint race (`23505`), or a
  link write that affected zero rows, is re-classified once from step 1, *before* `mapDbError` (IDENTITY-11). A best-effort, post-commit, allow-listed ledger audit records each
  link and create through `auditSafe` (IDENTITY-7). Its payload is `user_id`, `issuer` and `outcome` only, with no email
  and no token. A ledger outage never fails the login. Each environment resolves against its own `identity.users`;
  prod and staging never share links.

FR-4. **Authorisation of `ResolveExternalIdentity`.** The RPC is authorised **only** by the exact mTLS peer SAN
`xstockstrat-ui` or `xstockstrat-agent`, checked before any DB access. It ignores every caller-supplied header
(`x-user-id`, `x-access-scope`, `x-internal-caller`). This follows the `ListAdminUserIds` precedent (IDENTITY-12,
`src/grpc/adminDirectory.ts`). Any other peer gets `PERMISSION_DENIED`.
`IssueSessionForUser` (see Proto Contract Changes) is authorised the same way, but only for peer SAN
`xstockstrat-ui`; it refuses an inactive user with `FAILED_PRECONDITION` `account inactive`.

FR-5. **Email sync.** On every successful resolution, if the token's lowercased `email` differs from
`identity.users.email`, it is copied in. If another row already holds that email (case-insensitive), the old value is
kept and a `warn` log records `email_sync_conflict` with `user_id` and `issuer` (no email values). Authelia is the only
source of emails; xstockstrat offers no change-email path to end users.

FR-6. **Roles stay in xstockstrat.** Roles remain `identity.users.roles` per environment, managed only through
`SetUserRoles` / `manage_user` / `manage-users.py update-roles`. The role → `x-access-scope` bitmask mapping
(`services/xstockstrat-ui/src/lib/auth.ts` `rolesToAccessScope`, `services/xstockstrat-agent/app/scopes.py`
`roles_to_access_scope`) is unchanged (PLAT-5).

FR-7. **MCP identity and scope narrowing.** For every MCP request the agent stamps the **resolved `user_id`**, never the
Authelia `sub`, and the **effective scope** onto the request claims that `_caller_user_id` / `_caller_access_scope`
read (AGENT-3/3b/4, PLAT-4). The effective scope is
`roles_to_access_scope(roles) & scopes_to_mask(granted scopes)`. The granted scopes are the token's `scp` array (Authelia's
form, confirmed by the spike), or a space-delimited `scope` string if `scp` is absent. The OAuth scopes are:
- `xstockstrat.read` → READ 0x01
- `xstockstrat.write` → WRITE 0x02
- `xstockstrat.admin` → ADMIN 0x04
- `xstockstrat.trade` → TRADING 0x08

A token can only narrow the user's roles, never widen them. A token with none of these scopes has effective scope 0.

FR-8. **Role cache.** The agent caches `ResolveExternalIdentity` results for at most 60 s per `(issuer, subject)`. When
identity is unreachable and the entry has expired, the request returns HTTP 503 (today's
`_send_identity_unavailable` contract, `app/main.py`) and no backend RPC is sent.
This failure is an explicit refusal, not a truthy sentinel (the `IDENTITY_UNAVAILABLE` pattern in `app/auth.py` is
not reused). A deactivated user or a changed role takes effect on MCP within that TTL. An MCP request whose
resolution is refused (any FR-3 step-4 refusal) returns HTTP 403 and sends no backend RPC.

FR-9. **Password login flag.** Password login (`AuthenticateUser` and the UI's password form) is gated by `identity` /
`auth.password_login_enabled`.
- The code default is `false` (fail closed). Migration `051` seeds `true` on every database, DigitalOcean and homelab
  alike, so every deployment keeps password login until its own cutover.
- With it `false` or missing, `AuthenticateUser` returns `PERMISSION_DENIED` "password login disabled".
  - In SSO mode the login page shows only "Sign in with SSO".
  - In legacy mode (FR-14) the login page still renders the password form and is never hidden, plus a banner: "Password
    login is disabled in config (identity/auth.password_login_enabled) while SSO is not configured. Ask an admin."
  - Recovery is one `SetConfig` back to `true`.
- With it `true`, password login works as today.
  - In SSO mode both options are shown (the rollback path).
  - In legacy mode only the password form is shown.
- The flag does not affect MCP.

FR-10. **Session lifetime.** A web session ends when its refresh token expires (`identity` / `jwt.refresh_ttl_seconds`)
or at the first refresh after the user is deactivated (`SetUserActive false`; `rotateRefreshToken` already refuses
inactive users). The access JWT stays usable until it expires (`jwt.access_ttl_seconds`). Removing a person from the
Authelia group blocks new logins only. Cutting an existing session needs `SetUserActive false`, as homelab-edge
`docs/runbooks/sso.md` § 4 instructs.

FR-11. **Authorized apps page.** In SSO mode (FR-14), `/accounts/authorized-apps` no longer lists or revokes xstockstrat OAuth grants. It
explains that connected apps are managed in Authelia and links to the Authelia URL derived from `ui` /
`oidc.issuer`. It keeps the connector URL with its copy button, and shows the pre-registered MCP client IDs (full and
read-only) for the deployment's environment, read from `ui` / `oidc.mcp_client_id` and `ui` / `oidc.mcp_client_id_readonly`,
with the instruction to paste them into the connector's advanced OAuth settings (owner decision 2026-11-16). The UI's
own copies of the agent's discovery documents (`/.well-known/oauth-protected-resource/agent` and
`/.well-known/oauth-authorization-server/agent`, `src/app/api/oauth/*`) follow the same mode: in SSO mode the
protected-resource document names Authelia exactly like the agent's, and the authorization-server document answers 404.

FR-12. **Admin email tooling.** `scripts/manage-users.py` gains `update-email <old-email> <new-email>` (tested Python,
`docs/patterns/script-tooling.md`, inside feature 324's CI/ruff scope). It lets admins align an existing row's email
with the person's Authelia email before their first SSO login (cutover option B, homelab-edge
`docs/runbooks/sso.md` § 6). It stores the new email lowercased, keeps `user_id`, and exits non-zero with
"email already in use" when another row holds the email case-insensitively. It also gains `unlink-sso <email>
[--issuer <url>]`, which deletes that user's rows in `identity.external_identities` (all issuers unless `--issuer` is
given) so the next SSO login links by email again. This is the recovery path homelab-edge `docs/runbooks/sso.md` § 7
and § 8 rely on (owner decision 2026-11-16).

FR-13. **Documentation.** The same PR as each behaviour change updates:
- `docs/runbooks/mcp-tools.md`: connector setup with the pre-registered client IDs `xstockstrat-mcp-claude` (full) and
  `xstockstrat-mcp-claude-ro` (read-only), and `xstockstrat-staging-mcp-claude` / `xstockstrat-staging-mcp-claude-ro`
  for staging, with redirect URI `https://claude.ai/api/mcp/auth_callback`;
- the identity, ui and agent `CLAUDE.md` files (config keys, auth flow);
- AGENT-1 and AGENT-9 in `services/xstockstrat-agent/docs/context-constitution.md`: the watched namespaces now include
  `ui`, plus the new read sites in `app/sso_mode.py` and the SSO token validator;
- `docs/patterns/frontend-auth.md`;
- IDENTITY-15 in `services/xstockstrat-identity/docs/context-constitution.md` and `docs/patterns/database.md`: the
  seed email may be renamed by cutover, so new migrations resolve the seed owner by `SEED_USER_ID`, never by
  `admin@localhost`.

FR-14. **Backwards compatibility until cutover (per deployment).** The DigitalOcean apps (`.do/app.yaml`,
`.do/app.dev.yaml`) and the homelab deployment (`deploy/homelab/compose.yml`) have separate databases and so separate
config rows. Each deployment runs in exactly one mode, chosen by its own config, with no image or env change.

- **Legacy mode**: `ui` / `oidc.issuer` and `agent` / `oidc.issuer` are empty. This is the seeded default, so every
  deployment starts here, the DO apps included, and behaves as before this feature, apart from the both-mode changes
  (among them: the "Sign out" button, JSON on an expired-session logout, 403 on a logout from a foreign `Origin` (FR-15),
  logout revoking only a signature-valid session (feature 319), and FR-9's fail-closed default for a missing flag row):
  - password login works (`auth.password_login_enabled` is seeded `true`);
  - the login page shows no SSO button;
  - the agent keeps today's OAuth 2.1 server (DCR, identity-minted, `aud`-bound tokens validated via `ValidateToken`);
  - `/accounts/authorized-apps` lists and revokes those grants.

  The new RPCs, table and keys exist but are unused.
- **SSO mode**: both issuers are set. FR-1, FR-2, FR-7, FR-8, FR-11 and FR-15 apply (the "Sign out" button itself is shown in both modes) (FR-3/4/5 are reached only through
  them; FR-10 applies in both modes). The agent rejects identity-minted tokens,
  and its legacy OAuth routes answer 404, so a deployment never accepts both token kinds at once.
- **SSO mode with invalid configuration**: both issuers are set, but either is not a valid issuer URL, or `APP_URL` is not
  exactly a `scheme://host[:port]` origin. A valid issuer is https, or http only on `localhost`, `127.0.0.1` or `[::1]`. Its
  host is a canonical lowercase name: no IP address except loopback, no IDN or `xn--` labels, no default port. It has no
  userinfo, query, fragment or `%`, and no trailing slash or empty path segment. The deployment stays in SSO mode with a
  configuration error:
  - the login page still shows "Sign in with SSO", and SSO sign-in returns "SSO not configured" without contacting
    Authelia;
  - the UI's protected-resource document answers 503;
  - an invalid **issuer** also makes every MCP call, and the agent's protected-resource document, answer 503 without
    `WWW-Authenticate`;
  - the UI logs `sso_issuer_invalid` (issuer) or `app_url_invalid` (`APP_URL`); the agent logs `sso_issuer_invalid`.
    Each is logged once per distinct value.
- **SSO mode with unreadable configuration** (the config service is unreachable or times out): the login page renders the
  legacy login (AC-46). `POST /api/auth/sso/start` and the callback return "Sign-in failed. Try again." (`?error=failed`)
  and start no flow.
- `/api/auth/sso/start` is POST-only (a GET returns 405 in every mode). In SSO mode, a POST whose `Origin` header is
  missing or is not the app's origin returns "Sign-in failed. Try again." and starts no flow. The configuration check
  comes first: with an invalid configuration, every POST returns "SSO not configured" whatever its `Origin`.
- **Cutover for one deployment** is a config change only: set the `ui.oidc.*` and `agent.oidc.issuer` keys, then set
  `auth.password_login_enabled` to `false`. Clearing the two issuers returns that deployment to legacy mode (the MCP
  rollback path; redeploying the previous release remains possible).
- Outside SSO mode (legacy or half-configured), a POST to `/api/auth/sso/start` and a GET to `/api/auth/sso/callback`
  return 404, start no flow, and never call `ResolveExternalIdentity`. `/start` is POST-only: a GET returns 405 in every
  mode.
- A half-configured deployment (exactly one issuer set) is treated as legacy mode on both surfaces, and the agent and
  UI each log `sso_mode_misconfigured` once per process start.

FR-15. **SSO logout and refusals.** In SSO mode, `/api/auth/logout` revokes the session exactly as today. Then it always redirects
the browser to Authelia's logout, which also ends the person's Authelia session for every other app. The target is
the standard `end_session_endpoint` (RP-Initiated Logout, `post_logout_redirect_uri = ${APP_URL}/auth/login`) when
Authelia's discovery document advertises one. Otherwise it is Authelia's portal logout, with a redirect back to
`${APP_URL}/auth/login` (owner decision 2026-11-16, superseding the earlier "or documentation only" fallback). When Authelia answers the authorization request with `error=access_denied` (the person is not in the
app's group), the login page shows "You don't have access to xstockstrat. Ask an admin." (owner decision 2026-11-16).
Every other IdP error shows "Sign-in failed. Try again." The UI gains a "Sign out" button in the shared header, in both modes; before this feature nothing in the UI called
logout. If the UI cannot read its config at logout time, logout ends only the xstockstrat session and logs a warning
`sso_logout_mode_unknown`; the Authelia session survives (owner decision 2026-11-16). In **both modes**, a logout request
whose `Origin` header is present and is not the app's own origin (`APP_URL`) is refused with 403 and changes nothing:
no revoke, no cookie change (owner decision 2026-11-16, P-2). A request with no `Origin` header is unaffected, and a cookie-less cross-origin POST is redirected to the login page
as today (middleware). The Origin check is skipped, with the `app_url_invalid` error logged, when `APP_URL` itself is
invalid, because there is then no app origin to compare against. With an invalid configuration (FR-14), logout ends
only the xstockstrat session: no redirect to Authelia, so the browser returns to the login page.

## Out of Scope

- Authelia itself: deployment, Caddy routes, `auth.<domain>`, users, groups, client registration (including the client
  IDs named in FR-13 and the access-token `email` claim) live in `davcs86/homelab-edge` (separate PR).
- commsgun and webhooks-mcp SSO (their own repositories).
- Removing the old OAuth server (kept for legacy mode, FR-14, until every deployment has cut over), `RegisterOAuthClient`/`IssueAuthCode`/`ExchangeAuthCode`/`RefreshOAuthToken`/
  `ListAuthorizedApps`/`RevokeAuthorizedApp`, the `oauth_clients`/`oauth_auth_codes` tables, the `agent.oauth.*` keys, or
  `AuthenticateUser`. Removing an RPC is a breaking proto change; that waits for a follow-up feature after the
  rollback window. Until then the old agent OAuth routes stay as they are, and their fail-closed behaviour is owned by
  feature 319.
- Changing `SEED_USER_ID`, or editing analysis `029` / identity `002` (applied migrations, F-01).
- Self-service email or username changes for users.
- Authorisation gaps on WRITE paths to shared resources (see Risks).
- Gatus/Proxmox SSO (homelab-edge, a later phase).

## Affected Services

- `xstockstrat-identity`: `ResolveExternalIdentity` and `IssueSessionForUser` (both SAN-gated), `external_identities`,
  email sync, the password-login gate; the table `manage-users.py unlink-sso` deletes from.
- `xstockstrat-ui`: OIDC login, callback and the SSO "keep me signed in" checkbox; the login page per the flag; the
  `/accounts/authorized-apps` page; the SSO logout redirect (FR-15) and the shared-header "Sign out" button; the
  `/api/oauth/{protected-resource,authorization-server}` discovery routes; the middleware public/cookie-gated path sets.
- `xstockstrat-agent`: JWKS validation, protected-resource metadata, resolved-identity stamping, scope narrowing, the
  role cache.
- `xstockstrat-config`: seed migration `051`, and a `SECRET_CALLER_ALLOWLIST` grant (`src/grpc/authz.ts`, PLAT-9):
  `{callerID: 'ui', namespace: 'ui', keys: ['oidc.client_secret'], peerSan: 'xstockstrat-ui'}`.
- `packages/proto`: an additive `identity.proto` change.

## Consumer Surface(s)

- [x] **UI** (`xstockstrat-ui`), SSO mode unless noted (legacy mode is otherwise unchanged, FR-14; the exceptions, owner sign-off 2026-11-16, are a "Sign out" button in the shared header in both modes, logout with an expired session answering JSON instead of a redirect, and a cookie-bearing logout from a foreign `Origin` answering 403):
  - The login page (`src/app/auth/login`, shared by `/trader`, `/insights` and `/config-ui`) gets a "Sign in with SSO" button next to a "Keep me signed in for 14 days (SSO)" checkbox. The password form is shown only when the flag
    is on.
  - The page reads the mode and the flag server-side (today it is a `'use client'` page rendering `CredentialsForm`).
    An unreadable config renders the legacy login: password form, no SSO button.
  - `src/app/auth/oauth-login` (the login step of the agent's legacy OAuth flow) is unchanged. It is used only in legacy
    mode; in SSO mode its flow is unreachable, because the agent's `/oauth/*` routes answer 404.
  - `/accounts/authorized-apps` becomes a pointer to Authelia (FR-11).
- [x] **Agent** (`xstockstrat-agent`): every MCP tool's authentication and effective scope changes; no tool name,
  parameter or response changes. Connector setup moves to pre-registered read-only and full clients.
- [x] **Script**: `scripts/manage-users.py update-email` and `unlink-sso`.

## Proto Contract Changes

Additive only (non-breaking), in `packages/proto/identity/v1/identity.proto`:
- `rpc ResolveExternalIdentity(ResolveExternalIdentityRequest) returns (ResolveExternalIdentityResponse)`.
- `ResolveExternalIdentityRequest { string issuer; string subject; string email; }`.
- `ResolveExternalIdentityResponse { string user_id; repeated Role roles; bool is_active; ExternalIdentityOutcome outcome; }`.
- `enum ExternalIdentityOutcome { EXTERNAL_IDENTITY_OUTCOME_UNSPECIFIED = 0; ..._LINKED_EXISTING = 1; ..._LINKED_BY_EMAIL = 2; ..._CREATED = 3; }`.
- Refusals are gRPC statuses, not outcome values: `FAILED_PRECONDITION` with the FR-3 details, `PERMISSION_DENIED`
  for a peer not in the FR-4 SAN list.
- Session tokens for the UI come from a new `rpc IssueSessionForUser(IssueSessionForUserRequest{ string user_id; })
  returns (AuthTokenResponse)`. It is SAN-gated to `xstockstrat-ui` only and refuses an inactive user. It reuses the
  `AuthenticateUser` mint path (env `JWT_SECRET`, `identity.refresh_tokens`).
- Field numbers are fixed by design D-11. The messages are new, so their fields are numbered from 1: request fields 1–3,
  response fields 1–4. `buf breaking` against `main-dev` stays green because the change is purely additive.

## Config Key Changes

One seed migration: `services/xstockstrat-config/migrations/051_authelia_sso_keys` (up + down; last applied is `050` (feature 341),
C-07). It seeds every key below for both `production` and `staging`. Operators then set the real values per
environment, because prod and staging are separate Authelia apps.

- `identity.auth.password_login_enabled`
  - namespace `identity`, stored key `auth.password_login_enabled`, `bool`;
  - code default `false` (fail closed); seeded `true` until cutover;
  - readers:
    - `services/xstockstrat-identity/src/grpc/identityServiceImpl.ts:authenticateUser`, through the WatchConfig
      watcher, live;
    - `services/xstockstrat-ui/src/lib/oidcConfig.ts:loadPasswordLoginEnabled` (new), called by
      `src/app/auth/login/page.tsx`, one-shot `GetConfig(namespace: 'identity')` per render, live on the next page
      load.
- `ui.oidc.issuer`
  - namespace `ui`, stored key `oidc.issuer`, `string`, code default `""`;
  - empty means legacy mode (FR-14): no SSO button, and today's password login;
  - readers:
    - `services/xstockstrat-ui/src/lib/oidcConfig.ts:loadOidcConfig` (new), called by the login page,
      `src/app/api/auth/sso/start/route.ts:POST`, `src/app/api/auth/sso/callback/route.ts:GET` (new), the logout route,
      `/accounts/authorized-apps` and the two `src/app/api/oauth/*` discovery routes. One-shot
      `GetConfig(namespace: 'ui')` per request, live on the next request.
    - `services/xstockstrat-agent/app/sso_mode.py:current_sso_mode` (new), for the half-configured check (FR-14), through
      `read_config_value('ui', 'oidc.issuer')`. This requires adding `ui` to `WATCHED_NAMESPACES`
      (`app/config/watcher.py`, AGENT-9: an unwatched namespace silently reads `None`). Live through the snapshot.
- `ui.oidc.client_id`
  - namespace `ui`, stored key `oidc.client_id`, `string`, code default `""` (empty is handled as above);
  - same reader and mechanism as `ui.oidc.issuer`: `src/lib/oidcConfig.ts:loadOidcConfig`, one-shot per request,
    live on the next request.
- `ui.oidc.client_secret`
  - namespace `ui`, stored key `oidc.client_secret`, `string`, encrypted `is_secret` row, seeded with the `[redacted]`
    sentinel and a NULL ciphertext, which `GetSecret` reports as `found=false` (unset);
  - code default `""`: empty in SSO mode means `/start` and the callback fail with "SSO not configured" (fail closed), and logout
    falls back to the portal URL;
  - reader `services/xstockstrat-ui/src/lib/oidcConfig.ts:loadOidcClientSecret` (new), called by
    `src/app/api/auth/sso/start/route.ts:POST`, `src/app/api/auth/sso/callback/route.ts:GET` and the logout route, through
    `GetSecret` via the allow-list grant above. A rotated value applies on the next request (the cached OIDC
    Configuration is keyed on the secret's hash). It is redacted at every other edge.
- `ui.oidc.mcp_client_id` and `ui.oidc.mcp_client_id_readonly`
  - namespace `ui`, stored keys `oidc.mcp_client_id` / `oidc.mcp_client_id_readonly`, `string`, code default `""`
    (an empty value hides that line on the card);
  - reader `services/xstockstrat-ui/src/lib/oidcConfig.ts:loadOidcConfig`, one-shot `GetConfig(namespace: 'ui')` per
    request, live on the next request; displayed on `/accounts/authorized-apps` (FR-11).
- `agent.oidc.issuer`
  - namespace `agent`, stored key `oidc.issuer`, `string`, code default `""`;
  - empty means legacy mode (FR-14): today's OAuth server and identity-token validation, unchanged;
  - readers (all new code):
    - `services/xstockstrat-agent/app/sso_mode.py:current_sso_mode`, the SSO token validator (new) and the
      protected-resource metadata builder in `services/xstockstrat-agent/app/main.py`. All read through
      `read_config_value('agent', 'oidc.issuer')` (AGENT-9; `agent` is in `WATCHED_NAMESPACES`), live through the
      snapshot.
    - `services/xstockstrat-ui/src/lib/oidcConfig.ts:loadOidcConfig`, for the half-configured check (FR-14) and the
      protected-resource document (`src/app/api/oauth/protected-resource/route.ts`): a one-shot `GetConfig(namespace: 'agent')` per request, live on the next request.

The expected MCP audience is `AGENT_PUBLIC_URL`. No new key duplicates it (AGENT-6/AGENT-8).

The seed migration and the new readers must leave `node scripts/check-config-wiring.mjs --final` with zero findings
(the CI `config-wiring` job).
- Add a `registry.receivers` entry in `scripts/config-wiring.json` only for a reader binding the checker cannot resolve.
  `src/lib/oidcConfig.ts` reads three namespaces (`ui`, `identity`, `agent`), so it uses one binding per namespace.
- Never add a `findings` baseline entry for these keys: a correctly wired key in the baseline fails as `STALE`
  (`docs/patterns/config-governance.md` § Baseline).

## Database Changes

- identity migration `007_external_identities` (up + down):
  - `identity.external_identities (issuer TEXT NOT NULL, subject TEXT NOT NULL, user_id UUID NOT NULL REFERENCES
    identity.users(user_id) ON DELETE CASCADE, linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (issuer,
    subject), UNIQUE (issuer, user_id))`;
  - an index on `lower(identity.users.email)` for the case-insensitive match.
- config migration `051_authelia_sso_keys` (above).
- No applied migration is edited (F-01).

## Feature Workflow Notes

Branch to create: `feature/authelia-sso` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto or config change)
- [ ] 2 service owners + platform lead (breaking proto change)
- [x] DBA review + service owner (schema migration)
- [x] Config team + owner (new config keys, `GetSecret` allow-list grant)

Soft merge order (rebase only): `319-fix-auth-trust-hardening` (same `identityServiceImpl.ts`; owns the old
`oauth_server.py` fail-closed behaviour) and `324-fix-ci-enforcement-gaps` (CI gate over `manage-users.py`) before
this feature. `331-fix-agent-mcp-transport-fallthrough` and `323-fix-orphaned-code` also edit `app/main.py`, so expect a rebase.

**First gate: the Authelia spike (v4.39.28, pinned by digest in homelab-edge).** Before `/sdd-spec`, prove on the
pinned release:
- (a) Claude.ai and Claude Code complete MCP auth with a pre-registered public client sending RFC 8707 `resource`;
- (b) JWT access tokens carry `aud` = resource, the granted `scope`, and the `email` claim;
- (c) custom scopes `xstockstrat.*` are accepted;
- (d) whether group membership is re-checked on refresh;
- (e) `sub` is stable per username.

If (a) or (b) fails, the design falls back to option F: keep the agent's OAuth server and delegate only its login to
Authelia.

**Spike result (2026-11-16, local Authelia v4.39.28, release checksum-verified; details in `context.md`):**
- (a) and (c)–(e) behave as follows; option F is **not** needed:
  - (a) Pre-registered public clients with `resource` work. A foreign `resource` gets `invalid_target`.
  - (c) The `xstockstrat.*` scopes are granted, and a client can request only its configured scopes.
  - (d) Group membership is **not** re-checked on refresh; disabling the user in Authelia does stop refresh.
  - (e) `sub` is a stable per-user UUID across sessions and clients.
- (b) holds with two qualifications:
  - The granted scopes arrive as an `scp` array, not a `scope` string.
  - `aud` is present without `resource` only when the client sets `requested_audience_mode: implicit`.
- Authelia config requirements, owned by homelab-edge:
  - an ID-token claims policy with `email`;
  - an access-token claims policy with `email`;
  - `requested_audience_mode: implicit` on the MCP clients.
- Logout: Authelia 4.39 advertises no `end_session_endpoint`, so logout uses the portal branch.
- Still unverified until cutover: the Claude.ai and Claude Code client side of (a), which the local spike cannot exercise.

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Risks (accepted or owned elsewhere)

- **Trader WRITE on shared resources, accepted by the owner (2026-11-15).** New users start as `trader`. marketdata
  `BackfillBars` (`services/xstockstrat-marketdata/internal/handler/marketdata_handler.go:119-124`) has no admin check,
  so a trader can spend the shared vendor quota and fill the shared bars tables. The owner accepted this for
  family-only users and chose not to make a fix a prerequisite.
- **Analysis 029 re-run after cutover, accepted (IDENTITY-15).** The 029 migration has already run in both
  environments. Renaming `admin@localhost` (FR-12) makes a later re-run of 029 on that database (dirty-recovery,
  `scripts/migration-rerun.py`) seed nothing. CI's harness (`scripts/migration-assertions/analysis-029.sql`) uses a
  fresh database and is unaffected. Handled by documentation (FR-13): new migrations resolve the owner by
  `SEED_USER_ID`.
- **Statelessness (insights.md, 072, FR-B13).** The role cache is per instance. It stays correct with
  `instance_count > 1` only because it is bounded by its TTL and fails closed.
- **Dependency on the edge.** Authelia down blocks new web logins and MCP token refreshes (web session refresh goes through identity only); issued tokens and sessions keep
  working until they expire.

## Open Questions

- None. All product decisions are recorded in `context.md` (Sessions 2026-11-15).
