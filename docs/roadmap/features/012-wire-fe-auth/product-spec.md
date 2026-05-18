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

FR-7. nginx must strip `x-user-id`, `x-access-scope`, and `x-trace-id` from all inbound external requests (port 80) to prevent external callers from spoofing user identity, permission scope, or trace context. These headers are only valid when set by frontend or backend services inside the internal network.

FR-8. Each frontend auth library must export a `rolesToAccessScope(roles: string[]): number` function that maps role strings to a permissions bitmap (`read = 0x01`, `write = 0x02`, `admin = 0x04`, `trading = 0x08`; unrecognized roles contribute `0`). Role-to-bit mapping: `viewer` → `read`; `trader` → `read | write | trading`; `admin` → `read | write | admin | trading`. Frontend API routes must forward `x-access-scope: <decimal-string>` on all outbound Connect-RPC calls, derived from `claims.roles`. Backend services forward this value verbatim — they do not re-compute the bitmap.

FR-9. Each frontend's `middleware.ts` must attach a `x-trace-id` (UUID v4) to every request. If the incoming request already carries `x-trace-id`, preserve it; otherwise generate one via `crypto.randomUUID()`. The trace ID is injected into Next.js forwarded request headers via `NextResponse.next({ request: { headers: ... } })` so that API route handlers can read it from `req.headers.get('x-trace-id')` and forward it on all outbound Connect-RPC calls. Propagation is upstream only — `x-trace-id` must never be set on response headers.

FR-10. All backend services must implement a propagation layer that reads `x-user-id`, `x-access-scope`, and `x-trace-id` from incoming gRPC metadata and injects them into all outbound service-to-service gRPC calls within the same request context. Services that receive these headers but make no outbound service calls (`xstockstrat-ledger`, `xstockstrat-identity`, `xstockstrat-notify`, `xstockstrat-config`) require server-side extraction only (for structured logging context).

## Out of Scope

- Multi-factor authentication (MFA)
- Social/OAuth login (Google, GitHub, etc.)
- Role-based access control (RBAC) enforcement at the UI, route, or service level — `x-access-scope` is forwarded for observability and future use only; backend services must not enforce it in this feature
- A new dedicated auth frontend service
- gRPC-level JWT interceptors on services not currently enforcing them (covered by Phase 7+ hardening)
- API key authentication flow from the UI

## Affected Services

Exact service names from CLAUDE.md Service Registry:

Frontend services — auth wiring, JWT session, and three-header forwarding:
- `xstockstrat-trader` — add login page, `middleware.ts` (with trace ID), fix API routes to extract userId + accessScope from JWT claims and forward all three headers (`x-user-id`, `x-access-scope`, `x-trace-id`) on all outbound calls
- `xstockstrat-insights` — same as trader
- `xstockstrat-config-ui` — same as trader
- `xstockstrat-identity` — consumed as-is; no source changes required
- `xstockstrat-nginx` — strip `x-user-id`, `x-access-scope`, and `x-trace-id` from all inbound external requests

Backend services — propagation interceptor (server + client for callers; server-only for leaves):
- `xstockstrat-trading` — Go unary interceptors: extract on server, inject on client calls to ledger/notify/portfolio
- `xstockstrat-portfolio` — Go unary interceptors: extract on server, inject on client calls to ledger/marketdata/notify
- `xstockstrat-marketdata` — Go unary interceptors: extract on server, inject on client calls to ledger/notify
- `xstockstrat-indicators` — Python per-method extraction + outbound metadata: extract from servicer context, pass to ingest stub calls
- `xstockstrat-ingest` — Python per-method extraction + outbound metadata: extract from servicer context, pass to marketdata/ledger stub calls
- `xstockstrat-analysis` — Python per-method extraction + outbound metadata: extract from servicer context, pass to marketdata/indicators/ingest/ledger stub calls
- `xstockstrat-ledger` — Node.js AsyncLocalStorage middleware: extract from HTTP headers on Connect-RPC path (no outbound service calls)
- `xstockstrat-identity` — Node.js AsyncLocalStorage middleware: extract from HTTP headers (no outbound service calls)
- `xstockstrat-notify` — Node.js AsyncLocalStorage middleware: extract from HTTP headers (no outbound service calls)
- `xstockstrat-config` — Node.js AsyncLocalStorage middleware: extract from HTTP headers (no outbound service calls)

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
9. All outbound Connect-RPC calls from Next.js API routes carry `x-access-scope: <bitmap>` and `x-trace-id: <uuid>` alongside `x-user-id`.
10. A request trace originating at a frontend API route carries the same `x-trace-id` value through all downstream backend service calls.
11. nginx strips `x-access-scope` and `x-trace-id` from inbound external requests alongside `x-user-id` (same test vector as AC-7).

## Open Questions

- [x] **OQ-1 — DEFERRED to impl-spec**: Shared `@xstockstrat/auth` workspace package decision deferred to `/sdd-spec`; see context.md 2026-05-18.
- [x] **OQ-2 — DEFERRED/OUT OF SCOPE**: Per-frontend login pages per this spec; shared nginx-routed login app deferred for future SSO consideration.
- [x] **OQ-3 — RESOLVED**: Read from the `httpOnly` cookie header on each incoming request (stateless). No server-side session store. Consistent with FR-3.
