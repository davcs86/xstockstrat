# Product Spec: third-party-sso-oidc

**Created**: 2026-10-30

---

## Problem Statement

Authentication is local-password only (`identity.AuthenticateUser`, bcrypt). Operators who already run a central IdP such as Authentik must provision and rotate a separate xstockstrat password per person, with no single revocation point and no MFA/policy inheritance from the IdP.

## User Story

As an operator or trader whose organization runs an OIDC identity provider (e.g. Authentik), I want to sign in to xstockstrat — web UI and MCP agent — through that provider, so that identity, MFA, and offboarding are governed centrally while xstockstrat keeps issuing its own platform JWTs.

## Functional Requirements

FR-1. `xstockstrat-identity` acts as an OIDC relying party for **one** generic provider configured by issuer URL, using OIDC Discovery, authorization-code flow with PKCE (S256), `state`, and `nonce`. The provider is disabled unless explicitly enabled by config.
FR-2. The ID token is fully validated before any session is issued: signature against the provider JWKS, `iss`, `aud` (= configured client_id), `exp`, `nonce`, and `email_verified == true`.
FR-3. A validated SSO identity maps to an **existing active** `identity.users` row by verified email; the IdP `(issuer, sub)` pair is persisted as a link on first success and used as the primary match on later logins. No user is auto-created. An unknown or inactive user is denied with a generic error.
FR-4. A successful SSO login yields the same platform access + refresh JWTs as `AuthenticateUser` (same claims shape, TTLs from `identity.jwt.*`); downstream services see no difference.
FR-5. IdP group-to-role mapping: when the configured groups claim contains the configured admin value, the user holds the admin role for that session and the stored role set is reconciled on each SSO login (grant **and** revoke of the SSO-managed admin grant). Mapping is inert when its config keys are empty.
FR-6. `xstockstrat-ui` login page (all three segments) shows a "Sign in with SSO" control when SSO is enabled; the callback completes into the existing JWT cookie session and honors the per-segment `basePath`/post-login redirect.
FR-7. The `xstockstrat-agent` OAuth 2.1 authorize step can authenticate the human via the IdP instead of the password form; the agent's `txn` blob must never carry post-login identity (identity is re-derived from the validated callback).
FR-8. Password login remains available and unchanged when SSO is enabled.
FR-9. config-ui exposes an operator page to view SSO settings (secret redacted), run a discovery/JWKS "test connection", and see the callback URL to register at the IdP.
FR-10. The IdP `client_secret` is stored as an encrypted config secret (`is_secret=true`), resolved by identity via `GetSecret`; it is never logged, returned, or rendered.
FR-11. SSO login success/denial emits an auditable event (ledger) without recording tokens or secrets.

## Out of Scope

- Multiple simultaneous IdPs / a provider table and provider picker.
- SAML, LDAP, social logins as separate protocols.
- JIT user creation and email-domain allow-listing.
- SSO-only mode (disabling password login).
- Back-channel/front-channel logout and IdP-initiated SSO; RP-initiated logout is not required in v1.
- Per-user SSO enrollment self-service UI.

## Affected Services

- `xstockstrat-identity` — OIDC RP logic, link table, group→role reconciliation, new RPCs, platform JWT issuance
- `xstockstrat-ui` — login control, `/api/auth/sso/*` start/callback routes in each segment, config-ui settings/test page
- `xstockstrat-agent` — OAuth authorize step delegating human authentication to the IdP
- `xstockstrat-config` — new `identity.sso.*` keys incl. one secret row (no code change expected)
- `packages/proto` — new identity RPCs/messages

## Consumer Surface(s)

- [x] **UI** — `xstockstrat-ui` `/trader`, `/insights`, `/config-ui`: "Sign in with SSO" on each login page; `/config-ui` new SSO settings + test-connection page registered in `PLATFORM_SUBNAV` (**C-10**)
- [x] **Agent** — `xstockstrat-agent` OAuth authorize/consent flow (HTTP facade, not an MCP tool); no MCP tool contract change expected
- [ ] **None**

## Proto Contract Changes

- [ ] No proto changes required
- New identity RPCs (names indicative, fixed at design): begin-SSO (returns authorization URL + signed state), complete-SSO (code → platform tokens), get/test SSO settings (admin). Additive only; new message types, enum for outcome/failure reason.

## Config Key Changes

- [ ] No new config keys
- `identity.sso.enabled` (bool, default `false`)
- `identity.sso.issuer_url` (string)
- `identity.sso.client_id` (string)
- `identity.sso.client_secret` (**secret**, `is_secret=true`)
- `identity.sso.scopes` (string, default `openid email profile groups`)
- `identity.sso.groups_claim` (string, default `groups`)
- `identity.sso.admin_group` (string, default empty = mapping disabled)
- `identity.sso.button_label` (string, default `Sign in with SSO`)

Registered in `docs/patterns/config-governance.md` § Per-Feature Registered Keys; secret wiring per `docs/runbooks/add-data-source.md` § "Wiring a New Vendor Credential Through Deploy". `GetSecret` allow-list grant needed for identity.

## Database Changes

- [ ] No schema changes
- New `identity.user_sso_links` (`user_id` FK, `issuer`, `subject`, `linked_at`, `last_login_at`; unique `(issuer, subject)`; unique per `(user_id, issuer)`), plus a record of which roles are SSO-managed so FR-5 revocation never strips locally-granted roles. Next `identity` migration number.

## Feature Workflow Notes

Branch to create: `feature/third-party-sso-oidc` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto or config change)
- [ ] 2 service owners + platform lead (breaking proto change)
- [x] DBA review + service owner (schema migration)

Also: Security reviewer (identity/auth/secrets).

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [ ] **Known trap (fails.md 2026-08-06 unify-admin-auth-gates):** a pre-login signed blob must not carry post-login identity. Design must specify exactly what the signed `state`/`txn` carries (nonce, PKCE verifier, return target only) and keep it stateless for `instance_count > 1`.
- [ ] Where does the PKCE verifier/nonce live between start and callback — signed+encrypted cookie in UI, or signed blob signed by `JWT_SECRET`? Replay and single-use guarantees without a server-side store?
- [ ] Who terminates the callback: the UI BFF (per-segment `basePath` redirect URIs ⇒ up to 3 URIs to register) or one canonical callback host? Authentik requires exact redirect URI matches.
- [ ] Group→role reconciliation: "SSO-managed admin grant" tracking — a flag on the role row vs a separate column? What happens to a user whose IdP groups claim is absent from the token (treat as revoke, or no-op)?
- [ ] Email collision: password user `a@x` exists, IdP asserts `a@x` with a new `sub` — link silently, or require the first link be admin-approved? (Spec default: link by verified email once; later logins match on `(issuer, sub)` only.)
- [ ] `email_verified` absent (some IdPs omit it): hard deny, or configurable? Spec default: deny.
- [ ] Agent flow: does the agent redirect to the IdP itself (facade holds the RP role) or call identity's begin/complete RPCs? Preference: identity owns RP logic; agent only calls RPCs.
- [ ] Should `JWT_SECRET`-signed state use a distinct derived key/`aud` (IDENTITY-4 `aud`-binding) so it cannot be confused with an access token?
- [ ] Does turning SSO on/off or editing the issuer need a restart, or is it live via `WatchConfig`? JWKS cache TTL and rotation behavior on key-id miss.
