# Product Spec: unified-login-page

**Created**: 2026-05-25
**Status**: Preliminary idea capture — not yet reviewed. Run `/sdd-story unified-login-page` to formalize.

---

## Problem Statement

After feature 018 (agent-mcp-oauth), the platform has four separate login surfaces:
1. `xstockstrat-trader` — its own Next.js login page
2. `xstockstrat-insights` — its own Next.js login page
3. `xstockstrat-config-ui` — its own Next.js login page
4. `xstockstrat-identity` `GET /login` — minimal HTML form added by feature 018 for the OAuth redirect flow

Maintaining four independent login UIs means duplicated credential validation logic, inconsistent error messaging, and four separate surfaces to update whenever auth behavior changes. Operators see a different login experience depending on which frontend they enter through.

## User Story

As an operator, I want a single login page regardless of which platform URL I navigate to, so that authentication is consistent, maintainable from one place, and visually unified.

## Preliminary Functional Requirements

FR-1. All authentication entry points (trader, insights, config-ui, and the OAuth redirect from 018) redirect to a single canonical login URL served by `xstockstrat-identity`.

FR-2. The unified login page is an enhanced version of the `GET /login` form introduced in feature 018 — upgraded from bare inline styles to a proper styled page (minimal CSS, no framework dependency).

FR-3. On successful authentication, the login page redirects the browser to the original destination: either the frontend the user came from, or the OAuth callback URL (preserving the `redirect_uri` and `state` parameters from the OAuth flow).

FR-4. The three Next.js frontends (`xstockstrat-trader`, `xstockstrat-insights`, `xstockstrat-config-ui`) remove their individual `/login` pages and instead redirect unauthenticated requests to the identity login URL (via `middleware.ts` in each).

FR-5. The login URL is configurable via `IDENTITY_HTTP_ENDPOINT` (already present in all frontends) — frontends construct the redirect as `${IDENTITY_HTTP_ENDPOINT}/login?redirect_uri=<origin>&state=<csrf>`.

FR-6. The identity login page returns a JWT (or session cookie) that the frontends accept on the callback redirect to complete their own session initialization.

## Architectural Decision Needed

The main open question before /sdd-story: **where does post-login session state live?**

- **Option A (simpler)**: Identity `/login` sets a short-lived cookie scoped to its own domain; each frontend's `GET /api/auth/callback` exchanges this cookie for its own JWT. Requires nginx to expose identity's `/login` route at a shared subdomain or path.
- **Option B (unified session)**: Identity issues a platform-wide JWT that all three frontends accept directly. Requires all frontends to share a `JWT_SECRET` and trust the same issuer. Simplest operationally but tightest coupling.

Decision should be made during `/sdd-story` with platform lead input.

## Out of Scope (preliminary)

- Social / SSO login (Google, GitHub) — separate feature
- MFA / TOTP — separate feature
- Per-frontend branding / theming — separate feature
- User registration / password reset flows — separate feature

## Affected Services (preliminary)

- `xstockstrat-identity` — upgrade `GET /login` form from 018; add session/JWT issuance on success
- `xstockstrat-trader` — remove own login page; add middleware redirect to identity
- `xstockstrat-insights` — remove own login page; add middleware redirect to identity
- `xstockstrat-config-ui` — remove own login page; add middleware redirect to identity
- `xstockstrat-nginx` — expose identity `/login` route at the proxy layer

## Dependency

**Must follow feature 018 (`agent-mcp-oauth`) being launched.** Feature 018 adds the minimal `GET /login` to identity that this feature upgrades. Do not start implementation until 018 is live.

## Open Questions

- [ ] Which session model (Option A cookie exchange vs Option B shared JWT)?
- [ ] Does nginx expose identity's `/login` at a dedicated path (e.g. `/auth/login`) or does each frontend redirect directly to `IDENTITY_HTTP_ENDPOINT/login`? Direct redirect avoids nginx changes but leaks the internal identity port in the browser URL.
- [ ] Should the login page handle the OAuth redirect_uri flow from feature 018 identically, or does the unified page need separate routing logic for OAuth vs. direct frontend auth?
