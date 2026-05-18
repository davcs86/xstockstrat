# Implementation Spec: wire-fe-auth

**Status**: `in-progress`
**Created**: 2026-05-18
**Feature**: `docs/roadmap/features/012-wire-fe-auth/feature.md`
**Total Steps**: 16
**Feature Branch**: `feature/wire-fe-auth`

---

## Execution Summary

The implementation proceeds in four waves. Wave 1 (Steps 1–3) adds the `jose` JWT dependency and shared auth utilities — including `rolesToAccessScope` bitmap and `generateTraceId` — to all three Next.js frontends. Wave 2 (Steps 4–9) wires auth into each frontend in isolation: login page, `middleware.ts` with trace ID generation, API route updates forwarding all three headers (`x-user-id`, `x-access-scope`, `x-trace-id`), and package.json env additions. Wave 3 (Steps 10–12) strips all three headers in nginx, wires env vars, and adds E2E auth smoke tests. Wave 4 (Steps 13–16) adds header propagation to all backend services and verifies existing test suites: Go unary interceptors (Step 13), Python per-method metadata extraction (Step 14), Node.js AsyncLocalStorage middleware (Step 15), and Wave 4 test verification across all 10 backend services (Step 16). The identity service requires no source changes.

## Step Dependencies

- Steps 4–9 (per-frontend waves) require Step 1 (jose added to all three package.jsons) and Steps 2–3 (shared lib files defined)
- Step 10 (nginx) is independent of Steps 4–9 and can run in parallel
- Step 11 (env wiring) should run after all service steps so env keys match the completed implementation
- Step 12 (tests) requires Steps 4–9 to be complete
- Steps 13–15 (backend propagation, Wave 4) are fully independent of Steps 1–12 and can be executed in parallel with Wave 2
- Step 16 (test: Wave 4 backend suites) requires Steps 13–15 to be complete

---

### Step 1 — service: Add `jose` dependency to all three Next.js frontends

**Status**: `done`
**Service**: `xstockstrat-trader`, `xstockstrat-insights`, `xstockstrat-config-ui`
**Files**:
- `services/xstockstrat-trader/package.json` — modify
- `services/xstockstrat-insights/package.json` — modify
- `services/xstockstrat-config-ui/package.json` — modify

**Reviewers**: `xstockstrat-trader` owner — Trading UI correctness, Connect-RPC call safety, no direct DB access from frontend; `xstockstrat-insights` owner — Analytics display accuracy, SSE polling resilience, read-only access pattern; `xstockstrat-config-ui` owner — Config mutation safety, environment scope correctness, no secret values rendered in UI; Security — No secrets in config service state, secret keys use `secret.*` prefix, JWT claims minimal, API key scoping correct

**Codebase Evidence**:
- Confirmed via: `cat services/xstockstrat-trader/package.json` → `"dependencies"` block at L17–L36; no `jose` present
- Confirmed via: `cat services/xstockstrat-insights/package.json` → `"dependencies"` block at L17–L37; no `jose` present
- Confirmed via: `cat services/xstockstrat-config-ui/package.json` → `"dependencies"` block at L17–L33; no `jose` present
- Confirmed: identity service uses `jsonwebtoken` with HS256 (HMAC) algorithm; JWT payload fields are `user_id`, `email`, `roles`, `issued_at`, `expires_at` (snake_case) — confirmed via `services/xstockstrat-identity/src/grpc/identityServiceImpl.ts:L61–L67`
- `jose` is required (not `jsonwebtoken`) because Next.js `middleware.ts` runs in the Edge Runtime which cannot use Node.js built-ins that `jsonwebtoken` depends on

**Instructions**:
In each of the three `package.json` files, add `"jose": "^5.0.0"` to the `"dependencies"` object, alphabetically sorted (after `"date-fns"`, before `"lightweight-charts"` or `"lucide-react"`).

After editing all three files, run from the repo root:
```bash
pnpm install
```

**Verification**:
```bash
grep '"jose"' services/xstockstrat-trader/package.json
grep '"jose"' services/xstockstrat-insights/package.json
grep '"jose"' services/xstockstrat-config-ui/package.json
```
All three must print a line with `"jose": "^5.0.0"`.

---

### Step 2 — service: Create `src/lib/auth.ts` in xstockstrat-trader

**Status**: `done`
**Service**: `xstockstrat-trader`
**Files**:
- `services/xstockstrat-trader/src/lib/auth.ts` — create

**Reviewers**: `xstockstrat-trader` owner — Trading UI correctness, Connect-RPC call safety, no direct DB access from frontend; Security — No secrets in config service state, secret keys use `secret.*` prefix, JWT claims minimal, API key scoping correct

**Codebase Evidence**:
- Confirmed via: `ls services/xstockstrat-trader/src/lib/` → `connectClients.ts`, `connectTransport.ts`, `grpcClients.ts` — no `auth.ts` exists; must be created from scratch
- JWT payload fields confirmed at `services/xstockstrat-identity/src/grpc/identityServiceImpl.ts:L61–L67`: `user_id`, `email`, `roles`, `issued_at`, `expires_at` (all snake_case, from `jsonwebtoken`)
- `IDENTITY_HTTP_ENDPOINT` already exported from `services/xstockstrat-trader/src/lib/connectTransport.ts:L29`: `process.env.IDENTITY_HTTP_ENDPOINT ?? 'http://xstockstrat-identity:8058'`
- Cookie names `access_token` and `refresh_token` are not yet defined — introducing them here as the canonical source

**Instructions**:
Create `services/xstockstrat-trader/src/lib/auth.ts` with the following responsibilities:

1. **`verifyAccessToken(token: string): Promise<JwtClaims | null>`** — use `jose`'s `jwtVerify` with `new TextEncoder().encode(process.env.JWT_SECRET)` as the secret. Returns the decoded `JwtClaims` on success, `null` on any error (expired, tampered, missing secret). Never throws.

2. **`getSessionFromRequest(req: NextRequest): Promise<JwtClaims | null>`** — reads the `access_token` cookie from `req.cookies.get('access_token')?.value`, calls `verifyAccessToken`. If absent or invalid, returns `null`.

3. **`refreshSession(refreshToken: string): Promise<{ accessToken: string; refreshToken: string; claims: JwtClaims } | null>`** — POSTs to `${IDENTITY_HTTP_ENDPOINT}/xstockstrat.identity.v1.IdentityService/RefreshToken` with `{ refresh_token: refreshToken }` using `application/connect+json` content type. On success parses `access_token`, `refresh_token`, and `claims` from the response. Returns `null` on any error.

4. **`revokeToken(token: string): Promise<void>`** — POSTs to `${IDENTITY_HTTP_ENDPOINT}/xstockstrat.identity.v1.IdentityService/RevokeToken` with `{ token }`. Swallows errors (best-effort revocation).

5. **`setSessionCookies(res: NextResponse, accessToken: string, refreshToken: string): void`** — sets `access_token` and `refresh_token` as `httpOnly`, `secure` (only when `process.env.NODE_ENV === 'production'`), `SameSite=Lax`, `path=/` cookies.

6. **`clearSessionCookies(res: NextResponse): void`** — deletes both cookies by setting `maxAge=0`.

7. Export the `JwtClaims` interface: `{ user_id: string; email: string; roles: string[]; issued_at: number; expires_at: number; }` matching the identity service payload.

8. Export constant `ACCESS_TOKEN_REFRESH_THRESHOLD_SECONDS = 60` (FR-4).

9. **`rolesToAccessScope(roles: string[]): number`** — maps role strings to a permissions bitmap. Bit definitions: `read = 0x01`, `write = 0x02`, `admin = 0x04`, `trading = 0x08`. Mapping: `'viewer'` → `read`; `'trader'` → `read | write | trading`; `'admin'` → `read | write | admin | trading`. Unrecognized roles contribute `0`. Returns the OR of all matching bits (FR-8).

10. **`generateTraceId(): string`** — returns `crypto.randomUUID()`. Available in both the Node.js runtime (≥14.17) and the Edge Runtime (FR-9).

**Verification**:
```bash
cd services/xstockstrat-trader && pnpm run lint
```
No lint errors. The file compiles without errors (confirmed by lint).

---

### Step 3 — service: Create `src/lib/auth.ts` in xstockstrat-insights and `app/lib/auth.ts` in xstockstrat-config-ui

**Status**: `done`
**Service**: `xstockstrat-insights`, `xstockstrat-config-ui`
**Files**:
- `services/xstockstrat-insights/src/lib/auth.ts` — create
- `services/xstockstrat-config-ui/app/lib/auth.ts` — create (config-ui uses `app/` not `src/`)

**Reviewers**: `xstockstrat-insights` owner — Analytics display accuracy, SSE polling resilience, read-only access pattern; `xstockstrat-config-ui` owner — Config mutation safety, environment scope correctness, no secret values rendered in UI; Security — No secrets in config service state, secret keys use `secret.*` prefix, JWT claims minimal, API key scoping correct

**Codebase Evidence**:
- Confirmed via: `find services/xstockstrat-insights -type f | sort` → `src/lib/connectTransport.ts` present, no `auth.ts` — must be created
- Confirmed via: `find services/xstockstrat-config-ui -type f | sort` → `src/lib/configClient.ts` present (under `src/lib/`), but app pages live under `app/` (not `src/app/`) — the `app/lib/` sub-directory does not exist and must be created
- `IDENTITY_HTTP_ENDPOINT` confirmed in `services/xstockstrat-insights/src/lib/connectTransport.ts:L44`: `process.env.IDENTITY_HTTP_ENDPOINT ?? 'http://xstockstrat-identity:8058'`
- config-ui `IDENTITY_HTTP_ENDPOINT` is not yet in its `package.json` env section — add in Step 11

**Instructions**:
Create `services/xstockstrat-insights/src/lib/auth.ts` with the identical interface as the file created in Step 2, substituting the `IDENTITY_HTTP_ENDPOINT` import from `services/xstockstrat-insights/src/lib/connectTransport.ts` where the endpoint constant is already exported at L44.

Create `services/xstockstrat-config-ui/app/lib/auth.ts` with the same interface. In config-ui, `IDENTITY_HTTP_ENDPOINT` is not yet exported from a transport file; inline `process.env.IDENTITY_HTTP_ENDPOINT ?? 'http://xstockstrat-identity:8058'` directly in the auth file for now (Step 11 adds the env var to compose and DO specs).

Both files must export the same `JwtClaims` interface, `verifyAccessToken`, `getSessionFromRequest`, `refreshSession`, `revokeToken`, `setSessionCookies`, `clearSessionCookies`, `ACCESS_TOKEN_REFRESH_THRESHOLD_SECONDS`, `rolesToAccessScope`, and `generateTraceId` — identical contract to Step 2.

**Verification**:
```bash
cd services/xstockstrat-insights && pnpm run lint
cd services/xstockstrat-config-ui && pnpm run lint
```
No lint errors.

---

### Step 4 — service: Add `/login` page and `/api/auth/*` routes to xstockstrat-trader

**Status**: `pending`
**Service**: `xstockstrat-trader`
**Files**:
- `services/xstockstrat-trader/src/app/login/page.tsx` — create
- `services/xstockstrat-trader/src/app/api/auth/login/route.ts` — create
- `services/xstockstrat-trader/src/app/api/auth/refresh/route.ts` — create
- `services/xstockstrat-trader/src/app/api/auth/logout/route.ts` — create

**Reviewers**: `xstockstrat-trader` owner — Trading UI correctness, Connect-RPC call safety, no direct DB access from frontend; Security — No secrets in config service state, secret keys use `secret.*` prefix, JWT claims minimal, API key scoping correct

**Codebase Evidence**:
- Confirmed via: `ls services/xstockstrat-trader/src/app/` → `api/`, `globals.css`, `health/`, `layout.tsx`, `page.tsx` — no `login/` directory; must be created
- Confirmed via: `ls services/xstockstrat-trader/src/app/api/` → `accounts/`, `alerts/`, `health/`, `orders/`, `portfolio/` — no `auth/` sub-directory; must be created
- `IDENTITY_HTTP_ENDPOINT` confirmed in `services/xstockstrat-trader/src/lib/connectTransport.ts:L29`
- Existing API route fetch pattern confirmed at `services/xstockstrat-trader/src/app/api/orders/route.ts:L15–L19`: `fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/connect+json' }, body: JSON.stringify(body) })`
- `setSessionCookies` / `clearSessionCookies` / `getSessionFromRequest` / `refreshSession` / `revokeToken` will be imported from `@/lib/auth` (the file created in Step 2)

**Instructions**:

**`src/app/api/auth/login/route.ts`** — POST handler:
1. Parse `{ email, password }` from request body; return 400 if either is missing.
2. POST to `${process.env.IDENTITY_HTTP_ENDPOINT ?? 'http://xstockstrat-identity:8058'}/xstockstrat.identity.v1.IdentityService/AuthenticateUser` with `application/connect+json` content type.
3. On success, call `setSessionCookies(response, data.access_token, data.refresh_token)` from `@/lib/auth`.
4. Return `{ ok: true }` with the cookies set. On failure return 401.

**`src/app/api/auth/refresh/route.ts`** — POST handler:
1. Read the `refresh_token` cookie from the request using `req.cookies.get('refresh_token')?.value`.
2. If missing, return 401.
3. Call `refreshSession(refreshToken)` from `@/lib/auth`.
4. On success, call `setSessionCookies` and return `{ ok: true }`. On null result, call `clearSessionCookies` and return 401.

**`src/app/api/auth/logout/route.ts`** — POST handler:
1. Read the `access_token` cookie; call `revokeToken(token)` from `@/lib/auth` (best-effort).
2. Create a `NextResponse.json({ ok: true })`, call `clearSessionCookies(response)`, return the response.

**`src/app/login/page.tsx`** — client component:
1. Email + password form fields. On submit, POST to `/api/auth/login`.
2. On 200: redirect to `searchParams.get('redirect') ?? '/'` using `router.push`.
3. On non-200: show error message below the form.
4. Match the existing Tailwind styling in `src/app/page.tsx` (uses `bg-background`, `font-sans` from `globals.css`).

**Verification**:
```bash
cd services/xstockstrat-trader && pnpm run lint
```
No lint errors. Manually: `curl -s -X POST http://localhost:3000/api/auth/login -H 'Content-Type: application/json' -d '{"email":"missing@x.com","password":"x"}' | jq .` should return `{"error":"..."}` (401 from identity).

---

### Step 5 — service: Add `middleware.ts` to xstockstrat-trader

**Status**: `pending`
**Service**: `xstockstrat-trader`
**Files**:
- `services/xstockstrat-trader/src/middleware.ts` — create

**Reviewers**: `xstockstrat-trader` owner — Trading UI correctness, Connect-RPC call safety, no direct DB access from frontend; Security — No secrets in config service state, secret keys use `secret.*` prefix, JWT claims minimal, API key scoping correct

**Codebase Evidence**:
- Confirmed via: `find services/xstockstrat-trader -name "middleware.ts"` → no result; file must be created from scratch
- Next.js App Router middleware must live at `src/middleware.ts` (alongside the `src/app/` directory) for the App Router layout to pick it up — confirmed by Next.js 14 App Router conventions and the existing `src/` layout in this service
- `basePath` is `/trader` — confirmed in `services/xstockstrat-trader/next.config.js:L4`
- `getSessionFromRequest` and `ACCESS_TOKEN_REFRESH_THRESHOLD_SECONDS` available from `@/lib/auth` (Step 2)

**Instructions**:
Create `services/xstockstrat-trader/src/middleware.ts`:

1. **Matcher**: export `config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|api/auth/login|api/health|health).*)'] }` — excludes static assets, the login API route, and health endpoints from auth enforcement.

2. **Main logic** (runs on every matched request):
   a. Call `getSessionFromRequest(req)` from `@/lib/auth` to extract and verify the JWT from the `access_token` cookie.
   b. If `claims` is `null` (no cookie or invalid token):
      - If the request is for `/login`, allow it through.
      - Otherwise redirect to `/login?redirect=<encoded original URL>`.
   c. If `claims` is valid:
      - Check whether `claims.expires_at - Math.floor(Date.now() / 1000) < ACCESS_TOKEN_REFRESH_THRESHOLD_SECONDS`.
      - If token is near expiry, call the internal `/api/auth/refresh` route to rotate it (via a server-side `fetch` to the local origin). If refresh fails, redirect to `/login`.
      - Allow the request through (see step d).

   d. **Trace ID propagation** (upstream only — request direction; never set as a response header):
      - Read `req.headers.get('x-trace-id')`. If present use it; otherwise call `generateTraceId()` from `@/lib/auth`.
      - When allowing the request through, inject the trace ID into the forwarded request headers via `NextResponse.next({ request: { headers: new Headers({ ...Object.fromEntries(req.headers), 'x-trace-id': traceId }) } })` so that API route handlers can read `req.headers.get('x-trace-id')` and forward it upstream.
      - When redirecting to `/login`, do NOT set `x-trace-id` on the redirect response. The trace ID travels with requests only.

3. The middleware runs in the Edge Runtime — only import from `next/server` and `jose` (no Node.js built-ins). `@/lib/auth` uses only `jose`, `fetch`, and `crypto.randomUUID()`, all Edge-compatible.

**Verification**:
```bash
cd services/xstockstrat-trader && pnpm run lint
```
No lint errors. Manually: `curl -s -c /dev/null http://localhost:3000/` (no cookie) should return a 302 redirect to `/trader/login?redirect=...`.

---

### Step 6 — service: Fix API routes in xstockstrat-trader to extract userId from JWT

**Status**: `pending`
**Service**: `xstockstrat-trader`
**Files**:
- `services/xstockstrat-trader/src/app/api/orders/route.ts` — modify
- `services/xstockstrat-trader/src/app/api/portfolio/route.ts` — modify
- `services/xstockstrat-trader/src/app/api/alerts/stream/route.ts` — modify

**Reviewers**: `xstockstrat-trader` owner — Trading UI correctness, Connect-RPC call safety, no direct DB access from frontend; Security — No secrets in config service state, secret keys use `secret.*` prefix, JWT claims minimal, API key scoping correct

**Codebase Evidence**:
- Confirmed via: `services/xstockstrat-trader/src/app/api/orders/route.ts:L28–L31`: `// TODO(wire-fe-auth): extract userId from verified JWT claims in session cookie` and `if (!body.user_id) { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }`
- Confirmed via: `services/xstockstrat-trader/src/app/api/orders/route.ts:L57–L59`: GET handler reads `userId` from `searchParams.get('user_id')` — must be replaced with JWT extraction
- Confirmed via: `services/xstockstrat-trader/src/app/api/portfolio/route.ts:L15–L17`: same `// TODO(wire-fe-auth)` and `const userId = searchParams.get('user_id')`
- Confirmed via: `services/xstockstrat-trader/src/app/api/alerts/stream/route.ts:L28`: `userId: ''` — alerts route passes empty userId; must be updated to pass the real userId from the session
- All outbound Connect-RPC calls use plain `fetch` (confirmed at `services/xstockstrat-trader/src/app/api/orders/route.ts:L15–L19`); `x-user-id` header must be added to these fetch calls

**Instructions**:

**`src/app/api/orders/route.ts`**:
1. Import `getSessionFromRequest` from `@/lib/auth`.
2. In `POST`: replace the `body.user_id` check with `const claims = await getSessionFromRequest(req); if (!claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });`. Use `claims.user_id` as `userId` in the PlaceOrder body. Build the propagation headers: `import { rolesToAccessScope, generateTraceId } from '@/lib/auth'; const accessScope = String(rolesToAccessScope(claims.roles)); const traceId = req.headers.get('x-trace-id') ?? generateTraceId();`. Add `'x-user-id': claims.user_id`, `'x-access-scope': accessScope`, and `'x-trace-id': traceId` to the fetch headers.
3. In `GET`: replace `searchParams.get('user_id')` with `claims.user_id` from JWT. Remove the `user_id` query param dependency entirely. Add the same three propagation headers to the fetch call.

**`src/app/api/portfolio/route.ts`**:
1. Import `getSessionFromRequest`, `rolesToAccessScope`, `generateTraceId` from `@/lib/auth`.
2. Replace `searchParams.get('user_id')` with `claims.user_id` from `getSessionFromRequest`. Build `accessScope` and `traceId` the same way as in orders. Add all three headers to the fetch headers.

**`src/app/api/alerts/stream/route.ts`**:
1. Import `getSessionFromRequest`, `rolesToAccessScope`, `generateTraceId` from `@/lib/auth`.
2. Extract claims from request at the top of the `GET` handler. If no valid session, return a 401 response immediately (before opening the stream).
3. Pass `claims.user_id` as the `userId` field in the `ListAlerts` body (replacing `userId: ''` at L28). Add all three propagation headers to the fetch headers.

**Verification**:
```bash
cd services/xstockstrat-trader && pnpm run lint
```
No lint errors. Manually: `curl -s http://localhost:3000/api/orders` (no cookie) should return `{"error":"Unauthorized"}` with status 401.

---

### Step 7 — service: Add login page, auth API routes, and middleware to xstockstrat-insights

**Status**: `pending`
**Service**: `xstockstrat-insights`
**Files**:
- `services/xstockstrat-insights/src/app/login/page.tsx` — create
- `services/xstockstrat-insights/src/app/api/auth/login/route.ts` — create
- `services/xstockstrat-insights/src/app/api/auth/refresh/route.ts` — create
- `services/xstockstrat-insights/src/app/api/auth/logout/route.ts` — create
- `services/xstockstrat-insights/src/middleware.ts` — create
- `services/xstockstrat-insights/src/app/api/analysis/backtest/route.ts` — modify
- `services/xstockstrat-insights/src/app/api/analysis/strategies/route.ts` — modify
- `services/xstockstrat-insights/src/app/api/analysis/report/[id]/route.ts` — modify
- `services/xstockstrat-insights/src/app/api/portfolio/route.ts` — modify

**Reviewers**: `xstockstrat-insights` owner — Analytics display accuracy, SSE polling resilience, read-only access pattern; Security — No secrets in config service state, secret keys use `secret.*` prefix, JWT claims minimal, API key scoping correct

**Codebase Evidence**:
- Confirmed via: `ls services/xstockstrat-insights/src/app/` → `api/`, `globals.css`, `health/`, `layout.tsx`, `page.tsx`, `strategies/` — no `login/` directory; must be created
- Confirmed via: `ls services/xstockstrat-insights/src/app/api/` → `analysis/`, `health/`, `portfolio/` — no `auth/` directory
- Confirmed via: `find services/xstockstrat-insights -name "middleware.ts"` → no result
- Confirmed via: `services/xstockstrat-insights/src/app/api/analysis/backtest/route.ts:L19–L29`: outbound fetch uses `application/connect+json`; no `x-user-id` header present
- Confirmed via: `services/xstockstrat-insights/src/app/api/portfolio/route.ts:L15–L30`: no userId extraction or `x-user-id` forwarding
- `basePath` is `/insights` — confirmed in `services/xstockstrat-insights/next.config.js:L4`

**Instructions**:
Apply the same pattern as Steps 4 and 5 for xstockstrat-trader, adapted for insights:

1. Create `src/app/api/auth/login/route.ts`, `refresh/route.ts`, and `logout/route.ts` with the same logic as Step 4, importing from `@/lib/auth` (which maps to `services/xstockstrat-insights/src/lib/auth.ts` from Step 3). **Note**: use `process.env.IDENTITY_HTTP_ENDPOINT ?? 'http://xstockstrat-identity:8058'` for the identity endpoint URL — `IDENTITY_BASE_URL` does not exist in the codebase and must not be used.

2. Create `src/app/login/page.tsx` with the same email + password form pattern as Step 4.

3. Create `src/middleware.ts` with the same matcher and redirect logic as Step 5.

4. In all four API route files (`backtest`, `strategies`, `report/[id]`, `portfolio`):
   - Import `getSessionFromRequest`, `rolesToAccessScope`, `generateTraceId` from `@/lib/auth`.
   - At the top of each handler, call `getSessionFromRequest(req)`. If `null`, return 401.
   - Build: `const accessScope = String(rolesToAccessScope(claims.roles)); const traceId = req.headers.get('x-trace-id') ?? generateTraceId();`
   - Add `'x-user-id': claims.user_id`, `'x-access-scope': accessScope`, `'x-trace-id': traceId` to every outbound `fetch` call's headers.

**Note**: The `strategies` route at L21 passes `userId: ''` to `ListStrategies` — replace with `claims.user_id`.

**Verification**:
```bash
cd services/xstockstrat-insights && pnpm run lint
```
No lint errors. Manually: `curl -s http://localhost:3001/api/analysis/strategies` (no cookie) should return 401.

---

### Step 8 — service: Add login page, auth API routes, and middleware to xstockstrat-config-ui

**Status**: `pending`
**Service**: `xstockstrat-config-ui`
**Files**:
- `services/xstockstrat-config-ui/app/login/page.tsx` — create
- `services/xstockstrat-config-ui/app/api/auth/login/route.ts` — create
- `services/xstockstrat-config-ui/app/api/auth/refresh/route.ts` — create
- `services/xstockstrat-config-ui/app/api/auth/logout/route.ts` — create
- `services/xstockstrat-config-ui/middleware.ts` — create (at repo root of service, not in `app/`)
- `services/xstockstrat-config-ui/app/api/config/route.ts` — modify
- `services/xstockstrat-config-ui/app/api/audit/route.ts` — modify

**Reviewers**: `xstockstrat-config-ui` owner — Config mutation safety, environment scope correctness, no secret values rendered in UI; Security — No secrets in config service state, secret keys use `secret.*` prefix, JWT claims minimal, API key scoping correct

**Codebase Evidence**:
- Confirmed via: `find services/xstockstrat-config-ui -type f | sort` → `app/` directory structure (not `src/app/`); config-ui pages live under `app/` directly, not `src/app/`
- Confirmed via: `ls services/xstockstrat-config-ui/` → `app/`, `components/`, `e2e/`, `next.config.js`, `package.json`, `src/lib/configClient.ts` — middleware must live at `services/xstockstrat-config-ui/middleware.ts` (sibling to `app/`, not inside `src/`)
- Confirmed via: `services/xstockstrat-config-ui/app/api/config/route.ts:L10–L18`: `CONFIG_HTTP_ENDPOINT` with Connect-RPC fetch pattern; no `x-user-id` header
- Confirmed via: `services/xstockstrat-config-ui/app/api/audit/route.ts:L27–L56`: direct DB query (no Connect-RPC backend call); userId is not currently used but the route must still be auth-gated to prevent unauthenticated audit log reads
- `basePath` is `/config-ui` — confirmed in `services/xstockstrat-config-ui/next.config.js:L4`
- Auth lib path is `services/xstockstrat-config-ui/app/lib/auth.ts` (created in Step 3) — import in routes as `@/app/lib/auth` or adjust based on tsconfig paths

**Instructions**:
Apply the same pattern as Steps 4 and 5, adapted for config-ui's `app/` directory layout:

1. Create `app/api/auth/login/route.ts`, `refresh/route.ts`, and `logout/route.ts` with identical logic as Step 4. **Note**: use `process.env.IDENTITY_HTTP_ENDPOINT ?? 'http://xstockstrat-identity:8058'` for the identity endpoint URL — `IDENTITY_BASE_URL` does not exist in the codebase and must not be used.

2. Create `app/login/page.tsx` with the same form pattern as Step 4.

3. Create `middleware.ts` at the service root (i.e., `services/xstockstrat-config-ui/middleware.ts`) with the same matcher and redirect logic as Step 5. In config-ui, check the tsconfig `paths` (at `services/xstockstrat-config-ui/tsconfig.json`) to confirm the `@/` alias resolves to `app/` or root — adjust the import path for `auth.ts` accordingly.

4. In `app/api/config/route.ts`:
   - Import `getSessionFromRequest`, `rolesToAccessScope`, `generateTraceId` from the auth lib.
   - At the top of both `GET` and `POST` handlers, call `getSessionFromRequest(req)`. Return 401 if `null`.
   - Build: `const accessScope = String(rolesToAccessScope(claims.roles)); const traceId = req.headers.get('x-trace-id') ?? generateTraceId();`
   - Add `'x-user-id': claims.user_id`, `'x-access-scope': accessScope`, `'x-trace-id': traceId` to the outbound fetch headers.
   - In `POST`, set `author: claims.user_id` (replacing `author ?? 'config-ui'`).

5. In `app/api/audit/route.ts`:
   - Import `getSessionFromRequest` from the auth lib.
   - At the top of the `GET` handler, call `getSessionFromRequest(req)`. Return 401 if `null`.
   - No outbound Connect-RPC call here (direct DB query), so no `x-user-id` forwarding needed.

**Verification**:
```bash
cd services/xstockstrat-config-ui && pnpm run lint
```
No lint errors. Manually: `curl -s http://localhost:3002/api/config?namespace=platform` (no cookie) should return 401.

---

### Step 9 — service: Read tsconfig.json in config-ui to verify `@/` alias resolution

**Status**: `pending`
**Service**: `xstockstrat-config-ui`
**Files**:
- `services/xstockstrat-config-ui/tsconfig.json` — read only (may modify if paths need adding)

**Reviewers**: `xstockstrat-config-ui` owner — Config mutation safety, environment scope correctness, no secret values rendered in UI

**Codebase Evidence**:
- `services/xstockstrat-config-ui/tsconfig.json` confirmed to exist via `find services/xstockstrat-config-ui -type f | sort` output
- The config-ui app dir layout is `app/` not `src/app/`, which differs from trader and insights — the `@/` path alias may resolve differently

**Instructions**:
Read `services/xstockstrat-config-ui/tsconfig.json` and check the `compilerOptions.paths` section:
- If `"@/*"` maps to `["app/*"]`: the import in routes should be `import ... from '@/lib/auth'` (resolves to `app/lib/auth.ts` from Step 3).
- If `"@/*"` maps to `["./*"]` or `["/*"]`: the import should be `import ... from '@/app/lib/auth'`.
- If no `@/` path alias exists: add `"@/*": ["app/*"]` to `compilerOptions.paths` in `tsconfig.json`.

Update all auth imports in the files created in Step 8 to use the correct alias after confirming.

**Verification**:
```bash
cd services/xstockstrat-config-ui && pnpm run build 2>&1 | grep -i error | head -20
```
Build must complete with no TypeScript errors related to module resolution.

---

### Step 10 — service: Strip `x-user-id` from inbound external requests in nginx

**Status**: `pending`
**Service**: `xstockstrat-nginx`
**Files**:
- `nginx.conf` — modify (repo root)

**Reviewers**: `xstockstrat-trader` owner — Trading UI correctness, Connect-RPC call safety, no direct DB access from frontend

**Codebase Evidence**:
- Confirmed via: read of `nginx.conf` — the `server {}` block at L42–L88 has a top-level `proxy_set_header` section (L45–L52) that sets `Host`, `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto`, `Connection`, `Upgrade` but does NOT strip `x-user-id`
- Confirmed via: `nginx.conf:L55–L79`: three location blocks (`/trader`, `/trader/`, `/insights`, `/insights/`, `/config-ui`, `/config-ui/`) each proxy to upstream — the `proxy_set_header` clearing must be added at the `server {}` level to apply to all locations

**Instructions**:
In `nginx.conf`, inside the `server {}` block (after the existing `proxy_set_header Upgrade $http_upgrade;` line at approximately L51), add:
```nginx
# Strip auth propagation headers from all inbound external requests (FR-7, FR-9).
# Prevents external callers from spoofing user identity, permission scope, or trace context.
# These headers are only valid when set by internal services.
proxy_set_header x-user-id "";
proxy_set_header x-access-scope "";
proxy_set_header x-trace-id "";
```

This clears all three propagation headers for every proxied request through nginx. The `proxy_set_header` directive with an empty string value removes the header from the upstream request.

**Verification**:
```bash
docker run --rm -v $(pwd)/nginx.conf:/etc/nginx/nginx.conf:ro nginx:alpine nginx -t 2>&1
```
Output must include `syntax is ok` and `test is successful`. Also verify end-to-end: after a login, inspect that a request to `/trader/api/orders` forwarded through nginx arrives at the trader service with `x-user-id` absent (would need to be spoofed by the test caller externally).

---

### Step 11 — service: Wire `JWT_SECRET` and `IDENTITY_HTTP_ENDPOINT` env vars into docker-compose.yml and DO app specs

**Status**: `pending`
**Service**: `xstockstrat-trader`, `xstockstrat-insights`, `xstockstrat-config-ui`
**Files**:
- `docker-compose.yml` — modify
- `.do/app.dev.yaml` — modify
- `.do/app.yaml` — modify

**Reviewers**: `xstockstrat-trader` owner — Trading UI correctness, Connect-RPC call safety, no direct DB access from frontend; Security — No secrets in config service state, secret keys use `secret.*` prefix, JWT claims minimal, API key scoping correct

**Codebase Evidence**:
- Confirmed via: `grep -n "JWT_SECRET" .do/app.dev.yaml` → L233: only on `xstockstrat-identity`; the three Next.js frontends do NOT have `JWT_SECRET`
- Confirmed via: `grep -n "JWT_SECRET" docker-compose.yml` → L160: `JWT_SECRET: ${JWT_SECRET:?...}` only on `xstockstrat-identity`
- Confirmed via: `grep -n "IDENTITY_HTTP_ENDPOINT" docker-compose.yml` → L404 (trader), L432 (insights); config-ui at L454 does NOT have `IDENTITY_HTTP_ENDPOINT`
- Confirmed via: `grep -n "IDENTITY_HTTP_ENDPOINT" .do/app.dev.yaml` → L318 (trader), L345 (insights); config-ui section at L350–L363 does NOT have `IDENTITY_HTTP_ENDPOINT`
- Confirmed via: `.env.example:L28`: `JWT_SECRET=change-me-in-production-use-32-char-minimum` — present in local .env; frontends need this env var for `jose` `jwtVerify` in `middleware.ts` and `auth.ts`

**Instructions**:

**`docker-compose.yml`** — under `xstockstrat-trader` environment block (after L404 `IDENTITY_HTTP_ENDPOINT`): add `JWT_SECRET: ${JWT_SECRET:?JWT_SECRET is required}`. Under `xstockstrat-insights` environment block (after L432 `IDENTITY_HTTP_ENDPOINT`): add `JWT_SECRET: ${JWT_SECRET:?JWT_SECRET is required}`. Under `xstockstrat-config-ui` environment block (after L454 `CONFIG_HTTP_ENDPOINT`): add two lines: `IDENTITY_HTTP_ENDPOINT: http://xstockstrat-identity:8058` and `JWT_SECRET: ${JWT_SECRET:?JWT_SECRET is required}`. Also add `xstockstrat-identity` to the `depends_on` list of `xstockstrat-config-ui` (currently missing — confirmed by the docker-compose section at L458–L464).

**`.do/app.dev.yaml`** — under `xstockstrat-trader` envs block (after L320 `APP_URL`): add `- key: JWT_SECRET` / `scope: RUN_TIME` / `type: SECRET`. Under `xstockstrat-insights` envs block (after L347 `APP_URL`): same. Under `xstockstrat-config-ui` envs block (after L362 `APP_URL`): add both the `JWT_SECRET` secret entry and `- key: IDENTITY_HTTP_ENDPOINT` / `value: ${xstockstrat-identity.PRIVATE_URL}`.

**`.do/app.yaml`** — apply the identical changes as `.do/app.dev.yaml` (same structure, production branch/repo references).

**Verification**:
```bash
docker compose config 2>&1 | grep -A 2 "JWT_SECRET" | head -30
```
Must show `JWT_SECRET` appearing in `xstockstrat-trader`, `xstockstrat-insights`, and `xstockstrat-config-ui` environment sections. Also verify: `grep -c "JWT_SECRET" .do/app.dev.yaml` returns `4` (identity + 3 frontends).

---

### Step 12 — test: Add auth E2E smoke tests to all three frontends

**Status**: `pending`
**Service**: `xstockstrat-trader`, `xstockstrat-insights`, `xstockstrat-config-ui`
**Files**:
- `services/xstockstrat-trader/e2e/auth.spec.ts` — create
- `services/xstockstrat-trader/e2e/mock-backend.ts` — modify (add identity RPC responses)
- `services/xstockstrat-trader/playwright.config.ts` — modify (add `IDENTITY_HTTP_ENDPOINT` and `JWT_SECRET` to `webServer.env`)
- `services/xstockstrat-insights/e2e/auth.spec.ts` — create
- `services/xstockstrat-insights/e2e/mock-backend.ts` — modify (add identity RPC responses)
- `services/xstockstrat-insights/playwright.config.ts` — modify (add identity env vars)
- `services/xstockstrat-config-ui/e2e/auth.spec.ts` — create
- `services/xstockstrat-config-ui/e2e/mock-backend.ts` — modify (add identity RPC responses)
- `services/xstockstrat-config-ui/playwright.config.ts` — modify (add identity env vars)

**Reviewers**: `xstockstrat-trader` owner — Trading UI correctness, Connect-RPC call safety, no direct DB access from frontend; `xstockstrat-insights` owner — Analytics display accuracy, SSE polling resilience, read-only access pattern; `xstockstrat-config-ui` owner — Config mutation safety, environment scope correctness, no secret values rendered in UI

**Codebase Evidence**:
- Confirmed via: `services/xstockstrat-trader/e2e/mock-backend.ts:L17–L122`: `RESPONSES` dict keyed by Connect-RPC path — identity paths are absent; must add `AuthenticateUser`, `RefreshToken`, `RevokeToken`
- Confirmed via: `services/xstockstrat-trader/playwright.config.ts:L46–L50`: `webServer.env` has `TRADING_HTTP_ENDPOINT`, `PORTFOLIO_HTTP_ENDPOINT`, `NOTIFY_HTTP_ENDPOINT` but NOT `IDENTITY_HTTP_ENDPOINT` or `JWT_SECRET`
- Confirmed via: `services/xstockstrat-insights/playwright.config.ts:L40–L44`: `webServer.env` has only `ANALYSIS_HTTP_ENDPOINT`; missing identity vars
- Confirmed via: `services/xstockstrat-config-ui/playwright.config.ts:L30–L34`: `webServer.env` has only `CONFIG_ENDPOINT`; missing identity vars
- Existing test pattern at `services/xstockstrat-trader/e2e/api-smoke.spec.ts:L28–L55` uses `request.get/post` from Playwright's `APIRequestContext`

**Instructions**:

**mock-backend.ts (all three)**: Add identity mock responses to the `RESPONSES` dict:
- `/xstockstrat.identity.v1.IdentityService/AuthenticateUser`: return `{ access_token: '<signed-test-jwt>', refresh_token: 'test-refresh-token', claims: { user_id: 'test-user-001', email: 'test@example.com', roles: [] } }`. The `access_token` must be a valid JWT signed with the test `JWT_SECRET` (`test-jwt-secret-for-e2e-tests-min32c`) so that `jose` `jwtVerify` succeeds in the middleware.
- `/xstockstrat.identity.v1.IdentityService/RefreshToken`: return same structure.
- `/xstockstrat.identity.v1.IdentityService/RevokeToken`: return `{ success: true }`.

**playwright.config.ts (all three)**: In `webServer.env`, add:
- `IDENTITY_HTTP_ENDPOINT: 'http://127.0.0.1:<MOCK_PORT>'` (9091 for trader, 9092 for insights, 9093 for config-ui)
- `JWT_SECRET: 'test-jwt-secret-for-e2e-tests-min32c'`

**auth.spec.ts (all three)**: Create test file with the following test cases:
1. `POST /api/auth/login` with valid credentials returns 200 and sets `Set-Cookie` headers containing `access_token` and `refresh_token`.
2. `POST /api/auth/login` with missing credentials returns 400.
3. `GET /api/orders` (trader) or `/api/analysis/strategies` (insights) or `/api/config` (config-ui) without a session cookie returns 401.
4. `POST /api/auth/logout` clears cookies (response has `Set-Cookie: access_token=; Max-Age=0`).

For test case 3, use `request.get(route)` without any cookie context — no `storageState` needed since tests send raw HTTP requests.

**Verification**:
```bash
cd services/xstockstrat-trader && pnpm test:e2e -- --reporter=line 2>&1 | tail -20
cd services/xstockstrat-insights && pnpm test:e2e -- --reporter=line 2>&1 | tail -20
cd services/xstockstrat-config-ui && pnpm test:e2e -- --reporter=line 2>&1 | tail -20
```
All auth tests must pass. Existing smoke tests must continue to pass (they now require a valid session cookie — update them to include a mock `access_token` cookie in the request context if they start failing after Steps 4–9).

---

---

### Step 13 — service: Add header propagation interceptor to Go services (xstockstrat-trading, xstockstrat-portfolio, xstockstrat-marketdata)

**Status**: `pending`
**Service**: `xstockstrat-trading`, `xstockstrat-portfolio`, `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-trading/internal/middleware/propagation.go` — create
- `services/xstockstrat-trading/cmd/server/main.go` — modify
- `services/xstockstrat-trading/internal/service/trading.go` — modify
- `services/xstockstrat-portfolio/internal/middleware/propagation.go` — create
- `services/xstockstrat-portfolio/cmd/server/main.go` — modify
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go` — modify
- `services/xstockstrat-marketdata/internal/middleware/propagation.go` — create
- `services/xstockstrat-marketdata/cmd/server/main.go` — modify
- `services/xstockstrat-marketdata/internal/service/marketdata_service.go` — modify

**Reviewers**: `xstockstrat-trading` owner — Order execution correctness; `xstockstrat-portfolio` owner — P&L calculation accuracy; `xstockstrat-marketdata` owner — OHLCV ingestion integrity

**Codebase Evidence**:
- Server init (trading): `services/xstockstrat-trading/cmd/server/main.go:L121-128` — `grpc.NewServer(grpc.StatsHandler(...), grpc.KeepaliveParams(...))` — no unary interceptors; add `grpc.ChainUnaryInterceptor` here
- Server init (portfolio): `services/xstockstrat-portfolio/cmd/server/main.go:L81-88` — same pattern
- Server init (marketdata): `services/xstockstrat-marketdata/cmd/server/main.go:L95-102` — same pattern
- Client creation (trading): `services/xstockstrat-trading/internal/service/trading.go:L88-99` — `grpc.NewClient(endpoint, grpc.WithTransportCredentials(...), clientKeepAlive)` — 3 clients (ledger, notify, portfolio); add `grpc.WithChainUnaryInterceptor` here
- Client creation (portfolio): `services/xstockstrat-portfolio/internal/service/portfolio_service.go:L46-54` — 3 clients (ledger, marketdata, notify)
- Client creation (marketdata): `services/xstockstrat-marketdata/internal/service/marketdata_service.go:L46-52` — 2 clients (ledger, notify)
- Existing metadata import: `services/xstockstrat-trading/internal/handler/trading.go:L10` — `"google.golang.org/grpc/metadata"` already present
- Existing extraction pattern: `services/xstockstrat-trading/internal/handler/trading.go:L172-182` — `extractUserID(ctx)` uses `metadata.FromIncomingContext(ctx)` — this step generalizes that pattern into a reusable interceptor

**Instructions**:

Create `internal/middleware/propagation.go` in each of the three Go services with identical content (swap only the `package` declaration's path — the package name is always `middleware`):

```go
package middleware

import (
	"context"

	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
)

type propKey struct{}

// PropagationData holds the three upstream-propagation headers.
type PropagationData struct {
	UserID      string
	AccessScope string
	TraceID     string
}

// FromContext retrieves PropagationData stored by UnaryServerInterceptor.
func FromContext(ctx context.Context) PropagationData {
	v, _ := ctx.Value(propKey{}).(PropagationData)
	return v
}

// UnaryServerInterceptor extracts x-user-id, x-access-scope, x-trace-id from incoming
// metadata and stores them in context for use by client interceptors downstream.
func UnaryServerInterceptor(ctx context.Context, req interface{}, _ *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (interface{}, error) {
	md, _ := metadata.FromIncomingContext(ctx)
	ctx = context.WithValue(ctx, propKey{}, PropagationData{
		UserID:      first(md.Get("x-user-id")),
		AccessScope: first(md.Get("x-access-scope")),
		TraceID:     first(md.Get("x-trace-id")),
	})
	return handler(ctx, req)
}

// UnaryClientInterceptor reads PropagationData from context and injects the three headers
// into outgoing upstream gRPC metadata (request direction only — never set on responses).
func UnaryClientInterceptor(ctx context.Context, method string, req, reply interface{}, cc *grpc.ClientConn, invoker grpc.UnaryInvoker, opts ...grpc.CallOption) error {
	data := FromContext(ctx)
	if data.UserID != "" || data.AccessScope != "" || data.TraceID != "" {
		ctx = metadata.AppendToOutgoingContext(ctx,
			"x-user-id", data.UserID,
			"x-access-scope", data.AccessScope,
			"x-trace-id", data.TraceID,
		)
	}
	return invoker(ctx, method, req, reply, cc, opts...)
}

func first(vals []string) string {
	if len(vals) == 0 {
		return ""
	}
	return vals[0]
}
```

In `cmd/server/main.go` for each service: add `grpc.ChainUnaryInterceptor(middleware.UnaryServerInterceptor)` as the first option in the `grpc.NewServer(...)` call. Confirm the import path from each service's `go.mod` module declaration (pattern: `<module-root>/internal/middleware`).

In the service layer for each service: for every `grpc.NewClient(...)` call, append `grpc.WithChainUnaryInterceptor(middleware.UnaryClientInterceptor)` to the options slice.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go build ./... 2>&1
cd services/xstockstrat-portfolio && GOWORK=off go build ./... 2>&1
cd services/xstockstrat-marketdata && GOWORK=off go build ./... 2>&1
```
All three must build without errors. Also run: `cd services/xstockstrat-trading && GOWORK=off go vet ./...`

---

### Step 14 — service: Add header propagation to Python services (xstockstrat-indicators, xstockstrat-ingest, xstockstrat-analysis)

**Status**: `pending`
**Service**: `xstockstrat-indicators`, `xstockstrat-ingest`, `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-indicators/app/handlers/servicer.py` — modify
- `services/xstockstrat-ingest/app/handlers/servicer.py` — modify
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify

**Reviewers**: `xstockstrat-indicators` owner — Formula sandboxing, numeric precision; `xstockstrat-ingest` owner — Signal normalization correctness; `xstockstrat-analysis` owner — Backtest reproducibility

**Codebase Evidence**:
- Analysis servicer: `services/xstockstrat-analysis/app/handlers/servicer.py:L1-16` — instantiates 4 stubs (marketdata, indicators, ingest, ledger); outbound calls via `await self._ledger.AppendEvent(...)`, `await self._marketdata.GetBars(...)`, `await self._indicators.ComputeIndicator(...)`
- Ingest servicer: `services/xstockstrat-ingest/app/handlers/servicer.py:L1-8` — instantiates `MarketDataServiceStub` and `LedgerServiceStub`; makes upstream calls to both
- gRPC aio context API: `grpc.aio.ServicerContext.invocation_metadata()` returns a sequence of `(key, value)` tuples; `dict(context.invocation_metadata())` extracts by key
- Outbound stub call metadata: all gRPC aio stub methods accept a `metadata=` kwarg of type `Sequence[Tuple[str, str]]` — confirmed by grpc.aio API contract

**Instructions**:

In each servicer method that makes outbound stub calls, extract the three propagation headers from the incoming `context` and pass them as `metadata=` to every outbound stub call. The upstream-only pattern for each modified method:

```python
# Extract once at the top of each servicer method that makes outbound calls:
incoming = dict(context.invocation_metadata())
propagation_meta = [
    ('x-user-id',      incoming.get('x-user-id', '')),
    ('x-access-scope', incoming.get('x-access-scope', '0')),
    ('x-trace-id',     incoming.get('x-trace-id', '')),
]

# Add metadata= to every upstream stub call:
result = await self._ledger.AppendEvent(request, metadata=propagation_meta)
result = await self._marketdata.GetBars(request, metadata=propagation_meta)
# etc.
```

Apply to all RPC methods in:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — all methods calling downstream stubs
- `services/xstockstrat-ingest/app/handlers/servicer.py` — all methods calling marketdata or ledger stubs
- `services/xstockstrat-indicators/app/handlers/servicer.py` — all methods calling ingest stubs

Do NOT apply to config watcher channels — those are background streams, not request-scoped.

**Verification**:
```bash
cd services/xstockstrat-analysis && python -m ruff check app/ && python -m ruff format --check app/
cd services/xstockstrat-ingest && python -m ruff check app/ && python -m ruff format --check app/
cd services/xstockstrat-indicators && python -m ruff check app/ && python -m ruff format --check app/
```
No lint or format errors.

---

### Step 15 — service: Add header propagation middleware to Node.js backend services (xstockstrat-ledger, xstockstrat-identity, xstockstrat-notify, xstockstrat-config)

**Status**: `pending`
**Service**: `xstockstrat-ledger`, `xstockstrat-identity`, `xstockstrat-notify`, `xstockstrat-config`
**Files**:
- `services/xstockstrat-ledger/src/middleware/propagation.ts` — create
- `services/xstockstrat-ledger/src/index.ts` — modify
- `services/xstockstrat-identity/src/middleware/propagation.ts` — create
- `services/xstockstrat-identity/src/index.ts` — modify
- `services/xstockstrat-notify/src/middleware/propagation.ts` — create
- `services/xstockstrat-notify/src/index.ts` — modify
- `services/xstockstrat-config/src/middleware/propagation.ts` — create
- `services/xstockstrat-config/src/index.ts` — modify

**Reviewers**: `xstockstrat-ledger` owner — Append-only invariant; `xstockstrat-identity` owner — JWT expiry and rotation; Security — No secrets in config service state

**Codebase Evidence**:
- HTTP server (ledger): `services/xstockstrat-ledger/src/index.ts:L54-65` — `http.createServer(connectHandler).listen(HTTP_PORT, ...)` — wrapping `connectHandler` in a closure is the injection point for AsyncLocalStorage context
- gRPC server (ledger): `services/xstockstrat-ledger/src/index.ts:L36-41` — `new grpc.Server()` without interceptors; servicer impl at `services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts:L18` uses `call: any` with `call.metadata: grpc.Metadata`
- Same HTTP/gRPC structure confirmed for identity, notify, config (all follow the same index.ts pattern)
- These four services have no outbound service-to-service calls — server-side extraction only is needed

**Instructions**:

Create `src/middleware/propagation.ts` in each of the four services with identical content:

```typescript
import { AsyncLocalStorage } from 'async_hooks';
import type { IncomingMessage } from 'http';

export interface PropagationContext {
  userId: string;
  accessScope: string;
  traceId: string;
}

export const propagationStore = new AsyncLocalStorage<PropagationContext>();

// Extract the three upstream-propagation headers from an incoming HTTP request.
// Used on the Connect-RPC HTTP path.
export function extractFromHttpRequest(req: IncomingMessage): PropagationContext {
  return {
    userId:      (req.headers['x-user-id']      as string) ?? '',
    accessScope: (req.headers['x-access-scope'] as string) ?? '0',
    traceId:     (req.headers['x-trace-id']     as string) ?? '',
  };
}
```

In `src/index.ts` for each service, locate the `http.createServer(connectHandler)` call and wrap it so every Connect-RPC request runs inside the AsyncLocalStorage context:

```typescript
import { propagationStore, extractFromHttpRequest } from './middleware/propagation';

// Replace: http.createServer(connectHandler).listen(...)
// With:
http.createServer((req, res) => {
  propagationStore.run(extractFromHttpRequest(req), () => connectHandler(req, res));
}).listen(HTTP_PORT, () => { /* existing callback unchanged */ });
```

The gRPC path (requests arriving on the gRPC port) is not wrapped here — headers on that path are available via `call.metadata` in each servicer impl if needed for future structured logging. No changes to servicer impl files are required for this step.

**Verification**:
```bash
cd services/xstockstrat-ledger   && pnpm run lint
cd services/xstockstrat-identity && pnpm run lint
cd services/xstockstrat-notify   && pnpm run lint
cd services/xstockstrat-config   && pnpm run lint
```
No lint errors. All four services must pass their existing test suites: `pnpm run test:coverage` for each.

---

### Step 16 — test: Verify Wave 4 backend service test suites after propagation changes

**Status**: `pending`
**Service**: `xstockstrat-trading`, `xstockstrat-portfolio`, `xstockstrat-marketdata`, `xstockstrat-indicators`, `xstockstrat-ingest`, `xstockstrat-analysis`, `xstockstrat-ledger`, `xstockstrat-identity`, `xstockstrat-notify`, `xstockstrat-config`
**Files**: _(none — verification only; no source files modified in this step)_

**Reviewers**: `xstockstrat-trading` owner — Order execution correctness; `xstockstrat-portfolio` owner — P&L calculation accuracy; `xstockstrat-marketdata` owner — OHLCV ingestion integrity; `xstockstrat-indicators` owner — Formula sandboxing, numeric precision; `xstockstrat-ingest` owner — Signal normalization correctness; `xstockstrat-analysis` owner — Backtest reproducibility; `xstockstrat-ledger` owner — Append-only invariant; `xstockstrat-identity` owner — JWT expiry and rotation; `xstockstrat-notify` owner — Stream delivery guarantees; `xstockstrat-config` owner — WatchConfig stream stability

**Codebase Evidence**:
- CI coverage thresholds confirmed via `CLAUDE.md` §CI Jobs: `go test -race` ≥40% for Go services; `pytest --cov` ≥40% for Python services (indicators: ≥50%); `pnpm run test:coverage` ≥40% for Node.js services
- `test:coverage` script confirmed present in Node.js service package.json files (ledger, identity, notify, config) via existing CI job matrix
- pytest runner confirmed for Python services via pyproject.toml in each service directory

**Instructions**:
Run the existing test suites for all 10 Wave 4 backend services to confirm that the propagation changes introduced in Steps 13–15 do not regress coverage thresholds or break existing tests.

No new test code is required — the propagation middleware (`propagation.go` from Step 13, metadata extraction from Step 14, `propagation.ts` from Step 15) is thin glue code exercised by the existing handler-level test suites. If any service's suite fails, diagnose whether the failure pre-dates Steps 13–15 before attributing it to this feature.

**Verification**:
```bash
# Go services — ≥40% coverage each
cd services/xstockstrat-trading    && GOWORK=off go test -race ./... 2>&1 | tail -5
cd services/xstockstrat-portfolio  && GOWORK=off go test -race ./... 2>&1 | tail -5
cd services/xstockstrat-marketdata && GOWORK=off go test -race ./... 2>&1 | tail -5
# Python services — indicators: ≥50%, others: ≥40%
cd services/xstockstrat-indicators && python -m pytest --cov=app --cov-fail-under=50 2>&1 | tail -5
cd services/xstockstrat-ingest     && python -m pytest --cov=app --cov-fail-under=40 2>&1 | tail -5
cd services/xstockstrat-analysis   && python -m pytest --cov=app --cov-fail-under=40 2>&1 | tail -5
# Node.js services — ≥40% coverage each
cd services/xstockstrat-ledger   && pnpm run test:coverage 2>&1 | tail -5
cd services/xstockstrat-identity && pnpm run test:coverage 2>&1 | tail -5
cd services/xstockstrat-notify   && pnpm run test:coverage 2>&1 | tail -5
cd services/xstockstrat-config   && pnpm run test:coverage 2>&1 | tail -5
```
All commands must exit 0 and show passing tests. Coverage must meet or exceed the stated thresholds.

---

## Deviation Log

### Deviation: Step 2 — Create `src/lib/auth.ts` in xstockstrat-trader
**Spec said**: "`IDENTITY_HTTP_ENDPOINT` already exported from `connectTransport.ts:L29`" (implying import from that file)
**Actual**: Inlined `process.env.IDENTITY_HTTP_ENDPOINT ?? 'http://xstockstrat-identity:8058'` directly in `auth.ts` as a module-level constant.
**Reason**: `connectTransport.ts` imports `@connectrpc/connect-node` which is not Edge Runtime-compatible. Since `auth.ts` is used by `middleware.ts` (Step 5), which runs in the Edge Runtime, importing from `connectTransport.ts` would cause a runtime crash. The spec's Step 5 notes `auth.ts` must use only Edge-compatible APIs.

### Deviation: Step 3 — Create `src/lib/auth.ts` in xstockstrat-insights
**Spec said**: "substituting the `IDENTITY_HTTP_ENDPOINT` import from `services/xstockstrat-insights/src/lib/connectTransport.ts` where the endpoint constant is already exported at L44"
**Actual**: Inlined `process.env.IDENTITY_HTTP_ENDPOINT ?? 'http://xstockstrat-identity:8058'` directly in `auth.ts` (same pattern as Step 2). Note: the exported constant in connectTransport.ts is named `IDENTITY_BASE_URL` (not `IDENTITY_HTTP_ENDPOINT`), and imports `@connectrpc/connect-node` — not Edge Runtime-compatible.
**Reason**: Same Edge Runtime compatibility constraint as Step 2. The insights `auth.ts` will be used in `middleware.ts` (Step 7), which runs in the Edge Runtime. Importing from `connectTransport.ts` would cause a runtime crash.
