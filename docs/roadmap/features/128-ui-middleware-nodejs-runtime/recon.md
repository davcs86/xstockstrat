# Recon: ui-middleware-nodejs-runtime

**Created**: 2026-08-31
**From**: product-spec.md
**Affected services**: xstockstrat-ui

---

## Objective

Move `xstockstrat-ui`'s `src/middleware.ts` from the Edge runtime to the Next.js Node.js runtime
(stable since Next 15.5.0; this repo pins `^15.5.21`) so the near-expiry access-token refresh can call
`xstockstrat-identity`'s `refreshSession()` in-process, eliminating PR #925's self-referential
loopback `fetch()` to `/api/auth/refresh` and the class of self-fetch bugs it worked around.
Observable behavior (session refresh, redirect-to-login on failure, cookie attributes) is unchanged;
only the transport of the middleware→identity refresh changes.

## Codebase Map

- **`xstockstrat-ui`** (Next.js 15.5 / TypeScript, `services/xstockstrat-ui/package.json:48` `"next": "^15.5.21"`)
  - Middleware: `src/middleware.ts:24` (`middleware(req)`); `config` w/ matcher `:11-22`; near-expiry
    refresh branch `:39-49`; self-fetch to loopback `:40`; matcher **excludes** `api/auth/refresh` `:20`
    with the rationale comment `:14-17` (claims it is "never [called] by the browser" — now stale, see Risks).
  - Edge-safe auth: `src/lib/auth.ts` — `ACCESS_TOKEN_REFRESH_THRESHOLD_SECONDS = 60` `:12`;
    `getSessionFromRequest` `:36-40`; `buildInternalRefreshUrl()` (PR #925 loopback) `:57-60`;
    `setSessionCookies` `:62-86` (no-`maxAge` ⇒ session cookies `:69-71`); `clearSessionCookies` `:88-91`;
    "must not be reachable from middleware" note `:42-44`.
  - Node identity: `src/lib/identity.ts` — "NEVER import from middleware.ts" header `:1-6`;
    `refreshSession(refreshToken)` `:11-24` (calls `identityClient.refreshToken` `:15`).
  - gRPC clients: `src/lib/connectClients.ts` — `import { createGrpcTransport } from '@connectrpc/connect-node'` `:2`;
    `makeTransport` `:26-28`; `identityClient` constructed once at module load `:35`; all 10 clients `:31-40`.
  - Node refresh route: `src/app/api/auth/refresh/route.ts:5-19` (reads `refresh_token` cookie `:6`,
    `refreshSession` `:10`, `setSessionCookies` `:17`, `clearSessionCookies` on failure `:14`).
  - **Live browser refresh caller**: `src/lib/authRedirect.ts:38-48` — `attemptRefresh()` does
    `fetch('/api/auth/refresh', { method: 'POST' })` `:40` (browser transport interceptor + `apiFetch`).
  - Build config: `next.config.js:7` `output: 'standalone'`; `serverExternalPackages` `:8-14` lists
    `@connectrpc/connect-node` `:10` (route-handler externalization).
  - Dockerfile standalone: `Dockerfile:25` copies `.next/standalone`; `:31` `CMD node .../server.js`.
  - Unit test: `src/middleware.test.ts:11-13` asserts the matcher excludes `/api/auth/refresh`.

## Patterns to REUSE

- In-process refresh → reuse `refreshSession(refreshToken)` at `src/lib/identity.ts:11-24` (do **not**
  re-implement the identity RPC in middleware). This is the exact call the refresh route already makes.
- Read the refresh token → reuse the route's own pattern `req.cookies.get('refresh_token')?.value`
  (`src/app/api/auth/refresh/route.ts:6`).
- Set/clear cookies → reuse `setSessionCookies` / `clearSessionCookies` from `src/lib/auth.ts:62-91`
  (already Edge-and-Node-safe; no `@connectrpc/connect-node` in them). Call `setSessionCookies` with
  **no** `opts` to match the route's session-cookie behavior (`route.ts:17`).
- Redirect-to-login → reuse the existing `new URL('/auth/login', req.url)` + `redirect` param pattern
  already in middleware `:34-36` / `:45-47`.
- Node singleton gRPC client → reuse `identityClient` (`connectClients.ts:35`); transports are lazy
  (no connection until first RPC), so importing the module into middleware adds no eager I/O.

## Existing Business Rules (preserve / extend)

Durable suite: `services/xstockstrat-ui/acceptance/ui-auth-improvements.feature` (feature-153).
- **PRESERVE** `@AC-5` "An Unauthorized data call redirects the browser to login" — the browser's
  `/api/auth/refresh` recovery (authRedirect.ts:40) must keep working; it depends on the matcher
  exclusion (see Risk 2).
- **PRESERVE** `@AC-6` "The 401 redirect applies to every segment's browser client" — same dependency.
- **PRESERVE** `@AC-7` "The redirect does not loop on the login page itself".
- **PRESERVE** `@AC-2` / `@AC-3` (login cookie Max-Age semantics) — the in-process middleware refresh
  reuses `setSessionCookies` with no `maxAge`, i.e. session cookies, exactly as `route.ts:17` does today.
- No existing acceptance suite covers the middleware near-expiry refresh path itself (feature 128's own
  `acceptance.feature` is the first to assert it).

## Dependencies

- Proto/RPC: identity `RefreshToken` via `identityClient.refreshToken` (`identity.ts:15`) — **no proto change**.
- Migration: none.
- Config keys: none.
- Inter-service edges: xstockstrat-ui → xstockstrat-identity (gRPC `50058`) — pre-existing.
- New env vars / ports: none. No `docker-compose.yml` / `.do/app*.yaml` change required.

## Risks / Not-found

1. **LOAD-BEARING — Node middleware runtime under `output: 'standalone'`.** Next docs (Context7,
   `/vercel/next.js`) confirm the Node.js middleware runtime is **stable in 15.5.0** and that
   `export const config = { runtime: 'nodejs', matcher: [...] }` is the supported syntax; v16 renames
   Middleware→Proxy and defaults it to Node. Switching the target away from Edge removes the exact
   documented failure mode the ledger records (`Module not found: Can't resolve 'node:http'` from the
   Edge bundler, `docs/patterns/frontend-auth.md:35`). **Residual, undocumented:** whether
   `serverExternalPackages` externalization + the standalone `.nft.json` trace also cover the
   *Node-runtime middleware* chunk so `server.js` discovers `@connectrpc/connect-node` at runtime — the
   docs phrase `serverExternalPackages` for "Server Components or Route Handlers" only. This CANNOT be
   assumed from docs; it must be proven by a real `docker build` where `middleware.ts` transitively
   imports connect-node succeeds and the container performs an in-process refresh (feature `@AC-6`).
   Trap: `docs/roadmap/ledger/fails.md` 2026-07-29 `081-qa-capability` — "exercise the producer, not
   its advertised state." Treat `insights.md:777-780` as a hypothesis to disprove via build, not a given.
2. **FR-5 / AC-5 vs. feature-153 — removing the matcher exclusion is a REGRESSION.** FR-5 and `@AC-5`
   direct removal of the `api/auth/refresh` matcher exclusion, on the premise that "browsers never call
   it directly today" (FR-5; echoed by the stale comment `middleware.ts:14`). That premise is
   **false**: `authRedirect.ts:40` is a live browser caller. When it fires, the access token is
   expired/invalid (the BFF just returned Unauthenticated), so if `/api/auth/refresh` were matched,
   `getSessionFromRequest` returns null and middleware would redirect the refresh POST to `/auth/login`
   — breaking feature-153 `@AC-5`/`@AC-6` (C-16 regression). **Finding:** the exclusion must STAY; it
   now protects the browser caller, not a middleware self-call. This deviates from FR-5/AC-5 as written
   and needs operator sign-off + a product-spec correction.
3. **FR-3 "observably identical" is slightly inaccurate — in the new code's favor.** Today's
   middleware discards `refreshRes` (`middleware.ts:39-49`) and does **not** forward its `Set-Cookie`
   to the browser; the near-expiry rotation reaches identity but the browser keeps its old cookies. The
   new in-process design sets cookies on the `NextResponse` via `setSessionCookies` (feature `@AC-3`),
   so it is a strict improvement / latent-bug fix, not a byte-identical match. Worth flagging so the
   "only the transport changes" framing is not overclaimed.
4. **Fate of `/api/auth/refresh` route — KEEP.** FR-5 offers deletion "if fully redundant." It is
   **not** redundant: `authRedirect.ts:40` still calls it independently of middleware. Delete = break
   the browser silent-refresh flow. Decision: keep the route unchanged.
5. **Doc drift (FR-6 / AC-7).** `docs/patterns/frontend-auth.md:31-60` ("Edge-runtime trap", "Only
   `lib/auth.ts` may be imported from `middleware.ts`") and `services/xstockstrat-ui/CLAUDE.md`
   (Auth+BFF table row for `src/middleware.ts` = "Edge"; "Edge-runtime import trap" gotcha) encode the
   superseded constraint and must be corrected in-PR. `insights.md:777-780` is append-only (not edited);
   design records why it is superseded (FR-7).
6. **Per-invocation cost — low.** Clients are module-level singletons (`connectClients.ts:31-40`),
   transports lazy; the refresh RPC fires only inside the near-expiry window (same frequency as today's
   self-fetch). Cold-start pulls all 10 clients into the middleware bundle — negligible, no eager I/O.

## Recommended Scope

Advisory (input to grilling / /sdd-spec):
1. **Middleware → Node runtime + in-process refresh** (`src/middleware.ts`, `src/lib/auth.ts`): add
   `runtime: 'nodejs'` to `config`; in the near-expiry branch read the `refresh_token` cookie, call
   `refreshSession()`, on success `setSessionCookies` on the `NextResponse` and continue, on failure
   `clearSessionCookies` + redirect to `/auth/login`; drop the `buildInternalRefreshUrl` import + the
   `fetch()`. Remove `buildInternalRefreshUrl` from `auth.ts`. **Keep** the `api/auth/refresh` matcher
   exclusion (Risk 2). Unit tests: assert `config.runtime === 'nodejs'` (`@AC-1`); update the
   `middleware.test.ts:11` rationale text (exclusion now protects the browser caller).
2. **Prove the standalone build** (`@AC-6`, the feasibility gate): `docker compose build --no-cache
   xstockstrat-ui` with middleware transitively importing connect-node must succeed and the container
   must serve auth-guarded routes + perform an in-process refresh. A failure here blocks the feature
   (F-04 / P-03) — do not paper over it.
3. **Docs** (`@AC-7`): correct `docs/patterns/frontend-auth.md` + `services/xstockstrat-ui/CLAUDE.md`;
   run `/context-scrubber scan` per the CLAUDE.md teardown before the PR.
