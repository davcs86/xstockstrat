# Context: third-party-sso-oidc

**Feature**: `docs/roadmap/features/280-third-party-sso-oidc/feature.md`
**Product Spec**: `docs/roadmap/features/280-third-party-sso-oidc/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/280-third-party-sso-oidc/implementation-spec.md`

---

## Session 2026-10-30 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Operator decisions captured via Q&A (2026-10-30):
  - Provisioning: pre-provisioned users only, link by verified email, then `(issuer, sub)`; no JIT.
  - IdP model: one generic OIDC provider, config via `identity.sso.*` keys, `client_secret` as an encrypted config secret.
  - Surfaces: xstockstrat-ui login (all three segments), MCP agent OAuth authorize step, config-ui settings/test page.
  - Coexistence: password login retained; IdP groups claim maps to admin role (grant + SSO-managed revoke).
- Ledger traps surfaced: `fails.md` 2026-08-06 unify-admin-auth-gates (pre-login signed blob must not carry post-login identity) — captured as an Open Question for design.
- Existing facts grounded in code: identity is local-password only (`AuthenticateUser`), mints its own HS256 JWT from env `JWT_SECRET` (IDENTITY-1); agent has its own stateless OAuth 2.1 facade (`app/oauth_server.py`) over identity's OAuth RPCs.
- Per root CLAUDE.md the next step is `/sdd-review third-party-sso-oidc product-spec`, then `/sdd-design third-party-sso-oidc` (full mode recommended: auth + secrets + cross-service seams).

## Session 2026-11-24 — superseded by 345-authelia-sso (owner decision)

- Owner decision 2026-11-24: this feature is `demoted/canceled`, superseded by `docs/roadmap/features/345-authelia-sso/`
  (found by 345's 2026-11-24 `/sdd-review product-spec` overlap scan and its final pre-merge review).
- Why: 345 delivers OIDC SSO for the UI and MCP agent against homelab-edge
  `docs/superpowers/specs/2026-11-23-authelia-sso-respec.md`, whose decisions contradict this spec's model. Identity is
  not the relying party; the UI is, and the agent is a resource server of the issuer. Links are explicit (Link SSO) and
  never matched by verified email (respec decision 7; 345 FR-3). Roles stay in `identity.users.roles` and IdP groups do
  not map to roles (respec decision 6; 345 FR-6). The issuer and mode live in `identity/auth.mode` and `ui/oidc.*` /
  `agent/oidc.issuer`, not `identity.sso.*`.
- Nothing was implemented here (no implementation spec, no branch). The artifacts stay for `/sdd-archiver`.
