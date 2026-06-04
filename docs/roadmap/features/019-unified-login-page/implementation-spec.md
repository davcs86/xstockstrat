# Implementation Spec: unified-login-page

**Status**: `pending`
**Created**: 2026-06-01
**Re-spec**: 2026-06-04 (Steps 1–4, 6, 8 corrected to the actual post-045 structure on main-dev — a single `src/middleware.ts` routing to per-basePath login pages + per-basePath auth routes; the original spec assumed a single consolidated `src/app/api/auth/*` route and a single `e2e/auth.spec.ts` that do not exist. User approved re-spec, including creating the consolidated auth routes + unified login page as in-scope.)
**Feature**: `docs/roadmap/features/019-unified-login-page/feature.md`
**Total Steps**: 8
**Feature Branch**: `feature/unified-login-page`

---

## Execution Summary

This feature operates on the post-045 consolidated `xstockstrat-ui` service. As confirmed on current `main-dev`, that service has:
- A **single** `src/middleware.ts` that, when unauthenticated, redirects to a per-basePath login page (`/insights/login`, `/config-ui/login`, or `/trader/login`) and, on token refresh, calls a per-basePath refresh route.
- **Per-basePath login pages**: `src/app/{trader,insights,config-ui}/login/page.tsx`.
- **Per-basePath auth routes**: `src/app/{trader,insights,config-ui}/api/auth/{login,logout,refresh}/route.ts` (9 files). There is **no** top-level `src/app/api/auth/`.
- **Per-basePath e2e auth specs**: `e2e/{trader,insights,config-ui}/auth.spec.ts`. There is **no** `e2e/auth.spec.ts`.

Steps 1–4 add the unified `/auth/login` + `/auth/oauth-login` pages, create the consolidated `/api/auth/{login,logout,refresh}` routes (deleting the per-basePath copies), update the single middleware to redirect to `/auth/login`, and remove the per-basePath login pages. Step 5 verifies identity is gRPC-only. Step 6 adds `UI_BASE_URL` to the agent. Step 7 updates docs. Step 8 replaces the per-basePath auth e2e specs with a unified `e2e/auth.spec.ts`.

## Step Dependencies

- Step 2 requires Step 1: `/auth/login` page must exist before middleware redirects to it; the consolidated `POST /api/auth/login` must exist before middleware refresh points at `/api/auth/refresh`.
- Step 3 requires Step 2: middleware redirects to `/auth/login` and refreshes via `/api/auth/refresh`; both must exist first.
- Step 4 requires Step 3: per-basePath login pages are removed only after the middleware no longer redirects to them.
- Step 7 requires Step 1: `UI_BASE_URL` is only meaningful once `/auth/oauth-login` exists.
- Step 8 (test) covers Steps 1–4.

---

### Step 1 — service: Add unified `/auth/login` and `/auth/oauth-login` pages to `xstockstrat-ui`

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/auth/login/page.tsx` — create
- `services/xstockstrat-ui/src/app/auth/oauth-login/page.tsx` — create

**Reviewers**: `xstockstrat-ui` owner (`test`) — Auth middleware correctness, open-redirect protection on `?redirect=`, no direct DB from login routes; Security — JWT claims minimal, platform-wide JWT scope, no secrets in config, open-redirect validation

**Codebase Evidence** _(re-spec 2026-06-04)_:
- Confirmed via read of `services/xstockstrat-ui/src/app/insights/login/page.tsx` (and the identical `trader`/`config-ui` variants): `'use client'`, `Suspense` wrapper around a `LoginForm`, `useRouter()` + `useSearchParams()`, `fetch('/insights/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })`, on success `router.push(searchParams.get('redirect') ?? '/insights')`, inline `{error && <p>}`. Uses `@/components/ui/{button,input,card}`.
- Open-redirect protection (FR-3): the unified page must validate `redirect` starts with `/trader`, `/insights`, or `/config-ui`; otherwise default to `/trader`.
- OAuth login (FR-7): the agent OAuth flow (feature 018, not yet landed) will redirect the browser to `/auth/oauth-login` with `redirect_uri` + `state`; that page POSTs to the same consolidated `/api/auth/login` (Step 2) and, on success, redirects the browser to `redirect_uri` carrying `state`.

**Instructions**:
1. Create `services/xstockstrat-ui/src/app/auth/login/page.tsx` (`'use client'`), modeled on `src/app/insights/login/page.tsx`:
   - Title: "xstockstrat Platform".
   - `fetch('/api/auth/login', …)` (root-relative — `/auth/login` lives outside all basePaths and the consolidated route is at `/api/auth/login`).
   - On success: read `redirect` from `useSearchParams()`. If it starts with `/trader`, `/insights`, or `/config-ui`, `router.push(redirect)`; otherwise `router.push('/trader')`.
   - On failure: inline `{error && <p className="text-sm text-destructive">{error}</p>}`.
   - Wrap `LoginForm` in `<Suspense fallback={…}>` (the existing pages wrap in Suspense because of `useSearchParams`).
2. Create `services/xstockstrat-ui/src/app/auth/oauth-login/page.tsx` (`'use client'`):
   - Read `redirect_uri` and `state` from `useSearchParams()`.
   - Same login form shape; POST to `/api/auth/login`.
   - On success: if both `redirect_uri` and `state` present, redirect the browser to `${redirect_uri}?state=${state}` (use `window.location.href`); if either missing, render "Invalid OAuth authorization request."
   - Title: "xstockstrat Platform — Authorize Agent Access".
   - Do **not** apply the `/trader|/insights|/config-ui` allowlist here (the `redirect_uri` is an external OAuth callback).

**Verification**:
```bash
pnpm --filter xstockstrat-ui exec tsc --noEmit
ls services/xstockstrat-ui/src/app/auth/login/page.tsx services/xstockstrat-ui/src/app/auth/oauth-login/page.tsx
```

---

### Step 2 — service: Create consolidated `/api/auth/{login,logout,refresh}` routes and remove the per-basePath copies

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/api/auth/login/route.ts` — create
- `services/xstockstrat-ui/src/app/api/auth/logout/route.ts` — create
- `services/xstockstrat-ui/src/app/api/auth/refresh/route.ts` — create
- `services/xstockstrat-ui/src/app/trader/api/auth/login/route.ts` — delete
- `services/xstockstrat-ui/src/app/trader/api/auth/logout/route.ts` — delete
- `services/xstockstrat-ui/src/app/trader/api/auth/refresh/route.ts` — delete
- `services/xstockstrat-ui/src/app/insights/api/auth/login/route.ts` — delete
- `services/xstockstrat-ui/src/app/insights/api/auth/logout/route.ts` — delete
- `services/xstockstrat-ui/src/app/insights/api/auth/refresh/route.ts` — delete
- `services/xstockstrat-ui/src/app/config-ui/api/auth/login/route.ts` — delete
- `services/xstockstrat-ui/src/app/config-ui/api/auth/logout/route.ts` — delete
- `services/xstockstrat-ui/src/app/config-ui/api/auth/refresh/route.ts` — delete

**Reviewers**: `xstockstrat-ui` owner (`test`) — Auth middleware correctness, open-redirect protection, no direct DB from login routes; `xstockstrat-identity` owner — JWT expiry/rotation, secret store integration; Security — minimal JWT claims, platform-wide JWT, no secrets in config

**Codebase Evidence** _(re-spec 2026-06-04)_:
- Confirmed `services/xstockstrat-ui/src/app/api/auth/` does **not** exist (no top-level auth routes). Reality is nine per-basePath route files under `src/app/{trader,insights,config-ui}/api/auth/{login,logout,refresh}/route.ts` (confirmed via `find … -path "*api/auth*" -name route.ts`).
- The three per-basePath variants of each route are identical except basePath strings; they import from `@/lib/connectClients` (`identityClient.authenticateUser`), `@/lib/auth` (`setSessionCookies`/`clearSessionCookies`, Edge-safe, already `path: '/'` at `src/lib/auth.ts` L45/L51/L56–57), and `@/lib/identity` (`refreshSession`, `revokeToken`, Node-only — confirmed at `src/lib/identity.ts` L11/L26).
- Cookies are already platform-wide (`path: '/'`), so the consolidated routes need no cookie-scope change.
- `src/middleware.ts` `config.matcher` already excludes `api/auth/login` (L12 negative lookahead) — the consolidated `/api/auth/login` is therefore not auth-gated.

**Instructions**:
1. Create `src/app/api/auth/login/route.ts` by copying `src/app/trader/api/auth/login/route.ts` verbatim (imports already use `@/lib/*` aliases, so no path edits are needed). Confirm it: reads `{ email, password }` from `req.json()`, calls `identityClient.authenticateUser`, calls `setSessionCookies(...)`, maps `ConnectError` `Code.Unauthenticated` → 401, returns `{ ok: true }` on success / `{ error }` on failure (400 on missing fields).
2. Create `src/app/api/auth/logout/route.ts` by copying `src/app/trader/api/auth/logout/route.ts` (reads `access_token`, `revokeToken`, `clearSessionCookies`).
3. Create `src/app/api/auth/refresh/route.ts` by copying `src/app/trader/api/auth/refresh/route.ts` (reads `refresh_token`, `refreshSession`, sets new cookies / clears on failure).
4. Delete all nine per-basePath route files listed under **Files**.

**Verification**:
```bash
pnpm --filter xstockstrat-ui exec tsc --noEmit
# exactly one login route, at the consolidated path:
grep -rln "authenticateUser" services/xstockstrat-ui/src/app/   # → src/app/api/auth/login/route.ts only
find services/xstockstrat-ui/src/app -path "*api/auth*" -name route.ts | sort   # → only the 3 src/app/api/auth/* files
```

---

### Step 3 — service: Update `src/middleware.ts` to redirect to `/auth/login` and refresh via `/api/auth/refresh`

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/middleware.ts` — modify

**Reviewers**: `xstockstrat-ui` owner (`test`) — Auth middleware correctness, open-redirect protection; Security — open-redirect validation

**Codebase Evidence** _(re-spec 2026-06-04)_:
- Confirmed via read of `services/xstockstrat-ui/src/middleware.ts`: single middleware. Unauthenticated block (L21–37): allows `pathname.endsWith('/login')`, else clones `req.nextUrl` and sets `pathname` to `/insights/login`, `/config-ui/login`, or `/trader/login` by prefix, then `searchParams.set('redirect', …)`. Refresh block (L39–62): chooses a per-basePath `…/api/auth/refresh` path by prefix; on refresh failure redirects to the per-basePath login page (L50–60). `config.matcher` (L9–14) excludes `api/auth/login|api/health|health`.

**Instructions**:
1. In the unauthenticated block, replace the per-basePath login routing (L22–36) with:
   ```ts
   if (req.nextUrl.pathname === '/auth/login' || req.nextUrl.pathname === '/auth/oauth-login') {
     return NextResponse.next();
   }
   const loginUrl = new URL('/auth/login', req.url);
   loginUrl.searchParams.set('redirect', req.nextUrl.pathname + req.nextUrl.search);
   return NextResponse.redirect(loginUrl);
   ```
   Use `new URL('/auth/login', req.url)` (not `req.nextUrl.clone()` + `pathname`) so the path is domain-root, never basePath-prefixed.
2. In the refresh block, replace the per-basePath `refreshPath` selection with the single consolidated route: `const refreshUrl = new URL('/api/auth/refresh', req.url);`. On refresh failure, redirect to `new URL('/auth/login', req.url)` with the `redirect` param (same as step 1's block).
3. Update `config.matcher` negative lookahead to also exclude `auth/login` and `auth/oauth-login`: add `|auth/login|auth/oauth-login` alongside `api/auth/login|api/health|health`.

**Verification**:
```bash
pnpm --filter xstockstrat-ui exec tsc --noEmit
grep -rn "/insights/login\|/config-ui/login\|/trader/login" services/xstockstrat-ui/src/middleware.ts   # → 0
grep -n "'/auth/login'" services/xstockstrat-ui/src/middleware.ts                                       # → ≥1
grep -n "/api/auth/refresh" services/xstockstrat-ui/src/middleware.ts                                   # → 1
```

---

### Step 4 — service: Remove per-basePath login pages from `xstockstrat-ui`

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/trader/login/page.tsx` — delete
- `services/xstockstrat-ui/src/app/insights/login/page.tsx` — delete
- `services/xstockstrat-ui/src/app/config-ui/login/page.tsx` — delete

**Reviewers**: `xstockstrat-ui` owner (`test`) — Auth middleware correctness, no direct DB from login routes

**Codebase Evidence** _(re-spec 2026-06-04)_:
- Confirmed all three exist: `src/app/{trader,insights,config-ui}/login/page.tsx`. FR-4: `/trader/login`, `/insights/login`, `/config-ui/login` must no longer render (404 after deletion). The unified pages from Step 1 (`src/app/auth/login`, `src/app/auth/oauth-login`) must remain.

**Instructions**:
1. Delete the three per-basePath login page files listed under **Files**.
2. Confirm nothing imports them: `grep -rn "login/page\|/login'" services/xstockstrat-ui/src/` — resolve any references (middleware was already updated in Step 3).

**Verification**:
```bash
pnpm --filter xstockstrat-ui exec tsc --noEmit
find services/xstockstrat-ui/src -name page.tsx -path "*/login/*" | grep -v "/auth/login/"   # → 0
pnpm --filter xstockstrat-ui run build
```

---

### Step 5 — service: Verify identity is gRPC-only (FR-8)

**Status**: `pending`
**Service**: `xstockstrat-identity`
**Files**:
- `services/xstockstrat-identity/src/index.ts` — verify (no change expected)

**Reviewers**: `xstockstrat-identity` owner — JWT expiry/rotation, API key scoping, secret store integration

**Codebase Evidence**:
- `services/xstockstrat-identity/CLAUDE.md` states the service is gRPC-only; the former HTTP/Connect server on 8058 was removed. FR-8 is expected to already be satisfied.

**Instructions**:
```bash
grep -n "express\|app\.get\|app\.post\|createServer\|http\.listen\|HTTP_PORT" services/xstockstrat-identity/src/index.ts
```
If 0 matches: no-op verification only. If feature 018 added an HTTP server, remove it and the `express` dep from `services/xstockstrat-identity/package.json`.

**Verification**:
```bash
grep -n "express\|app\.get\|app\.post\|createServer\|HTTP_PORT" services/xstockstrat-identity/src/index.ts   # → 0
pnpm --filter xstockstrat-identity run build
```

---

### Step 6 — service: Add `UI_BASE_URL` to `xstockstrat-agent`

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `docker-compose.yml` — modify (add `UI_BASE_URL` to the agent `environment:` block)
- `.do/app.dev.yaml` — modify (add `UI_BASE_URL` to the agent `envs:` block)
- `.do/app.yaml` — modify (add `UI_BASE_URL` to the agent `envs:` block)
- `services/xstockstrat-agent/app/main.py` — modify (only if feature 018's `/oauth/authorize` handler is present; otherwise leave a TODO)

**Reviewers**: `xstockstrat-agent` owner (`test`) — open-redirect protection

**Codebase Evidence** _(re-spec 2026-06-04)_:
- `grep -n "UI_BASE_URL" docker-compose.yml .do/app.dev.yaml .do/app.yaml` → 0 matches (absent — must add).
- agent docker-compose block starts at `docker-compose.yml` L474; `environment:` at L482; `MCP_AGENT_SECRET` at L492.
- agent `.do/app.dev.yaml` block starts L224; agent `MCP_AGENT_SECRET` at L250. `APP_URL` is already defined (used by trader at L402–403).
- agent `.do/app.yaml` block starts L224 (same structure).
- `services/xstockstrat-agent/app/main.py` has **no** `/oauth/authorize` handler (feature 018 not yet landed; `grep -n "oauth\|authorize"` → none relevant). So no redirect-target edit is possible yet — wire the env var and leave a TODO.

**Instructions**:
1. In `docker-compose.yml`, add to the agent `environment:` block (after `MCP_AGENT_SECRET`):
   ```yaml
   UI_BASE_URL: http://localhost:3000
   ```
2. In `.do/app.dev.yaml`, add to the agent `envs:` block (after its `MCP_AGENT_SECRET`):
   ```yaml
   - key: UI_BASE_URL
     value: ${APP_URL}
   ```
3. In `.do/app.yaml`, add the same to the agent `envs:` block.
4. In `services/xstockstrat-agent/app/main.py`, since 018 has not landed, add a comment near the top of the request-handling section: `# TODO(019): when 018's /oauth/authorize lands, redirect to f"{os.environ.get('UI_BASE_URL','http://localhost:3000')}/auth/oauth-login?redirect_uri=…&state=…"`. Do not add a handler that does not yet exist.

**Verification**:
```bash
grep -n "UI_BASE_URL" docker-compose.yml .do/app.dev.yaml .do/app.yaml      # → 3 (one each)
grep -n "UI_BASE_URL_ENDPOINT\|UI_BASE_ENDPOINT" docker-compose.yml .do/app.dev.yaml .do/app.yaml   # → 0
grep -n "TODO(019)" services/xstockstrat-agent/app/main.py                  # → 1
```

---

### Step 7 — docs: Update `docs/patterns/frontend-auth.md` for the unified login pattern

**Status**: `pending`
**Service**: `docs/patterns/`
**Files**:
- `docs/patterns/frontend-auth.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `docs/patterns/frontend-auth.md` documents per-service `src/app/login/page.tsx` + `src/app/api/auth/login/route.ts`. After this feature: a unified `src/app/auth/login/page.tsx` (+ `auth/oauth-login`), a single `src/app/api/auth/{login,logout,refresh}/route.ts`, per-basePath login pages removed, and middleware redirecting to `/auth/login` via `new URL('/auth/login', req.url)`.

**Instructions**:
1. Update the required-files table: replace per-basePath `…/login/page.tsx` with `src/app/auth/login/page.tsx` (unified) and add `src/app/auth/oauth-login/page.tsx`; note the single `src/app/api/auth/{login,logout,refresh}/route.ts`.
2. In the middleware section, document that the redirect target is `/auth/login` (not `/login`) and that `new URL('/auth/login', req.url)` must be used to avoid the basePath prefix; refresh goes to `/api/auth/refresh`.
3. Update prose referencing three separate services to the consolidated `xstockstrat-ui` service.

**Verification**:
```bash
grep -n "/auth/login\|oauth-login" docs/patterns/frontend-auth.md   # → ≥2
```

---

### Step 8 — test: Unified login E2E spec (replaces per-basePath auth specs)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/auth.spec.ts` — create
- `services/xstockstrat-ui/e2e/trader/auth.spec.ts` — delete
- `services/xstockstrat-ui/e2e/insights/auth.spec.ts` — delete
- `services/xstockstrat-ui/e2e/config-ui/auth.spec.ts` — delete

**Reviewers**: `xstockstrat-ui` owner (`test`) — Auth middleware correctness, open-redirect protection; Security — open-redirect validation

**Codebase Evidence** _(re-spec 2026-06-04)_:
- Confirmed three per-basePath specs exist: `e2e/{trader,insights,config-ui}/auth.spec.ts`. Each POSTs to its per-basePath `…/api/auth/login` (e.g. trader L5 `page.request.post('/trader/api/auth/login', …)`) — those routes are deleted in Step 2, so these specs must be replaced by a unified spec hitting `/api/auth/login`.
- The `IdentityService` mock in `e2e/mock-backend.ts` already handles `authenticateUser`/`refreshToken`/`revokeToken`; no mock change needed.
- The shared playwright config (`playwright.config.ts`) uses `baseURL: http://localhost:3000`, mock gRPC on 9092, `testDir: ./e2e` (picks up `e2e/auth.spec.ts`).

**Instructions**:
1. Create `services/xstockstrat-ui/e2e/auth.spec.ts` covering:
   - POST `/api/auth/login` valid creds → 200, `access_token` + `refresh_token` cookies set (AC2).
   - POST `/api/auth/login` empty creds → 400 with `error` (AC3).
   - GET `/trader/api/orders?trading_mode=paper`, `/insights/strategies`, `/config-ui/` with `maxRedirects: 0` → 302/307 with `location` containing `/auth/login` (AC1).
   - GET `/trader/login`, `/insights/login`, `/config-ui/login` → 404 or redirect to `/auth/login` (AC4).
   - login → POST `/api/auth/logout` → cookies cleared (AC5).
   Model the request/cookie assertions on the existing `e2e/trader/auth.spec.ts`.
2. Delete the three per-basePath `e2e/{trader,insights,config-ui}/auth.spec.ts` files (superseded).

**Verification**:
```bash
pnpm --filter xstockstrat-ui exec tsc --noEmit
pnpm --filter xstockstrat-ui exec playwright test --project=chromium --grep "auth" 
# (or the lint-only fallback if browsers/dev-server are unavailable)
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
