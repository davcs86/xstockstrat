# Product Spec: wire-fe-auth

**Created**: 2026-05-18

---

## Problem Statement

The `xstockstrat-identity` service is fully implemented (JWT issuance, refresh token rotation, API keys, bcrypt passwords), but no frontend consumes it. All three Next.js UIs serve pages to unauthenticated users and API routes accept `user_id` from the caller with a silent `'default'` fallback. Operations cannot be attributed to a real user in logs, ledger events, or downstream services.

## User Story

As a platform operator, I want every frontend page and API call to require a valid JWT session, so that all trading operations, config changes, and analytics queries are attributed to a specific authenticated user.

## Functional Requirements

FR-1. Each Next.js frontend (trader, insights, config-ui) must expose a `/login` page that calls `AuthenticateUser` on `xstockstrat-identity` and stores the returned `access_token` and `refresh_token` as `httpOnly`, `Secure`, `SameSite=Lax` cookies.

FR-2. Each Next.js frontend must include a `middleware.ts` that validates the access token (via local JWT signature verification using `JWT_SECRET`) on every request and redirects unauthenticated or expired sessions to `/login`, preserving the original destination in a `redirect` query param.

FR-3. All Next.js API routes must extract `userId` from the verified JWT claims in the session cookie — never from request body fields or query parameters. The frontends are the authentication boundary; backend services receive user identity exclusively via the `x-user-id` metadata header (see FR-7), not via forwarded tokens.

FR-4. Access tokens must be silently refreshed (via `RefreshToken` RPC) when less than 60 seconds remain before expiry. Refresh token rotation is handled automatically by the identity service. If refresh fails, the session must be cleared and the user redirected to `/login`.

FR-5. Each frontend must expose a logout action that calls `RevokeToken` on the identity service and clears the session cookies.

FR-6. Frontend API routes must forward `x-user-id: <userId>` as a header on all outbound Connect-RPC calls to backend services. The `userId` value is extracted from the verified JWT claims in the session cookie. Backend services trust this header only from internal callers.

FR-7. nginx must strip `x-user-id` from all inbound external requests (port 80) to prevent external callers from spoofing user identity. The header is only valid when set by a frontend service inside the internal network.

## Out of Scope

- Multi-factor authentication (MFA)
- Social/OAuth login (Google, GitHub, etc.)
- Role-based access control (RBAC) enforcement at the UI or route level
- A new dedicated auth frontend service
- gRPC-level JWT interceptors on services not currently enforcing them (covered by Phase 7+ hardening)
- API key authentication flow from the UI

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-trader` — add login page, `middleware.ts`, fix API routes to extract userId from JWT claims and forward as `x-user-id`
- `xstockstrat-insights` — add login page, `middleware.ts`, forward `x-user-id` on outbound calls
- `xstockstrat-config-ui` — add login page, `middleware.ts`, forward `x-user-id` on outbound calls
- `xstockstrat-identity` — consumed as-is; no source changes required
- `xstockstrat-nginx` — add `proxy_set_header x-user-id ""` to strip the header on inbound external requests

## Proto Contract Changes

- [ ] No proto changes required

## Config Key Changes

- [ ] No new config keys required (`identity.jwt.access_ttl_seconds` and `identity.jwt.refresh_ttl_seconds` already exist)

## Database Changes

- [ ] No schema changes required

## Feature Workflow Notes

Branch to create: `feature/wire-fe-auth` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking change; touches only frontend services and nginx config)

## Acceptance Criteria

1. Navigating to any frontend route without a valid session cookie redirects to `/login`.
2. Successful login with valid credentials stores access + refresh tokens as `httpOnly` cookies and redirects to the originally requested page.
3. API routes extract `userId` exclusively from verified JWT claims in the session cookie — not from request body or query parameters.
4. All outbound Connect-RPC calls from Next.js API routes carry `x-user-id: <userId>` derived from the JWT claims; no Bearer token is forwarded.
5. Access tokens are refreshed automatically before expiry; failed refresh clears the session and redirects to `/login`.
6. Logout clears cookies and the identity service marks the refresh token as revoked.
7. nginx strips `x-user-id` from all inbound external requests.
8. Expired or tampered tokens return a 401 on API routes and redirect browser requests to `/login`.

## Open Questions

- [ ] Should all three frontends share a single `@xstockstrat/auth` workspace package for the middleware and token-refresh logic, or duplicate the implementation per frontend?
- [ ] Should the login page be its own standalone page per frontend, or should nginx route `/login` to a single shared login app (deferred — out of scope per this spec, but worth noting for future SSO consideration)?
- [ ] What is the token storage strategy for SSR API routes — read from cookie header on each request, or cache in a server-side session store?
