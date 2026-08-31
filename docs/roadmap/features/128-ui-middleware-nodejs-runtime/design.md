# Design: ui-middleware-nodejs-runtime

**Created**: 2026-08-31
**Rounds**: 2 (full; termination: approved with two operator sign-offs pending — see Open Risks 1 & 2)
**Approved by**: pending orchestrator/operator gate @ 2026-08-31 (design-adversary raised no unresolved Floor breach)
**Grounded in**: recon.md

---

## Chosen Approach

Run `src/middleware.ts` in the **Node.js runtime** and perform the near-expiry refresh in-process.

- **Runtime opt-in.** Add `runtime: 'nodejs'` to the exported `config` alongside the existing
  `matcher` (`recon.md` → Codebase Map, `middleware.ts:11-22`). Next 15.5.0 made this stable and
  `^15.5.21` is pinned (`package.json:48`); no `experimental.*` flag is needed. Verified against Next
  docs via Context7 (`/vercel/next.js`): `config = { runtime: 'nodejs', matcher: [...] }` is the
  canonical form.
- **In-process refresh.** Replace the near-expiry branch (`middleware.ts:39-49`) so it reads the
  `refresh_token` cookie directly (mirroring `app/api/auth/refresh/route.ts:6`) and calls
  `refreshSession(refreshToken)` from `src/lib/identity.ts:11-24` — the same RPC the route makes —
  instead of `fetch(buildInternalRefreshUrl())`. On success, set the rotated cookies on the outgoing
  `NextResponse` via `setSessionCookies` (`auth.ts:62-86`, no `opts` ⇒ session cookies, matching
  `route.ts:17`) and continue the request with the trace-ID header injection intact. On failure
  (`refreshSession` returns `null`), `clearSessionCookies` (`auth.ts:88-91`) + redirect to
  `/auth/login?redirect=…` (reusing the existing pattern `middleware.ts:34-36`).
- **Remove the loopback workaround.** Delete `buildInternalRefreshUrl()` from `auth.ts:57-60` and its
  import + `fetch()` from `middleware.ts:7,40`.
- **KEEP the `api/auth/refresh` matcher exclusion** (`middleware.ts:20`). This is the one deliberate
  divergence from FR-5/AC-5: the exclusion no longer guards a middleware self-call but a **live browser
  caller** — `authRedirect.ts:40` (`fetch('/api/auth/refresh')`, feature-153). Removing it would let
  middleware redirect the browser's expired-token refresh POST to `/auth/login`, regressing the durable
  guarantees `@AC-5`/`@AC-6` (`services/xstockstrat-ui/acceptance/ui-auth-improvements.feature`). Its
  rationale comment is rewritten to describe the browser caller.
- **KEEP `app/api/auth/refresh/route.ts` unchanged.** Not redundant — `authRedirect.ts:40` calls it
  (recon Risk 4).
- **Docs corrected in-PR** (FR-6): `docs/patterns/frontend-auth.md:31-60` and
  `services/xstockstrat-ui/CLAUDE.md` (Auth+BFF table + "Edge-runtime import trap") stop stating the
  "Edge runtime / only `auth.ts` may be imported from `middleware.ts`" rule as current; both describe
  the Node.js-runtime middleware calling `refreshSession()` directly.

**Consumer surface (C-14):** internal/platform-only — no UI segment or Agent tool changes; the
trader/insights/config-ui/accounts segments behave identically. The design's own gate is the
**standalone build proof** (see Open Risk 1), which is where the feature's premise is validated.

**Feasibility verdict:** the Edge-bundling constraint is lifted **in principle** — moving off the Edge
target removes the documented `Module not found: node:http` failure (`frontend-auth.md:35`) — but is
**not provable from docs alone**. It is confirmed only when a real `docker build` under
`output: 'standalone'` (`next.config.js:7`), with `middleware.ts` transitively importing
`@connectrpc/connect-node`, succeeds and the container performs an in-process refresh (feature `@AC-6`).
This build is the feature's red-before-green gate, not a post-hoc check.

## Rejected Alternatives

- **Remove the `api/auth/refresh` matcher exclusion (literal FR-5/AC-5)** — rejected: `authRedirect.ts:40`
  is a live browser caller with an expired access token; middleware would redirect its refresh POST to
  login, regressing feature-153 `@AC-5`/`@AC-6` (C-16). Keeping the exclusion costs nothing observable.
- **Delete `app/api/auth/refresh/route.ts`** — rejected: same live browser caller; deletion breaks the
  browser silent-refresh/`apiFetch` recovery path.
- **Keep the loopback `fetch()`, just harden it further** — rejected: retains the avoidable network hop
  and the whole self-fetch bug class (the defect PR #925 patched); the feature exists to remove it.
- **Split a dedicated `identityClient`-only module to shrink the middleware bundle** — rejected as
  speculative (CLAUDE.md "How to Act" #2 / DRY): transports are lazy singletons, so the cost is a
  negligible cold-start import, not per-request work; a new module would duplicate `connectClients`.
- **Adopt the v16 Middleware→Proxy rename now** — rejected: explicitly out of scope; repo is on 15.5.21.

## Open Risks

- [ ] **1 — Standalone build feasibility (load-bearing).** `serverExternalPackages` +`.nft.json` trace
  covering the Node-runtime middleware chunk is undocumented; prove it with `docker compose build
  --no-cache xstockstrat-ui` (or `pnpm --filter xstockstrat-ui build`) + a running-container refresh —
  addressed at the build/verify step (`@AC-6`). If it fails, the feature is blocked (F-04/P-03), and
  `next.config.js`'s `serverExternalPackages` may need a middleware-aware adjustment or the feature is
  infeasible on this Next version. **Operator confirmation:** accept that this feature ships only if
  that build passes.
- [ ] **2 — FR-5/AC-5 deviation (needs sign-off).** Keeping the matcher exclusion contradicts FR-5 and
  `@AC-5`'s third clause as literally written. `@AC-*` IDs are append-only (C-15), so the fix is a
  product-spec/`acceptance.feature` correction by the spec owner (drop the "matcher no longer excludes
  api/auth/refresh" assertion; correct FR-5's "browsers never call it directly" premise). **Operator
  confirmation required** before /sdd-spec traces AC-5.
- [ ] **3 — FR-3 wording.** "Observably identical" is imprecise: the new code forwards the rotated
  `Set-Cookie` to the browser, which today's discarded-`refreshRes` path does not (recon Risk 3). This
  is a strict improvement; note it in the spec so it is not mistaken for a regression — addressed at the
  middleware step.

## Constitution Rules Touched

- **C-11** — honored: this is the design phase of the mandated `/sdd-story → /sdd-design → spec` chain
  for a UI-behavior change; recon ran in full.
- **C-14** — honored: consumer surface declared internal/platform-only with reason (no user-facing change).
- **C-15 / C-16** — honored: recon loaded the durable `ui-auth-improvements.feature` guarantees; the
  design **preserves** `@AC-2/@AC-3/@AC-5/@AC-6/@AC-7` by keeping the matcher exclusion and reusing
  `setSessionCookies` — the design-adversary's regression check found no C-16 break in the chosen
  approach (the break exists only in the rejected literal-FR-5 variant).
- **C-17** — honored: no UI markup/token change (middleware only).
- **F-04 / P-03** — honored: the standalone-build feasibility is treated as a VERIFY-not-assume gate;
  a build failure blocks the feature rather than being papered over (recon Risk 1; fails.md 2026-07-29
  `081-qa-capability`).
- **F-07** — honored: `ACCESS_TOKEN_REFRESH_THRESHOLD_SECONDS` and cookie attributes are unchanged; no
  new hardcoded config (the threshold already lives in `auth.ts:12`, out of scope to change).
- **F-11** — no unresolved Floor breach; approval is not blocked by a Floor item (the two open items are
  a build-gate and a Commandment-level spec correction, both surfaced, not waived).

## Business Rules Touched (C-16)

- PRESERVE `@AC-5` "An Unauthorized data call redirects the browser to login"
  (`services/xstockstrat-ui/acceptance/ui-auth-improvements.feature`) — not regressed by: keeping the
  `api/auth/refresh` matcher exclusion so the browser's `authRedirect.ts:40` refresh reaches the route.
- PRESERVE `@AC-6` "The 401 redirect applies to every segment's browser client" — same mechanism.
- PRESERVE `@AC-7` "The redirect does not loop on the login page itself" — untouched (browser-side).
- PRESERVE `@AC-2` / `@AC-3` (login cookie Max-Age semantics) — in-process refresh reuses
  `setSessionCookies` with no `maxAge` (session cookies), identical to `route.ts:17`.
- No CHANGE lines: the chosen approach preserves every existing guarantee. (The deviation in Open Risk 2
  is against feature 128's *own* FR-5/AC-5, not a durable promoted rule.)
