# Implementation Spec: unified-login-page

**Status**: `pending`
**Created**: 2026-06-01
**Feature**: `docs/roadmap/features/019-unified-login-page/feature.md`
**Total Steps**: 8
**Feature Branch**: `feature/unified-login-page`

---

## Execution Summary

This feature operates entirely on the **post-045 consolidated `xstockstrat-ui` service** — it cannot be executed until feature 045 (`ui-consolidation-nextjs`) is `launched` and `xstockstrat-ui` exists as a single Next.js service serving all three basePaths. The product spec records this hard dependency in § Merge-order Dependencies.

Steps 1–4 modify the consolidated `xstockstrat-ui` service: adding the unified `/auth/login` and `/auth/oauth-login` pages, consolidating auth routes, and updating all three per-basePath middlewares to redirect to the shared page. Step 5 removes the three per-basePath login page directories. Steps 6–7 update `xstockstrat-agent` (add `UI_BASE_URL`) and wiring docs. Step 8 covers the E2E test suite for the new login flows.

Step 2 (auth route consolidation) must complete before Step 3 (middleware update) because the middleware will redirect to `/auth/login`, which must resolve to the unified page. Step 4 (per-basePath login removal) must follow Step 3 because it deletes pages the old middleware redirected to.

## Step Dependencies

- Step 2 requires Step 1: `/auth/login` page must exist before auth routes call it and before middleware redirects to it.
- Step 3 requires Step 2: middleware redirects to `/auth/login`; the consolidated `POST /api/auth/login` route must exist first.
- Step 4 requires Step 3: per-basePath login pages are removed after middleware no longer redirects to them.
- Step 5 requires Step 4: no intermediate state where middleware redirects to a deleted login page.
- Step 7 requires Step 1: `UI_BASE_URL` is only needed once the unified OAuth login page exists.
- Step 8 (test) covers Steps 1–5.

---

### Step 1 — service: Add unified `/auth/login` and `/auth/oauth-login` pages to `xstockstrat-ui`

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/auth/login/page.tsx` — create
- `services/xstockstrat-ui/src/app/auth/oauth-login/page.tsx` — create

**Reviewers**: `xstockstrat-ui` owner (`test`) — Auth middleware correctness, open-redirect protection on `?redirect=`, no direct DB from login routes; Security — JWT claims minimal, platform-wide JWT scope, no secrets in config, open-redirect validation

**Codebase Evidence**:
- Confirmed via: `services/xstockstrat-trader/src/app/login/page.tsx` (lines 1–103) — existing trader login form. Title "xstockstrat Trader", POSTs to `/trader/api/auth/login`, redirects via `searchParams.get('redirect') ?? '/'`.
- Confirmed via: `services/xstockstrat-insights/src/app/login/page.tsx` (lines 1–103) — identical pattern; POSTs to `/insights/api/auth/login`.
- Confirmed via: `services/xstockstrat-config-ui/app/login/page.tsx` (lines 1–103) — identical pattern; POSTs to `/config-ui/api/auth/login`.
- Open-redirect protection required by FR-3: validated redirect values must start with `/trader`, `/insights`, or `/config-ui`; default to `/trader` if not.
- Existing pattern: `'use client'` page, `Suspense` wrapper, `useSearchParams()` for the `redirect` param, `useRouter().push(redirect)` on success, inline `{error && <p>}` on failure — all three existing login pages use this shape.
- OAuth login (FR-7): separate `GET /auth/oauth-login` route — receives `redirect_uri` and `state` query params from the agent OAuth flow (feature 018). On success, redirects browser to `redirect_uri` with `state`. Auth POST for this page goes to the same consolidated `POST /api/auth/login` route (Step 2).

**Instructions**:

1. Create `services/xstockstrat-ui/src/app/auth/login/page.tsx` as a `'use client'` component following the trader login page shape (`services/xstockstrat-trader/src/app/login/page.tsx` lines 1–103):
   - Title: "xstockstrat Platform"
   - POST target: `/api/auth/login` (basePath-relative — the consolidated service has no basePath set for the `/auth` segment; use an absolute-from-basePath path. Since `/auth/login` lives outside the three existing basePaths, the consolidated service must serve it at the root. The `fetch` call should use `/api/auth/login`.)
   - On success: read `redirect` from `useSearchParams()`. Validate: if the value starts with `/trader`, `/insights`, or `/config-ui`, redirect there; otherwise `router.push('/trader')`.
   - On failure: render `{error && <p className="text-sm text-destructive">{error}</p>}`.
   - Wrap the `LoginForm` in `<Suspense fallback={<LoginSkeleton />}>` following the existing pattern.
   - Use the same Radix/shadcn `Card`, `Input`, `Button` components used in the trader login page.

2. Create `services/xstockstrat-ui/src/app/auth/oauth-login/page.tsx` as a `'use client'` component:
   - This page is only reached when the agent OAuth flow redirects the browser here (FR-7).
   - Read `redirect_uri` and `state` query params from `useSearchParams()`.
   - Render the same login form shape, but on success, redirect the browser to `${redirect_uri}?state=${state}` (construct only if both params are present; on missing params, render an error: "Invalid OAuth authorization request.").
   - POST target: `/api/auth/login` (same consolidated route as the regular login page).
   - Title: "xstockstrat Platform — Authorize Agent Access".
   - Do **not** apply the `/trader`/`/insights`/`/config-ui` allowlist check here — the `redirect_uri` is an agent OAuth callback, not a browser path.

**Verification**:
```bash
# After 045 is launched and xstockstrat-ui exists at services/xstockstrat-ui:
pnpm --filter xstockstrat-ui exec tsc --noEmit
# Confirm no TypeScript errors.
# Also confirm the files were created:
ls services/xstockstrat-ui/src/app/auth/login/page.tsx \
   services/xstockstrat-ui/src/app/auth/oauth-login/page.tsx
```

---

### Step 2 — service: Consolidate `/api/auth/login`, `/api/auth/logout`, `/api/auth/refresh` routes in `xstockstrat-ui`

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/api/auth/login/route.ts` — modify
- `services/xstockstrat-ui/src/app/api/auth/logout/route.ts` — modify
- `services/xstockstrat-ui/src/app/api/auth/refresh/route.ts` — modify

**Reviewers**: `xstockstrat-ui` owner (`test`) — Auth middleware correctness, open-redirect protection on `?redirect=`, no direct DB from login routes; `xstockstrat-identity` owner — JWT expiry and rotation, API key scoping, secret store integration (never plaintext secrets in config); Security — JWT claims minimal, platform-wide JWT scope, no secrets in config, open-redirect validation

**Codebase Evidence**:
- Confirmed via: `services/xstockstrat-trader/src/app/api/auth/login/route.ts` (lines 1–39) — calls `identityClient.authenticateUser({ email, password })`, then `setSessionCookies(response, tokens.accessToken, tokens.refreshToken)`.
- Confirmed via: `services/xstockstrat-trader/src/app/api/auth/logout/route.ts` (lines 1–13) — reads `access_token` cookie, calls `revokeToken(token)` from `@/lib/identity`, calls `clearSessionCookies(response)`.
- Confirmed via: `services/xstockstrat-trader/src/app/api/auth/refresh/route.ts` (lines 1–19) — reads `refresh_token` cookie, calls `refreshSession(refreshToken)` from `@/lib/identity`, sets new cookies or clears on failure.
- All three per-basePath services have identical auth route handler logic (confirmed by reading trader, insights, and config-ui variants). The consolidated routes are a direct copy with the import paths adjusted for the consolidated service.
- `setSessionCookies` / `clearSessionCookies` are in `src/lib/auth.ts` (Edge-safe). `revokeToken` / `refreshSession` are in `src/lib/identity.ts` (Node-only) — the split must be preserved per `docs/patterns/frontend-auth.md` L32–57.
- Platform-wide JWT: one `JWT_SECRET` shared with `xstockstrat-ui` (OQ resolved at review gate, context.md session 2026-06-01T00:01:00Z).

**Instructions**:

After 045 creates `xstockstrat-ui`, it will have three sets of per-basePath auth routes (one per basePath segment). Feature 019 consolidates them to a single set:

1. In `services/xstockstrat-ui/src/app/api/auth/login/route.ts`, ensure there is exactly **one** `POST` handler that:
   - Reads `email` and `password` from `req.json()`.
   - Calls `identityClient.authenticateUser({ email, password })` (from `@/lib/connectClients`).
   - Calls `setSessionCookies(response, tokens.accessToken, tokens.refreshToken)` with cookies scoped to `path: '/'` (not scoped to a basePath prefix — platform-wide JWT, per the resolved OQ).
   - Returns `ConnectError` handling for `Code.Unauthenticated` → 401.
   - Verify `path: '/'` is present in `setSessionCookies` call in `src/lib/auth.ts` (confirmed at `services/xstockstrat-trader/src/lib/auth.ts` line 43 — already `path: '/'`).

2. In `services/xstockstrat-ui/src/app/api/auth/logout/route.ts`, ensure there is exactly one `POST` handler that reads `access_token` cookie, calls `revokeToken(token)` (Node-only, from `@/lib/identity`), clears cookies with `clearSessionCookies(response)`.

3. In `services/xstockstrat-ui/src/app/api/auth/refresh/route.ts`, ensure there is exactly one `POST` handler that reads `refresh_token` cookie, calls `refreshSession(refreshToken)` (from `@/lib/identity`), sets new cookies on success or clears them on failure.

4. Remove any duplicate per-basePath copies of these routes (e.g. `src/app/trader/api/auth/login/route.ts`, `src/app/insights/api/auth/login/route.ts`, etc.) that the 045 consolidation may have created. **Do not remove the single consolidated route at `src/app/api/auth/login/route.ts`.**

5. Confirm `middleware.ts` `config.matcher` excludes `api/auth/login` (confirmed present in trader middleware at line 12: `api/auth/login|api/health|health` in the negative lookahead).

**Verification**:
```bash
pnpm --filter xstockstrat-ui exec tsc --noEmit
# Confirm there is exactly one login route and it is not in a basePath-scoped directory:
grep -rn "authenticateUser" services/xstockstrat-ui/src/app/api/
# Expected: exactly one match at src/app/api/auth/login/route.ts
```

---

### Step 3 — service: Update all three per-basePath `middleware.ts` files in `xstockstrat-ui` to redirect to `/auth/login`

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/middleware.ts` — modify (or the per-basePath equivalents that 045 produces)

**Reviewers**: `xstockstrat-ui` owner (`test`) — Auth middleware correctness, open-redirect protection on `?redirect=`, no direct DB from login routes; Security — JWT claims minimal, platform-wide JWT scope, no secrets in config, open-redirect validation

**Codebase Evidence**:
- Confirmed via: `services/xstockstrat-trader/src/middleware.ts` (lines 1–53) — redirects to `/login` at L24–29; sets `loginUrl.pathname = '/login'` and `loginUrl.searchParams.set('redirect', req.nextUrl.pathname)`.
- Confirmed via: `services/xstockstrat-insights/src/middleware.ts` (lines 1–53) — identical pattern.
- Confirmed via: `services/xstockstrat-config-ui/middleware.ts` (lines 1–53) — identical pattern.
- Confirmed via: trader middleware `config.matcher` (line 10–14): `['/', '/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|api/auth/login|api/health|health).+)']`.
- After 045 produces `xstockstrat-ui`, the exact file path and whether middleware is unified or segmented per-basePath depends on 045's implementation. Proceed against whichever file(s) contain `pathname === '/login'` for each basePath.

**Instructions**:

In the consolidated `xstockstrat-ui` service, locate every occurrence of the redirect-to-login pattern. In the current per-service source, the pattern is:
```ts
if (req.nextUrl.pathname === '/login') {
  return NextResponse.next();
}
const loginUrl = req.nextUrl.clone();
loginUrl.pathname = '/login';
loginUrl.searchParams.set('redirect', req.nextUrl.pathname);
return NextResponse.redirect(loginUrl);
```
(Confirmed at `services/xstockstrat-trader/src/middleware.ts` L23–29, identical in insights L23–29 and config-ui L23–29.)

Replace all occurrences of this pattern with:
```ts
if (req.nextUrl.pathname === '/auth/login' || req.nextUrl.pathname === '/auth/oauth-login') {
  return NextResponse.next();
}
const loginUrl = new URL('/auth/login', req.url);
loginUrl.searchParams.set('redirect', req.nextUrl.pathname + req.nextUrl.search);
return NextResponse.redirect(loginUrl);
```

Key constraints:
- The redirect target is `/auth/login` (absolute from the domain root, outside all basePath prefixes). Use `new URL('/auth/login', req.url)` rather than cloning `req.nextUrl` and setting `pathname`, because `req.nextUrl` carries the basePath and would produce `/trader/auth/login`.
- Both `/auth/login` and `/auth/oauth-login` must be allowed through without auth (added to the matcher negative lookahead or handled with the explicit `if` check above).
- The `redirect` query param preserves the original path so the unified login page can redirect back after authentication.
- Also update `config.matcher` to exclude `auth/login` and `auth/oauth-login` from the protected matcher, in addition to the existing exclusions (`api/auth/login`, `api/health`, `health`): add `auth/login|auth/oauth-login` to the negative lookahead pattern.

**Verification**:
```bash
pnpm --filter xstockstrat-ui exec tsc --noEmit
# Confirm no remaining redirects to /login:
grep -rn "pathname.*=.*'/login'" services/xstockstrat-ui/src/
# Expected: 0 matches
# Confirm redirect to /auth/login is present:
grep -rn "'/auth/login'" services/xstockstrat-ui/src/middleware.ts
# Expected: at least 1 match
```

---

### Step 4 — service: Remove per-basePath login pages from `xstockstrat-ui`

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/trader/login/page.tsx` — delete (or equivalent per-basePath login page path that 045 produces)
- `services/xstockstrat-ui/src/app/insights/login/page.tsx` — delete
- `services/xstockstrat-ui/src/app/config-ui/login/page.tsx` — delete

**Reviewers**: `xstockstrat-ui` owner (`test`) — Auth middleware correctness, open-redirect protection on `?redirect=`, no direct DB from login routes

**Codebase Evidence**:
- Confirmed via: `services/xstockstrat-trader/src/app/login/page.tsx` — exists. Corresponding post-045 path will be inside the consolidated service at the basePath-scoped directory that 045 creates (exact path depends on 045 implementation; locate via `find services/xstockstrat-ui -name "page.tsx" -path "*/login/*"`).
- Confirmed via: `services/xstockstrat-insights/src/app/login/page.tsx` — exists.
- Confirmed via: `services/xstockstrat-config-ui/app/login/page.tsx` — exists.
- FR-4 requires: `/trader/login`, `/insights/login`, and `/config-ui/login` no longer render; requests to them return 404.

**Instructions**:

1. Run `find services/xstockstrat-ui -name "page.tsx" -path "*/login/*"` to locate all per-basePath login pages in the consolidated service.
2. Delete all three login page files (one per basePath segment: trader, insights, config-ui). Do not delete `src/app/auth/login/page.tsx` or `src/app/auth/oauth-login/page.tsx` (created in Step 1).
3. Confirm no other component in the consolidated service imports from these deleted files. Run:
   ```bash
   grep -rn "login/page\|from.*login'" services/xstockstrat-ui/src/
   ```
   Resolve any remaining import errors before committing.

**Verification**:
```bash
pnpm --filter xstockstrat-ui exec tsc --noEmit
# Confirm the deleted pages are gone:
find services/xstockstrat-ui/src -name "page.tsx" -path "*/login/*" | grep -v "/auth/login/"
# Expected: 0 matches (only /auth/login/page.tsx and /auth/oauth-login/page.tsx should remain)
# Confirm build still passes:
pnpm --filter xstockstrat-ui run build
```

---

### Step 5 — service: Remove identity HTTP Express server (FR-8)

**Status**: `pending`
**Service**: `xstockstrat-identity`
**Files**:
- `services/xstockstrat-identity/src/index.ts` — verify (no change required if Express server is absent)

**Reviewers**: `xstockstrat-identity` owner — JWT expiry and rotation, API key scoping, secret store integration (never plaintext secrets in config)

**Codebase Evidence**:
- Confirmed via: `services/xstockstrat-identity/src/index.ts` (lines 1–66) — identity is **already gRPC-only**. No Express HTTP server is present. The file starts `@grpc/grpc-js` server setup at line 4 and contains no `express`, `app.get`, `app.post`, or HTTP port binding.
- Confirmed via: `services/xstockstrat-identity/CLAUDE.md` — "This service is gRPC-only (`src/index.ts` runs a single `@grpc/grpc-js` server…). The former HTTP/Connect-RPC server on `8058` (and the `src/connect/` Connect router) was removed."
- **FR-8 is already satisfied** for identity — no code change required in `xstockstrat-identity`.

**Instructions**:

Verify that `services/xstockstrat-identity/src/index.ts` contains no HTTP or Express server. Specifically confirm:
```bash
grep -n "express\|app\.get\|app\.post\|createServer\|http\.listen\|HTTP_PORT" \
  services/xstockstrat-identity/src/index.ts
```
Expected: 0 matches. If feature 018 (`agent-mcp-oauth`) added an HTTP server to identity before launching, it will appear here — remove it and the `express` dependency from `services/xstockstrat-identity/package.json`.

If the grep confirms 0 matches (identity is already gRPC-only), this step is a no-op verification only. No file changes.

**Verification**:
```bash
grep -n "express\|app\.get\|app\.post\|createServer\|HTTP_PORT" \
  services/xstockstrat-identity/src/index.ts
# Expected: 0 matches
pnpm --filter xstockstrat-identity run build
# Expected: build succeeds
```

---

### Step 6 — service: Add `UI_BASE_URL` to `xstockstrat-agent` and update OAuth redirect target

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/main.py` — modify (update `/oauth/authorize` redirect target once feature 018 lands)
- `docker-compose.yml` — modify (add `UI_BASE_URL` to agent `environment:` block)
- `.do/app.dev.yaml` — modify (add `UI_BASE_URL` to agent `envs:` block)
- `.do/app.yaml` — modify (add `UI_BASE_URL` to agent `envs:` block)

**Reviewers**: `xstockstrat-agent` owner (`test`) — Auth middleware correctness, open-redirect protection on `?redirect=`, no direct DB from login routes

**Codebase Evidence**:
- Confirmed via: `services/xstockstrat-agent/app/main.py` (lines 1–93) — **no `/oauth/authorize` handler is present** in the current codebase. Feature 018 (`agent-mcp-oauth`) adds this handler. This step's instruction to update the redirect target applies to the post-018 implementation; once 018 lands, locate the handler in `app/main.py` via `grep -n "oauth\|authorize" services/xstockstrat-agent/app/main.py`.
- Confirmed via: `grep -n "UI_BASE_URL" docker-compose.yml .do/app.dev.yaml .do/app.yaml` → 0 matches (absent — must add).
- Docker-compose agent block: `services/xstockstrat-agent` environment at `docker-compose.yml` lines 553–563. `UI_BASE_URL` is absent — confirmed by grep.
- app.dev.yaml agent envs block: lines 229–248. `UI_BASE_URL` absent.
- app.yaml agent envs block: lines 229–248 (same structure). `UI_BASE_URL` absent.
- Per product spec FR-8: `UI_BASE_URL` is a browser-redirect URL, not a gRPC endpoint — does **not** use the `_ENDPOINT` suffix.

**Instructions**:

1. Add `UI_BASE_URL` to the `xstockstrat-agent` `environment:` block in `docker-compose.yml` (after `MCP_AGENT_SECRET` at line 563):
   ```yaml
   UI_BASE_URL: http://localhost:3000
   ```

2. Add `UI_BASE_URL` to the `xstockstrat-agent` `envs:` block in `.do/app.dev.yaml` (after `MCP_AGENT_SECRET` at line 247):
   ```yaml
   - key: UI_BASE_URL
     value: ${APP_URL}
   ```
   (The dev App Platform URL is the `APP_URL` variable already used by the trader service at `.do/app.dev.yaml` line 413.)

3. Add `UI_BASE_URL` to the `xstockstrat-agent` `envs:` block in `.do/app.yaml` (after `MCP_AGENT_SECRET`):
   ```yaml
   - key: UI_BASE_URL
     value: ${APP_URL}
   ```

4. In `services/xstockstrat-agent/app/main.py`, once feature 018 is landed: locate the `/oauth/authorize` handler (it will contain a redirect to `identity:HTTP/login` or equivalent). Update the redirect target from the identity HTTP login URL to:
   ```python
   UI_BASE_URL = os.environ.get("UI_BASE_URL", "http://localhost:3000")
   oauth_login_url = f"{UI_BASE_URL}/auth/oauth-login"
   ```
   Use this `oauth_login_url` as the redirect target, preserving `redirect_uri` and `state` as query params (e.g. `f"{UI_BASE_URL}/auth/oauth-login?redirect_uri={redirect_uri}&state={state}"`).
   
   **Note**: If 018 has not yet landed when executing this step, add the `UI_BASE_URL` env var wiring (sub-steps 1–3) and leave a `# TODO(019): update to {UI_BASE_URL}/auth/oauth-login when 018 lands` comment where the redirect will go.

**Verification**:
```bash
# Confirm UI_BASE_URL is present in all three deployment files:
grep -n "UI_BASE_URL" docker-compose.yml .do/app.dev.yaml .do/app.yaml
# Expected: 1 match each (3 total)

# Confirm it is NOT using _ENDPOINT suffix (naming convention check):
grep -n "UI_BASE_URL_ENDPOINT\|UI_BASE_ENDPOINT" docker-compose.yml .do/app.dev.yaml .do/app.yaml
# Expected: 0 matches

# If 018 has landed, confirm redirect target in agent:
grep -n "auth/oauth-login\|UI_BASE_URL" services/xstockstrat-agent/app/main.py
# Expected: at least 1 match per line
```

---

### Step 7 — docs: Update `docs/patterns/frontend-auth.md` for the unified login pattern

**Status**: `pending`
**Service**: `docs/patterns/`
**Files**:
- `docs/patterns/frontend-auth.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- Confirmed via: `docs/patterns/frontend-auth.md` lines 20–24 — the required files table lists `src/app/login/page.tsx` and `src/app/api/auth/login/route.ts` as per-service required files.
- After this feature, the pattern changes: the unified login page is at `src/app/auth/login/page.tsx` (outside all basePaths), per-basePath login pages are removed, and the single `src/app/api/auth/login/route.ts` handles all basePaths.

**Instructions**:

In `docs/patterns/frontend-auth.md`:

1. In the Required files table (around line 20), update:
   - Change `src/app/login/page.tsx` → `src/app/auth/login/page.tsx` — Unified login form (outside all basePaths)
   - Add a new row: `src/app/auth/oauth-login/page.tsx` — OAuth agent login form (separate from operator login)
   - Note that per-basePath `login/page.tsx` files are removed after this feature.

2. Add a note to the middleware section (around the redirect-to-login code block) that the redirect target is `/auth/login`, not `/login`, and that `new URL('/auth/login', req.url)` must be used (not `req.nextUrl.clone()` with `pathname = '/login'`) to avoid the basePath prefix.

3. In the "Required files" table intro paragraph, update the reference from "three separate services (trader, insights, config-ui)" to "the consolidated `xstockstrat-ui` service".

**Verification**:
```bash
# No automated check — visual confirmation that the doc is updated:
grep -n "/auth/login\|oauth-login" docs/patterns/frontend-auth.md
# Expected: at least 2 matches (one for the login page path, one for the middleware redirect)
```

---

### Step 8 — test: E2E test coverage for the unified login page and per-basePath redirect behavior

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/auth.spec.ts` — modify
- `services/xstockstrat-ui/e2e/mock-backend.ts` — verify (no changes needed; existing mock handles `authenticateUser`)

**Reviewers**: `xstockstrat-ui` owner (`test`) — Auth middleware correctness, open-redirect protection on `?redirect=`, no direct DB from login routes; Security — JWT claims minimal, platform-wide JWT scope, no secrets in config, open-redirect validation

**Codebase Evidence**:
- Confirmed via: `services/xstockstrat-trader/e2e/auth.spec.ts` (lines 1–53) — existing auth E2E tests. POSTs to `/trader/api/auth/login`; checks cookie names; verifies 400 on missing credentials; verifies protected routes redirect.
- Confirmed via: `services/xstockstrat-trader/e2e/mock-backend.ts` (lines 194–212) — `IdentityService` mock handles `authenticateUser`, `refreshToken`, `revokeToken`. The 019 tests do not require new mock handlers.
- After 045 consolidation, the auth E2E spec in `xstockstrat-ui` will need to test the new `/auth/login` endpoint, not `/trader/api/auth/login`.
- Acceptance criteria from product spec: AC1 (unauthenticated redirect to `/auth/login`), AC2 (valid credentials → JWT + redirect), AC3 (invalid credentials → inline error), AC4 (per-basePath login pages 404), AC5 (logout invalidates session), AC6 (OAuth flow), AC7 (`tsc --noEmit` passes).

**Instructions**:

In `services/xstockstrat-ui/e2e/auth.spec.ts`, add or update the following test cases:

1. **Unified login page — POST `/api/auth/login` (AC2)**: POST valid credentials → expect 200, `access_token` and `refresh_token` cookies set. Use the same mock setup as trader (`POST /api/auth/login` backed by `authenticateUser` mock).

2. **Unified login page — invalid credentials (AC3)**: POST empty credentials → expect 400 with `error` field.

3. **Redirect to `/auth/login` from trader (AC1)**: `page.request.get('/trader/api/orders?trading_mode=paper', { maxRedirects: 0 })` → expect 302/307 and `location` header containing `/auth/login`.

4. **Redirect to `/auth/login` from insights (AC1)**: `page.request.get('/insights/strategies', { maxRedirects: 0 })` → expect 302/307 and `location` header containing `/auth/login`.

5. **Redirect to `/auth/login` from config-ui (AC1)**: `page.request.get('/config-ui/', { maxRedirects: 0 })` → expect 302/307 and `location` header containing `/auth/login`.

6. **Per-basePath login pages return 404 (AC4)**: GET `/trader/login`, `/insights/login`, `/config-ui/login` → each must return 404 (or 302 to `/auth/login`).

7. **Logout clears session (AC5)**: login → logout → confirm cookies cleared (matching existing trader pattern at `services/xstockstrat-trader/e2e/auth.spec.ts` L36–53, adapted for `/api/auth/logout`).

8. **Open-redirect protection (FR-3)**: After login with `?redirect=https://evil.com`, expect browser to end up at `/trader` (default), not `https://evil.com`.

9. **`tsc --noEmit` (AC7)**: Include in the verification step below (not a Playwright test but a CI check).

The `mock-backend.ts` in `xstockstrat-ui` after 045 should already include the `IdentityService` mock from the trader's `mock-backend.ts` (lines 194–212). No changes to the mock are needed unless 045 changed the mock structure.

**Verification**:
```bash
# TypeScript check (AC7):
pnpm --filter xstockstrat-ui exec tsc --noEmit
# Expected: 0 errors

# Run E2E tests (no coverage threshold for Next.js frontends):
pnpm --filter xstockstrat-ui test:e2e
# Expected: all tests pass including the new auth.spec.ts cases
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
