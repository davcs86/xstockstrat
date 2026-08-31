# Product Spec: ui-middleware-nodejs-runtime

**Created**: 2026-08-11

---

## Problem Statement

`xstockstrat-ui`'s `src/middleware.ts` runs in the Next.js Edge runtime, which cannot import
Node-only modules — including `src/lib/identity.ts`'s `@connectrpc/connect-node` gRPC client. So
the middleware's near-expiry access-token refresh cannot call `xstockstrat-identity` directly; it
instead makes a self-referential HTTP call to its own `/api/auth/refresh` Node.js route handler,
which then calls `identity.ts`. That extra network hop was the root cause of a production defect
(`docs/reports/2026-08-11-ui-middleware-self-refresh-tls-defect.md`, fixed in PR #925 by looping
back over plain HTTP to `127.0.0.1:$PORT` instead of the request's public origin). The loopback fix
is safe, but it's a workaround for an avoidable network hop: Next.js 15.5 (this repo's pinned
version) stabilized a Node.js runtime option for middleware, which would let the refresh call reach
`identity.ts` in-process, eliminating the hop and the class of self-fetch bugs entirely.

## User Story

As a platform engineer, I want `xstockstrat-ui`'s `middleware.ts` to run in the Node.js runtime and
call `xstockstrat-identity`'s `refreshSession()` directly, so the near-expiry token refresh no
longer needs a self-referential HTTP call to `/api/auth/refresh` — with the observable behavior
(session refresh, redirect-to-login on failure, cookie attributes) unchanged.

## Functional Requirements

FR-1. `src/middleware.ts` opts into the Node.js runtime (`export const config = { runtime: 'nodejs', matcher: [...] }`).

FR-2. The near-expiry refresh branch calls `refreshSession(refreshToken)` (from `src/lib/identity.ts`)
directly instead of `fetch()`-ing `/api/auth/refresh`. `middleware.ts` reads the `refresh_token`
cookie directly (mirroring what `app/api/auth/refresh/route.ts` does today) since there's no
longer an inner HTTP request to carry it.

FR-3. On successful refresh, the middleware sets the new session cookies itself (reusing
`setSessionCookies` from `auth.ts`) on the outgoing `NextResponse`, matching today's behavior where
the browser receives updated `Set-Cookie` headers from the refresh call — same cookie attributes
(`httpOnly`/`secure`/`sameSite`/path/max-age).

FR-4. On failed refresh (invalid/expired refresh token), the middleware clears session cookies
(`clearSessionCookies`) and redirects to `/auth/login`, matching current behavior.

FR-5. `PR #925`'s loopback workaround (`buildInternalRefreshUrl()` in `auth.ts`, the `fetch()` call
and the `api/auth/refresh` matcher exclusion in `middleware.ts`) is removed — the `/api/auth/refresh`
Node route itself may stay (browsers never call it directly today, but removing it is out of scope
here; see Out of Scope) or be deleted if this feature's design finds it now fully redundant.

FR-6. `docs/patterns/frontend-auth.md` and
`services/xstockstrat-ui/CLAUDE.md` are updated in the same feature: the documented hard rule "Only
`lib/auth.ts` may be imported from `middleware.ts`" (and the associated Edge-bundling-trap
explanation) no longer applies once `middleware.ts` runs in the Node.js runtime, and must be
corrected — not left contradicting the shipped code.

FR-7. `docs/roadmap/ledger/insights.md`'s 2026-08-05 `wire-fe-auth` entry ("`middleware.ts` and
other Edge-runtime code must never import modules that pull in `@connectrpc/connect-node`") predates
this change and describes a now-superseded constraint; the Ledger is append-only, so this feature
does not edit it, but its design phase must explicitly account for why the old constraint no longer
applies (see Design-Phase Investigation).

## Out of Scope

- Migrating any other Edge-runtime code path in this repo (there is currently only one
  `middleware.ts`).
- Deleting `app/api/auth/{login,logout}/route.ts` or restructuring the unified-login flow —
  those routes are Node-runtime already and unaffected.
- Any change to `ACCESS_TOKEN_REFRESH_THRESHOLD_SECONDS`, the redirect-to-login fallback behavior,
  or cookie attributes (`httpOnly`/`secure`/`sameSite`) — behavior must be observably identical to
  today, only the transport changes.
- Renaming `middleware.ts` to `proxy.ts` (Next.js's newer file-convention rename, deprecating
  "Middleware" terminology as of v16) — out of scope; this repo is on Next 15.5.21, and that rename
  is a separate, unrelated migration.

## Affected Services

- `xstockstrat-ui` — `src/middleware.ts`, `src/lib/auth.ts`, `src/lib/identity.ts`,
  `services/xstockstrat-ui/CLAUDE.md`
- Repo-root docs — `docs/patterns/frontend-auth.md`

## Consumer Surface(s)

Constitution **C-14** — consumer surface must be declared for every feature.

- [ ] **UI** — no visible change; the trader/insights/config-ui/accounts segments behave identically.
- [ ] **Agent** — not applicable.
- [x] **None** — internal auth-transport refactor of the existing middleware. No new capability,
  page, control, route, or MCP tool. The observable behavior (session refresh, redirect-to-login on
  failure, cookie attributes) is unchanged; only how the middleware reaches `xstockstrat-identity`
  changes (in-process `refreshSession()` instead of a self-fetch to `/api/auth/refresh`), so there
  is no user-facing surface to declare.

## Proto Contract Changes

- [ ] No proto changes required

## Config Key Changes

- [ ] No new config keys

## Database Changes

- [ ] No schema changes

## Feature Workflow Notes

Branch to create: `feature/ui-middleware-nodejs-runtime` (branch from `main-dev`).
Approval gates required (per `docs/runbooks/feature-workflow.md`):

- [x] 1 service owner approval — non-breaking, single-service (`xstockstrat-ui`) internal refactor;
  no proto, config, or DB gate applies.

## Acceptance Criteria

Acceptance scenarios are the single source of acceptance truth (Constitution **C-15**) and live in
[`acceptance.feature`](acceptance.feature). Each functional requirement (FR-N) is covered by at
least one `@AC-*` scenario tagged with the FR it validates; `/sdd-spec` traces each scenario to a
concrete test step, and the scenarios are promoted into the `xstockstrat-ui` durable business-rule
suite at launch (**C-16**).

## Open Questions

None — moved to Design-Phase Investigation below.

## Design-Phase Investigation (owned by /sdd-design Phase 0)

These are genuine feasibility investigations the design phase owns and must resolve during Recon —
they are **not** acceptance gates on this product spec, so they are listed as plain bullets rather
than checklist items. The first is load-bearing: if it fails, the feature's entire premise collapses.

- **Load-bearing — does the Node.js middleware runtime actually lift the Edge-bundling constraint on
  `@connectrpc/connect-node` under this repo's `output: 'standalone'` Docker build?** The known trap
  (`docs/roadmap/ledger/insights.md`, 2026-08-05, `wire-fe-auth`, reuse — the entry at
  `insights.md:777-780`) records: "`middleware.ts` and other Edge-runtime code must never import
  modules that pull in `@connectrpc/connect-node`; inline the needed constant instead." This
  feature's entire premise is that Next.js 15.5's stable Node.js middleware runtime removes the reason
  that rule existed. Concretely, `next.config.js` lists `@connectrpc/connect-node` in
  `serverExternalPackages` **for route handlers only**, and `src/lib/identity.ts` carries a "NEVER
  import this file from middleware.ts or from any module middleware.ts transitively imports" header —
  both encode the old Edge constraint. The Ledger is append-only, so this feature does not edit that
  entry; but design must **VERIFY, not assume**, that the Node.js runtime genuinely lifts the
  constraint **under this repo's own Docker `output: 'standalone'` build**, by re-deriving why the
  rule was written and confirming a real build where `middleware.ts` transitively imports
  `@connectrpc/connect-node` succeeds. Treat "the ledger entry is simply obsolete" as a hypothesis to
  disprove, not a given (recurrence family: `docs/roadmap/ledger/fails.md` 2026-07-29
  `081-qa-capability` — "exercise the producer, not its advertised state").
- **Per-invocation client behavior.** Does `identity.ts`'s `refreshSession()` (and the
  `@connectrpc/connect-node` gRPC client it builds) behave correctly when constructed/invoked once per
  middleware invocation (as opposed to once per Node.js route handler invocation, its current call
  pattern)? Middleware runs far more frequently (every non-excluded request) than the refresh route
  did — check for any per-call client-construction cost or connection-pooling assumption in
  `connectClients.ts`.
- **Fate of `app/api/auth/refresh/route.ts`.** Should it be deleted once middleware no longer calls
  it, or kept as a still-reachable (if currently uncalled) API surface? Confirm no other caller exists
  before deciding (FR-5 leaves this to the design phase).
- **Docker/standalone bundling gotcha.** Is there a `standalone`-specific gotcha with Node.js-runtime
  middleware bundling (e.g. `serverExternalPackages` in `next.config.js` already lists
  `@connectrpc/connect-node` for route handlers — does middleware need the same treatment, and does
  the standalone output's `server.js` still discover it correctly)? Must be verified with a real
  `docker build`/`next build` under `output: 'standalone'`, not assumed from Vercel-oriented
  documentation.
