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

FR-7. A separate route `GET /auth/oauth-login` in `xstockstrat-ui` handles the agent OAuth
redirect flow from feature 018. It presents a login form that, on success, redirects to the
OAuth `redirect_uri` + `state` params from the agent's authorization request — keeping OAuth
UX separate from the regular operator login and avoiding branching logic on a shared route.

FR-8. Identity's HTTP Express server (added by feature 018 to serve `GET /login`) is removed
entirely. Identity returns to gRPC-only. `xstockstrat-agent`'s `/oauth/authorize` handler is
updated to redirect browsers to `{UI_BASE_URL}/auth/oauth-login` (instead of the identity HTTP
server). `UI_BASE_URL` is a new env var for the agent: `http://localhost:3000` locally, the
public App Platform URL in dev/prod. It is a browser-redirect target, not a gRPC endpoint, and
does not follow the `_ENDPOINT` suffix convention.

FR-9. The unified login page is styled consistently with the platform design (matching the
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
- `xstockstrat-ui` — unified login page at `/auth/login`; separate OAuth login at `/auth/oauth-login`; per-basePath login pages removed; middleware updated to redirect to `/auth/login`.
- `xstockstrat-identity` — HTTP Express server (added by feature 018) removed; identity returns to gRPC-only; no gRPC or proto changes.
- `xstockstrat-agent` — `/oauth/authorize` redirect target updated from identity HTTP to `{UI_BASE_URL}/auth/oauth-login`.

## Proto Contract Changes

- [x] No proto changes required — existing `AuthenticateUser`, `RefreshToken`, `RevokeToken`
  RPCs in identity are called as-is.

## Config Key Changes

New env var (browser-redirect URL, not a gRPC `_ENDPOINT`):
- `UI_BASE_URL` — added to `xstockstrat-agent` environment; e.g. `http://localhost:3000`
  locally and the public App Platform URL in dev/prod. Used to construct the OAuth login
  redirect URL (`{UI_BASE_URL}/auth/oauth-login`).

All other auth keys (`JWT_SECRET`, `IDENTITY_ENDPOINT`, `identity.*`) are unchanged.

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

_Resolved at `/sdd-review product-spec` gate (2026-06-01)._

- [x] **JWT scope after consolidation.** **Decision: single platform-wide JWT.** One JWT issued
  by identity, one `JWT_SECRET` shared with `xstockstrat-ui`, valid for all basePaths within
  the consolidated service. No per-basePath re-issuance needed.
- [x] **OAuth redirect mechanics.** **Decision: separate `GET /auth/oauth-login` route.** The
  OAuth flow uses a dedicated route distinct from the regular login, keeping handler logic clean
  and avoiding `?type=oauth` branching on a shared route. The agent redirects directly to
  `/auth/oauth-login` (not `/auth/login`).
- [x] **Identity HTTP server lifecycle.** **Decision: remove — update agent to redirect to UI.**
  Identity's HTTP Express server is removed; identity returns to gRPC-only. The agent's
  `/oauth/authorize` is updated to point to `{UI_BASE_URL}/auth/oauth-login`.
