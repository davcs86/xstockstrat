# Implementation Spec: ui-middleware-nodejs-runtime

**Status**: `pending`
**Created**: 2026-08-31
**Feature**: `docs/roadmap/features/128-ui-middleware-nodejs-runtime/feature.md`
**Total Steps**: 4
**Feature Branch**: `feature/ui-middleware-nodejs-runtime`

---

## Execution Summary

This is an internal auth-transport refactor of `xstockstrat-ui`'s single `src/middleware.ts`,
following `design.md`'s Chosen Approach exactly. Step 1 is the cohesive code change: flip
`middleware.ts` to `runtime: 'nodejs'`, replace the near-expiry `fetch(buildInternalRefreshUrl())`
loopback with an in-process `refreshSession()` call that sets/clears cookies on the `NextResponse`,
delete `buildInternalRefreshUrl()` from `src/lib/auth.ts`, **keep** the `api/auth/refresh` matcher
exclusion (corrected FR-5 — it now guards a live browser caller, `authRedirect.ts:40`), and correct
the now-stale in-file "Edge-only / never reachable from middleware" comments in `auth.ts` and
`identity.ts`. These three files are edited together because they are mutually dependent (removing
`buildInternalRefreshUrl` from `auth.ts` while `middleware.ts` still imports it would not compile).
Step 2 is the paired vitest unit test (red-before-green) that drives the middleware branches and the
structural assertions. Step 3 is the **load-bearing** standalone-build feasibility gate (`@AC-6`) —
the design's own red-before-green premise check; a build failure blocks the feature (F-04/P-03).
Step 4 corrects the two external docs (`docs/patterns/frontend-auth.md`,
`services/xstockstrat-ui/CLAUDE.md`).

**Consumer surface (C-14):** the product spec declares Consumer Surface = **None —
internal/platform-only** (no visible change to trader/insights/config-ui/accounts). This is a
decision, not an omission: no UI-segment or Agent-tool step is required. The observable behavior
(session refresh, redirect-to-login on failure, cookie attributes) is unchanged; only the
middleware→identity transport changes.

**FR-7 (no file change):** `docs/roadmap/ledger/insights.md`'s 2026-08-05 `wire-fe-auth` entry is
append-only and is **not** edited by this feature; `design.md` (§ Constitution Rules Touched / Open
Risk 1) already records why the Edge-runtime constraint it describes is superseded. No step touches
it.

**FR-3 note (strict improvement, not a regression):** today's middleware discards `refreshRes`
(`middleware.ts:39-49`) and does not forward the rotated `Set-Cookie`; the new in-process design
sets the cookies on the `NextResponse` via `setSessionCookies`. This is a latent-bug fix, so
"observably identical" is slightly imprecise in the new code's favor (recon Risk 3 / design Open
Risk 3) — flagged so it is not mistaken for a regression.

### Scenario Coverage (Constitution C-15)

- `@AC-1` (config.runtime === "nodejs" + matcher still declared) → **Step 2**
- `@AC-2` (in-process `refreshSession()`, no self-`fetch()`, one `Set-Cookie`) → **Step 2**
- `@AC-3` (refreshed cookies via `setSessionCookies`, same attributes) → **Step 2**
- `@AC-4` (`refreshSession()` failure ⇒ `clearSessionCookies` + redirect to `/auth/login`) → **Step 2**
- `@AC-5` (`buildInternalRefreshUrl` gone, no self-`fetch()`, matcher still excludes `api/auth/refresh`) → **Step 2**
- `@AC-6` (Node-runtime middleware imports connect-node; standalone build + container refresh succeed) → **Step 3**
- `@AC-7` (Edge-only docs corrected) → **Step 4**

All 7 scenarios covered.

## Step Dependencies

- **Step 2 [test] covers Step 1 [service]** — the vitest unit tests assert the new middleware
  behavior and the removal of `buildInternalRefreshUrl`. Authored red-before-green (P-06): they fail
  against the pre-Step-1 tree (which has no `runtime` key, still self-`fetch()`es, and still exports
  `buildInternalRefreshUrl`) and pass after Step 1.
- **Step 3 requires Step 1** — the standalone build can only prove the feasibility premise once
  `middleware.ts` actually runs on the Node runtime and transitively imports
  `@connectrpc/connect-node` (via `@/lib/identity`). It is the design's load-bearing gate: a failure
  **blocks** the feature (F-04/P-03), and may require a middleware-aware `serverExternalPackages`
  adjustment in `next.config.js` or render the feature infeasible on this Next version.
- **Step 4 requires Step 1** — docs are corrected to match the shipped Node-runtime middleware; no
  code dependency, but they must describe the landed behavior.

---

### Step 1 — service: Middleware → Node.js runtime + in-process refresh; delete `buildInternalRefreshUrl`; keep matcher exclusion

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/middleware.ts` — modify
- `services/xstockstrat-ui/src/lib/auth.ts` — modify
- `services/xstockstrat-ui/src/lib/identity.ts` — modify (correct stale in-file header comment only)

**Reviewers**: xstockstrat-ui service owner — Connect-RPC call safety, environment (`production`/`staging`) scope correctness, no secret values rendered in UI (per `docs/runbooks/reviewer-registry.md`; `service` step → service owner of the service being modified)

**Codebase Evidence**:
- `middleware.ts:11-22` — `export const config = { matcher: [ '/', '/((?!…|api/auth/login|api/auth/refresh|api/health|…).+)' ] }`; the `api/auth/refresh` exclusion is inside the negative-lookahead at `:20`; its rationale comment ("called only by this middleware's own near-expiry refresh … never by the browser") is `:14-17` (now stale — recon Risk 2).
- `middleware.ts:3-8` — import block pulls `buildInternalRefreshUrl` from `@/lib/auth` (`:7`).
- `middleware.ts:24-25` — `export async function middleware(req: NextRequest)` → `getSessionFromRequest(req)`.
- `middleware.ts:27` — `const traceId = req.headers.get(HEADER_TRACE_ID) ?? generateTraceId();`
- `middleware.ts:29-37` — `!claims` branch: login-path passthrough (`:30-32`) + redirect pattern `new URL('/auth/login', req.url)` + `searchParams.set('redirect', …)` (`:34-36`).
- `middleware.ts:39-49` — near-expiry branch: `if (claims.expires_at - Math.floor(Date.now()/1000) < ACCESS_TOKEN_REFRESH_THRESHOLD_SECONDS)` then `await fetch(buildInternalRefreshUrl(), { method:'POST', headers:{ cookie: … } })` (`:40-43`); `if (!refreshRes.ok)` ⇒ redirect to `/auth/login` (`:44-48`).
- `middleware.ts:51-55` — success fall-through: `return NextResponse.next({ request: { headers: new Headers({ …Object.fromEntries(req.headers), [HEADER_TRACE_ID]: traceId }) } })`.
- `auth.ts:12` — `ACCESS_TOKEN_REFRESH_THRESHOLD_SECONDS = 60` (unchanged; out of scope per FR / Out of Scope).
- `auth.ts:42-44` — stale comment: "refreshSession / revokeToken live in `identity.ts` … must not be reachable from middleware, which Next.js bundles for the Edge runtime."
- `auth.ts:46-60` — `buildInternalRefreshUrl()` JSDoc (`:46-56`) + `export function buildInternalRefreshUrl(): URL { … }` (`:57-60`) — PR #925 loopback, the deletion target.
- `auth.ts:62-86` — `setSessionCookies(res, accessToken, refreshToken, opts?)`; with no `opts.maxAge` ⇒ session cookies (`:69-71`, `httpOnly`/`secure`/`sameSite:'lax'`/`path:'/'`). Reuse target — do not re-implement.
- `auth.ts:88-91` — `clearSessionCookies(res)` (`maxAge:0`, `path:'/'`). Reuse target.
- `identity.ts:1-6` — header comment "NEVER import this file from middleware.ts … breaks the Edge runtime bundle" (now false — middleware imports it after this step).
- `identity.ts:11-24` — `refreshSession(refreshToken)` returns `{ accessToken, refreshToken, claims } | null`; calls `identityClient.refreshToken({ refreshToken })` (`:15`). The exact RPC the refresh route already makes.
- `app/api/auth/refresh/route.ts:6` — canonical read pattern `req.cookies.get('refresh_token')?.value` (mirror this in middleware); `:10` `refreshSession`; `:17` `setSessionCookies(response, result.accessToken, result.refreshToken)` (no `opts` ⇒ session cookies — match this); `:13` `clearSessionCookies` on failure.
- `connectClients.ts:2,26-28,35` — `identityClient` is a module-load singleton on a lazy `createGrpcTransport` (`makeTransport`), no eager I/O — importing it into middleware adds no per-request connection cost (recon Risk 6).
- `authRedirect.ts:38-48` — **live browser caller** `attemptRefresh()` does `fetch('/api/auth/refresh', { method:'POST' })` (`:40`). This is why the matcher exclusion must STAY (corrected FR-5; design Chosen Approach bullet 4; preserves durable `@AC-5`/`@AC-6`).
- Next version supports the switch: `package.json:48` `"next": "^15.5.21"` (Node middleware runtime stable since 15.5.0 — design.md, Context7 `/vercel/next.js`). No `experimental.*` flag needed.

**TDD**: `red-green required` — paired with Step 2 (`/sdd-execute` proves Step 2 fails against this pre-change file, passes after).

**Covers**: `—` (code-bearing step; behavioral coverage is asserted by Step 2)

**Instructions**:
1. **Runtime opt-in (FR-1).** In `middleware.ts` `export const config` (`:11-22`), add `runtime: 'nodejs'` as a sibling of `matcher`. **KEEP the `matcher` array byte-for-byte**, including the `api/auth/refresh` exclusion at `:20`.
2. **Rewrite the matcher rationale comment (`:14-17`)** so it describes the corrected reason for the `api/auth/refresh` exclusion: the path is excluded because it has a **live browser caller** (`src/lib/authRedirect.ts:40`, feature-153) whose refresh POST fires with an expired/invalid access token — matching it would let middleware redirect that POST to `/auth/login`, regressing the durable `@AC-5`/`@AC-6` guarantees (C-16). It is no longer a middleware self-call (that is being removed in step 4 below).
3. **In-process refresh (FR-2/FR-3).** In the near-expiry branch (`middleware.ts:39-49`), keep the `if (claims.expires_at - … < ACCESS_TOKEN_REFRESH_THRESHOLD_SECONDS)` guard and replace its body:
   - Read the refresh token directly, mirroring the route: `const refreshToken = req.cookies.get('refresh_token')?.value;`. If absent, treat it as a failed refresh (go to the failure path in step 5).
   - Call `refreshSession(refreshToken)` (imported from `@/lib/identity`) instead of `fetch(...)`. Do **not** re-implement the identity RPC (recon Patterns to REUSE).
   - **On success** (non-null result): build the success `NextResponse` first — `const response = NextResponse.next({ request: { headers: new Headers({ ...Object.fromEntries(req.headers), [HEADER_TRACE_ID]: traceId }) } });` (preserving the existing trace-ID injection, `:51-55`) — then `setSessionCookies(response, result.accessToken, result.refreshToken)` (no `opts` ⇒ session cookies, matching `route.ts:17`) and `return response;`.
4. **Delete the loopback (FR-5).** Remove `buildInternalRefreshUrl` from the `@/lib/auth` import (`middleware.ts:7`) and delete the `buildInternalRefreshUrl()` function + its JSDoc from `auth.ts:46-60`. Also remove the now-stale note in `auth.ts:42-44` ("… must not be reachable from middleware, which Next.js bundles for the Edge runtime") or rewrite it to state that `refreshSession`/`revokeToken` live in `identity.ts` and are now reachable from the Node-runtime middleware.
5. **On failed refresh (FR-4).** When `refreshSession` returns `null` (or the `refresh_token` cookie was absent), reuse the existing redirect pattern (`middleware.ts:34-36`): `const loginUrl = new URL('/auth/login', req.url); loginUrl.searchParams.set('redirect', req.nextUrl.pathname + req.nextUrl.search); const res = NextResponse.redirect(loginUrl); clearSessionCookies(res); return res;`.
6. **Correct `identity.ts:1-6`** header comment: it must no longer say "NEVER import this file from middleware.ts … breaks the Edge runtime bundle." Rewrite it to state that `identity.ts` is Node-only and is now imported by the Node-runtime `middleware.ts` (via `refreshSession`) as well as the auth route handlers. (In-file doc-drift correction for a file already in scope — root CLAUDE.md teardown.)
7. **Do NOT touch** `app/api/auth/refresh/route.ts` (design: KEEP — `authRedirect.ts:40` still calls it) or `ACCESS_TOKEN_REFRESH_THRESHOLD_SECONDS` / cookie attributes (Out of Scope). No new outbound gRPC call is introduced to a *new* backend — `refreshSession` already targets `xstockstrat-identity` via the existing singleton client, so no new header-propagation wiring is required (the middleware still injects `x-trace-id` on the outgoing response as today).

**Verification**:
- `grep -n "runtime: 'nodejs'" services/xstockstrat-ui/src/middleware.ts` — confirms FR-1.
- `grep -n "refreshSession\|setSessionCookies\|clearSessionCookies" services/xstockstrat-ui/src/middleware.ts` — confirms in-process refresh + cookie handling present.
- `grep -n "buildInternalRefreshUrl" services/xstockstrat-ui/src/lib/auth.ts services/xstockstrat-ui/src/middleware.ts` — must return **no matches** (FR-5).
- `grep -n "api/auth/refresh" services/xstockstrat-ui/src/middleware.ts` — must still show the matcher exclusion (corrected FR-5).
- `grep -n "fetch(" services/xstockstrat-ui/src/middleware.ts` — must return **no matches** (no self-`fetch()` remains).
- `cd services/xstockstrat-ui && pnpm run lint` — TypeScript/ESLint clean (removed-symbol imports resolved). (Coverage/behavioral checks run in Step 2.)

---

### Step 2 — test: vitest unit tests for the Node-runtime middleware; drop the `buildInternalRefreshUrl` test block

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/middleware.test.ts` — modify
- `services/xstockstrat-ui/src/lib/auth.test.ts` — modify

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness, Connect-RPC call safety (per registry; `test` step → service owner of the service being tested)

**Codebase Evidence**:
- `middleware.test.ts:1-8` — vitest node-env suite: `import { config } from './middleware'`; helper `matches(pathname)` reads `config.matcher[1]` (`:5-8`).
- `middleware.test.ts:11-13` — existing assertion `expect(matches('/api/auth/refresh')).toBe(false)` with the now-stale `it(...)` description "internal-only call made by this middleware, never the browser" (`:11`) — description must be rewritten; assertion is KEPT (AC-5 third clause).
- `middleware.test.ts:15-23` — sibling exclusions + protected-route assertions (unchanged reference).
- `auth.test.ts:2` — `import { buildInternalRefreshUrl, setSessionCookies, REMEMBER_ME_MAX_AGE_SECONDS } from './auth';` — must drop `buildInternalRefreshUrl`.
- `auth.test.ts:1` — `import { describe, it, expect, afterEach } from 'vitest'` — `afterEach` becomes unused after the removal below.
- `auth.test.ts:17-22` — `ORIGINAL_PORT` + `afterEach` PORT-restore harness — used **only** by the `buildInternalRefreshUrl` tests; remove with them.
- `auth.test.ts:24-42` — `describe('buildInternalRefreshUrl', …)` block (3 `it`s) — must be deleted (the function is gone; leaving it fails to compile). The `setSessionCookies` block (`:44-68`) stays.
- Coverage config: `services/xstockstrat-ui/CLAUDE.md` § Testing — vitest node-env `src/**/*.test.ts`, coverage scoped to `src/lib/**` (`coverage.all:false`), 40% floor on exercised files (root CLAUDE.md § Language Versions, Vitest row); `package.json:17,19` scripts `test:unit`, `test:coverage`.
- Alias: `services/xstockstrat-ui/CLAUDE.md` § Styling — `vitest.config.ts` sets `resolve.alias { '@': './src' }`, so `vi.mock('@/lib/identity')` / `vi.mock('@/lib/auth')` resolve.

**TDD**: `red-green required` — these assertions fail against the pre-Step-1 tree (no `runtime` key; self-`fetch()`; `buildInternalRefreshUrl` still exported) and pass after Step 1. `/sdd-execute` captures the RED run before Step 1 and GREEN after (`reference/tdd-gate.md`), citing the `@AC-*` ID per assertion.

**Covers**: `AC-1, AC-2, AC-3, AC-4, AC-5`

**Instructions**:
1. **`auth.test.ts`** — remove `buildInternalRefreshUrl` from the import (`:2`), delete the whole `describe('buildInternalRefreshUrl', …)` block (`:24-42`), and remove the now-unused `ORIGINAL_PORT`/`afterEach` PORT harness (`:17-22`) plus `afterEach` from the vitest import (`:1`). Leave the `setSessionCookies` block (`:44-68`) untouched. This is the structural half of `@AC-5` ("`buildInternalRefreshUrl` no longer exists").
2. **`middleware.test.ts` — `@AC-1`:** add a test that `config.runtime === 'nodejs'` AND `config.matcher` is still a declared array containing `'/'` (the second clause of AC-1: "the exported config still declares its route matcher").
3. **`middleware.test.ts` — `@AC-5`:** rewrite the `:11` `it(...)` description to state the exclusion now protects the route's **live browser caller** (`src/lib/authRedirect.ts`), not a middleware self-call; KEEP `expect(matches('/api/auth/refresh')).toBe(false)`. Keep `:15-23` as-is.
4. **`middleware.test.ts` — `@AC-2`/`@AC-3`/`@AC-4`:** add a `describe` that invokes `middleware(req)` for the near-expiry path. Use `vi.mock('@/lib/identity', …)` to stub `refreshSession` and `vi.mock('@/lib/auth', …)` (or a signed near-expiry JWT via `JWT_SECRET`) to force `getSessionFromRequest` to return claims with `expires_at` within `ACCESS_TOKEN_REFRESH_THRESHOLD_SECONDS`. Spy on global `fetch` (`vi.spyOn(globalThis,'fetch')`). Construct the request with a `refresh_token` cookie (`new NextRequest(new URL('http://localhost/trader'), { headers: { cookie: 'access_token=…; refresh_token=rt' } })`).
   - `@AC-2`: assert `refreshSession` was called with `'rt'`; assert `fetch` was **not** called; assert the returned `NextResponse` carries a `Set-Cookie` for `access_token` (one updated cookie on that same response).
   - `@AC-3`: with `refreshSession` returning rotated tokens, assert the response sets `access_token` and `refresh_token` via `setSessionCookies` with `httpOnly`/`secure`(per `NODE_ENV`)/`sameSite:'lax'`/`path:'/'` and **no** `maxAge` (session cookies, matching the pre-change `route.ts:17` flow). (Assert on the cookie attributes, mirroring the existing `setSessionCookies` cookie-attribute test in `auth.test.ts:44-68`.)
   - `@AC-4`: with `refreshSession` mocked to return `null`, assert the response is a redirect to `/auth/login` (status 307/`Location` header contains `/auth/login`) and that `access_token`/`refresh_token` are cleared (`Max-Age=0`, i.e. `clearSessionCookies`).
5. **C-12/C-13 test-data:** these unit tests use only auth-domain literals (a mock JWT claims object, a fake refresh-token string) local to this one test file — a single inline consumer, no second consumer, so no fixture home is created (C-13 one-consumer-inline is compliant; no `e2e/fixtures/INVENTORY.md` entity is touched — this is vitest logic, not a Playwright spec).

**Verification**:
- `cd services/xstockstrat-ui && pnpm run test:unit` — the new middleware assertions and the trimmed `auth.test.ts` pass (RED first against the pre-Step-1 tree, per the TDD gate).
- `cd services/xstockstrat-ui && pnpm run test:coverage` — vitest coverage run; confirm the 40% floor on exercised `src/lib/**` files still passes (`src/lib/auth.ts` is exercised via `setSessionCookies`/`clearSessionCookies`; the `node-test` CI job runs this).
- `cd services/xstockstrat-ui && pnpm run lint` — no unused-import/var errors after removing the `buildInternalRefreshUrl` block and `afterEach` harness.
- `grep -n "buildInternalRefreshUrl" services/xstockstrat-ui/src/lib/auth.test.ts` — no matches.

---

### Step 3 — test: standalone-build feasibility gate (load-bearing, `@AC-6`)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/next.config.js` — modify **only if** the standalone build fails and a middleware-aware `serverExternalPackages` adjustment is required (contingent; happy path = no change)

**Reviewers**: xstockstrat-ui service owner — Connect-RPC call safety, Docker/standalone build integrity (per registry; `test`/build step → service owner)

**Codebase Evidence**:
- `next.config.js:7` — `output: process.env.NEXT_DISABLE_STANDALONE ? undefined : 'standalone'` (the standalone target under test).
- `next.config.js:8-14` — `serverExternalPackages` already lists `@connectrpc/connect-node` (`:10`), `@connectrpc/connect`, `@bufbuild/protobuf`, OTel packages — **documented for route handlers**; whether it also covers the Node-runtime *middleware* chunk under `output:'standalone'` is the residual, undocumented risk (recon Risk 1 / design Open Risk 1).
- `Dockerfile:20` builder `pnpm --filter xstockstrat-ui run build`; `:25` runner copies `.next/standalone`; `:31` `CMD ["node","services/xstockstrat-ui/server.js"]` — the standalone server that must discover `@connectrpc/connect-node` at runtime.
- `services/xstockstrat-ui/CLAUDE.md` § Docker Build Pattern — "E2E builds set `NEXT_DISABLE_STANDALONE=1` … every other build keeps standalone." The feasibility proof must run **without** that flag.
- Chain under test: `middleware.ts` (Node runtime, after Step 1) → `@/lib/identity` (`identity.ts:7` imports `connectClients`) → `connectClients.ts:2` `@connectrpc/connect-node` (the previously Edge-forbidden transitive import — `frontend-auth.md:35-44` `Module not found: node:http`).

**TDD**: `N/A` — build/integration feasibility proof, not a unit red-green pair. This is the design's load-bearing gate (Open Risk 1): moving off the Edge target removes the documented `node:http` Edge-bundler failure **in principle**, but standalone `.nft.json` coverage of the Node-middleware chunk is only provable by a real build + running container. Treat `insights.md:777-780` as a hypothesis to disprove here, not a given (fails.md 2026-07-29 `081-qa-capability` — "exercise the producer, not its advertised state").

**Covers**: `AC-6`

**Instructions**:
1. Build the standalone bundle with the Node-runtime middleware transitively importing `@connectrpc/connect-node` — **do not** set `NEXT_DISABLE_STANDALONE` (that would build the non-standalone bundle and bypass the exact thing under test). Prefer the container build to also prove the runner image: `docker compose build --no-cache xstockstrat-ui`. (A faster local inner-loop check is `cd services/xstockstrat-ui && pnpm run build`, which emits `.next/standalone` per `next.config.js:7`.)
2. Bring the container up and exercise an **in-process refresh**: `docker compose up -d xstockstrat-ui` (plus its dependencies), then drive an auth-guarded route (e.g. `/trader`) with a session cookie whose access token is within `ACCESS_TOKEN_REFRESH_THRESHOLD_SECONDS` of expiry and a valid `refresh_token`, and confirm (a) the response carries a rotated `Set-Cookie` and (b) **no** `/api/auth/refresh` request is emitted by the server during that refresh (the in-process path, not the loopback).
3. **If the build fails** with an Edge/Node bundling error for the gRPC transport (or `server.js` cannot resolve `@connectrpc/connect-node` at runtime): this is the load-bearing risk materializing. First attempt the design's named remedy — a middleware-aware `serverExternalPackages`/config adjustment in `next.config.js:8-14`. If no in-scope adjustment makes the standalone build discover the transport, **STOP and block the feature** (F-04/P-03 — do not paper over it); escalate to the operator per design Open Risk 1 ("this feature ships only if that build passes"). Record the outcome in the Deviation Log and `context.md`.

**Verification**:
- `docker compose build --no-cache xstockstrat-ui` — completes with **no** `Module not found: Can't resolve 'node:http'` (or any Edge-runtime bundling error) for `@connectrpc/connect-node` (contrast `frontend-auth.md:35-44`).
- `docker compose up -d xstockstrat-ui && docker compose logs xstockstrat-ui` — container starts and serves; a near-expiry request to an auth-guarded route returns a rotated `Set-Cookie` and the logs show the identity `RefreshToken` gRPC call with **no** inbound `/api/auth/refresh` request during that refresh.
- Offline fallback if Docker is unavailable in the execute environment: `cd services/xstockstrat-ui && pnpm run build` succeeds and emits `.next/standalone/services/xstockstrat-ui/server.js` — but the container-refresh clause above is the authoritative `@AC-6` proof and must run before the feature is called done.

---

### Step 4 — docs: correct the Edge-only auth docs to describe the Node.js-runtime middleware

**Status**: `pending`
**Service**: `docs/patterns/` + `xstockstrat-ui`
**Files**:
- `docs/patterns/frontend-auth.md` — modify
- `services/xstockstrat-ui/CLAUDE.md` — modify

**Reviewers**: none (`docs` step → None, per `docs/runbooks/reviewer-registry.md` Step Category matrix)

**Codebase Evidence**:
- `docs/patterns/frontend-auth.md:20` — required-files table row `src/middleware.ts | Edge runtime | Auth gate, redirects…, near-expiry refresh` (runtime label to correct).
- `frontend-auth.md:31` — heading "## The Edge-runtime trap (read this first)"; `:33` the hard rule "`src/lib/auth.ts` MUST NOT statically import anything that pulls in `@connectrpc/connect-node`…"; `:35-44` the `Module not found: node:http` build-failure block; `:46` "PRs #409 and #410"; `:48-56` the Edge-safe/Node-only split table; `:58` "Only `lib/auth.ts` may be imported from `middleware.ts`. `lib/identity.ts` is only ever imported from `app/api/auth/refresh/route.ts` and `app/api/auth/logout/route.ts`…"; `:60` "If you add any new import to `lib/auth.ts`…".
- `services/xstockstrat-ui/CLAUDE.md:212` — Auth+BFF row `src/lib/auth.ts | Edge-safe | … **Must not import @connectrpc/connect-node** … middleware.ts bundles it for the Edge runtime.`
- `services/xstockstrat-ui/CLAUDE.md:220` — Auth+BFF row `src/middleware.ts | Edge | Route protection, token refresh, trace-ID injection; matcher must include /`.
- `services/xstockstrat-ui/CLAUDE.md:282` — Frontend-gotchas bullet "**Edge-runtime import trap**: keep Node-only code out of `auth.ts` (it bundles to Edge via middleware)."

**TDD**: `N/A` — docs-only, no behavior change.

**Covers**: `AC-7`

**Instructions**:
1. **`frontend-auth.md`:** update the `src/middleware.ts` row (`:20`) runtime to **Node.js runtime** and state it calls `refreshSession()` directly. In the "Edge-runtime trap" section (`:31-60`), stop presenting "Only `lib/auth.ts` may be imported from `middleware.ts`" (`:58`) and the `auth.ts` MUST-NOT-import rule (`:33`) as **current** constraints: reframe them as **historical** (the Edge-runtime era / PRs #409-410 / the `node:http` failure at `:35-44`), and add that as of feature 128 `middleware.ts` runs in the Node.js runtime (`config.runtime='nodejs'`, stable since Next 15.5.0) and may import Node-only modules such as `@/lib/identity` (`refreshSession()`). Do not delete the historical explanation wholesale — mark it superseded so the scar is preserved, per the ledger's append-only spirit (FR-6/FR-7).
2. **`services/xstockstrat-ui/CLAUDE.md`:** correct the `src/middleware.ts` Auth+BFF row (`:220`) from `Edge` to Node.js runtime with an in-process-`refreshSession()` note; soften the `src/lib/auth.ts` row (`:212`) — the "middleware bundles it for the Edge runtime" rationale no longer holds (keeping `auth.ts` free of heavy Node deps may remain a preference, but it is no longer an Edge-bundling hard requirement); and correct the "Edge-runtime import trap" gotcha (`:282`) to describe the Node.js-runtime middleware. Neither file may state the "Only `lib/auth.ts` may be imported from `middleware.ts`" rule as a current constraint (AC-7).
3. **Teardown (root CLAUDE.md):** this step changes a context file (`services/xstockstrat-ui/CLAUDE.md`) and a pattern doc — run `/context-scrubber scan` scoped to the touched docs before the PR and fix any grounded findings; if the context-forge plugin is unavailable, say so in the PR body rather than skipping silently. (The in-file code-comment corrections in `auth.ts:42-44` and `identity.ts:1-6` were already made in Step 1; `docs/roadmap/ledger/insights.md` is append-only and is **not** edited — FR-7.)

**Verification**:
- `grep -n "Only .lib/auth.ts. may be imported\|Only \`lib/auth.ts\`" docs/patterns/frontend-auth.md` — the rule no longer appears as a current constraint (present only inside clearly-marked historical context, if at all).
- `grep -ni "node.js runtime\|runtime: 'nodejs'\|refreshSession" docs/patterns/frontend-auth.md services/xstockstrat-ui/CLAUDE.md` — both files now describe the Node.js-runtime middleware calling `refreshSession()` directly (AC-7 second clause).
- `grep -n "middleware" docs/patterns/frontend-auth.md services/xstockstrat-ui/CLAUDE.md | grep -i "edge"` — remaining "Edge" mentions for middleware are historical/superseded only, not stated as the current runtime.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
