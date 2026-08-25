# Product Spec: ui-auth-improvements

**Created**: 2026-08-25

---

## Problem Statement

Two rough edges in `xstockstrat-ui` auth: (1) sessions are dropped the moment the browser is closed —
the auth cookies are set with no `maxAge`, so they are session cookies even though the server-side
refresh token lives 30 days — giving operators no way to stay signed in across restarts; and (2) when
a browser data call returns Unauthorized (an expired/invalid session), the page surfaces a broken /
errored panel instead of sending the user back to log in.

## User Story

As a platform operator, I want to (1) opt into an extended login session so I stay signed in across
browser restarts, and (2) be automatically sent to the login page whenever a call comes back
Unauthorized, so an expired session returns me to sign-in instead of showing a broken page.

## Functional Requirements

FR-1. The login form presents a "Remember me" (extended session) control, unchecked by default.
FR-2. When "Remember me" is checked, the auth cookies (`access_token`, `refresh_token`) are written
      as **persistent** cookies with a bounded `maxAge` (the extended-session duration), so the
      session survives a browser restart.
FR-3. When "Remember me" is left unchecked, cookie behavior is unchanged from today — **session
      cookies** with no `maxAge`, cleared on browser close.
FR-4. The extended-session `maxAge` must not exceed the server-side refresh-token TTL
      (`identity.jwt.refresh_ttl_seconds`, default 2592000s / 30d), so a persisted cookie is never
      left pointing at an already-expired server-side refresh token.
FR-5. When a browser data call (any segment's BFF RPC via `browserClients`) fails with gRPC
      `Unauthenticated` (HTTP 401), the browser is redirected to the unified login page at
      `/auth/login?redirect=<current path>`, preserving the current location for post-login return.
FR-6. The 401→login redirect applies uniformly to **every** browser gRPC client across all segments
      (`/trader`, `/insights`, `/config-ui`, `/accounts`), not a subset — a single shared transport
      path so no client is silently left unguarded.

## Out of Scope

- Any change to token minting or TTLs in `xstockstrat-identity` (the 30-day refresh TTL already
  backs a 7-day persistent cookie — no proto or identity change).
- Sliding/rolling re-issue of the persistent cookie on activity (a fixed `maxAge` window is enough;
  the existing near-expiry access-token refresh in `middleware.ts` is untouched).
- "Remember this device" / trusted-device or MFA changes.
- Redirect handling for **server-side** 401s already covered by `middleware.ts` (browser navigation
  is already redirected today); this feature adds only the **client-side data-call** path.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-ui` — login form control, cookie-setting in `/api/auth/login`, cookie helpers in
  `src/lib/auth.ts`, and a shared browser transport interceptor for the 401 redirect. No backend
  service changes.

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **UI** — `xstockstrat-ui`: the unified login page (`src/app/auth/login/page.tsx` /
  `src/components/auth/AuthForm.tsx`) gains the "Remember me" control (FR-1..FR-3); the 401→login
  redirect (FR-5/FR-6) is a cross-cutting behavior on the shared browser transport used by all
  segments (`/trader`, `/insights`, `/config-ui`, `/accounts`). No new page/route — the login page
  already exists and is already reachable, so no `PLATFORM_SUBNAV` registration is required.
- [ ] **Agent** — no MCP tool change.
- [ ] **None**.

## Proto Contract Changes

- [x] No proto changes required. `AuthenticateUserRequest` (email + password) is unchanged; the
  extended session is purely a UI cookie-persistence decision, and the server-side refresh token
  already lives 30 days.

## Config Key Changes

- [x] No new config keys _(default position — see Open Question on whether the extended-session
  duration should be a hardcoded constant vs. a config key)_.

## Database Changes

- [x] No schema changes.

## Feature Workflow Notes

Branch to create: `feature/ui-auth-improvements` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (`xstockstrat-ui`) — UI-only change, no proto/config/schema
- [ ] 2 service owners + platform lead (breaking proto change) — n/a
- [ ] DBA review + service owner (schema migration) — n/a

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [ ] **Extended-session duration & source.** Story says "7 days or something." Options: (a) hardcode
      a `REMEMBER_ME_MAX_AGE_SECONDS` constant (simplest, "minimum that solves it") in `src/lib/auth.ts`;
      (b) make it a config key (`ui.auth.remember_me_ttl_seconds`). Recommend (a) for a quick change,
      with the value bounded ≤ `identity.jwt.refresh_ttl_seconds` (FR-4). Decide in `/sdd-design`.
- [ ] **Shared transport refactor (DRY / known trap).** Today each `src/lib/browserClients/*.ts`
      file calls `createConnectTransport({ baseUrl })` inline (~15 files). FR-6 needs the 401
      interceptor on *every* one. Ledger fails repeatedly flag "shipped the producer, forgot the
      shared consumer" (2026-07-xx entries) — adding the interceptor to a subset would silently leave
      some clients unguarded. Recommend consolidating onto one shared `makeBrowserTransport(baseUrl)`
      factory carrying the interceptor. Confirm the factory approach in `/sdd-design`.
- [ ] **Redirect-loop / login-page safety.** The interceptor must not fire on the login flow itself
      and must avoid a redirect loop if `/api/auth/*` returns 401 (e.g. suppress when already on
      `/auth/login`). Confirm the guard in `/sdd-design`.
