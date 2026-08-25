# Recon: ui-auth-improvements

**Created**: 2026-08-25
**From**: product-spec.md
**Affected services**: xstockstrat-ui (only)

---

## Objective

Add two `xstockstrat-ui` auth UX behaviors: a "Remember me" control that persists the session across
browser restarts (extended session), and an automatic redirect to the login page whenever a browser
data call returns Unauthorized (401 / gRPC `Unauthenticated`). Both are UI-only — the server-side
refresh token already lives 30 days, so no proto/identity/config/DB change is required.

## Codebase Map

- **`xstockstrat-ui`** (Next.js 15 / TypeScript)
  - Edge-safe auth helpers: `services/xstockstrat-ui/src/lib/auth.ts`
    - `setSessionCookies(res, accessToken, refreshToken)` — `auth.ts:51` — currently sets both cookies
      with `httpOnly / secure / sameSite:'lax' / path:'/'` and **no `maxAge`** → session cookies.
    - `clearSessionCookies` — `auth.ts:71`.
    - `ACCESS_TOKEN_REFRESH_THRESHOLD_SECONDS = 60` — `auth.ts:12`.
  - Login route: `services/xstockstrat-ui/src/app/api/auth/login/route.ts:6` — `POST` reads
    `{email,password}` (`route.ts:8`), calls `identityClient.authenticateUser`, then
    `setSessionCookies(response, data.accessToken, data.refreshToken)` (`route.ts:17`).
  - Login page: `services/xstockstrat-ui/src/app/auth/login/page.tsx` — renders `AuthCardShell` +
    `CredentialsForm` (from `AuthForm.tsx`); `onSuccess` redirects via `safeRedirect(...)`.
  - Shared auth form: `services/xstockstrat-ui/src/components/auth/AuthForm.tsx`
    - `CredentialsForm` (`AuthForm.tsx:40`) — react-hook-form + zod; `onSubmit` (`AuthForm.tsx:60`)
      does `fetch('/api/auth/login', { method:'POST', body: JSON.stringify(values) })`.
    - **Shared by two pages**: `auth/login/page.tsx` (operator) AND `auth/oauth-login/page.tsx`
      (OAuth agent authorize) — both call `CredentialsForm`.
  - Middleware: `services/xstockstrat-ui/src/middleware.ts` — already redirects **browser
    navigations** with no/expired session to `/auth/login?redirect=<path>` (built with
    `new URL('/auth/login', req.url)` per frontend-auth.md §middleware).
  - Browser gRPC clients: `services/xstockstrat-ui/src/lib/browserClients/*.ts` — **14 files**,
    **28** `createConnectTransport({ baseUrl })` call sites, each created **inline** (no shared
    factory). baseUrls span `/trader/api`, `/insights/api`, `/config-ui/api`.
  - `connectCodeToHttp` maps `Code.Unauthenticated → 401` (frontend-auth.md; `connectClients.ts`).

- **`xstockstrat-identity`** (Node) — **not modified**, recon only:
  - `services/xstockstrat-identity/src/grpc/identityServiceImpl.ts`
    - `accessTtlSeconds` — `:39` — `identity.jwt.access_ttl_seconds`, default **900** (15m).
    - `refreshTtlSeconds` — `:43` — `identity.jwt.refresh_ttl_seconds`, default **2592000** (30d).
  - `AuthenticateUserRequest` = email + password only (`packages/proto/identity/v1/identity.proto:34`).

## Patterns to REUSE

- Persistent cookie → extend `setSessionCookies` (`auth.ts:51`) to accept an optional `maxAge`;
  do not fork a second cookie-setter (DRY guard rail).
- "Remember me" flag transport → add a boolean to the existing `/api/auth/login` POST body
  (`route.ts:8` already `req.json()`s the body) and the existing `CredentialsForm` fetch
  (`AuthForm.tsx:60`); no new route.
- 401→login navigation target → reuse the exact `/auth/login?redirect=<path>` shape the middleware
  already produces (`middleware.ts`), so client and server redirects are identical.
- Shared browser transport → consolidate the 14 inline `createConnectTransport({ baseUrl })` calls
  onto one `makeBrowserTransport(baseUrl)` factory (candidate home:
  `src/lib/browserClients/transport.ts` or `src/lib/connectTransport.ts`) carrying the 401
  interceptor once. This is the FR-6 "one shared consumer path" requirement.
- Bounded duration constant → colocate `REMEMBER_ME_MAX_AGE_SECONDS` with the other auth constants
  in `auth.ts` (next to `ACCESS_TOKEN_REFRESH_THRESHOLD_SECONDS`).

## Existing Business Rules (preserve / extend)

- **PRESERVE** the current auth gate + login-error semantics in `e2e/auth.spec.ts` — this feature
  must not regress the unchecked-Remember-me default (session cookies) or the login credential-error
  path. (No dedicated `services/xstockstrat-ui/acceptance/*.feature` suite is maintained for the UI;
  UI behavior is covered by the Playwright e2e suite, per the service CLAUDE.md § Testing.)
- **EXTEND** the login flow with the new "Remember me" branch (persistent cookies) alongside the
  existing default.
- No cross-cutting `docs/sdd/business-rules/platform.feature` scenario governs UI cookie persistence.

## Dependencies

- Proto/RPC: none (email+password `AuthenticateUserRequest` unchanged).
- Migration: none.
- Config keys: none required (Open Question: optional `ui.auth.remember_me_ttl_seconds` — default
  position is a hardcoded constant).
- Inter-service edges: none new (login already calls identity `AuthenticateUser`).
- New env vars / ports: none.

## Risks / Not-found

- **Shared-consumer trap (ledger fails, 2026-07 "shipped producer, forgot the shared consumer",
  C-10-family).** With 14 client files creating transports inline, adding the 401 interceptor to a
  subset silently leaves clients unguarded. Mitigation: single shared factory (Patterns to REUSE).
- **Redirect loop.** The interceptor must suppress navigation when already on `/auth/login` (and not
  fire on `/api/auth/*` responses) to avoid a loop. Carry into design Open Risks.
- **`CredentialsForm` is shared with OAuth login.** A "Remember me" checkbox must be opt-in per page
  (e.g. a `showRememberMe` prop) so it does not appear on the OAuth authorize page unless intended.
- **Edge-runtime trap.** `auth.ts` is bundled for Edge via `middleware.ts` — the `maxAge` change adds
  no Node-only import, so it stays Edge-safe. Do not add Node-only imports to `auth.ts`.
- **`secure` flag.** Persistent cookies keep the existing `secure: isProduction` behavior — no change.

## Recommended Scope

Advisory step boundaries (input to grilling / /sdd-spec):
1. `auth.ts` — `setSessionCookies` gains optional `maxAge`; add `REMEMBER_ME_MAX_AGE_SECONDS`.
2. `/api/auth/login/route.ts` — read `remember`/`rememberMe` from body, pass `maxAge` when true.
3. `AuthForm.tsx` + `auth/login/page.tsx` — opt-in "Remember me" checkbox, included in POST body.
4. Shared `makeBrowserTransport(baseUrl)` factory with the 401→login interceptor; refactor the 14
   `browserClients/*.ts` files onto it.
5. Tests — vitest unit for `setSessionCookies(maxAge)`; Playwright e2e for the checkbox default,
   persistent-cookie header, and the 401 redirect.
