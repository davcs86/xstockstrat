# Design: ui-auth-improvements

**Created**: 2026-08-25
**Rounds**: 1 (quick; termination: approved after user gate)
**Approved by**: user @ 2026-08-25 (AskUserQuestion — 401 behavior, coverage, session length)
**Grounded in**: recon.md

---

## Chosen Approach

Ship both behaviors inside `xstockstrat-ui` only — no proto/identity/config/DB change (the server-side
refresh token already lives 30 days, `identityServiceImpl.ts:43`).

### Behavior 1 — "Remember me" extended session (persistent cookies)

- Add `REMEMBER_ME_MAX_AGE_SECONDS = 1_209_600` (**14 days**, per user) beside
  `ACCESS_TOKEN_REFRESH_THRESHOLD_SECONDS` in `src/lib/auth.ts:12`, with a documenting comment: the
  value **must stay ≤ `identity.jwt.refresh_ttl_seconds`** (default 2592000 / 30d) — the UI has no
  runtime read of that config, so this is an operational coupling documented at the constant, **not**
  a runtime-enforced invariant (FR-4 downgraded from "tested" to "documented" per the adversary's
  tautology finding).
- Extend `setSessionCookies(res, accessToken, refreshToken, opts?: { maxAge?: number })`
  (`auth.ts:51`). When `opts?.maxAge` is set it is applied to **both** cookie option objects;
  otherwise the calls are byte-identical to today → session cookies (FR-3). Single setter, no fork
  (DRY).
- `POST /api/auth/login` (`route.ts:6`) reads `body.rememberMe === true` and passes
  `{ maxAge: REMEMBER_ME_MAX_AGE_SECONDS }` when true.
- `CredentialsForm` (`AuthForm.tsx:41`) gains an opt-in `showRememberMe?: boolean` prop (default
  `false`) + a `rememberMe` boolean field (zod default `false`); the checkbox renders only when
  `showRememberMe` is true, and the existing `JSON.stringify(values)` submit carries it. Only
  `auth/login/page.tsx` passes `showRememberMe` — the shared OAuth authorize page
  (`auth/oauth-login/page.tsx`) does not, so the checkbox never appears there. Uses the shadcn
  `ui/checkbox` primitive (add via `npx shadcn add checkbox` if not present).

### Behavior 2 — Unauthorized → refresh-first, then redirect (all data-call surfaces)

One shared browser-only core module `src/lib/authRedirect.ts` (never imported by `middleware.ts`/
`auth.ts` — stays out of the Edge bundle), holding:
- Pure helpers `shouldRedirectToLogin(pathname)` (false when `pathname === '/auth/login'`) and
  `buildLoginRedirect(pathname, search)` → `/auth/login?redirect=<encoded pathname+search>` — the
  exact shape `middleware.ts:32-33` produces.
- A **deduped, single-in-flight** `attemptRefresh()` that `POST`s `/api/auth/refresh` (cookie-only,
  no body — matches `refresh/route.ts:5`; that path is excluded from the middleware matcher so it is
  not itself gated) and resolves to `true`/`false`. Concurrent 401s share one refresh.
- `redirectToLogin()` — guarded by `typeof window !== 'undefined'` and `shouldRedirectToLogin`.
- `handleUnauthorized()` — the shared decision: `await attemptRefresh()`; return `true` if refreshed
  (caller retries once), else `redirectToLogin()` and return `false`.

Two consumers of that core, so **every** browser data call is covered (FR-6):
1. **connect-web unary + streaming** — new `src/lib/browserClients/transport.ts` exporting
   `makeBrowserTransport(baseUrl)` = `createConnectTransport({ baseUrl, interceptors: [unauthInterceptor] })`.
   The interceptor: on a caught `ConnectError` with `Code.Unauthenticated`, `handleUnauthorized()`;
   on refresh success **retry the call once**, else the redirect already fired. For **streaming**
   responses it wraps the `message` async-iterable so a mid-stream `Unauthenticated` (the trader
   alert stream `AlertStream.tsx` and order-updates `useOrderUpdates.ts`, which today swallow the
   error) runs the same `handleUnauthorized()` — refresh-or-redirect — instead of dying silently. All
   **14** `browserClients/*.ts` files are refactored from inline `createConnectTransport({baseUrl})`
   onto `makeBrowserTransport('<same baseUrl>')` (one shared consumer path — closes the C-10
   "forgot a client" trap).
2. **/accounts REST divergence** — a shared `apiFetch(input, init?)` in `authRedirect.ts` doing
   `fetch`, then on `res.status === 401`: `handleUnauthorized()`, retry once on refresh success, else
   the redirect already fired. Applied to the `/accounts` data-call sites: `profile/page.tsx:37,73`,
   `mcp-tools/page.tsx:68`, `authorized-apps/page.tsx:41,74`.

### Consumer surface (C-14)

Reaches users through `xstockstrat-ui`: the login page (checkbox) and every segment's data calls
(`/trader`, `/insights`, `/config-ui` via connect-web; `/accounts` via `apiFetch`). No new route,
so no `PLATFORM_SUBNAV` registration needed.

## Rejected Alternatives

- **Redirect-only on 401 (no refresh)** — rejected: would bounce a still-refreshable session to full
  re-login every ~15 min (access TTL 900s), losing unsaved form state; middleware already refreshes
  navigations, so client data calls should too.
- **Add the interceptor to each of the 14 client files inline** — rejected: repeats the "shipped the
  producer, forgot the shared consumer" trap (ledger fails 2026-07); one factory instead.
- **connect-web-only coverage** — rejected by user: leaves `/accounts` REST and the streams (the
  actual silently-dying panels) unguarded.
- **FR-4 as a unit test (`604800 ≤ 2592000`)** — rejected: compares two source literals, enforces
  nothing at runtime; downgraded to a documented coupling comment.
- **Config key for the duration** — rejected for scope: the UI has no config-read path; a hardcoded,
  documented constant is the minimum that solves it.
- **Making `/api/auth/me` and `/accounts/api/agent-health` redirect on 401** — deliberately **not**
  wrapped: `me` is a session-probe consumed to *detect* logged-in state (PlatformHeader), and
  `agent-health` is a tolerant health probe; redirecting on those risks loops/regressions and is
  redundant with the middleware gate. Scoped out on purpose (see Open Risks).

## Open Risks

- [ ] **Streaming replay.** On a mid-stream 401 with a *successful* refresh, the stream is not
      replayed (only unary calls retry) — the panel recovers on next navigation/refetch, not
      in-place. Acceptable; documented. — verify in the stream e2e step.
- [ ] **`me`/`agent-health` scoped out** of the 401 redirect (see Rejected Alternatives). If a stale
      `me` should also redirect, that is a follow-up. — note in context.md.
- [ ] **Refresh re-entrancy.** `attemptRefresh()` must be a true singleton (shared promise) so a
      page firing many RPCs at once does not spawn many refresh POSTs — covered by a unit test.

## Constitution Rules Touched

- `C-11` (design gate / no silent guess) — honored: the three genuine forks (401 behavior, coverage,
  duration) were surfaced to the user, not guessed.
- `C-14` (consumer surface) — honored: the change reaches every UI segment's data calls + the login
  page; surface named in product-spec and above.
- `C-10` family (shared-consumer parity) — honored: single `makeBrowserTransport` factory + shared
  `apiFetch`/`handleUnauthorized` core, so no data-call path is left unguarded; a parity guard test
  asserts every `browserClients/*.ts` routes through the factory.
- `C-13` (test data / fixtures) — honored: e2e uses the existing mock-backend to force
  `Unauthenticated`; unit tests use no new domain fixtures.
- DRY guard rail — honored: one cookie setter, one redirect core, one transport factory.
- Edge-runtime trap (PLAT / frontend-auth) — honored: `authRedirect.ts` and `transport.ts` are
  browser-only and never imported by `middleware.ts`/`auth.ts`.
- No Floor (`F-*`) breach.

## Business Rules Touched (C-16)

- PRESERVE — the existing `e2e/auth.spec.ts` login + auth-gate guarantees (unchecked default →
  session cookies; credential-error copy) are not regressed.
- EXTEND — a new "Remember me" branch (persistent cookies) and a client-side 401→login path are
  added alongside the existing server-side middleware redirect.
