# Product Spec: unified-login-page

**Created**: 2026-05-25
**Last Updated**: 2026-06-01

---

## Problem Statement

After features 012 (frontend auth) and 045 (UI consolidation), the platform still has multiple
login surfaces that must be individually maintained: each basePath segment of `xstockstrat-ui`
(`/trader/login`, `/insights/login`, `/config-ui/login`) has its own login page and its own
`/api/auth/login` route handler. Feature 018 adds a fourth surface — a minimal HTML form at
`identity:HTTP/login` for the OAuth redirect flow. Maintaining four independent login UIs means
duplicated credential-validation logic, inconsistent UX, and four separate surfaces to update
when auth behavior changes.

## User Story

As an operator, I want a single login page at `/auth/login` served by `xstockstrat-ui`,
so that all basePaths redirect unauthenticated users to one consistent, maintainable login
surface, and the identity OAuth flow (from feature 018) uses the same page.

## Functional Requirements

FR-1. `xstockstrat-ui` provides a unified login page at `/auth/login` — a route outside all
basePath prefixes (`/trader`, `/insights`, `/config-ui`), accessible without authentication.

FR-2. The `middleware.ts` for each basePath segment in `xstockstrat-ui` is updated to redirect
unauthenticated requests to `/auth/login?redirect=<original-path>` instead of the current
per-basePath `/login` pages.

FR-3. On successful authentication, the `/auth/login` page reads the `redirect` query param and
redirects the browser to it; any `redirect` value that does not start with `/trader`, `/insights`,
or `/config-ui` defaults to `/trader` (CSRF/open-redirect protection).

FR-4. The per-basePath login pages (`/trader/login`, `/insights/login`, `/config-ui/login`) and
their `app/login/page.tsx` files are removed from `xstockstrat-ui`.

FR-5. Authentication POSTs for all basePaths are handled by a single consolidated
`/api/auth/login` route in `xstockstrat-ui` that calls identity's `AuthenticateUser` gRPC RPC
and issues a session JWT scoped to the entire consolidated service (see Open Questions for JWT
scope decisions).

FR-6. Logout and token refresh routes (`/api/auth/logout`, `/api/auth/refresh`) are similarly
consolidated — one set of routes for all basePaths — with refresh logic calling identity's
`RefreshToken` gRPC RPC.

FR-7. Identity's minimal `GET /login` HTML form (added by feature 018 for the OAuth redirect
flow) is replaced with a redirect to `xstockstrat-ui/auth/login`, preserving the OAuth
`redirect_uri` and `state` params so the unified login page can redirect back to the agent's
OAuth authorize endpoint after the user authenticates.

FR-8. The unified login page is styled consistently with the platform design (matching the
existing trader login page) and is server-side rendered from a single Next.js page component.

## Out of Scope

- Social / SSO login (Google, GitHub) — separate feature.
- MFA / TOTP — separate feature.
- Per-basePath login theming / branding — separate feature.
- User registration or password reset flows — separate feature.
- Changes to the identity gRPC service (proto, gRPC handlers, DB schema) — auth logic unchanged.
- Any change to the OAuth protocol implementation in feature 018 (`xstockstrat-agent`); only
  the login redirect target changes.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-ui` — unified login page and consolidated auth routes; per-basePath login pages
  removed; middleware updated to redirect to `/auth/login`.
- `xstockstrat-identity` — `GET /login` HTML form (added by feature 018) replaced with a
  redirect to `xstockstrat-ui/auth/login`; no gRPC changes.

## Proto Contract Changes

- [x] No proto changes required — existing `AuthenticateUser`, `RefreshToken`, `RevokeToken`
  RPCs in identity are called as-is.

## Config Key Changes

- [x] No new config keys — consolidated auth routes use the same `JWT_SECRET`,
  `IDENTITY_ENDPOINT`, and `identity.*` config keys already present in `xstockstrat-ui`.

## Database Changes

- [x] No schema changes.

## Feature Workflow Notes

Branch to create: `feature/unified-login-page` (branch from `main-dev`).
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (`test` + auth category; non-breaking, no proto/schema changes)
- [ ] 2 service owners + platform lead (breaking proto change) — N/A
- [ ] DBA review + service owner (schema migration) — N/A

## Merge-order Dependencies

- **Must follow 045 (`ui-consolidation-nextjs`)**: `xstockstrat-ui` must exist before the
  per-basePath login pages can be consolidated.
- **Must follow 018 (`agent-mcp-oauth`) being launched**: FR-7 replaces identity's `GET /login`
  HTML form with a redirect; that form must exist first.

## Acceptance Criteria

1. Navigating to any protected route under `/trader`, `/insights`, or `/config-ui` while
   unauthenticated redirects to `/auth/login?redirect=<original-path>`.
2. Submitting valid credentials on `/auth/login` sets a session JWT and redirects to the
   `redirect` param (or `/trader` as default).
3. Submitting invalid credentials shows an inline error message; no redirect occurs.
4. `/trader/login`, `/insights/login`, and `/config-ui/login` no longer exist as renderable
   routes; requests to them return 404 or redirect to `/auth/login`.
5. Logout from any basePath invalidates the session (calls identity `RevokeToken`) and
   redirects to `/auth/login`.
6. Identity's `GET /login` redirects to `xstockstrat-ui/auth/login` with OAuth params
   preserved; the OAuth flow (feature 018) completes successfully end-to-end.
7. `tsc --noEmit` passes with zero errors after the auth route consolidation.

## Open Questions

_Left open for the `/sdd-review product-spec` gate — do not resolve inline._

- [ ] **JWT scope after consolidation.** The current per-basePath auth issues separate JWTs
  (one per service). After consolidation, should `xstockstrat-ui` issue a single platform-wide
  JWT accepted by all three basePaths (simpler, one `JWT_SECRET`), or keep per-basePath JWTs
  with independent secrets (stronger isolation, more config)? Single JWT is the natural fit for
  a single-process app; per-basePath only makes sense if the basePaths remain isolatable.
- [ ] **OAuth redirect mechanics.** FR-7 has identity redirect to `xstockstrat-ui/auth/login`;
  the unified page must then redirect back to the agent's OAuth authorize URL after login. What
  query param carries the agent callback URL through the unified login page, and how does the
  page distinguish an OAuth login from a regular frontend login so it can redirect correctly?
- [ ] **Identity HTTP server lifecycle.** Feature 018 adds an HTTP Express server to identity
  (currently gRPC-only) to serve `GET /login`. After 019 replaces that form with a redirect,
  does the HTTP server remain in identity (serving only the redirect endpoint), or is it removed
  entirely? Keeping it is simpler but adds a permanent HTTP surface to an otherwise gRPC-only
  service.
