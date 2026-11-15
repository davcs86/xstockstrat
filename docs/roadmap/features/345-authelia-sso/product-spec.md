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
client, PKCE S256, `state` + `nonce` checked) against Authelia. After the callback it resolves the user through
identity (FR-3) and issues the **existing** session JWT carrying `user_id` and `roles`, so middleware, header
propagation (`x-user-id`, `x-access-scope`, `x-trace-id`) and every backend check are unchanged.

FR-2. **MCP as a resource server.** `xstockstrat-agent` accepts Authelia-issued JWT access tokens on its MCP endpoint,
validated against Authelia's JWKS (signature, `iss`, `exp`, and `aud` equal to the agent's own resource URI per
RFC 8707). It publishes RFC 9728 protected-resource metadata naming Authelia as the authorization server. It issues no
tokens and keeps no per-request state (`instance_count > 1` stays safe). Clients are pre-registered in Authelia; no
dynamic client registration.

FR-3. **Account resolution per environment.** A new identity RPC `ResolveExternalIdentity(issuer, subject, email)`
returns `{user_id, roles, is_active}` using, in order:
  1. an existing `(issuer, subject)` link → that user;
  2. else exactly one **active, unlinked** row whose email matches case-insensitively → link it and append a ledger
     audit event;
  3. else no row with that email → create a user with roles written explicitly as `{trader}` and link it;
  4. else (several case-insensitive matches, or the only match is linked to another subject, or the linked user is
     inactive) → refuse.
  Each environment resolves against its own `identity.users`; prod and staging never share links.

FR-4. **Email sync.** On every successful resolution, if the token's `email` differs from `identity.users.email`, it is
copied in; if another row already holds that email, the old value is kept and the clash is logged. Authelia is the only
source of emails; xstockstrat offers no change-email path to end users.

FR-5. **Roles stay in xstockstrat.** Roles remain `identity.users.roles` per environment, managed only through
`SetUserRoles` / `manage_user` / `manage-users.py update-roles`. The role → `x-access-scope` bitmask mapping
(`services/xstockstrat-ui/src/lib/auth.ts` `rolesToAccessScope`, `services/xstockstrat-agent/app/scopes.py`
`roles_to_access_scope`) is unchanged.

FR-6. **MCP scope narrowing.** The agent computes
`effective_scope = roles_to_access_scope(roles) & scopes_to_mask(token.scope)` with OAuth scopes
`xstockstrat.read` → READ 0x01, `xstockstrat.write` → WRITE 0x02, `xstockstrat.admin` → ADMIN 0x04,
`xstockstrat.trade` → TRADING 0x08. A token can only narrow the user's roles, never widen them. A token with none of
these scopes has effective scope 0.

FR-7. **Role cache.** The agent caches `ResolveExternalIdentity` results for at most 60 s per subject. When identity is
unreachable and the cached entry has expired, the request fails closed (no tool runs). A deactivated user or a changed
role takes effect within that TTL.

FR-8. **Password login as rollback only.** Password login (`AuthenticateUser` and the UI's password form) stays in the
code behind a boolean config key and is off once SSO is live. With the key off, a password attempt is rejected and the
UI shows only the Authelia login. With it on, password login works as today.

FR-9. **Admin email tooling.** `scripts/manage-users.py` gains an `update-email <old-email> <new-email>` command
(tested Python, `docs/patterns/script-tooling.md`) so admins can align an existing row's email with the person's
Authelia email before their first SSO login (cutover option B, homelab-edge `docs/runbooks/sso.md` § 6). It refuses
when the new email already belongs to another row (case-insensitive).

FR-10. **Operator documentation.** `docs/runbooks/mcp-tools.md` (connector setup with a pre-registered client and the
read-only vs full connector), the identity, ui and agent `CLAUDE.md` files, and `docs/patterns/frontend-auth.md`
describe the new flows in the same PR as the behaviour change.

## Out of Scope

- Authelia itself: its deployment, Caddy routes, `auth.<domain>`, users, groups and client registration live in
  `davcs86/homelab-edge` (separate PR).
- commsgun and webhooks-mcp SSO (their own repositories).
- Removing the old OAuth server, `RegisterOAuthClient`/`IssueAuthCode`/`ExchangeAuthCode`/`RefreshOAuthToken`, the
  `oauth_clients` / `oauth_auth_codes` tables, or `AuthenticateUser`. Removing an RPC is a breaking proto change and
  waits for a follow-up feature after the rollback window.
- Changing `SEED_USER_ID` (only future, not-yet-applied migrations would see a new value; applied migrations are
  never edited).
- Self-service email or username changes for users.
- Gatus/Proxmox SSO (homelab-edge, a later phase).

## Affected Services

- `xstockstrat-identity` — `ResolveExternalIdentity` RPC, `external_identities` table, email sync, password-login gate.
- `xstockstrat-ui` — OIDC client login and callback, session JWT from resolved identity, login page without the
  password form when the flag is off, the `/accounts/authorized-apps` page (see Open Questions).
- `xstockstrat-agent` — resource-server validation, protected-resource metadata, scope narrowing, role cache.
- `xstockstrat-config` — seed migration for the new keys.
- `packages/proto` — additive `identity.proto` change.

## Consumer Surface(s)

- [x] **UI** — `xstockstrat-ui`: the login entry for all three segments (`/trader`, `/insights`, `/config-ui`, and
  `/auth/oauth-login`) redirects to Authelia and loses the password form when the flag is off; `/accounts/authorized-apps`
  is affected because MCP grants move to Authelia (decision open).
- [x] **Agent** — `xstockstrat-agent`: every MCP tool's authentication and effective scope (no tool name, parameter or
  response change); connector setup changes (pre-registered client, read-only and full connectors).
- [x] **Script** — `scripts/manage-users.py update-email`.

## Proto Contract Changes

Additive only (non-breaking):
- `rpc ResolveExternalIdentity(ResolveExternalIdentityRequest) returns (ResolveExternalIdentityResponse)` with request
  `issuer`, `subject`, `email`, and response `user_id`, `repeated Role roles`, `is_active`, and an outcome enum
  (`..._UNSPECIFIED = 0`, linked-existing, linked-by-email, created) for audit and metrics.
- Whether the UI needs a separate RPC to mint its session tokens for a resolved user (today `AuthenticateUser` returns
  them) is decided in `/sdd-design`.

## Config Key Changes

Proposed; exact names, defaults and readers confirmed in `/sdd-design` recon (C-05):

- `identity.auth.password_login_enabled` — bool. Read by identity `AuthenticateUser` and the UI login route. Seeded
  `true` until cutover, then set `false` per environment. The code default (key missing) is an open question.
- `ui.oidc.issuer` — string, Authelia issuer URL. Read by the UI OIDC client.
- `ui.oidc.client_id` — string. Read by the UI OIDC client.
- `ui.oidc.client_secret` — encrypted `is_secret` row resolved via `GetSecret`. Read by the UI OIDC client.
- `agent.oidc.issuer` — string. Read by the agent's JWKS validator and protected-resource metadata.
- `agent.oidc.resource` — string, the agent's canonical resource URI (expected `aud`).

Each key differs per environment (`production`/`staging`), because prod and staging are separate Authelia apps.

## Database Changes

identity migration `007_external_identities` (up + down):
- `identity.external_identities (issuer TEXT, subject TEXT, user_id UUID NOT NULL REFERENCES identity.users(user_id)
  ON DELETE CASCADE, linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (issuer, subject),
  UNIQUE (issuer, user_id))`.
- Config migration seeding the keys above.

## Feature Workflow Notes

Branch to create: `feature/authelia-sso` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto or config change)
- [ ] 2 service owners + platform lead (breaking proto change)
- [x] DBA review + service owner (schema migration)
- [x] Config team + owner (new config keys)

**First gate — Authelia spike (v4.39.28, pinned by digest in homelab-edge).** Before `/sdd-spec`, prove on the pinned
release: (a) Claude.ai and Claude Code complete MCP auth with a pre-registered public client sending RFC 8707
`resource`; (b) JWT access tokens carry `aud` = resource and the granted `scope`; (c) custom scopes
`xstockstrat.*` are accepted; (d) whether group membership is re-checked on refresh; (e) `sub` is stable per username.
If (a) or (b) fails, the design falls back to option F: keep the agent's OAuth server and delegate only its login to
Authelia.

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [ ] UI session issuance: does `ResolveExternalIdentity` also mint the session tokens, or does a separate RPC do it?
  Which component holds the OIDC client secret (UI only)?
- [ ] `/accounts/authorized-apps` (`ListAuthorizedApps`/`RevokeAuthorizedApp`): hide it, link to Authelia's consent
  management, or keep it for the old OAuth grants during the rollback window?
- [ ] MCP rollback: does the password-login flag also re-enable the old agent OAuth server, or is MCP rollback just the
  option F fallback?
- [ ] Code default of `identity.auth.password_login_enabled` when the key is missing: fail closed (`false`) or keep
  today's behaviour (`true`)? Ledger: never change a key's `value_type` in place (fails.md, maintenance_mode entry).
- [ ] Known risk: a `trader` (the starting role) holds WRITE. Recon must verify that every WRITE path touching
  platform-wide resources requires ADMIN. Lead: marketdata `BackfillBars`
  (`services/xstockstrat-marketdata/internal/handler/marketdata_handler.go:120`) has no visible admin check, while the
  agent's `trigger_backfill` is documented as admin-scoped. Ledger: pick the authz model from the verified caller set
  (insights.md, 092-fix-mcp-writepath-authz).
- [ ] Known trap: the agent's OAuth path must stay stateless (insights.md, 072, FR-B13). The role cache is per-instance
  and correct only because it is bounded by TTL and fails closed.
- [ ] Session lifetime: with Authelia as issuer, what bounds a UI session after a user leaves the Authelia group or is
  deactivated (session JWT TTL vs. a re-check on refresh)?
