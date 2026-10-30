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
