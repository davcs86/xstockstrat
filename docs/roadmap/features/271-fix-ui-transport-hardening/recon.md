# Recon: fix-ui-transport-hardening

**Created**: 2026-10-21
**From**: product-spec.md
**Affected services**: xstockstrat-ui

---

## Objective

Fix two defects in the `xstockstrat-ui` server side (debt-radar D-37 and D-38, SEV-3, Track C).
- **D-37.** The mTLS gRPC transport has no default deadline. An unresponsive backend, notably identity during the middleware's `refreshSession`, hangs the request.
- **D-38.** The middleware matcher excludes health paths only at the root. The eight segment health routes are therefore auth-gated, and unauthenticated probes get redirected to `/auth/login`.

The fix adds a bounded, per-call-overridable default deadline for unary calls (streams stay open). It also exempts the exact segment health paths from auth, and every other path stays gated.

## Codebase Map

- **`xstockstrat-ui`** (Next.js / TypeScript)
  - Entry point (request gate): `services/xstockstrat-ui/src/middleware.ts:14-23`.
    - `config.runtime = 'nodejs'` is at `:15`.
    - The matcher is `['/', '/((?!…).+)']`. The negative lookahead at `:22` includes `api/health|health`, anchored at the root.
  - Transport wrapper: `makeTransport` at `services/xstockstrat-ui/src/lib/connectClients.ts:48-74`.
    - It lazily builds `createGrpcTransport({ baseUrl, nodeOptions: { ca, cert, key, checkServerIdentity } })` at `:53`. No `defaultTimeoutMs` is set.
    - The `unary` wrapper (`:67-68`) and the `stream` wrapper (`:70-71`) forward `timeoutMs` unchanged.
    - The lazy build is load-bearing. The comment at `:45-47` explains why: `next build` has no `MTLS_*`.
  - Code to HTTP map: `connectClients.ts:140` maps `Code.DeadlineExceeded` to 504.
  - Refresh call: `services/xstockstrat-ui/src/lib/identity.ts:14` is `identityClient.refreshToken({ refreshToken })` with no `timeoutMs`. The `catch` at `:20-21` returns `null`.
  - Refresh-failed branches (already fail-closed):
    - Expired token: `middleware.ts:40` calls `refreshSession`. On `null`, `:59-63` set `redirect` to path+search, call `clearSessionCookies`, and redirect.
    - Near-expiry: `middleware.ts:76` does the same at `:77-81`.
    - The `?redirect=` param is already set at `:60` and `:79`, so the new AC-2 is existing behaviour (see EXTEND below).
  - In-function login special-case: `middleware.ts:32` (`/auth/login`, `/auth/oauth-login`).
  - Per-call timeouts already in place (these must keep overriding any default):
    - `src/lib/insightsBff.ts:58` (`30_000`)
    - `insightsBff.ts:103` and `:114` (`FUNDAMENTALS_TIMEOUT_MS`)
    - `src/lib/traderBff.ts:78` (`FUNDAMENTALS_TIMEOUT_MS`)
    - The constant is defined at `src/lib/bffShared.ts:55` (`FUNDAMENTALS_TIMEOUT_MS = 15_000`).
    - `forward()` (`bffShared.ts:65-74`) sets `callOpts.timeoutMs` only when `options.timeoutMs !== undefined` (`:74`). The transport is therefore the only place a default can live.
  - Streams that must stay open:
    - Server proxy: `traderBff.ts:85-91` (`async *streamAlerts` → `yield* notifyClient.streamAlerts(…, { headers, signal: ctx.signal })`).
    - Browser consumer: `src/components/trader/AlertStream.tsx:37`. It uses a browser connect-web client, not `connectClients.ts`.
    - Second server stream: `src/app/trader/api/ledger/export/route.ts:115` (`ledgerClient.exportEvents(request, { headers })`, no `timeoutMs`). It goes through the same `stream` wrapper, so the unary-only default must leave it unbounded too.
  - Health route handlers (all `export async function GET`):
    - `src/app/trader/health/route.ts:3`
    - `src/app/trader/api/health/route.ts:3`
    - `src/app/insights/health/route.ts:3`
    - `src/app/insights/api/health/route.ts:3`
    - `src/app/config-ui/health/route.ts:3`
    - `src/app/config-ui/api/health/route.ts:3`
    - `src/app/accounts/api/health/route.ts:3`
    - `src/app/accounts/api/agent-health/route.ts:6`, which takes `req: NextRequest`. **It checks the session itself** (`getSessionFromRequest(req)` → 401 JSON at `:7-8`). See Risks.
  - Last migration: n/a. The UI owns no migrations for this fix.
  - Config-read pattern: the `ui` namespace is read once via `GetConfig('ui')` in `insightsBff.ts`. There is no `WatchConfig` in the UI (`services/xstockstrat-ui/CLAUDE.md` § Config Keys Consumed).

## Patterns to REUSE

- **Default unary deadline.** Apply `timeoutMs ?? <DEFAULT>` inside the existing `unary` wrapper in `makeTransport` (`connectClients.ts:67-68`). Leave the `stream` wrapper (`:70-71`) untouched. This gives the unary-only default (FR-1, AC-5) and keeps per-call overrides (AC-6).
  - Not chosen: `createGrpcTransport`'s own `defaultTimeoutMs` would also apply to streams. This is unverified in the connect-node typings, so design should check it before relying on either reading.
- **Default value as a module constant.** Follow `FUNDAMENTALS_TIMEOUT_MS` at `bffShared.ts:55`. The proposal is no config key (product-spec Open Question 2).
- **Timeout to existing fail-closed path.** `refreshSession` already returns `null` on any throw (`identity.ts:20-21`), and both middleware sites redirect with cookies cleared. No middleware logic change is needed for D-37.
- **Timeout to HTTP status.** The existing `Code.DeadlineExceeded` → 504 mapping is at `connectClients.ts:140`.
- **Matcher edit.** Change the existing lookahead at `middleware.ts:22` in place. Keep every other alternative verbatim: `_next/*`, the PWA assets, `api/auth/login|api/auth/refresh`, `auth/login|auth/oauth-login`, `\\.well-known` and `api/oauth`.
- **Test harness:**
  - Vitest node-env `src/**/*.test.ts` (`pnpm run test:unit`, coverage scoped to `src/lib/**`). The closest model is `src/lib/__tests__/insightsBff.test.ts` (it mocks `forward()` opts and threads `timeoutMs`).
  - Transport-level e2e precedent: `e2e/mtls-transport.spec.ts`, using `http2.createSecureServer` and dev certs with no browser. This is the model for a never-responding listener (AC-1, AC-2, AC-6).
  - Auth e2e: `e2e/auth.spec.ts` (AC-3, AC-4).
  - Alert stream e2e: `e2e/trader/alert-stream.spec.ts` (AC-5).
  - Shared mocks: `e2e/mock-backend.ts`, wired through `playwright.config.ts`. `IDENTITY_ENDPOINT: '127.0.0.1:9091'` is at `:152` and `MTLS_*` at `:178-180`.

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-1 @FR-1 @feature-128` "The middleware runs on the Node.js runtime" (`services/xstockstrat-ui/acceptance/ui-middleware-nodejs-runtime.feature`): `config.runtime` stays `"nodejs"` and the matcher stays declared after the health-exclusion edit.
- **PRESERVE** `@AC-2 @FR-2 @feature-128` "A near-expiry access token is refreshed in-process, not via a self-fetch" (same file): `refreshSession()` stays in-process with the cookie value and makes no `/api/auth/refresh` fetch. The default deadline must not change this.
- **PRESERVE** `@AC-3 @FR-3 @feature-128` "Refreshed cookies keep the same attributes as before the change" (same file): cookie attributes are unchanged.
- **EXTEND** `@AC-4 @FR-4 @feature-128` "An expired or invalid session still redirects to login with cookies cleared" (same file): the new case is a refresh that fails with DEADLINE_EXCEEDED. It lands in the same branch: clear cookies, then redirect to `/auth/login`.
  - The digest asked whether the `?redirect=` param is already set. Recon confirmed it is, at `middleware.ts:60` and `:79`. So this is EXTEND, not CHANGE, and needs no sign-off.
- **PRESERVE** `@AC-5 @FR-5 @feature-128` "PR #925's loopback workaround is removed" (same file): the matcher still excludes `api/auth/refresh`. The health exclusion is added next to it.
- **PRESERVE** `@AC-6 @FR-1 @FR-7 @feature-128` "Node.js-runtime middleware imports connect-node-backed code and the standalone build succeeds" (same file): the standalone build stays free of Edge-bundling errors. The lazy transport build (`connectClients.ts:45-47`) must be kept.
- **PRESERVE** `@AC-5 @FR-5 @feature-153` "An Unauthorized data call redirects the browser to login" (`services/xstockstrat-ui/acceptance/ui-auth-improvements.feature`): a gRPC Unauthenticated still returns the browser to `/auth/login?redirect=<path>`. A timeout (504) must not be conflated with it.
- **PRESERVE** `@AC-7 @FR-5 @feature-153` "The redirect does not loop on the login page itself" (same file): `/auth/login` stays reachable, and the matcher edit must not gate it.
- **PRESERVE** `@AC-1 @FR-1 @feature-191` "BFF enforces a 30s gRPC deadline on ListOpportunities" (`services/xstockstrat-ui/acceptance/opportunities-latency-fix.feature`): the per-call 30s `timeoutMs` still overrides the transport default and is not shortened to the default.
- **PRESERVE** `@AC-1 @regression @feature-220` "A stalled fundamentals request resolves to the error state instead of loading forever" (`services/xstockstrat-ui/acceptance/fix-trader-position-fundamentals.feature`): the per-call `GetFundamentals` deadline (15s) still applies and still yields the deadline-exceeded error card.
- **PRESERVE** `@AC-6 @FR-5 @feature-021` "An unauthenticated request is rejected" (`services/xstockstrat-ui/acceptance/ledger-event-export.feature`): an unauthenticated `/trader/api/ledger/export` still gets a 401 or a login redirect and makes no `ExportEvents` call. The health exemption must not widen to it.
- **PRESERVE** `@AC-7 @FR-6 @feature-021` "A one-million-row export streams without buffering the full result set" (`docs/sdd/business-rules/platform.feature`): `ExportEvents` is a server stream through the UI transport (`ledger/export/route.ts:115`), so a default deadline on streams would cut it off.
- **PRESERVE** `@AC-1 @FR-1 @feature-165` "The app is installable and serves a standalone manifest" (`services/xstockstrat-ui/acceptance/pwa-notifications.feature`): `/manifest.webmanifest`, `sw.js` and `icon-*.png` stay public after the matcher change.
- **PRESERVE** `@AC-2 @FR-1 @FR-2 @feature-210` "A mutually-authenticated peer with a valid platform-issued identity is accepted" (`docs/sdd/business-rules/platform.feature`): the UI-to-backend mTLS channel and the honoured header trio are unchanged by a transport-level deadline.
- **PRESERVE** `@AC-5 @FR-5 @feature-210` "Header-propagation semantics are unchanged beneath mTLS" (same file): `x-user-id`, `x-access-scope` and `x-trace-id` are still propagated.
- **PRESERVE** `@AC-6 @FR-6 @FR-3 @feature-210` "A long-lived streaming RPC survives a certificate rotation" (same file): the default must be unary-only or opt-out so streams stay open (cf. the new AC-5 for `streamAlerts`). The ledger export server stream (`@AC-7 @feature-021`, above) is protected by the same rule.

Net-new coverage: no existing suite pins the segment health routes or the shape of the matcher's health exclusion. The new AC-3, AC-4 and FR-3 (exact paths only) do not conflict with any guarantee.

## Dependencies

- Proto/RPC: none.
- Migration: none.
- Config keys: none if the default is a code constant (proposed).
  - If design makes it a `ui.*` key, that is a new config surface: C-05 naming, config-team approval, the Fix Scope box flips, and new wiring is needed because the `ui` namespace has one-shot `GetConfig` only.
- Inter-service edges: unchanged. These are the existing UI → identity, analysis, ingest, trading, portfolio, notify and other gRPC calls through `connectClients.ts`; the deadline only bounds them.
- New env vars / ports: none.
  - Tests may need a second identity endpoint, a black-hole h2 listener on its own port, because `127.0.0.1:9091` (`playwright.config.ts:152`) is a shared mock.
  - Per `fails.md` (2026-08-05 trader-chart-panel), any new env var must be added to both `mock-backend.ts` and `playwright.config.ts` `webServer.env`.

## Risks / Not-found

- **`/accounts/api/agent-health` is not an anonymous probe.**
  - Its handler checks the session and returns 401 JSON when there is none (`agent-health/route.ts:7-8`). It probes the agent's OAuth discovery endpoint for a signed-in UI.
  - If it is excluded from the matcher, an unauthenticated request "reaches its handler" (FR-2 is satisfied literally) but returns 401, not 200.
  - Design must decide one of these: exclude it, and accept the 401 (AC-3 must then expect the handler's 401 rather than a 2xx); or drop it from FR-2's list (this changes the product-spec scope and needs sign-off).
  - The handler must not lose its own session check either way.
- **A global unary default shortens currently unbounded calls** (`fails.md` 2026-10-21, rule "enumerate every caller's request shape … make the change opt-in when the callers differ"). Unary BFF calls with no `timeoutMs` would newly be capped at the default (proposed 10s). Examples:
  - `configUiBff.ts:69` `runFundamentalsScan` (admin, potentially long)
  - `insightsBff.ts:42` `screenSymbols`
  - `insightsBff.ts:80` `triggerBackfill`
  - Design must enumerate the unary callers. There are 8 non-test `src` files importing `connectClients`, and recon did not enumerate them per call. Design then decides which ones need an explicit longer `timeoutMs`.
- **A deadline turns a hang into a fallback** (`insights.md` 2026-10-20 fix-agent-getconfig-deadline, rule "enumerate the fallbacks that open a security gate when the read fails").
  - For `refreshSession` the fallback is fail-closed: redirect and clear cookies.
  - Design must still check the `catch` fallbacks of other unary call sites, for example `identity.ts:28`, for any that permit something on failure.
- **F-07 tension.** "Never hardcode config values in source" sits against a code-constant deadline. The precedent `FUNDAMENTALS_TIMEOUT_MS` (`bffShared.ts:55`) is a code constant. Design should record why a transport deadline is a code constant and not config, or choose the key.
- **Prefix-match trap in the current matcher.** Because the lookahead is a prefix, `health` today also excludes `/healthcheck-x` and `api/health` excludes `/api/health-extra`. The new exclusion must be exact-path (end-anchored) per FR-3 and AC-4. Design should also decide whether to tighten the existing root `api/health|health` alternatives, which match no route (`src/app/api/` has no health route).
- **`defaultTimeoutMs` semantics are unverified.** Recon did not confirm in the connect-node typings whether `createGrpcTransport`'s `defaultTimeoutMs` applies to streams.
- **AC-5 harness gap.** The mock `streamAlerts` ends cleanly after yielding its fixtures (`e2e/mock-backend.ts:529-534`). AC-5 needs a held-open variant that outlives the default deadline and then emits. Per C-12, fixtures come from the inventory, and per `insights.md` the stateful mock must be request-scoped.
- **No existing fixtures.** There is no unit test for `connectClients.ts` or `middleware.ts`, and no "never-responding backend" e2e fixture.
- **Test-only branches.** Per `insights.md` (2026-08-05 upgrade-nextjs15), never add test-only branches to production `connectClients.ts`. The black-hole backend must live in the e2e harness.
- **No deploy health-check targets a UI path.**
  - Not found: `.do/app.yaml` and `.do/app.dev.yaml` have no `health_check`/`http_path`, and the `docker-compose.yml` `xstockstrat-ui` block has no `healthcheck:` of its own.
  - The probe consumers in the product spec are therefore external uptime monitors or future checks. No deploy spec change is needed.
- **Overlaps.**
  - 241-fix-config-audit-author-spoof mocks `@/lib/connectClients` at test level. A unary-wrapper change does not alter the mock shape.
  - Sibling 273-fix-agent-client-deadlines (debt-radar D-16): align the default-deadline value and approach if design picks a shared convention.
- Not searched: other default-timeout constant names in `src/lib`. Only `timeoutMs` and `defaultTimeoutMs` were grepped.

## Recommended Scope

These boundaries are advisory, not binding.
1. **D-37, transport default.**
   - Add the module constant and apply `timeoutMs ?? DEFAULT` in the `unary` wrapper of `makeTransport` only.
   - Add explicit longer `timeoutMs` for any unary caller design flags as legitimately long.
   - Paired vitest for `connectClients.ts`: the default is applied when `timeoutMs` is absent, the per-call value wins, and the stream wrapper passes `timeoutMs` through untouched.
2. **D-37, e2e.**
   - A black-hole h2 identity listener in the e2e harness on its own port. Expired-token navigation then redirects to `/auth/login?redirect=…` with cookies cleared within the default (AC-1, AC-2).
   - A per-call override test (AC-6).
   - A held-open `streamAlerts` variant (AC-5).
3. **D-38, matcher.**
   - Add end-anchored exact-path exclusions for the eight segment health routes, keeping all existing alternatives verbatim.
   - Resolve the `agent-health` 401 question.
   - e2e: no-cookie requests to each health path reach the handler, and lookalike paths (`/trader/healthx`, `/trader/health/x`, `/trader/api/health-extra`) stay gated (AC-3, AC-4).

Design depth: quick suffices. The design debate should settle the default value, constant vs key, the agent-health handling and the long-caller enumeration.
