# Product Spec: authelia-sso

**Created**: 2026-11-15
**Amended**: 2026-11-24 (re-spec against homelab-edge `docs/superpowers/specs/2026-11-23-authelia-sso-respec.md`; see `context.md`); 2026-11-27 (owner: no stale signing keys, no Claude Code clients on the homelab; Link requests send `max_age=1`, spike S17; see `context.md`)

---

## Problem Statement

xstockstrat runs its own password login and its own OAuth 2.1 authorization server for MCP. The login has no MFA
and no lockout; the homelab edge's Caddy rate limits are its only brute-force control
(`davcs86/homelab-edge` `docs/decisions.md`, "Login hardening is upstream's gap"). The homelab now standardises on
Authelia as the single login and token issuer for its apps (homelab-edge
`docs/superpowers/specs/2026-11-23-authelia-sso-respec.md`, owner-approved 2026-11-23, "the SSO spec" below;
`docs/decisions.md` "SSO is Authelia"; `docs/runbooks/sso.md`). xstockstrat must become a **provider-neutral** OIDC
client and OAuth resource server of that issuer without losing its own user store, its per-environment roles or the
DigitalOcean deployments, which keep password login (SSO spec decision 2).

## User Story

As a platform admin, I want each xstockstrat deployment (homelab prod and staging, web UI and MCP agent) to be able to
authenticate users through an external OIDC issuer, chosen per deployment by one config key, while `identity.users`
stays the only user store, every user keeps a local password, and an SSO identity reaches an account only through an
explicit "Link SSO", so family members get one login with passkey/TOTP 2FA, MCP connectors can be narrowed, and the
DigitalOcean deployments keep working unchanged.

## Functional Requirements

FR-1. **Web login via the issuer.** `xstockstrat-ui` logs users in with the OIDC authorization-code flow (confidential
client, PKCE S256). The callback rejects a mismatched `state` or `nonce`, or an ID token that fails
signature/`iss`/`aud`/`exp` checks, and creates no session. On success it calls `ResolveExternalIdentity` (FR-3) with
the ID token's `iss` and `sub`, and then receives the **existing** session token pair (identity-minted access JWT +
identity-backed refresh token, signed with env `JWT_SECRET` per IDENTITY-1) for the resolved user through
`IssueSessionForUser`. The session-cookie, middleware, header-propagation (`x-user-id`, `x-access-scope`, `x-trace-id`)
and refresh paths are unchanged. The login page shows a "Keep me signed in for 14 days (SSO)" checkbox next to "Sign in
with SSO". Its value, and the post-login redirect, travel bound to the OIDC `state`: they are stored in the encrypted,
httpOnly SSO-transaction cookie keyed by the random `state` value (owner decision 2026-11-16). The callback passes it to
`setSessionCookies` exactly as the password path does today (UI-8). A `not linked` refusal shows "Your single sign-on
account isn't linked to an xstockstrat account. Sign in with your password and choose Link SSO, or ask an admin." in
`both`, and "Your single sign-on account isn't linked to an xstockstrat account. Ask an admin." in `oidc`; an `account inactive` refusal shows
"This account is disabled. Ask an admin." Each refusal returns to the login page with an `error` query value
(`not_linked`, `inactive`) and sets no session cookie. With an invalid configuration (FR-14), sign-in fails with "SSO
not configured" (`?error=not_configured`) and no request reaches the issuer. FR-1 applies in `both` and `oidc`.

FR-2. **MCP as a resource server (`oidc` only).** With `auth.mode = oidc` (FR-14), `xstockstrat-agent` accepts **only**
JWT access tokens from the configured issuer on its MCP endpoint. A token passes only if all of these hold, against the
issuer's cached JWKS:
- a valid signature;
- `iss` equals the configured issuer;
- `exp` is in the future;
- `aud` equals `AGENT_PUBLIC_URL` (RFC 8707; the single source of the expected audience, IDENTITY-4/AGENT-8).

Any token defect (signature, `iss`, `exp`, `aud`, unknown key while the issuer's keys are reachable) returns HTTP 401
with a `WWW-Authenticate` header pointing at the agent's RFC 9728 protected-resource metadata. When the token's key
cannot be judged because the issuer's signing keys cannot be fetched, the agent returns HTTP 503 without
`WWW-Authenticate`, the same contract as an identity outage (owner sign-off 2026-11-16). That metadata names the issuer
as the authorization server. The agent stops accepting identity-minted OAuth tokens. It issues no tokens and keeps no
per-request state (`instance_count > 1` stays safe). Clients are pre-registered at the issuer; there is no dynamic client
registration. The agent never logs a token. With an invalid issuer configuration (FR-14), the agent answers 503 without
`WWW-Authenticate` before examining the token. In `local` and `both` the agent keeps today's built-in OAuth server
(owner decision 2026-11-24).

FR-3. **Account resolution per environment (link lookup only).** A new identity RPC
`ResolveExternalIdentity(issuer, subject)` returns `{user_id, roles, is_active}` for the user linked to `(issuer,
subject)`. It writes nothing. It refuses with gRPC `FAILED_PRECONDITION` (raw code 9, IDENTITY-3) and one of these
details:
  - `not linked`: no `identity.external_identities` row holds the pair;
  - `account inactive`: the linked user is inactive.

There is no matching by email and no user creation (owner, SSO spec decisions 7 and 8, 2026-11-24): a link exists only
through FR-16, and every xstockstrat user keeps a local password. Each environment resolves against its own
`identity.users`; prod and staging never share links.

FR-4. **Authorisation of the new RPCs.** Each is authorised **only** by the exact mTLS peer SAN, checked before any DB
access, ignoring every caller-supplied header (`x-user-id`, `x-access-scope`, `x-internal-caller`), following the
`ListAdminUserIds` precedent (IDENTITY-12, `src/grpc/adminDirectory.ts`). Any other peer gets `PERMISSION_DENIED`.
- `ResolveExternalIdentity`: `xstockstrat-ui` or `xstockstrat-agent`.
- `IssueSessionForUser` (see Proto Contract Changes): `xstockstrat-ui` only; it refuses an inactive user with
  `FAILED_PRECONDITION` `account inactive`.
- `LinkExternalIdentity` (FR-16): `xstockstrat-ui` only; outside `both` it refuses with `FAILED_PRECONDITION` `link disabled` before any database access.
- `GetExternalIdentityLinks` (FR-16): `xstockstrat-ui` only; returns the issuers the given user is linked to.
- `GetSecret` for `ui` / `oidc.client_secret`: `xstockstrat-ui` only, through a `SECRET_CALLER_ALLOWLIST` grant
  (PLAT-9); the UI sends header `x-internal-caller: ui` and presents peer SAN `xstockstrat-ui`, and both are required; every other caller gets `PERMISSION_DENIED`, and `GetConfig`/`WatchConfig` return the row redacted.

FR-5. *(Removed 2026-11-24, owner: no email sync. xstockstrat owns its users' emails, SSO spec decision 6; the IdP email
is shown on the link confirmation only, FR-16, and never stored.)*

FR-6. **Roles stay in xstockstrat.** Roles remain `identity.users.roles` per environment, managed only through
`SetUserRoles` / `manage_user` / `manage-users.py update-roles`. The role → `x-access-scope` bitmask mapping
(`services/xstockstrat-ui/src/lib/auth.ts` `rolesToAccessScope`, `services/xstockstrat-agent/app/scopes.py`
`roles_to_access_scope`) is unchanged (PLAT-5). The issuer's groups gate only who may open the app (SSO spec decision 6).

FR-7. **MCP identity and scope narrowing (`oidc`).** For every MCP request the agent stamps the **resolved `user_id`**,
never the issuer's `sub`, and the **effective scope** onto the request claims that `_caller_user_id` /
`_caller_access_scope` read (AGENT-3/3b/4, PLAT-4). The effective scope is
`roles_to_access_scope(roles) & scopes_to_mask(granted scopes)`. The granted scopes are the token's `scp` array
(Authelia's form, confirmed by the 2026-11-16 spike), or a space-delimited `scope` string if `scp` is absent. The OAuth
scopes are:
- `xstockstrat.read` → READ 0x01
- `xstockstrat.write` → WRITE 0x02
- `xstockstrat.admin` → ADMIN 0x04
- `xstockstrat.trade` → TRADING 0x08

A token can only narrow the user's roles, never widen them. A token with none of these scopes has effective scope 0.

FR-8. **Role cache.** The agent caches `ResolveExternalIdentity` results for at most 60 s per `(issuer, subject)`. When
identity is unreachable and the entry has expired, the request returns HTTP 503 (today's
`_send_identity_unavailable` contract, `app/main.py`) and no backend RPC is sent. This failure is an explicit refusal,
not a truthy sentinel (the `IDENTITY_UNAVAILABLE` pattern in `app/auth.py` is not reused). A deactivated user, a removed
link or a changed role takes effect on MCP within that TTL. An MCP request whose resolution is refused (`not linked` or
`account inactive`) returns HTTP 403 with a `text/plain` body `not linked` or `account inactive`, and sends no backend RPC. Any other refusal
detail returns 503 without `WWW-Authenticate`.

FR-9. **One mode key: `identity` / `auth.mode`.** It replaces both the issuer-presence switch and
`auth.password_login_enabled` of the 2026-11-16 design (SSO spec § 3). Values `local` | `both` | `oidc`; code default
and seed `local` on every database, DigitalOcean and homelab alike. A missing row reads as `local` without logging
`auth_mode_invalid`; any other value, including an empty string, reads as `local` and logs `auth_mode_invalid` once per
distinct value on each reading surface (identity parses the value at startup and on every config update, not only at
login).
- `AuthenticateUser` refuses with `PERMISSION_DENIED` "password login disabled" in `oidc` only.
- The login page renders per FR-14's table. Recovery from any mode is FR-17, which needs no login.

FR-10. **Session lifetime and offboarding.** A web session ends when its refresh token expires (`identity` /
`jwt.refresh_ttl_seconds`) or at the first refresh after the user is deactivated (`SetUserActive false`;
`rotateRefreshToken` already refuses inactive users). The access JWT, and the roles in it, stay usable until it expires
(`jwt.access_ttl_seconds`, default 900 s); a role change reaches the web session at the next refresh. This is a bounded
deviation from SSO spec § 3 "Sessions" (disabling a user or removing a role ends their sessions), recorded 2026-11-24. Removing a person from the issuer's group blocks new logins only. Offboarding a person
(homelab-edge `sso.md`) is `SetUserActive false` (ends sessions at the next refresh and refuses MCP within FR-8's TTL)
plus `manage-users.py unlink-sso` (FR-12).

FR-11. **Authorized apps page.** In `oidc` (MCP uses the issuer, FR-2), `/accounts/authorized-apps` no longer lists or
revokes xstockstrat OAuth grants. It explains that connected apps are managed at the issuer and links to the issuer URL
from `ui` / `oidc.issuer`. It keeps the connector URL with its copy button, and shows the pre-registered MCP client IDs
for the deployment's environment, read from `ui` / `oidc.mcp_client_id` and `oidc.mcp_client_id_readonly` (Claude.ai)
and `oidc.mcp_client_id_claude_code` and `oidc.mcp_client_id_claude_code_readonly` (Claude Code), with the instruction to
paste them into the connector's OAuth settings (owner decision 2026-11-16, extended 2026-11-24). In `local` and `both` the
page lists and revokes the built-in server's grants as today. The UI's own copies of the agent's discovery documents
(`/.well-known/oauth-protected-resource/agent` and `/.well-known/oauth-authorization-server/agent`,
`src/app/api/oauth/*`) follow the MCP mode: in `oidc` the protected-resource document names the issuer exactly like the
agent's, and the authorization-server document answers 404; in `local` and `both`, and whenever the UI cannot read the mode, both are as today (owner, 2026-11-24); in `oidc` the
protected-resource document answers 503 `no-store` when `agent` / `oidc.issuer` is invalid, empty or unreadable (FR-14).

FR-12. **Admin link tooling.** `scripts/manage-users.py` gains `unlink-sso <email> [--issuer <url>]` (tested Python,
`docs/patterns/script-tooling.md`, inside feature 324's CI/ruff scope). It deletes that user's rows in
`identity.external_identities` (all issuers unless `--issuer` is given), so the person can link again (FR-16), or so an
offboarded person's `sub` no longer resolves. `update-email` is out of scope (owner, 2026-11-24). Bootstrap and
break-glass stay the existing `create-user` and `reset-password` (the seeded admin is a migration row, not an env value),
which satisfies SSO spec decision 9 without new tooling.

FR-13. **Documentation.** The same PR as each behaviour change updates:
- `docs/runbooks/mcp-tools.md`: connector setup with the pre-registered client IDs `xstockstrat-mcp-claude` (full),
  `xstockstrat-mcp-claude-ro` (read-only), `xstockstrat-mcp-claude-code` and `xstockstrat-mcp-claude-code-ro`, and the
  `xstockstrat-staging-…` set for staging; redirect URIs `https://claude.ai/api/mcp/auth_callback` and
  `https://claude.com/api/mcp/auth_callback` (Claude.ai) and a loopback redirect (Claude Code, SSO spec S9);
- a runbook section for the mode lifecycle: cutover (`local` → `both` → link → `oidc`), rollback and break-glass with
  FR-17, linking (FR-16) and unlinking (FR-12);
- the identity, ui and agent `CLAUDE.md` files (config keys, auth flow);
- AGENT-1 and AGENT-9 in `services/xstockstrat-agent/docs/context-constitution.md`: the watched namespaces now include
  `identity`, plus the new read sites (the mode reader and the token validator);
- `docs/patterns/frontend-auth.md`;
- IDENTITY-15 in `services/xstockstrat-identity/docs/context-constitution.md` and `docs/patterns/database.md`: new
  migrations resolve the seed owner by `SEED_USER_ID`, never by `admin@localhost`.

FR-14. **Per-deployment mode until and after cutover.** The DigitalOcean apps (`.do/app.yaml`, `.do/app.dev.yaml`) and the
homelab deployment (`deploy/homelab/compose.yml`) have separate databases and so separate config rows. Each deployment
runs in exactly one mode, `identity` / `auth.mode` (FR-9), with no image or env change.

| Surface | `local` (default; DigitalOcean stays here) | `both` (linking window, break-glass) | `oidc` (homelab steady state) |
|---|---|---|---|
| Login page | password form | "Sign in with SSO" and the password form; the password form works while the issuer is unreachable | "Sign in with SSO" only |
| `AuthenticateUser` | works | works | `PERMISSION_DENIED` "password login disabled" |
| `/api/auth/sso/start`, `/callback` | 404, no flow, `ResolveExternalIdentity` never called | FR-1 | FR-1 |
| Link SSO (FR-16) | absent | available | absent |
| MCP (agent) | built-in OAuth server (DCR, identity-minted, `aud`-bound tokens via `ValidateToken`) | built-in OAuth server | issuer tokens only (FR-2); legacy `/oauth/*` routes 404 |
| `/accounts/authorized-apps` | lists and revokes legacy grants | lists and revokes legacy grants | pointer to the issuer (FR-11) |
| Logout | as today plus the every-mode changes of FR-15 (Origin 403, JSON on an expired session, the Sign-out button) | FR-15 SSO logout | FR-15 SSO logout |

- A deployment never accepts both MCP token kinds at once.
- **Invalid configuration**: the web SSO surfaces (in `both`/`oidc`) need a valid `ui` / `oidc.issuer`, a non-empty `ui` / `oidc.client_id` and a valid `APP_URL`; the
  agent (in `oidc`) needs a valid `agent` / `oidc.issuer`. A valid issuer is https, or http only on `localhost`,
  `127.0.0.1` or `[::1]`. Its host is a canonical lowercase name: no IP address except loopback, no IDN or `xn--`
  labels, no default port. It has no userinfo, query, fragment or `%`, and no trailing slash or empty path segment.
  `APP_URL` must be exactly a `scheme://host[:port]` origin. With an invalid or empty value:
  - with `ui` / `oidc.issuer`, `ui` / `oidc.client_id` or `APP_URL` invalid or empty, the login page still shows "Sign in with
    SSO", and SSO sign-in returns "SSO not configured" (`?error=not_configured`) without contacting the issuer (in `both`
    the password form still works), whatever the request's `Origin`. An unset `ui` / `oidc.client_secret` also returns "SSO
    not configured", but only after the `Origin` check;
  - in `oidc`, the UI's protected-resource document answers 503 `no-store` when `agent` / `oidc.issuer` (its only issuer
    input) is invalid, empty, or unreadable while the mode itself is readable (FR-11);
  - in `oidc`, an invalid agent issuer makes every MCP call, and the agent's protected-resource document, answer 503
    without `WWW-Authenticate`;
  - the UI logs `sso_issuer_invalid` (issuer) or `app_url_invalid` (`APP_URL`); the agent logs `sso_issuer_invalid`. Each
    is logged once per distinct value.
- **Unreadable configuration** (the config service is unreachable or times out): the login page renders the `local`
  login and the UI's two discovery documents (FR-11) are today's (AC-46). `POST /api/auth/sso/start` and the callback
  return "Sign-in failed. Try again." (`?error=failed`) and start no flow. `POST /accounts/api/sso/link` and
  `POST /accounts/api/sso/confirm` answer 503 `{"error":"failed"}`, and `GET /accounts/api/sso` answers 200 with
  `mode: "error"` and no Link action. Logout follows FR-15.
- `/api/auth/sso/start` is POST-only (a GET returns 405 in every mode). In `both`/`oidc`, a POST whose `Origin` header is
  missing or is not the app's origin returns "Sign-in failed. Try again." and starts no flow. The configuration check
  comes first: with an invalid configuration, every POST returns "SSO not configured" whatever its `Origin`.
- **Cutover for one deployment** is config only: set the `ui.oidc.*` keys and `agent.oidc.issuer`, set `auth.mode` to
  `both`, let each person sign in with their password and link (FR-16), then set `auth.mode` to `oidc`. Setting
  `auth.mode` back to `local` (FR-17) is the rollback; redeploying the previous release remains possible.

FR-15. **SSO logout and refusals.** In `both` and `oidc`, `/api/auth/logout` revokes the session exactly as today. Then, unless
one of the exceptions at the end of this requirement applies, it redirects the browser to the issuer's logout, which also ends the person's issuer session for every other app.
The target is the standard `end_session_endpoint` (RP-Initiated Logout, `post_logout_redirect_uri =
${APP_URL}/auth/login`) when the issuer's discovery document advertises one. Otherwise it is the portal logout, with a
redirect back to `${APP_URL}/auth/login` (owner decision 2026-11-16). When the issuer answers the authorization request
with `error=access_denied` (the person is not in the app's group), the login page shows "You don't have access to
xstockstrat. Ask an admin." (owner decision 2026-11-16). Every other IdP error shows "Sign-in failed. Try again." An IdP error answering a Link SSO request returns to
`/accounts/sso` instead when the browser still holds that request's unexpired link transaction (FR-16.2). The UI
gains a "Sign out" button in the shared header, in every mode; before this feature nothing in the UI called logout. If
the UI cannot read its config at logout time, logout ends only the xstockstrat session and logs a warning
`sso_logout_mode_unknown`; the issuer session survives (owner decision 2026-11-16). In **every mode**, a logout request
whose `Origin` header is present and is not the app's own origin (`APP_URL`) is refused with 403 and changes nothing: no
revoke, no cookie change (owner decision 2026-11-16, P-2). A same-origin logout whose access token has expired (only a
refresh token cookie is left) answers HTTP 200 JSON `{"ok": true}` and clears the cookies instead of redirecting (owner
sign-off 2026-11-16). A request with no `Origin` header is unaffected, and a
cookie-less cross-origin POST is redirected to the login page as today (middleware). The Origin check is skipped, with the
`app_url_invalid` error logged, when `APP_URL` itself is invalid, because there is then no app origin to compare against.
Exceptions: with an invalid configuration (FR-14), logout ends only the xstockstrat session: no redirect to the issuer,
so the browser returns to the login page; with unreadable configuration it does the same and logs
`sso_logout_mode_unknown` (above); a logout whose access token has expired answers JSON (above); and when
`ui` / `oidc.client_secret` is unset or cannot be read, the target is the portal logout (owner-approved design D-134).

FR-16. **Link SSO (explicit linking, `both` only).** A user signed in with their password links their issuer identity
from a new account page `/accounts/sso` ("Single sign-on"), registered next to "Authorized apps" in the shared nav
(`src/components/shared/navGroups.tsx`) and the accounts subnav (`src/components/shared/PlatformHeader.tsx`). The page
shows in every mode whether the account is linked (from `GetExternalIdentityLinks`: linked when the valid `ui` /
`oidc.issuer` is among the returned issuers, or, when that issuer is empty, invalid or unreadable, when any link
exists); the
"Link SSO" action exists only in `both` (SSO spec decision 7, § 3). The page's data and actions go through the session-gated
routes `GET /accounts/api/sso` (status), `POST /accounts/api/sso/link` (start) and `POST /accounts/api/sso/confirm`
(confirm) (amended 2026-11-24); the anonymous `/api/auth/sso/start` stays login-only.
1. "Link SSO" posts to `/accounts/api/sso/link`. The transaction cookie binds the purpose `link`, the
   signed-in user (from the verified session, not a value the browser supplies) and the start time, and the
   authorization request carries `prompt=login` and `max_age=1`, so the issuer re-authenticates even while another issuer session is live
   (SSO spec S17; not `max_age=0`, with which Authelia v4.39.28 refuses consent even after re-authentication, owner 2026-11-27). Because the issuer may ignore `prompt=login`, the callback also requires the ID token's `auth_time`
   to be no earlier than the link start (minus clock skew); a missing or older `auth_time` is refused with "Sign-in
   failed. Try again." and nothing is written (owner, 2026-11-24).
2. The callback validates the ID token as FR-1 does, calls neither `ResolveExternalIdentity` nor `IssueSessionForUser`,
   and returns the browser to `/accounts/sso`, which shows a confirmation: "You are linking <the ID token's email, else
   its preferred_username, else 'your single sign-on account'> to <the signed-in account's email>." Once the callback
   has opened the link transaction (after the mode and configuration checks), every failure returns to `/accounts/sso`
   with an `error` value; a failure before that, or with a missing or expired transaction, returns to the login page. An
   issuer error on the Link request shows "Your single sign-on account doesn't have access to xstockstrat. Ask an
   admin." for `access_denied` (`?error=no_access`) and "Sign-in failed. Try again." otherwise (`?error=failed`)
   (owner, 2026-11-24). The person re-enters their **xstockstrat password** and confirms (local re-authentication).
3. `LinkExternalIdentity(user_id, issuer, subject, password)` (FR-4: UI only) selects the user by `user_id` and
   verifies the password as `AuthenticateUser` does (bcrypt; the production seed-admin refusal counts as `invalid
   credentials`), then inserts the link in one atomic write keyed on `(issuer, subject)` (IDENTITY-13). It
   refuses with `FAILED_PRECONDITION`: `invalid credentials` (wrong password; the page shows "Incorrect password."),
   `account inactive` ("This account is disabled. Ask an admin."), `account already linked` (the pair belongs to another
   user; "This sign-in is already linked to another account. Ask an admin."), or `already linked to this issuer` (this
   user has a link for that issuer; "This account is already linked to a single sign-on account. Ask an admin to unlink
   it first.", FR-12), or `link disabled` (the mode is no longer `both`; "Sign-in failed. Try again."). A raw unique-constraint race (`23505`) is re-classified once into one of these, *before*
   `mapDbError` (IDENTITY-11).
4. A best-effort, post-commit, allow-listed ledger audit records each link through `auditSafe` (IDENTITY-7), payload
   `user_id`, `issuer` and `outcome: linked` only (no email, no token, no `sub`). A ledger outage never fails the link.
5. The confirmation lasts at most the transaction cookie's lifetime (10 minutes); after it, or if the signed-in user
   changed (another `user_id`), the link is refused with "Sign-in failed. Try again." and nothing is written.
6. Route statuses (owner-approved design, 2026-11-24). A refusal is never 401. A request with no session cookie at all
   never reaches these handlers: the middleware redirects it to `/auth/login`, as for every session-gated route
   (`middleware.ts:80-83`). The 401 below is the handler's answer to a stale access token it cannot verify (the
   middleware's refresh sets the new cookies on the response only).
   - `GET /accounts/api/sso`: 401 on a stale token; 503 when the link lookup fails; otherwise 200 (`mode: "error"` when
     the config is unreadable).
   - `POST /accounts/api/sso/link`: 401; 404 outside `both`; 503 when the config is unreadable; 400 `not_configured`;
     403 on a foreign or missing `Origin`; 503 on an issuer or secret fault; 200 `{url}`.
   - `POST /accounts/api/sso/confirm`: 401; 404 outside `both`; 503 when the config is unreadable; 403 `Origin`; 400
     `failed` on a stale or foreign confirmation; 400 `invalid_credentials`, `inactive`, `already_linked_other`,
     `already_linked_self` or `failed`; 503 `failed` when identity is unavailable; 200.

FR-17. **Switching mode without a login.** An operator on a tailnet host with access to the deployment's config database
sets `identity` / `auth.mode` for one environment with a tested Python command in `scripts/`
(`docs/patterns/script-tooling.md`), without signing in to xstockstrat (SSO spec § 3). It refuses any value but `local`,
`both` and `oidc`, and the running services apply the new value within 60 seconds through the config service's watch
(the UI on its next request), without a restart.
The runbook (FR-13) and homelab-edge `sso.md` name the command for break-glass (`local`) and rollback.

## Out of Scope

- The issuer itself: Authelia and lldap deployment, Caddy routes, `auth.public.<domain>`, people, groups, client
  registration (including the client IDs named in FR-13), and Authelia's claims and audience settings live in
  `davcs86/homelab-edge` (SSO spec phases P0–P1).
- commsgun, webhooks-mcp and happybabytracker SSO (their own repositories, amended 2026-11-24).
- Matching by email, creating users at SSO login, auto-provisioning, and email sync (owner, 2026-11-24).
- `manage-users.py update-email`.
- Removing the old OAuth server (kept for `local` and `both`, FR-14), `RegisterOAuthClient`/`IssueAuthCode`/
  `ExchangeAuthCode`/`RefreshOAuthToken`/`ListAuthorizedApps`/`RevokeAuthorizedApp`, the `oauth_clients`/
  `oauth_auth_codes` tables, the `agent.oauth.*` keys, or `AuthenticateUser`. Removing an RPC is a breaking proto change.
  The old agent OAuth routes stay as they are, and their fail-closed behaviour is owned by feature 319.
- Changing `SEED_USER_ID`, or editing analysis `029` / identity `002` (applied migrations, F-01).
- Self-service email or username changes for users; self-service unlinking.
- Authorisation gaps on WRITE paths to shared resources (see Risks).
- Gatus/Proxmox SSO (homelab-edge, a later phase).

## Affected Services

- `xstockstrat-identity`: `ResolveExternalIdentity`, `LinkExternalIdentity`, `GetExternalIdentityLinks` and
  `IssueSessionForUser` (all SAN-gated),
  `external_identities`, the `auth.mode` gate on `AuthenticateUser`; the table `manage-users.py unlink-sso` deletes from.
- `xstockstrat-ui`: OIDC login, callback and the SSO "keep me signed in" checkbox; the login page per the mode; the Link
  SSO account page and confirmation (FR-16); the `/accounts/authorized-apps` page; the `/accounts/sso` page and its nav entries and its routes `/accounts/api/sso`,
  `/accounts/api/sso/link`, `/accounts/api/sso/confirm`; the SSO logout redirect (FR-15) and
  the shared-header "Sign out" button; the `/api/oauth/{protected-resource,authorization-server}` discovery routes; the
  middleware public/cookie-gated path sets.
- `xstockstrat-agent`: the per-mode token path (FR-14), JWKS validation, protected-resource metadata, resolved-identity
  stamping, scope narrowing, the role cache.
- `xstockstrat-config`: the seed migration (next free number at execute time, Config Key Changes), and a
  `SECRET_CALLER_ALLOWLIST` grant (`src/grpc/authz.ts`, PLAT-9):
  `{callerID: 'ui', namespace: 'ui', keys: ['oidc.client_secret'], peerSan: 'xstockstrat-ui'}`.
- `packages/proto`: an additive `identity.proto` change.
- `scripts/`: `manage-users.py unlink-sso` and the FR-17 mode command.

## Consumer Surface(s)

- [x] **UI** (`xstockstrat-ui`): per FR-14's table. In `local` the UI is unchanged except for the every-mode changes of
  FR-15 (owner sign-off 2026-11-16): a "Sign out" button in the shared header, logout with an expired session answering
  JSON instead of a redirect, and a cookie-bearing logout from a foreign `Origin` answering 403.
  - The login page (`src/app/auth/login`, shared by `/trader`, `/insights` and `/config-ui`) gets a "Sign in with SSO"
    button next to a "Keep me signed in for 14 days (SSO)" checkbox in `both`/`oidc`; the password form is shown in
    `local`/`both`.
  - The page reads the mode server-side (today it is a `'use client'` page rendering `CredentialsForm`). An unreadable
    config renders the `local` login.
  - The `/accounts/sso` page (link status in every mode) and its "Link SSO" action and confirmation in `both` only (FR-16).
  - `src/app/auth/oauth-login` (the login step of the agent's legacy OAuth flow) is unchanged and used in `local` and
    `both`; in `oidc` its flow is unreachable, because the agent's `/oauth/*` routes answer 404.
  - `/accounts/authorized-apps` becomes a pointer to the issuer in `oidc` (FR-11).
- [x] **Agent** (`xstockstrat-agent`): in `oidc`, every MCP tool's authentication and effective scope changes; no tool
  name, parameter or response changes. Connector setup moves to pre-registered read-only and full clients for Claude.ai
  and Claude Code.
- [x] **Script**: `scripts/manage-users.py unlink-sso` and the FR-17 mode command.

## Proto Contract Changes

Additive only (non-breaking), in `packages/proto/identity/v1/identity.proto`:
- `rpc ResolveExternalIdentity(ResolveExternalIdentityRequest) returns (ResolveExternalIdentityResponse)`;
  `ResolveExternalIdentityRequest { string issuer; string subject; }`;
  `ResolveExternalIdentityResponse { string user_id; repeated Role roles; bool is_active; }`.
- `rpc LinkExternalIdentity(LinkExternalIdentityRequest) returns (LinkExternalIdentityResponse)`;
  `LinkExternalIdentityRequest { string user_id; string issuer; string subject; string password; }`;
  `LinkExternalIdentityResponse {}`.
- `rpc GetExternalIdentityLinks(GetExternalIdentityLinksRequest{ string user_id; }) returns
  (GetExternalIdentityLinksResponse{ repeated string issuers; })`, SAN-gated to `xstockstrat-ui`.
- `rpc IssueSessionForUser(IssueSessionForUserRequest{ string user_id; }) returns (AuthTokenResponse)`, SAN-gated to
  `xstockstrat-ui`; it refuses an inactive user and reuses the `AuthenticateUser` mint path (env `JWT_SECRET`,
  `identity.refresh_tokens`).
- Refusals are gRPC statuses: `FAILED_PRECONDITION` with exactly one of `not linked`, `account inactive`, `invalid credentials`,
  `account already linked`, `already linked to this issuer`, `link disabled` (a closed set shared by identity, the UI and
  the agent), `PERMISSION_DENIED` for a peer not
  in the FR-4 SAN list. The `ExternalIdentityOutcome` enum of the 2026-11-16 design is dropped: resolution has one
  success outcome.
- The messages are new, so their fields are numbered from 1. `buf breaking` against `main-dev` stays green because the
  change is purely additive. `password` is never logged.

## Config Key Changes

One seed migration: `services/xstockstrat-config/migrations/<NNN>_authelia_sso_keys` (up + down, C-07). `NNN` is the next
free config number when the step executes: `056` on trunk on 2026-11-24, which features 314, 317 and 321 also plan, so
whichever merges first keeps it and the others renumber. A number below trunk's highest is never used, because
golang-migrate skips a lower version that lands after a higher one (`merge-order.md` row 345 vs 314/317/321). It seeds every key below for both
`production` and `staging`. Operators then set the real values per environment.

- `identity.auth.mode`
  - namespace `identity`, stored key `auth.mode`, `string`, one of `local` | `both` | `oidc`;
  - code default `local`; seeded `local`;
  - readers:
    - `services/xstockstrat-identity/src/authMode.ts:readAuthMode` (new), called by `authenticateUser` and
      `linkExternalIdentity`, and `watchAuthMode`, called once from `src/index.ts` (parses at startup and on each watcher
      update), live;
    - `services/xstockstrat-ui/src/lib/oidcConfig.ts:loadAuthMode` (new), called by the login page, the SSO start and
      callback routes, the `/accounts/api/sso` routes, the logout route, `/accounts/authorized-apps` and the two `src/app/api/oauth/*`
      discovery routes; one-shot `GetConfig(namespace: 'identity')` per request, live on the next request;
    - `services/xstockstrat-agent/app/sso_mode.py:current_auth_mode` (new), through `read_config_value('identity',
      'auth.mode')`. This requires adding `identity` to `WATCHED_NAMESPACES` (`app/config/watcher.py`, AGENT-9: an
      unwatched namespace silently reads `None`). Live through the snapshot.
- `ui.oidc.issuer`
  - namespace `ui`, stored key `oidc.issuer`, `string`, code default `""` (an empty value in `both`/`oidc` is the FR-14
    invalid configuration);
  - reader `services/xstockstrat-ui/src/lib/oidcConfig.ts:loadOidcConfig` (new), called by the routes listed for
    `loadAuthMode` that need it; one-shot `GetConfig(namespace: 'ui')` per request, live on the next request.
- `ui.oidc.client_id`
  - namespace `ui`, stored key `oidc.client_id`, `string`, code default `""`; same reader and mechanism.
- `ui.oidc.client_secret`
  - namespace `ui`, stored key `oidc.client_secret`, `string`, encrypted `is_secret` row, seeded with the `[redacted]`
    sentinel and a NULL ciphertext, which `GetSecret` reports as `found=false` (unset);
  - code default `""`: empty in `both`/`oidc` means `/start`, the callback and `POST /accounts/api/sso/link` fail with
    "SSO not configured" (fail closed), and logout falls back to the portal URL;
  - reader `services/xstockstrat-ui/src/lib/oidcConfig.ts:loadOidcClientSecret` (new), called by the SSO start and
    callback routes, `POST /accounts/api/sso/link` and the logout route, through `GetSecret` (header
    `x-internal-caller: ui`) via the allow-list grant above. A rotated value applies on
    the next request (the cached OIDC Configuration is keyed on the secret's hash). It is redacted at every other edge.
- `ui.oidc.mcp_client_id`, `ui.oidc.mcp_client_id_readonly`, `ui.oidc.mcp_client_id_claude_code`,
  `ui.oidc.mcp_client_id_claude_code_readonly`
  - namespace `ui`, `string`, code default `""` (an empty value hides that line on the card);
  - reader `services/xstockstrat-ui/src/lib/oidcConfig.ts:loadOidcConfig`, one-shot per request; displayed on
    `/accounts/authorized-apps` (FR-11).
- `agent.oidc.issuer`
  - namespace `agent`, stored key `oidc.issuer`, `string`, code default `""` (an empty value in `oidc` is the FR-14
    invalid configuration);
  - readers: `services/xstockstrat-agent/app/sso_mode.py`, the token validator (new) and the protected-resource metadata
    builder, all through `read_config_value('agent', 'oidc.issuer')` (AGENT-9; `agent` is in `WATCHED_NAMESPACES`),
    live through the snapshot; and `services/xstockstrat-ui/src/lib/oidcConfig.ts:loadAgentIssuer` for the UI's
    protected-resource document (`src/app/api/oauth/protected-resource/route.ts`), one-shot
    `GetConfig(namespace: 'agent')` per request.

The expected MCP audience is `AGENT_PUBLIC_URL`. No new key duplicates it (AGENT-6/AGENT-8). The issuer value on the
homelab is `https://auth.public.<domain>` (SSO spec decision 3).

The seed migration and the new readers must leave `node scripts/check-config-wiring.mjs --final` with zero findings (the
CI `config-wiring` job). Add a `registry.receivers` entry in `scripts/config-wiring.json` only for a reader binding the
checker cannot resolve; `src/lib/oidcConfig.ts` reads three namespaces (`ui`, `identity`, `agent`), so it uses one binding
per namespace. Never add a `findings` baseline entry for these keys (`docs/patterns/config-governance.md` § Baseline).

## Database Changes

- identity migration `007_external_identities` (up + down): `identity.external_identities (issuer TEXT NOT NULL, subject
  TEXT NOT NULL, user_id UUID NOT NULL REFERENCES identity.users(user_id) ON DELETE CASCADE, linked_at TIMESTAMPTZ NOT
  NULL DEFAULT NOW(), PRIMARY KEY (issuer, subject), UNIQUE (issuer, user_id))`. No email index: nothing matches by
  email.
- config migration `<NNN>_authelia_sso_keys` (above).
- No applied migration is edited (F-01).

## Feature Workflow Notes

Branch to create: `feature/authelia-sso` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto or config change)
- [ ] 2 service owners + platform lead (breaking proto change)
- [x] DBA review + service owner (schema migration)
- [x] Config team + owner (new config keys, `GetSecret` allow-list grant)

Hard merge order: `319-fix-auth-trust-hardening` merges first or alongside this feature, never after it (D-52: the
logout route calls `RevokeToken`, which decodes the token unverified until 319 lands; `merge-order.md` row 345 vs 319).
Rebase only: `324-fix-ci-enforcement-gaps` (CI gate over `manage-users.py`), and
`331-fix-agent-mcp-transport-fallthrough` and `323-fix-orphaned-code` (both also edit `app/main.py`). Config migration number: taken at execute time (Config Key Changes).

**Spike evidence.** The 2026-11-16 local spike (Authelia v4.39.28, details in `context.md`) proved pre-registered public
clients with RFC 8707 `resource`, the `scp` array, custom `xstockstrat.*` scopes, a stable per-user `sub`, `typ=at+jwt`,
`requested_audience_mode: implicit` for `aud`, no `end_session_endpoint` (portal logout), group membership not re-checked
on refresh, and `error=access_denied` for a person outside the group. Its email findings now matter only for the link
confirmation's label (FR-16.2). Still to be proven by homelab-edge, before this feature's cutover: Claude.ai against
the deployed portal (SSO spec S1, S5; the homelab registers no Claude Code client and S9 is retired, SSO spec § 4.6 and
§ 11 as amended 2026-11-27), the web client registered with scopes `openid profile email` (SSO spec § 4.6 as amended 2026-11-24;
the UI requests all three) and its ID-token claims `email`, `preferred_username` and `auth_time` (by default or via the claims policy, per S17),
and refresh after
leaving the group (S24). S17 is proven (spike on the edge droplet, Authelia v4.39.28, 2026-11-27): `prompt=login`
with `max_age=1` forces re-authentication and returns a fresh `auth_time`, `email` and `preferred_username` in the ID
token; with `max_age=0` Authelia issues no code even after re-authentication, so Link requests send `max_age=1`.

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution **C-15**). Each `FR-N`
above is covered by ≥1 tagged scenario there; FR-5 is removed and has none.

## Risks (accepted or owned elsewhere)

- **Trader WRITE on shared resources, accepted by the owner (2026-11-15).** Users created with `manage-users.py
  create-user` start as `trader` unless roles are given. marketdata `BackfillBars`
  (`services/xstockstrat-marketdata/internal/handler/marketdata_handler.go:119-124`) has no admin check, so a trader can
  spend the shared vendor quota and fill the shared bars tables. SSO no longer creates users, so this risk no longer
  grows with SSO.
- **Analysis 029 re-run, accepted (IDENTITY-15).** New migrations resolve the seed owner by `SEED_USER_ID` (FR-13).
- **Statelessness (insights.md, 072, FR-B13).** The role cache is per instance. It stays correct with
  `instance_count > 1` only because it is bounded by its TTL and fails closed.
- **Dependency on the edge.** In `oidc`, the issuer down blocks new web logins and MCP token refreshes (web session
  refresh goes through identity only); issued tokens and sessions keep working until they expire. FR-17 switches the
  deployment to `local` without a login. In `both`, the password form and MCP keep working while the issuer is down.
- **Linking window.** A person can link only while the deployment is in `both`; `both` keeps public password login
  behind the edge's rate limits (SSO spec decision 18). The Link confirmation accepts a password, so a homelab-edge
  path-scoped rate-limit zone covering `POST /accounts/api/sso/confirm` is a **required cutover gate** before `both` is set on a homelab deployment
  (owner, 2026-11-24). homelab-edge is adding it to the SSO spec's § 4.3 zones and the gate to `sso.md` § 6 (owner,
  2026-11-24); until that change lands there, this gate is tracked only here and in design.md § 6.
- **Signing keys at most 3600 s old, no stale-key grace (owner, 2026-11-27; SSO spec § 3 "Signing keys"; design
  D-138).** In `oidc` the agent verifies a token only with a key from an issuer key set fetched within the last 3600 s
  (`_JWKS_MAX_AGE_S`). Past that, a token needs a refetch; if the refetch fails or is held by the cooldown, the call gets
  HTTP 503 without `WWW-Authenticate` (as FR-2's unfetchable-keys case), never a verify with the old keys (AC-79). So a
  JWKS outage that outlasts 3600 s from the last good fetch makes every `oidc` MCP call 503 until the JWKS is reachable
  again; the owner accepts that availability cost. This supersedes the 24 h stale-key window (`_JWKS_STALE_MAX_S`) that
  was pending owner sign-off. The web relying party already complies (openid-client refetches at 300 s and fails
  closed). The cutover runbook states it.
- **Identity runs in every mode** (owner, 2026-11-24): it holds users, roles, links and sessions. An identity-less `oidc`
  deployment is out of scope (an idea for the owner's xstockstrat-only Authentik exploration).

## Open Questions

- None. Product decisions are recorded in `context.md` (Sessions 2026-11-15, 2026-11-16 and 2026-11-24).
