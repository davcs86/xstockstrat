# Implementation Spec: ui-auth-improvements

**Created**: 2026-08-25
**From**: design.md (approved), recon.md
**Service**: xstockstrat-ui only

All paths are `services/xstockstrat-ui/…`. Statuses: `todo` → `done`.

---

## Step 1 — Extended-session cookie support in `auth.ts` — `done`

- File: `src/lib/auth.ts`.
- Add constant beside `ACCESS_TOKEN_REFRESH_THRESHOLD_SECONDS` (`auth.ts:12`):
  `export const REMEMBER_ME_MAX_AGE_SECONDS = 1_209_600; // 14 days` with a comment: MUST stay
  ≤ `identity.jwt.refresh_ttl_seconds` (default 2592000/30d); UI has no runtime read of that config,
  so this bound is a documented operational coupling, not runtime-enforced (FR-4).
- Change `setSessionCookies(res, accessToken, refreshToken)` → add 4th param
  `opts?: { maxAge?: number }`; spread `...(opts?.maxAge ? { maxAge: opts.maxAge } : {})` into both
  cookie option objects (`auth.ts:57`, `auth.ts:63`). No behavior change when `opts` absent (FR-3).
- Covers: FR-2, FR-3, FR-4. AC-2, AC-3, AC-4.

## Step 2 — Login route reads `rememberMe` — `done`

- File: `src/app/api/auth/login/route.ts`.
- After validating body, pass persistence to the setter (`route.ts:17`):
  `setSessionCookies(response, data.accessToken, data.refreshToken, body.rememberMe ? { maxAge: REMEMBER_ME_MAX_AGE_SECONDS } : undefined)`.
- Import `REMEMBER_ME_MAX_AGE_SECONDS` from `@/lib/auth`.
- Covers: FR-2. AC-2, AC-3.

## Step 3 — "Remember me" checkbox in `CredentialsForm` — `done`

- Files: `src/components/auth/AuthForm.tsx`, `src/app/auth/login/page.tsx`.
- Add shadcn `Checkbox` if absent: `npx shadcn@latest add checkbox` (creates
  `src/components/ui/checkbox.tsx`).
- `CredentialsForm`: add prop `showRememberMe?: boolean` (default `false`); add `rememberMe: boolean`
  to the zod schema (`z.boolean().default(false)` or omit from schema and add to `defaultValues`) and
  `defaultValues` (`AuthForm.tsx:58`); render a `Checkbox` + label only when `showRememberMe`. The
  existing `JSON.stringify(values)` submit (`AuthForm.tsx:67`) already carries `rememberMe`.
- `auth/login/page.tsx`: pass `showRememberMe` to `<CredentialsForm />` (`page.tsx:25`).
- Do NOT touch `auth/oauth-login/page.tsx` — it keeps the default (no checkbox).
- Covers: FR-1. AC-1.

## Step 4 — Shared 401 redirect core `authRedirect.ts` — `done`

- New file: `src/lib/authRedirect.ts` (browser-only; NEVER import from `middleware.ts`/`auth.ts`).
- Exports:
  - `shouldRedirectToLogin(pathname: string): boolean` — `pathname !== '/auth/login'`.
  - `buildLoginRedirect(pathname: string, search: string): string` —
    `` `/auth/login?redirect=${encodeURIComponent(pathname + search)}` `` (matches `middleware.ts:32-33`).
  - `attemptRefresh(): Promise<boolean>` — single in-flight: module-level `let inFlight`; POST
    `/api/auth/refresh` (no body), resolve `res.ok`, clear `inFlight` in `.finally`.
  - `redirectToLogin(): void` — guard `typeof window !== 'undefined'` and `shouldRedirectToLogin`;
    `window.location.assign(buildLoginRedirect(window.location.pathname, window.location.search))`.
  - `handleUnauthorized(): Promise<boolean>` — `const ok = await attemptRefresh(); if (!ok) redirectToLogin(); return ok;`
  - `apiFetch(input, init?): Promise<Response>` — `fetch`; if `res.status === 401`, `handleUnauthorized()`;
    on `true` retry `fetch` once and return it; else return the original 401 response.
- Covers: FR-5, FR-6 (shared core). AC-5, AC-6, AC-7.

## Step 5 — Browser transport factory + interceptor `transport.ts` — `done`

- New file: `src/lib/browserClients/transport.ts`.
- `makeBrowserTransport(baseUrl: string)` = `createConnectTransport({ baseUrl, interceptors: [unauthInterceptor] })`.
- `unauthInterceptor` (connect `Interceptor`): `async (req) => { … }`:
  - unary: try `next(req)`; catch → if `ConnectError` && `Code.Unauthenticated`: `await handleUnauthorized()`;
    if refreshed retry `next(req)` once (on second Unauthenticated, `redirectToLogin()`); rethrow.
  - streaming (`res.stream`): wrap `res.message` async-iterable in a generator that try/catches
    iteration; on `Unauthenticated` run `handleUnauthorized()` (no replay), then rethrow.
  - Use a small `isUnauthenticated(err)` helper.
- Covers: FR-5, FR-6, streaming. AC-5, AC-6.

## Step 6 — Route all 14 browser clients through the factory — `done`

- Files: every `src/lib/browserClients/*.ts` (14 files, 28 call sites).
- Replace inline `createConnectTransport({ baseUrl: 'X' })` with `makeBrowserTransport('X')`; drop the
  now-unused `createConnectTransport` import from each.
- Covers: FR-6 (no client left unguarded). AC-6.

## Step 7 — Route `/accounts` REST data calls through `apiFetch` — `done`

- Files: `src/app/accounts/profile/page.tsx` (`:37`, `:73`), `src/app/accounts/mcp-tools/page.tsx`
  (`:68`), `src/app/accounts/authorized-apps/page.tsx` (`:41`, `:74`).
- Replace `fetch('/accounts/api/…', …)` with `apiFetch('/accounts/api/…', …)` from `@/lib/authRedirect`.
- Leave `/accounts/api/agent-health` (`authorized-apps/page.tsx:58`) and `/api/auth/me`
  (PlatformHeader, useLiveStrategies) as bare `fetch` (deliberately scoped out — design Rejected
  Alternatives).
- Covers: FR-6 (`/accounts` clause). AC-6.

## Step 8 — Tests — `done`

- vitest (`src/lib/*.test.ts`, node env):
  - `auth.test.ts`: `setSessionCookies` with `{maxAge}` → both cookies carry positive `Max-Age`;
    without → no `Max-Age`. Assert the documented bound `REMEMBER_ME_MAX_AGE_SECONDS <= 2592000`
    (as a documentation guard, labelled as such).
  - `authRedirect.test.ts`: `shouldRedirectToLogin('/auth/login') === false`,
    `shouldRedirectToLogin('/trader') === true`; `buildLoginRedirect('/trader','?x=1')` →
    `/auth/login?redirect=%2Ftrader%3Fx%3D1`; `attemptRefresh` single-in-flight (mock `fetch`, two
    concurrent calls → one POST).
- Playwright e2e (`e2e/auth.spec.ts`, mock backend):
  - checkbox visible + unchecked by default (AC-1); OAuth login page shows no checkbox;
  - `rememberMe: true` login → `Set-Cookie` carries `Max-Age=1209600` on both cookies (AC-2/AC-4);
    without it → no `Max-Age`/`Expires` (AC-3).
- **Testing boundary for AC-5/AC-6/AC-7** (the client-side 401 → refresh/redirect): covered by the
  `authRedirect.test.ts` unit tests over the pure helpers (`shouldRedirectToLogin` loop guard = AC-7,
  `buildLoginRedirect` shape = AC-5, deduped `attemptRefresh` = refresh-first core). A full
  browser-interceptor e2e is intentionally NOT added: it requires deterministic access-token expiry +
  a failing refresh mid-session, which the current mock-backend harness cannot orchestrate
  deterministically (middleware would redirect the navigation before a page-level client call runs).
  This is a deliberate, documented boundary, not an omission.
- Covers: AC-1..AC-4 via e2e; AC-5/AC-6/AC-7 via unit tests on the shared core.

## Step 9 — Docs teardown — `done`

- Update `services/xstockstrat-ui/CLAUDE.md` if the browser-client transport story changed
  (mention `makeBrowserTransport` + `authRedirect.ts`).
- Run `/context-scrubber scan` scoped to touched context files if the plugin is available.
