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
unchanged. The login page keeps a "Remember me" checkbox next to "Sign in with SSO". Its value travels in the OIDC
`state`, and the callback passes it to `setSessionCookies` exactly as the password path does today (UI-8).

FR-2. **MCP as a resource server.** `xstockstrat-agent` accepts **only** Authelia-issued JWT access tokens on its MCP
endpoint. A token passes only if all of these hold, against Authelia's cached JWKS:
- a valid signature;
- `iss` equals the configured issuer;
- `exp` is in the future;
- `aud` equals `AGENT_PUBLIC_URL` (RFC 8707; the single source of the expected audience, IDENTITY-4/AGENT-8).

Any failure returns HTTP 401 with a `WWW-Authenticate` header pointing at the agent's RFC 9728 protected-resource
metadata. That metadata names Authelia as the authorization server. The agent stops accepting identity-minted OAuth
tokens. It issues no tokens and keeps no per-request state (`instance_count > 1` stays safe). Clients are
pre-registered in Authelia; there is no dynamic client registration. Authelia is configured to include the `email`
claim in access tokens (spike item), and the agent never logs a token or its `email` claim.

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
  subject therefore yield exactly one link and at most one created user. A unique-constraint race maps through
  `mapDbError` and is retried as step 1 (IDENTITY-11). A best-effort, post-commit, allow-listed ledger audit records each
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
`roles_to_access_scope(roles) & scopes_to_mask(token.scope)`, with these OAuth scopes:
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

FR-9. **Password login as rollback only.** Password login (`AuthenticateUser` and the UI's password form) stays in the
code behind `identity` / `auth.password_login_enabled`, off once SSO is live:
- With it `false`, or the key missing (fail closed), `AuthenticateUser` returns `PERMISSION_DENIED` "password login
  disabled", and the login page shows only "Sign in with SSO".
- With it `true`, password login works as today and both options are shown.

This flag does not affect MCP. MCP rollback means redeploying the last release before this feature.

FR-10. **Session lifetime.** A web session ends when its refresh token expires (`identity` / `jwt.refresh_ttl_seconds`)
or at the first refresh after the user is deactivated (`SetUserActive false`; `rotateRefreshToken` already refuses
inactive users). The access JWT stays usable until it expires (`jwt.access_ttl_seconds`). Removing a person from the
Authelia group blocks new logins only. Cutting an existing session needs `SetUserActive false`, as homelab-edge
`docs/runbooks/sso.md` § 4 instructs.

FR-11. **Authorized apps page.** `/accounts/authorized-apps` no longer lists or revokes xstockstrat OAuth grants. It
explains that connected apps are managed in Authelia and links to the Authelia URL derived from `ui` /
`oidc.issuer`.

FR-12. **Admin email tooling.** `scripts/manage-users.py` gains `update-email <old-email> <new-email>` (tested Python,
`docs/patterns/script-tooling.md`, inside feature 324's CI/ruff scope). It lets admins align an existing row's email
with the person's Authelia email before their first SSO login (cutover option B, homelab-edge
`docs/runbooks/sso.md` § 6). It stores the new email lowercased, keeps `user_id`, and exits non-zero with
"email already in use" when another row holds the email case-insensitively.

FR-13. **Documentation.** The same PR as each behaviour change updates:
- `docs/runbooks/mcp-tools.md`: connector setup with the pre-registered client IDs `xstockstrat-mcp-claude` (full) and
  `xstockstrat-mcp-claude-ro` (read-only), and `xstockstrat-staging-mcp-claude` / `xstockstrat-staging-mcp-claude-ro`
  for staging, with redirect URI `https://claude.ai/api/mcp/auth_callback`;
- the identity, ui and agent `CLAUDE.md` files (config keys, auth flow);
- `docs/patterns/frontend-auth.md`;
- IDENTITY-15 in `services/xstockstrat-identity/docs/context-constitution.md` and `docs/patterns/database.md`: the
  seed email may be renamed by cutover, so new migrations resolve the seed owner by `SEED_USER_ID`, never by
  `admin@localhost`.

## Out of Scope

- Authelia itself: deployment, Caddy routes, `auth.<domain>`, users, groups, client registration (including the client
  IDs named in FR-13 and the access-token `email` claim) live in `davcs86/homelab-edge` (separate PR).
- commsgun and webhooks-mcp SSO (their own repositories).
- Removing the old OAuth server, `RegisterOAuthClient`/`IssueAuthCode`/`ExchangeAuthCode`/`RefreshOAuthToken`/
  `ListAuthorizedApps`/`RevokeAuthorizedApp`, the `oauth_clients`/`oauth_auth_codes` tables, the `agent.oauth.*` keys, or
  `AuthenticateUser`. Removing an RPC is a breaking proto change; that waits for a follow-up feature after the
  rollback window. Until then the old agent OAuth routes stay as they are, and their fail-closed behaviour is owned by
  feature 319.
- Changing `SEED_USER_ID`, or editing analysis `029` / identity `002` (applied migrations, F-01).
- Self-service email or username changes for users.
- Authorisation gaps on WRITE paths to shared resources (see Risks).
- Gatus/Proxmox SSO (homelab-edge, a later phase).

## Affected Services

- `xstockstrat-identity`: `ResolveExternalIdentity` (SAN-gated), `external_identities`, email sync, the password-login
  gate.
- `xstockstrat-ui`: OIDC login, callback and "Remember me"; the login page per the flag; the `/accounts/authorized-apps`
  page.
- `xstockstrat-agent`: JWKS validation, protected-resource metadata, resolved-identity stamping, scope narrowing, the
  role cache.
- `xstockstrat-config`: seed migration `050`, and a `SECRET_CALLER_ALLOWLIST` grant (`src/grpc/authz.ts`, PLAT-9):
  `{callerID: 'ui', namespace: 'ui', keys: ['oidc.client_secret'], peerSan: 'xstockstrat-ui'}`.
- `packages/proto`: an additive `identity.proto` change.

## Consumer Surface(s)

- [x] **UI** (`xstockstrat-ui`):
  - The login entry for all segments (`/trader`, `/insights`, `/config-ui`; pages `src/app/auth/login`,
    `src/app/auth/oauth-login`) gets a "Sign in with SSO" button and a "Remember me" checkbox. The password form is
    shown only when the flag is on.
  - `/accounts/authorized-apps` becomes a pointer to Authelia (FR-11).
- [x] **Agent** (`xstockstrat-agent`): every MCP tool's authentication and effective scope changes; no tool name,
  parameter or response changes. Connector setup moves to pre-registered read-only and full clients.
- [x] **Script**: `scripts/manage-users.py update-email`.

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
- Field numbers come from the next free numbers in the file and are confirmed at `/sdd-design` (`buf breaking` against
  `main-dev`).

## Config Key Changes

One seed migration: `services/xstockstrat-config/migrations/050_authelia_sso_keys` (up + down; last applied is `049`,
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
  - empty means the SSO button reports "SSO not configured" and no redirect happens;
  - reader `services/xstockstrat-ui/src/lib/oidcConfig.ts:loadOidcConfig` (new), called by
    `src/app/api/auth/sso/start/route.ts:GET` and `src/app/api/auth/sso/callback/route.ts:GET` (new). One-shot
    `GetConfig(namespace: 'ui')` per request, live on the next request.
- `ui.oidc.client_id`
  - namespace `ui`, stored key `oidc.client_id`, `string`, code default `""` (empty is handled as above);
  - same reader and mechanism as `ui.oidc.issuer`: `src/lib/oidcConfig.ts:loadOidcConfig`, one-shot per request,
    live on the next request.
- `ui.oidc.client_secret`
  - namespace `ui`, stored key `oidc.client_secret`, `string`, encrypted `is_secret` row, seeded empty;
  - code default `""`: empty means the callback fails with "SSO not configured" (fail closed);
  - sole reader `services/xstockstrat-ui/src/lib/oidcConfig.ts:loadOidcClientSecret` (new), called only by
    `src/app/api/auth/sso/callback/route.ts:GET`, through `GetSecret` on each callback via the allow-list grant above.
    A rotated value applies on the next callback. It is redacted at every other edge.
- `agent.oidc.issuer`
  - namespace `agent`, stored key `oidc.issuer`, `string`, code default `""`;
  - empty means every MCP request returns 401 (fail closed);
  - readers (all new code):
    - `services/xstockstrat-agent/app/auth.py:validate_authelia_token`;
    - the protected-resource metadata builder in `services/xstockstrat-agent/app/main.py`.

    Both read through `read_config_value('agent', 'oidc.issuer')` (AGENT-9; `agent` is in `WATCHED_NAMESPACES`),
    live through the snapshot.

The expected MCP audience is `AGENT_PUBLIC_URL`. No new key duplicates it (AGENT-6/AGENT-8).

## Database Changes

- identity migration `007_external_identities` (up + down):
  - `identity.external_identities (issuer TEXT NOT NULL, subject TEXT NOT NULL, user_id UUID NOT NULL REFERENCES
    identity.users(user_id) ON DELETE CASCADE, linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (issuer,
    subject), UNIQUE (issuer, user_id))`;
  - an index on `lower(identity.users.email)` for the case-insensitive match.
- config migration `050_authelia_sso_keys` (above).
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
this feature.

**First gate: the Authelia spike (v4.39.28, pinned by digest in homelab-edge).** Before `/sdd-spec`, prove on the
pinned release:
- (a) Claude.ai and Claude Code complete MCP auth with a pre-registered public client sending RFC 8707 `resource`;
- (b) JWT access tokens carry `aud` = resource, the granted `scope`, and the `email` claim;
- (c) custom scopes `xstockstrat.*` are accepted;
- (d) whether group membership is re-checked on refresh;
- (e) `sub` is stable per username.

If (a) or (b) fails, the design falls back to option F: keep the agent's OAuth server and delegate only its login to
Authelia.

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
- **Dependency on the edge.** Authelia down blocks new web logins and token refreshes; issued tokens and sessions keep
  working until they expire.

## Open Questions

- None. All product decisions are recorded in `context.md` (Sessions 2026-11-15).
