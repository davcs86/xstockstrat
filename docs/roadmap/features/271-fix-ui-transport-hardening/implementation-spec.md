# Implementation Spec: fix-ui-transport-hardening

**Status**: `pending`
**Created**: 2026-10-22
**Feature**: `docs/roadmap/features/271-fix-ui-transport-hardening/feature.md`
**Total Steps**: 10
**Feature Branch**: `feature/fix-ui-transport-hardening`

---

## Execution Summary

The work follows design.md § Chosen Approach (approved 2026-10-22, operator Option 2 on agent-health). It runs D-37 first, then D-38.
- D-37 builds out from the transport: the leaf `deadlines.ts` and the unary default (Steps 1–3), then the 10s refresh bound (Steps 4–5), then the `forwardAdmin` option and the six long calls (Steps 6–7).
- D-38 is the exact-path health exemption plus deleting the dead matcher prefixes (Steps 8–9).
- Step 10 updates the UI context docs and runs the teardown audit.

Each `service` step is followed by its paired `test` step. That test step holds the vitest RED assertion plus the real-socket or e2e proof for the same behavior, so `/sdd-execute` can run each pair as a single red→green cycle.

Single service (`xstockstrat-ui`). No proto, migration, config-key, env-var, port or deploy-file change. No new outbound gRPC call is added, so header propagation is unchanged: `backendHeaders` (`src/lib/bffShared.ts:38-44`) still forwards `x-trace-id`. That satisfies the operator's 2026-10-21 x-trace-id decision.

**Consumer surfaces (C-14).** Both surfaces named in product-spec § Consumer Surface(s) are reached:
- **Probes / uptime monitors**: Step 8 (middleware), proven in Step 9 (e2e on the real handlers).
- **Signed-in users of every segment**: Step 4 (refresh bound), proven in Step 5 (e2e expired-token navigation).

There are no UI page or route additions, so C-10(a) nav registration does not apply.

### Scenario Coverage (C-15)

| Scenario | Covered by |
|---|---|
| `@AC-1` default deadline bounds an un-timed unary call (30s) | Step 2 (vitest + real-socket black-hole spec) |
| `@AC-2` middleware refresh does not hang (10s) | Step 5 (vitest + e2e stalled-refresh) |
| `@AC-3` segment health routes reachable without a session (agent-health → 401) | Step 9 (middleware vitest + e2e) |
| `@AC-4` non-health / lookalike routes still gated | Step 9 (middleware vitest + e2e) |
| `@AC-5` alert stream not cut off by the unary default | Step 2 (vitest: stream wrapper unchanged) + Step 3 (e2e held-open stream) |
| `@AC-6` per-call timeout overrides the default | Step 2 (vitest + real-socket 2s case) + Step 7 (BFF registrations keep their per-call values) |

### Spec-time gates resolved here (design.md items 7 and 11, Open Risks)

- **p99 latency gate (design item 7) — telemetry unavailable.**
  - No Grafana Cloud query tool is attached to this `/sdd-spec` session, so no staging or production p99 was obtained.
  - It is missing for every row marked provisional: evaluateReadiness, getWatchlistReadiness, getStrategyAnalytics, getIndicatorSeries, queryPnLPatterns, getAttribution, getHistoricalFundamentals, getBars, queryEvents, executeFormula, computeIndicator, placeOrder, replaceOrder, cancelOrder and confirmOrder. The identity `RefreshToken` p99 is missing too.
  - The rows stay class D (30s default).
  - The r2 synthesis that the operator approved at the design gate says: "If telemetry is unavailable, record that in context.md and treat the risk as accepted by the operator before implementation-ready" (context.md, the round-2 design-state block).
  - This spec records the absence and applies that approved clause. It is flagged in context.md § Open Threads for the operator to veto at `/sdd-review impl-spec` or the first `/sdd-execute` confirmation.
- **Matcher prefixes `api/health|health` (design item 11) — deleted.**
  - The durable suites were re-read for this check: `services/xstockstrat-ui/acceptance/ui-middleware-nodejs-runtime.feature` (`@feature-128`) and `acceptance/pwa-notifications.feature` (`@feature-165`). Neither references a health path. The only health-related matcher line is `:47`, the `api/auth/refresh` exclusion, which stays.
  - The only pin on the dead prefix is an **untagged** unit assertion, `src/middleware.test.ts:58-62` (`expect(matches('/api/health')).toBe(false)`). recon.md said no `middleware.ts` unit test exists; that was a recon miss, and this file does exist.
  - Step 9 rewrites that assertion. It pins no durable AC, so no C-16 CHANGE is involved.
- **`/accounts/api/agent-health` (Option 2).**
  - It goes in the Set (Step 8).
  - Its handler keeps its own session check (`src/app/accounts/api/agent-health/route.ts:7-8`, which this spec leaves untouched).
  - AC-3's row expects 401 (Step 9).
  - The accepted risk: the bare `fetch('/accounts/api/agent-health')` at `src/app/accounts/authorized-apps/page.tsx:59` loses the middleware's silent refresh on that path.
- **504 after server-side work completes (Open Risk).**
  - No new error copy is added (C-18 YAGNI).
  - A `Code.DeadlineExceeded` is mapped to 504 by the existing `connectCodeToHttp` (`src/lib/connectClients.ts:140-141`) and surfaces through each caller's existing error state. That is pre-existing behavior for every backend error, and this feature only makes the condition reachable sooner.
  - The 300s long class (Step 6) keeps the long, destructive calls from tripping it.
- **Sibling 273 (`fix-agent-client-deadlines`).**
  - It is still `spec-ready` (`origin/feature/fix-agent-client-deadlines`), so it has chosen no value yet.
  - 271's values are a 30s unary default and a 10s refresh, for a browser-to-BFF-to-backend hop.
  - If 273 picks differently, 273 records why; 271 is not changed to match.

## Step Dependencies

- Step 2 [test] covers Step 1 [service]. Write it first and capture RED: the unary call forwards `timeoutMs === undefined`, and the black-hole call hangs past the test timeout.
- Step 3 [test] covers Step 1 [service] as a **preservation guard**. The pre-fix tree has no deadline at all, so AC-5 is already green. Its RED is a mutation check: temporarily forward `timeoutMs ?? DEFAULT_UNARY_TIMEOUT_MS` in the **stream** wrapper too, confirm the spec fails, then revert. Record "red via mutation — preservation guard" per `.claude/skills/sdd-execute/reference/tdd-gate.md` § Interaction (the allowed escape, stated explicitly).
- Step 4 requires Step 1, which creates `REFRESH_TIMEOUT_MS` in `src/lib/deadlines.ts`. Step 5 [test] covers Step 4 [service].
- Step 6 requires Step 1, which creates `LONG_RPC_TIMEOUT_MS` and moves `FUNDAMENTALS_TIMEOUT_MS`. Step 7 [test] covers Step 6 [service].
- Step 9 [test] covers Step 8 [service]. Step 8 is independent of Steps 1–7, but runs after them to keep `src/middleware.ts` → `src/lib/identity.ts` changes in order.
- Step 10 [docs] requires Steps 1–9, because it documents the landed behavior.
- In Step 2, `AC-6`'s real-socket case is a preservation guard too: per-call `timeoutMs` already works before the fix. Only its AC-1 half is red-before-green.

---

### Step 1 — service: Leaf `deadlines.ts` + unary transport default

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/deadlines.ts` — create
- `services/xstockstrat-ui/src/lib/connectClients.ts` — modify
- `services/xstockstrat-ui/src/lib/bffShared.ts` — modify
- `services/xstockstrat-ui/src/lib/insightsBff.ts` — modify
- `services/xstockstrat-ui/src/lib/traderBff.ts` — modify

**Reviewers**: `xstockstrat-ui` owner — Connect-RPC call safety, trading UI correctness, environment scope correctness

**Codebase Evidence**:
- `src/lib/connectClients.ts:48-74` `makeTransport`:
  - The lazy `get()` is at `:50-65`. Its load-bearing comment at `:45-47` explains that `next build` has no `MTLS_*`.
  - The `unary` wrapper is at `:67-69`; its return statement is `:68`: `return get().unary(method, signal, timeoutMs, header, input, contextValues);`.
  - The `stream` wrapper is at `:70-72` and forwards `timeoutMs` unchanged.
- `connectClients.ts:1-13` imports only packages and `node:tls`, with no `@/` alias. The Step 2 real-socket spec imports this module from Playwright, so the new import must be relative.
- `src/lib/bffShared.ts:53-55`: `export const FUNDAMENTALS_TIMEOUT_MS = 15_000;`, with its feature-220 comment at `:53-54`.
- Importers of `FUNDAMENTALS_TIMEOUT_MS` (`grep -rn FUNDAMENTALS_TIMEOUT_MS src e2e`):
  - `src/lib/insightsBff.ts:27` (import), used at `:103` and `:114`
  - `src/lib/traderBff.ts:24` (import), used at `:78`
  - There are no other importers.
- `grep -rn "defaultTimeoutMs" src` finds nothing. recon.md Codebase Map confirms no default is set today.
- Rejected (design.md § Rejected Alternatives): `createGrpcTransport({ defaultTimeoutMs })`.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Create `src/lib/deadlines.ts`. It has **no imports**; that is a leaf-module constraint. Keep this ≤2-line constraint comment: `// Leaf module (no imports): connectClients.ts imports it, and must not import bffShared.ts (cycle).` It exports:
   - `export const DEFAULT_UNARY_TIMEOUT_MS = 30_000;`
   - `export const REFRESH_TIMEOUT_MS = 10_000;`
   - `export const LONG_RPC_TIMEOUT_MS = 300_000;`
   - `export const ORDER_MUTATION_TIMEOUT_MS = 60_000;` (operator 2026-10-22: order mutations are exempt from the 30s default).
   - `export const FUNDAMENTALS_TIMEOUT_MS = 15_000;`, carrying over the existing feature-220 constraint comment from `bffShared.ts:53-54` verbatim.
2. In `bffShared.ts`, delete `:53-55`, which is the constant and its comment. Add no re-export.
3. In `insightsBff.ts`, remove `FUNDAMENTALS_TIMEOUT_MS` from the `@/lib/bffShared` import (`:27`) and add `import { FUNDAMENTALS_TIMEOUT_MS } from '@/lib/deadlines';`. Do the same in `traderBff.ts` (`:24`). Leave the call sites at `insightsBff.ts:103`, `:114` and `traderBff.ts:78` unchanged.
4. In `connectClients.ts`, add `import { DEFAULT_UNARY_TIMEOUT_MS } from './deadlines';` after the package imports. It must be relative, not `@/lib/deadlines`, because the Step 2 Playwright spec imports this module outside Next's alias resolution.
5. Change only the `unary` body (`:68`) to `return get().unary(method, signal, timeoutMs ?? DEFAULT_UNARY_TIMEOUT_MS, header, input, contextValues);`.
   - Leave the `stream` wrapper (`:70-72`) **byte-for-byte unchanged**. That keeps `streamAlerts`, `streamOrderUpdates` and `exportEvents` unbounded.
   - Leave the lazy `get()` (`:50-65`) unchanged.
6. Leave the literal `timeoutMs: 30_000` at `insightsBff.ts:58` (`@AC-1 @feature-191`) as written.

**Verification**:
```bash
cd services/xstockstrat-ui && grep -n "timeoutMs ?? DEFAULT_UNARY_TIMEOUT_MS" src/lib/connectClients.ts \
  && grep -c "DEFAULT_UNARY_TIMEOUT_MS" src/lib/connectClients.ts \
  && ! grep -n "FUNDAMENTALS_TIMEOUT_MS = " src/lib/bffShared.ts \
  && ! grep -n "^import" src/lib/deadlines.ts \
  && pnpm run lint && pnpm run format:check && pnpm run build
```
- The `grep -c` count must be 2 (the import and the unary use).
- The `stream(` body must show no diff: check with `git diff -U0 src/lib/connectClients.ts`.
- `pnpm run build` re-proves the standalone build stays green (`@AC-6 @feature-128`).

---

### Step 2 — test: Unary default + per-call override (vitest + real-socket black hole)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/connectClients.test.ts` — create
- `services/xstockstrat-ui/e2e/transport-deadline.spec.ts` — create

**Reviewers**: `xstockstrat-ui` owner — Connect-RPC call safety, trading UI correctness, environment scope correctness

**Codebase Evidence**:
- Vitest config (`vitest.config.ts`):
  - Node env, `include: ['src/**/*.test.ts']`, with the `@` alias at `resolve.alias`.
  - `connectClients.ts` is excluded from **coverage** only (`exclude: [... 'src/lib/connectClients.ts' ...]`), so its test still runs.
- `connectClients.ts:30-38`: `loadMtls` throws unless `MTLS_CERT`, `MTLS_KEY` and `MTLS_CA_CERT` are non-empty. `:53` is the `createGrpcTransport` call from `@connectrpc/connect-node` (`:3`).
- Real-socket precedent: `e2e/mtls-transport.spec.ts`. It stands up `http2.createSecureServer(tlsOptions(), …)` on `listen(0, '127.0.0.1')`, tracks server sessions and destroys them in `afterAll`. It uses `tlsOptions` from `e2e/mock-backend.ts:141` and `devCerts()` (`e2e/helpers/devCerts.ts:91`, fields `ca`/`uiCert`/`uiKey` at `:30-32`). `xstockstrat-config` is a served SAN (`devCerts.ts:23`).
- `ConfigService.GetConfig` is unary (`packages/proto/config/v1/config.proto:23`, request fields at `:103-107`). `configClient` is pinned to `'xstockstrat-config'` (`connectClients.ts:101-104`), and `CONFIG_ENDPOINT` is read at module load (`:22`).
- No new env var or port: the black hole listens on an ephemeral port inside the spec process, so `playwright.config.ts` `webServer.env` needs no new entry (the fails.md 2026-08-05 trap does not apply). design.md § Files: "`playwright.config.ts`, if a new env var is added".
- C-12: there are no domain objects; `devCerts()` and `tlsOptions()` are the shared harness helpers. The GetConfig request `{ namespace: 'ui' }` is a scenario one-off.

**TDD**: `red-green required`

**Covers**: `AC-1, AC-6, AC-5`

**Instructions**:
1. `src/lib/connectClients.test.ts`:
   - `vi.mock('@connectrpc/connect-node', () => ({ createGrpcTransport: vi.fn(() => fakeTransport) }))`, where `fakeTransport.unary = vi.fn(async () => ({ stream: false, header: new Headers(), trailer: new Headers(), message: {} }))` and `fakeTransport.stream = vi.fn(async () => ({ stream: true, header: new Headers(), trailer: new Headers(), message: (async function* () {})() }))`.
   - Set `process.env.MTLS_CERT`, `MTLS_KEY` and `MTLS_CA_CERT` to non-empty strings **before** a dynamic `await import('@/lib/connectClients')`.
   - Import `DEFAULT_UNARY_TIMEOUT_MS` from `@/lib/deadlines`.
   - Cases:
     - (a) **AC-6 @feature-128 lazy build preserved**: `createGrpcTransport` is not called at import, and is called on the first RPC.
     - (b) **AC-1**: `await identityClient.revokeToken({ token: 't' })`. The `unary` spy's third argument (`timeoutMs`) is `DEFAULT_UNARY_TIMEOUT_MS`. RED on the pre-fix tree: `undefined`.
     - (c) **AC-6**: `await configClient.getConfig({ namespace: 'ui' }, { timeoutMs: 2000 })` forwards `2000`.
     - (d) **AC-5**: iterate `notifyClient.streamAlerts({})` to completion. The `stream` spy's third argument is `undefined`, so the stream gets no default.
   - Add no test-only branch to production code (insights.md, the 2026-08-05 upgrade-nextjs15 entry).
2. `e2e/transport-deadline.spec.ts`, under the Playwright runner like `mtls-transport.spec.ts`; no browser is needed:
   - `beforeAll`: start `http2.createSecureServer(tlsOptions(), () => {})`. The handler never responds, which makes it a black hole.
     - Track sessions as `mtls-transport.spec.ts` does.
     - `listen(0, '127.0.0.1')`.
     - Set `process.env.MTLS_CERT = devCerts().uiCert`, `MTLS_KEY = uiKey`, `MTLS_CA_CERT = ca`, and `CONFIG_ENDPOINT = 127.0.0.1:<port>`.
     - Then `({ configClient } = await import('../src/lib/connectClients'))`.
   - `afterAll`: destroy the sessions and close the server, using the same teardown as `mtls-transport.spec.ts:44-53`.
   - **AC-1**:
     - `test.setTimeout(DEFAULT_UNARY_TIMEOUT_MS + 30_000)`.
     - `configClient.getConfig({ namespace: 'ui' })` with no options rejects with a `ConnectError` whose `code === Code.DeadlineExceeded`.
     - Elapsed must be ≥ `DEFAULT_UNARY_TIMEOUT_MS - 1_000` and ≤ `DEFAULT_UNARY_TIMEOUT_MS + 5_000`.
     - RED pre-fix: it hangs until the test timeout.
   - **AC-6**: with `{ timeoutMs: 2000 }`, it rejects with `DeadlineExceeded` and elapsed ≤ 5_000.
   - Import `DEFAULT_UNARY_TIMEOUT_MS` from `../src/lib/deadlines`. Precedent for e2e importing `src`: `e2e/mock-backend.ts:32-33`.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm exec vitest run src/lib/connectClients.test.ts \
  && pnpm exec playwright test e2e/transport-deadline.spec.ts \
  && pnpm run test:coverage && pnpm run lint
grep -n "helpers/devCerts\|from './mock-backend'" e2e/transport-deadline.spec.ts
```
- Coverage thresholds: lines, functions and statements ≥ 40% over `src/lib/**` (`vitest.config.ts` `thresholds`).
- Confirm all 4 vitest cases and both Playwright cases executed (not skipped).
- Vitest (a), (c), (d) and the Playwright AC-6 case are preservation guards (green pre-fix). Record their RED in context.md as "red via mutation — preservation guard" (C-08/P-06): e.g. drop the per-call `timeoutMs` forward for (c)/AC-6, and apply the default in the `stream` wrapper for (d). Revert each mutation.

---

### Step 3 — test: Held-open alert stream outlives the unary default (e2e)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/fixtures/alerts.ts` — modify
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify
- `services/xstockstrat-ui/e2e/trader/alert-stream.spec.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify

**Reviewers**: `xstockstrat-ui` owner — Connect-RPC call safety, trading UI correctness, environment scope correctness

**Codebase Evidence**:
- Mock stream at `e2e/mock-backend.ts:530-535`: `async *streamAlerts()` yields `ALERT_STREAM_ALL` and then ends ("Stream ends cleanly — no hang in tests."). That default path must keep ending cleanly.
- How the sentinel reaches the mock on the server-stream path (verified in code):
  1. `middleware.ts:29` keeps an inbound `x-trace-id`, and `:100-104` forwards it on the request headers.
  2. `createDispatch` passes `req.headers` as the handler header (`bffShared.ts:126-131`).
  3. `traderBff.ts:85-90` calls `notifyClient.streamAlerts(..., { headers: backendHeaders(claims, ctx), signal: ctx.signal })`.
  4. `backendHeaders` sets `HEADER_TRACE_ID` from `ctx.requestHeader` (`bffShared.ts:42`).
  5. No `src` code sets `x-trace-id` client-side: `grep -rn "x-trace-id\|HEADER_TRACE_ID" src` lists only middleware, the BFF and server routes.
- Fallback: if execution shows the header does not arrive, use `StreamAlertsRequest.categories` (`packages/proto/notify/v1/notify.proto:84`). It is spread through at `traderBff.ts:88`. Record that as a Deviation.
- Fixture home:
  - `e2e/fixtures/alerts.ts:9-33` defines `ALERT_STREAM_001` (keys `alertId`, `severity`, `category`, `title`, `body`, `sourceService`) through `ALERT_STREAM_ALL`.
  - Its INVENTORY row is `e2e/fixtures/INVENTORY.md:43`.
  - Sentinel precedent: `FUNDAMENTALS_STALL_SYMBOL` (`e2e/fixtures/fundamentals.ts:32-34`, INVENTORY `:19`), whose stall is abort-aware (`mock-backend.ts:643-650`).
- `'Order rejected'` is both a stream title and a list title (`alerts.ts:21`, `:48`), so it cannot prove stream delivery. The held alert needs a distinct title.
- Existing spec pattern: `e2e/trader/alert-stream.spec.ts:41-50` ("opening the sheet shows at least one alert title"). It opens the sheet by clicking the parent of the unread badge (`/^2$/`), then asserts the alert text.
- Request-scoped stateful mock rule (insights.md): keying on a per-test trace id keeps parallel specs unaffected.

**TDD**: `red-green required` (preservation guard: RED via the mutation check in § Step Dependencies)

**Covers**: `AC-5`

**Instructions**:
1. In `alerts.ts`, add and export:
   - `ALERT_STREAM_HOLD_TRACE_ID = 'trace-alert-stream-hold'`.
   - `ALERT_STREAM_HOLD_MS = DEFAULT_UNARY_TIMEOUT_MS + 5_000`, importing from `'../../src/lib/deadlines'`.
   - `ALERT_STREAM_HELD = { ...ALERT_STREAM_001, alertId: 'alert-stream-held', title: 'Held stream alert' }`.

   The mock and the spec are two consumers, so these belong in the fixture (C-12).
2. In `mock-backend.ts`, change the handler to `async *streamAlerts(_req, ctx)`:
   - If `ctx.requestHeader.get(HEADER_TRACE_ID) === ALERT_STREAM_HOLD_TRACE_ID`:
     - Wait `ALERT_STREAM_HOLD_MS`. If `ctx.signal` aborts first, return early.
     - Then `yield ALERT_STREAM_HELD as Alert` and return.
   - Otherwise keep the existing loop unchanged.
   - Import `HEADER_TRACE_ID` alongside the existing `../src/lib/headers` import (`:32`).
3. In `alert-stream.spec.ts`, add a test, "the alert stream survives past the unary default deadline (feature 271 @AC-5)":
   - `test.setTimeout(ALERT_STREAM_HOLD_MS + 45_000)`.
   - `await page.setExtraHTTPHeaders({ 'x-trace-id': ALERT_STREAM_HOLD_TRACE_ID })`, then `addAuthCookie(page)`, then `page.goto('/trader')`.
   - Record `t0`, then open the sheet the same way as `:44-47`.
   - `await expect(page.getByText('Held stream alert')).toBeVisible({ timeout: ALERT_STREAM_HOLD_MS + 15_000 })`.
   - Assert `Date.now() - t0 >= DEFAULT_UNARY_TIMEOUT_MS`.
4. In `INVENTORY.md`, append `ALERT_STREAM_HELD`, `ALERT_STREAM_HOLD_TRACE_ID` and `ALERT_STREAM_HOLD_MS` to the Alerts row (`:43`). Add the `streamAlerts` hold branch to its consumer list.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm exec playwright test e2e/trader/alert-stream.spec.ts && pnpm run lint
grep -n "from '../fixtures'\|helpers/auth" e2e/trader/alert-stream.spec.ts
grep -n "ALERT_STREAM_HOLD_TRACE_ID" e2e/fixtures/INVENTORY.md e2e/mock-backend.ts
```
- The existing alert-stream tests must still pass, which proves the default stream still ends cleanly.
- Record the mutation-check RED in context.md: apply the default in the `stream` wrapper and confirm this test fails, then revert.

---

### Step 4 — service: 10s bound on `refreshSession`

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/identity.ts` — modify

**Reviewers**: `xstockstrat-ui` owner — Connect-RPC call safety, trading UI correctness, environment scope correctness

**Codebase Evidence**:
- `src/lib/identity.ts:14`: `const data: AuthTokenResponse = await identityClient.refreshToken({ refreshToken });`. There is no `timeoutMs`.
- `identity.ts:20-21`: the `catch` returns `null` on any throw, which is fail-closed.
- `identity.ts:27`: `revokeToken` stays on the 30s default (design table row).
- The three `refreshSession` callers all fail closed on `null`:
  - `src/middleware.ts:40`, whose expired-token branch at `:58-63` clears cookies and redirects with `?redirect=`.
  - `middleware.ts:76`, whose near-expiry branch is at `:77-82`.
  - `src/app/api/auth/refresh/route.ts:10`, which returns 401 and clears cookies at `:11-14`.
- Accepted risk (design Open Risks): identity's single-use rotation (`services/xstockstrat-identity/src/grpc/identityServiceImpl.ts:230-241`, `rotateRefreshToken` at `:236`) can commit after the 10s client deadline. The result is a fail-closed forced logout. The identity `RefreshToken` p99 is unavailable (§ Spec-time gates).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add `import { REFRESH_TIMEOUT_MS } from '@/lib/deadlines';`. `identity.ts` already uses the `@/` alias at `:6-8`.
2. Change `:14` to `await identityClient.refreshToken({ refreshToken }, { timeoutMs: REFRESH_TIMEOUT_MS });`.
3. Leave the `catch` and `revokeToken` unchanged, and leave `middleware.ts` and the refresh route untouched; no logic change is needed for D-37.
4. Add no inbound headers. The identity calls carry none today. That predates this feature and is outside D-37/D-38 scope (design.md § Header propagation).

**Verification**:
```bash
cd services/xstockstrat-ui && grep -n "timeoutMs: REFRESH_TIMEOUT_MS" src/lib/identity.ts && pnpm run lint && pnpm run format:check
```

---

### Step 5 — test: Refresh deadline fails closed (vitest + e2e stalled identity)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/identity.test.ts` — create
- `services/xstockstrat-ui/e2e/helpers/auth.ts` — modify
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify
- `services/xstockstrat-ui/e2e/auth.spec.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify

**Reviewers**: `xstockstrat-ui` owner — Connect-RPC call safety, trading UI correctness, environment scope correctness

**Codebase Evidence**:
- Mock pattern for `@/lib/connectClients`: `src/lib/insightsBff.test.ts:9-18` (`vi.mock('@/lib/connectClients', () => ({ … }))`).
- The identity mock's `refreshToken()` is at `e2e/mock-backend.ts:191-196` (`:184-190` is `authenticateUser`). It takes no args today and always returns `refreshToken: 'test-refresh-token'`. `ConnectError` and `Code` are already imported (`:16`).
- The abort-aware stall precedent is `getFundamentals` at `:662-668` (`FUNDAMENTALS_STALL_SYMBOL`: wait for `ctx.signal` abort, then `ConnectError` `Code.Canceled`).
- `e2e/helpers/auth.ts`:
  - It is the canonical home for test JWT signing (`:14-17`: "specs must not re-implement SignJWT").
  - `signTestJwt` (`:29-44`) always signs `expires_at: now + 3600`.
  - `mock-backend.ts:38` already imports `signTestJwt` from it.
- `e2e/auth.spec.ts:70-89` is the existing `POST /api/auth/refresh` pattern: `request.post(..., { headers: { cookie: 'refresh_token=…' } })`, with Set-Cookie inspection via `headersArray()`.
- Redirect assertion pattern: the loop at `auth.spec.ts:183-195` (`page.request.get(path, { maxRedirects: 0 })` at `:190`, status in `[302, 307]`, `location` contains `/auth/login`).
- `middleware.ts:60`: `redirect` = `pathname + search`, so `/trader` → `redirect=%2Ftrader`. The cookie-clear shape is `Max-Age=0` (`src/middleware.test.ts:171-172`).
- `IDENTITY_ENDPOINT: '127.0.0.1:9091'` is the shared mock (`playwright.config.ts:152`). A sentinel token keeps the stall request-scoped, so no new env var or port is needed.
- Sentinel table: `e2e/fixtures/INVENTORY.md:53` (§ Recurring sentinel ids), table header at `:58`.

**TDD**: `red-green required`

**Covers**: `AC-2`

**Instructions**:
1. `src/lib/identity.test.ts`:
   - `vi.mock('@/lib/connectClients', () => ({ identityClient: { refreshToken, revokeToken } }))`, with `vi.fn` spies.
   - Case (a): `refreshSession('rt')` calls `refreshToken` with `({ refreshToken: 'rt' }, { timeoutMs: REFRESH_TIMEOUT_MS })`. RED pre-fix: called with one argument.
   - Case (b): when `refreshToken` rejects with `new ConnectError('deadline', Code.DeadlineExceeded)`, `refreshSession` resolves `null`. That is the fail-closed EXTEND of `@AC-4 @feature-128`.
2. `e2e/helpers/auth.ts`:
   - Export `REFRESH_STALL_TOKEN = 'refresh-stall-token'`.
   - Export `signExpiredTestJwt()`. It mirrors `signTestJwt` with `issued_at: now - 1800`, `expires_at: now - 900` and `setExpirationTime(now - 900)`, and stays in this canonical SignJWT home.
3. `mock-backend.ts` `refreshToken(req, ctx)`:
   - If `req.refreshToken === REFRESH_STALL_TOKEN`, wait for `ctx.signal` abort and then `throw new ConnectError('aborted by caller', Code.Canceled)`. This mirrors `:662-668`.
   - Otherwise return the existing response unchanged.
   - Import `REFRESH_STALL_TOKEN` from `./helpers/auth`.
4. `e2e/auth.spec.ts`: new describe, "Session refresh against a stalled identity (feature 271 @AC-2)". Import `REFRESH_TIMEOUT_MS` from `../src/lib/deadlines` and use `test.setTimeout(REFRESH_TIMEOUT_MS + 20_000)`.
   - (a) `page.request.get('/trader', { maxRedirects: 0, timeout: REFRESH_TIMEOUT_MS + 15_000, headers: { cookie: `access_token=${await signExpiredTestJwt()}; refresh_token=${REFRESH_STALL_TOKEN}` } })`:
     - The status is in `[302, 307]`.
     - `location` contains `/auth/login?redirect=%2Ftrader`.
     - Set-Cookie carries `access_token=` and `refresh_token=` with `Max-Age=0`.
     - Elapsed ≤ `REFRESH_TIMEOUT_MS + 5_000`.
     - RED pre-fix: the request times out.
   - (b) `request.post('/api/auth/refresh', { headers: { cookie: `refresh_token=${REFRESH_STALL_TOKEN}` } })`: status 401, both cookies cleared, and the same elapsed bound.
5. `INVENTORY.md`: add a sentinel row: `REFRESH_STALL_TOKEN` | the identity `RefreshToken` mock never answers until the caller's deadline aborts (feature 271) | `e2e/helpers/auth.ts`, `e2e/mock-backend.ts`, `e2e/auth.spec.ts`. Also note `signExpiredTestJwt` next to the auth helpers.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm exec vitest run src/lib/identity.test.ts \
  && pnpm exec playwright test e2e/auth.spec.ts \
  && pnpm run test:coverage && pnpm run lint
grep -n "helpers/auth" e2e/auth.spec.ts e2e/mock-backend.ts
grep -n "REFRESH_STALL_TOKEN" e2e/fixtures/INVENTORY.md
```
- Coverage ≥ 40% over `src/lib/**`.
- Every pre-existing `auth.spec.ts` test must still pass; they use `test-refresh-token`, which is unaffected.

---

### Step 6 — service: `forwardAdmin` timeout option + long-RPC class

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/bffShared.ts` — modify
- `services/xstockstrat-ui/src/lib/insightsBff.ts` — modify
- `services/xstockstrat-ui/src/lib/configUiBff.ts` — modify
- `services/xstockstrat-ui/src/lib/traderBff.ts` — modify

**Reviewers**: `xstockstrat-ui` owner — Connect-RPC call safety, trading UI correctness, environment scope correctness

**Codebase Evidence**:
- `src/lib/traderBff.ts:33` `placeOrder`, `:42` `cancelOrder`, `:43` `replaceOrder`, `:45` `confirmOrder` are bare `forward(...)`.
- `src/lib/bffShared.ts:76-80` (JSDoc at `:75`): `forwardAdmin(call: (req, opts: { headers: Headers }) => Promise<Res>)` → `forward(call, { admin: true })`.
- `forward()` (`:60-73`) applies `options.admin` at `:66` and sets `callOpts.timeoutMs` only when it is defined (`:70`).
- `src/lib/insightsBff.ts`:
  - `:40` `scoreStrategy`, `:41` `runBacktest` and `:42` `screenSymbols` are all bare `forward(...)`.
  - `:80` `triggerBackfill` is `forward(...)`.
  - `:117-119` `deleteBackfilledData` is `forwardAdmin(...)`.
- `src/lib/configUiBff.ts:69`: `runFundamentalsScan: forwardAdmin((req, opts) => analysisClient.runFundamentalsScan(req, opts))`. Its `@/lib/bffShared` import is at `:20-28`.
- design.md item 6 holds the classification table. Every other unary call stays D (30s transport default) or keeps its P value (`insightsBff.ts:58`, `:102-104`, `:113-115`; `traderBff.ts:77-79`).
- Rejected: bypassing `forwardAdmin` with `forward(call, { admin: true, timeoutMs })`.
- `services/xstockstrat-ui/docs/context-constitution.md:40` documents that bypass as the current workaround. Step 10 updates it.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `bffShared.ts` `forwardAdmin`:
   - Widen `call` to `(req: Req, opts: { headers: Headers; timeoutMs?: number }) => Promise<Res>`.
   - Add a second parameter, `options: { timeoutMs?: number } = {}`.
   - The body becomes `return forward(call, { ...options, admin: true });`. `admin` is spread last, so a caller cannot unset it.
   - Update its JSDoc (`:75`) in one line.
2. `insightsBff.ts`:
   - Add `LONG_RPC_TIMEOUT_MS` to the `@/lib/deadlines` import created in Step 1.
   - Pass `{ timeoutMs: LONG_RPC_TIMEOUT_MS }` as the `forward` options for `scoreStrategy` (`:40`), `runBacktest` (`:41`), `screenSymbols` (`:42`) and `triggerBackfill` (`:80`).
   - Pass it as the `forwardAdmin` options for `deleteBackfilledData` (`:117-119`).
3. `configUiBff.ts`: add `import { LONG_RPC_TIMEOUT_MS } from '@/lib/deadlines';` and pass `{ timeoutMs: LONG_RPC_TIMEOUT_MS }` to `runFundamentalsScan`'s `forwardAdmin` (`:69`).
3b. `traderBff.ts` (operator 2026-10-22): add `ORDER_MUTATION_TIMEOUT_MS` to its `@/lib/deadlines` import and pass `{ timeoutMs: ORDER_MUTATION_TIMEOUT_MS }` as the `forward` options for `placeOrder` (`:33`), `cancelOrder` (`:42`), `replaceOrder` (`:43`) and `confirmOrder` (`:45`). A late 504 after a server-side commit stays safe because trading's exactly-once order intents make a client retry idempotent.
4. Touch no other registration.
5. Add no UI error copy. A 504 after server-side completion is pre-existing behavior for any backend error (§ Spec-time gates).

**Verification**:
```bash
cd services/xstockstrat-ui && grep -c "LONG_RPC_TIMEOUT_MS" src/lib/insightsBff.ts src/lib/configUiBff.ts \
  && test "$(grep -c "ORDER_MUTATION_TIMEOUT_MS" src/lib/traderBff.ts)" -ge 5 \
  && grep -n "{ ...options, admin: true }" src/lib/bffShared.ts \
  && pnpm run lint && pnpm run format:check
```
- Expected `grep -c` counts: `insightsBff.ts` 6 (the import and 5 uses); `configUiBff.ts` 2.

---

### Step 7 — test: `forwardAdmin` threading + BFF deadline classes (vitest)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/__tests__/insightsBff.test.ts` — modify
- `services/xstockstrat-ui/src/lib/bffDeadlines.test.ts` — create

**Reviewers**: `xstockstrat-ui` owner — Connect-RPC call safety, trading UI correctness, environment scope correctness

**Codebase Evidence**:
- `src/lib/__tests__/insightsBff.test.ts` is the feature-183 `forward()` threading suite:
  - `vi.mock('@/lib/auth', …)` at `:11-20`, with `hasAdminScope: vi.fn(() => false)` at `:19`.
  - The `fakeCtx()` stub is at `:27-35`.
  - Its cases capture `opts.timeoutMs` at `:37-85`.
  - It currently imports only `forward` from `@/lib/bffShared` (`:22`); `forwardAdmin` and `hasAdminScope` are not imported yet.
- `src/lib/insightsBff.test.ts:1-46` is the dispatch-level pattern:
  - Mock `@/lib/connectClients` with spies.
  - `await import('@/lib/insightsBff')` to get `dispatchConnect`.
  - Sign a JWT with `jose` under `process.env.JWT_SECRET`.
  - POST JSON to `http://localhost/insights/api/<service>/<Method>`.
- `configUiBff.ts:101`: `export const dispatchConnect = createDispatch(router, '/config-ui/api');`. It imports `configClient`, `ingestClient`, `analysisClient`, `identityClient` and `indicatorsClient` (`:8-14`).
- `insightsBff.ts` imports its clients at `:10-19`.
- `dispatchConnect` exports: `insightsBff.ts:209`, `traderBff.ts:151`. `traderBff.ts` imports its clients at `:9-16`.
- Admin gate: `requireAdminScope` (`bffShared.ts:47-51`) calls `hasAdminScope(claims.roles)`. Admin JWT roles are `['admin']`, as in `e2e/helpers/auth.ts` `addAdminCookie`.
- C-12 does not apply: there are no domain fixtures. The request bodies are `{}`, which are scenario one-offs.

**TDD**: `red-green required`

**Covers**: `AC-6`

**Instructions**:
1. Add a describe to `src/lib/__tests__/insightsBff.test.ts`: "forwardAdmin() — timeoutMs threading (feature 271)". Add `forwardAdmin` to the `@/lib/bffShared` import and add `import { hasAdminScope } from '@/lib/auth';` (the mocked export).
   - (a) With `vi.mocked(hasAdminScope).mockReturnValueOnce(true)`, `forwardAdmin(mockCall, { timeoutMs: LONG_RPC_TIMEOUT_MS })` passes `timeoutMs === LONG_RPC_TIMEOUT_MS` along with `headers`. RED pre-fix: `undefined`, because the option is ignored.
   - (b) When `hasAdminScope` returns false, the handler rejects with `Code.PermissionDenied` and `mockCall` is never called.
2. `src/lib/bffDeadlines.test.ts`:
   - Mock `@/lib/connectClients` with the union of every client the three BFFs import (`configUiBff.ts:8-14`, `insightsBff.ts:10-19`, `traderBff.ts:9-16` — the latter adds `tradingClient`, `portfolioClient`, `notifyClient`, `ledgerClient`, `configClient`); unexercised clients may be empty objects. Give spies resolving `{}` to:
     - `analysisClient.{scoreStrategy, runBacktest, screenSymbols, listOpportunities, runFundamentalsScan}`
     - `ingestClient.triggerBackfill`
     - `marketDataClient.{deleteBackfilledData, getBars, getFundamentals}`
     - `tradingClient.{placeOrder, cancelOrder, replaceOrder, confirmOrder}` (operator 2026-10-22, order-mutation class)
   - Dynamically import `insightsBff`, `configUiBff` and `traderBff` `dispatchConnect`. Use an admin JWT cookie.
   - `it.each` over the six long methods: `AnalysisService/{ScoreStrategy,RunBacktest,ScreenSymbols}` and `IngestService/TriggerBackfill` and `MarketDataService/DeleteBackfilledData` via `/insights/api/xstockstrat.<pkg>.v1.<Service>/<Method>`, and `AnalysisService/RunFundamentalsScan` via `/config-ui/api/...`. For each, the spy's second argument has `timeoutMs === LONG_RPC_TIMEOUT_MS`.
   - `it.each` over the four order mutations (operator 2026-10-22): `TradingService/{PlaceOrder,CancelOrder,ReplaceOrder,ConfirmOrder}` via `/trader/api/xstockstrat.trading.v1.TradingService/<Method>`. For each, the spy's second argument has `timeoutMs === ORDER_MUTATION_TIMEOUT_MS`. RED pre-fix: `undefined`.
   - Preservation:
     - `ListOpportunities` → `30_000` (`@AC-1 @feature-191`).
     - `GetFundamentals` → `FUNDAMENTALS_TIMEOUT_MS` (`@AC-1 @feature-220`).
     - `GetBars` → `undefined`. The 30s default applies at the transport, not in the BFF.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm exec vitest run src/lib/__tests__/insightsBff.test.ts src/lib/bffDeadlines.test.ts \
  && pnpm run test:coverage && pnpm run lint
```
- Coverage ≥ 40% over `src/lib/**`.
- Confirm that all 9 `bffDeadlines` cases and both `forwardAdmin` cases executed.

---

### Step 8 — service: Exact-path health exemption + drop dead matcher prefixes

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/middleware.ts` — modify

**Reviewers**: `xstockstrat-ui` owner — Connect-RPC call safety, trading UI correctness, environment scope correctness; Security — Identity, auth scope (the unauthenticated surface widens to exactly the eight health paths)

**Codebase Evidence**:
- `src/middleware.ts:14-24` `config`:
  - `runtime: 'nodejs'` (`:15`).
  - The matcher is `['/', '/((?!…).+)']`. The lookahead at `:22` contains `…|api/auth/login|api/auth/refresh|api/health|health|auth/login|…`.
- `middleware()` starts at `:26`. `getSessionFromRequest(req)` is the first statement, at `:27`. The existing exact-path check at `:32` uses `req.nextUrl.pathname === '/auth/login' || … '/auth/oauth-login'`, followed by `return NextResponse.next();`.
- The eight handlers all export `GET`, and none makes a backend gRPC call, so skipping the middleware's `x-trace-id` injection loses no propagation:
  - Static `NextResponse.json({ status: 'ok', … })` at `:3-4` in each of:
    - `src/app/trader/health/route.ts`
    - `src/app/trader/api/health/route.ts`
    - `src/app/insights/health/route.ts`
    - `src/app/insights/api/health/route.ts`
    - `src/app/config-ui/health/route.ts`
    - `src/app/config-ui/api/health/route.ts`
    - `src/app/accounts/api/health/route.ts`
  - `src/app/accounts/api/agent-health/route.ts:6-18`. Its own session check returns 401 at `:7-8`, and its only outbound call is a `fetch` to `AGENT_PUBLIC_URL` at `:14`.
- There are no routes under the root `/health` or `/api/health`: `find src/app -path '*health*'` lists only the eight segment routes, and `src/app/api/` holds only `auth` and `oauth`.
- The durable suites (`acceptance/ui-middleware-nodejs-runtime.feature`, `acceptance/pwa-notifications.feature`) never reference the health prefixes (§ Spec-time gates).
- Rejected: an end-anchored matcher regex (design.md § Rejected Alternatives).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Above `middleware()`, add a module-level `const PUBLIC_HEALTH_PATHS = new Set([...])` holding exactly:
   - `'/trader/health'`, `'/trader/api/health'`
   - `'/insights/health'`, `'/insights/api/health'`
   - `'/config-ui/health'`, `'/config-ui/api/health'`
   - `'/accounts/api/health'`, `'/accounts/api/agent-health'`

   Give it a ≤2-line constraint comment: `// Exact paths only (FR-3) — a prefix match would exempt lookalikes. agent-health keeps its own session check (route.ts:7-8).`
2. Make the first statement of `middleware()`, before `:27`: `if (PUBLIC_HEALTH_PATHS.has(req.nextUrl.pathname)) return NextResponse.next();`.
3. In the matcher string at `:22`, delete only the two alternatives `api/health|` and `health|`.
   - Leave every other alternative and the `:18-21` comment verbatim. That includes `api/auth/refresh` (`@AC-5 @feature-128`) and the PWA assets (`@AC-1 @feature-165`).
   - `config.runtime` stays `'nodejs'` (`@AC-1 @feature-128`).
4. Do not modify `agent-health/route.ts`.

**Verification**:
```bash
cd services/xstockstrat-ui && grep -n "PUBLIC_HEALTH_PATHS" src/middleware.ts \
  && ! grep -n "api/health|health|" src/middleware.ts \
  && grep -n "api/auth/refresh" src/middleware.ts && grep -n "runtime: 'nodejs'" src/middleware.ts \
  && pnpm run lint && pnpm run format:check
```

---

### Step 9 — test: Health routes public, everything else gated (vitest + e2e)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/middleware.test.ts` — modify
- `services/xstockstrat-ui/e2e/auth.spec.ts` — modify

**Reviewers**: `xstockstrat-ui` owner — Connect-RPC call safety, trading UI correctness, environment scope correctness; Security — Identity, auth scope

**Codebase Evidence**:
- `src/middleware.test.ts`:
  - It mocks `@/lib/identity` (`:8-12`).
  - `matches()` tests `config.matcher[1]` anchored with `^…$` (`:19-22`).
  - `:58-62` is "still excludes the sibling auth/health paths" and includes `expect(matches('/api/health')).toBe(false)` at `:60`. That is the only pin on the dead prefix.
  - Request construction: `new NextRequest(new URL('http://localhost/trader'), { headers: { cookie } })` (`:46`).
  - The redirect assertion shape is `res.status === 307` with `location` containing `/auth/login` (`:166-167`).
- `e2e/auth.spec.ts:183-195`: the protected-route redirect loop (`page.request.get(path, { maxRedirects: 0 })`, status in `[302, 307]`).
- `@AC-7 @feature-153` (the login page does not loop) stays covered by the untouched `:32` check.
- Trailing-slash trap (insights.md: Next 308s `/config-ui/` before middleware): use canonical paths without a trailing slash, as written in AC-4.
- C-12 does not apply: there are no domain objects. The paths come from `acceptance.feature` Examples.

**TDD**: `red-green required`

**Covers**: `AC-3, AC-4`

**Instructions**:
1. `src/middleware.test.ts`:
   - Rename the `:58-62` test to "still excludes the sibling auth paths" and drop its `/api/health` line.
   - Add "no longer prefix-excludes root health lookalikes (feature 271 FR-3)": `matches('/api/health')`, `matches('/health/anything')` and `matches('/healthcheck-x')` are each `true`. RED pre-fix: `false`.
   - Add the describe "segment health exemption (feature 271 @AC-3/@AC-4)". Set `JWT_SECRET` as in `:84-86`, and `refreshSession.mockReset()`.
     - `it.each` over the 8 health paths: `await middleware(new NextRequest(new URL('http://localhost' + path)))` with no cookie gives status 200 and no `location` header, and `refreshSession` is not called. RED pre-fix: 307 to `/auth/login`.
     - `it.each` over `/trader/orders`, `/trader/healthcheck-x`, `/trader/health/x`, `/insights/api/health-extra`, `/config-ui` and `/accounts`: status 307 and `location` contains `/auth/login`.
2. `e2e/auth.spec.ts`:
   - New describe "Segment health routes are reachable without a session (feature 271 @AC-3)". It runs a table of `[path, status]` from the AC-3 Examples: seven rows at 200 and `/accounts/api/agent-health` at 401.
     - `page.request.get(path, { maxRedirects: 0 })` returns exactly that status, with no `location` header.
     - The 200 rows' JSON has `status: 'ok'`. The 401 row's JSON has `error: 'Unauthorized'` (`agent-health/route.ts:8`).
   - New describe "Non-health routes still require a session (feature 271 @AC-4)". It loops over the AC-4 Examples: `/trader/orders`, `/trader/healthcheck-x`, `/insights/api/health-extra`, `/config-ui`, `/accounts`, `/healthcheck-x` and `/health/anything`. Each gives a status in `[302, 307]` and a `location` containing `/auth/login`.
     - `/healthcheck-x` and `/health/anything` are RED pre-fix: the root prefix skipped the middleware, so they returned 404.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm exec vitest run src/middleware.test.ts \
  && pnpm exec playwright test e2e/auth.spec.ts \
  && pnpm run test:coverage && pnpm run lint
```
- Every pre-existing `middleware.test.ts` case must pass (`@AC-1`…`@AC-6 @feature-128` guards).
- Coverage ≥ 40% over `src/lib/**`.

---

### Step 10 — docs: UI context docs + teardown audit

**Status**: `pending`
**Service**: `services/xstockstrat-ui/` docs
**Files**:
- `services/xstockstrat-ui/CLAUDE.md` — modify
- `services/xstockstrat-ui/docs/context-constitution.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `services/xstockstrat-ui/CLAUDE.md:235` is the `src/middleware.ts` row: Node.js runtime, route protection, refresh, and the `api/auth/refresh` exclusion. It says nothing about health routes.
- `services/xstockstrat-ui/docs/context-constitution.md:40`, the gotcha "BFF deadlines are opt-in and per-handler", says:
  - "`forward(call, {timeoutMs})` is the only way to bound a BFF unary call; without it a stalled upstream leaves the browser query pending forever".
  - "`forwardAdmin` takes no options".
  - It cites `src/lib/bffShared.ts#FUNDAMENTALS_TIMEOUT_MS` as authoritative.

  After Steps 1 and 6, all three claims are false.
- The root `CLAUDE.md` § Teardown requires `/context-forge:context-constitution refresh` after a context file changes. If the plugin is unavailable, do a manual reconciliation and record it in the PR body.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. `services/xstockstrat-ui/CLAUDE.md:235`: append one clause to the middleware row. The eight segment health paths are exempted by an exact-match `PUBLIC_HEALTH_PATHS` Set before the session check. `agent-health` keeps its own 401.
2. `services/xstockstrat-ui/docs/context-constitution.md:40` (the UI-service file — **not** the root `docs/context-constitution.md`): rewrite the gotcha:
   - The UI transport applies `DEFAULT_UNARY_TIMEOUT_MS` (30s) to every unary call without a per-call `timeoutMs`; streams stay unbounded.
   - Per-call values (`LONG_RPC_TIMEOUT_MS` 300s, `ORDER_MUTATION_TIMEOUT_MS` 60s for place/cancel/replace/confirm order, `FUNDAMENTALS_TIMEOUT_MS` 15s, `REFRESH_TIMEOUT_MS` 10s, the `listOpportunities` 30s literal) override it.
   - `forwardAdmin` takes `{ timeoutMs }`.
   - The authoritative home is `src/lib/deadlines.ts`.
   - Re-stamp the evidence pointers.
3. Leave the open finding `services/xstockstrat-ui/docs/context-constitution-findings.md:36` (the `listOpportunities` literal; not the root findings file, whose `:36` is an unrelated feature-227 analysis finding) open. Design kept the literal (design.md item 1).
4. Run `/context-forge:context-constitution refresh` scoped to `services/xstockstrat-ui/` and fix any grounded drift it reports. If the plugin is unavailable, re-read both files against the code by hand and record the manual reconciliation in the PR body.

**Verification**:
```bash
grep -n "PUBLIC_HEALTH_PATHS" services/xstockstrat-ui/CLAUDE.md
grep -n "deadlines.ts" services/xstockstrat-ui/docs/context-constitution.md
! grep -n "forwardAdmin. takes no options" services/xstockstrat-ui/docs/context-constitution.md
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

### Step 1 — `pnpm run format:check` fails on pre-existing drift (2026-10-28)

- **What**: Step 1 **Verification** chains `pnpm run format:check`, which exits 1 on 10 files this step does not touch (`src/app/config-ui/users/page.tsx`, `src/app/insights/pnl-patterns/page.tsx`, `src/components/insights/PerformanceDashboard.tsx`, `src/components/trader/CredentialStatusBadge.tsx`, `src/hooks/{useAccountPortfolios,useOrders,useOrderUpdates,useSignalAttribution}.ts`, `src/lib/performanceMetrics{,.test}.ts`).
- **Why not fixed here**: reformatting unrelated files is outside Step 1 **Files** (F-08). CI does not run `format:check` (`.github/workflows/ci.yml`); the pre-commit hook formats staged files only.
- **Disposition**: CI-equivalent fallback — `prettier --check` scoped to the five Step 1 files passes; every other Verification clause (greps, count = 2, `lint`, `build`) passes, and the `stream(` wrapper shows no diff.

### Step 2 — Playwright verification run with `CI=1` (2026-10-28)

- **What**: the local (non-CI) Playwright mode starts `pnpm dev`, and the `setup` warmup project exceeded the 10s local test timeout on first compile, so `transport-deadline.spec.ts` never ran.
- **Disposition**: CI-equivalent fallback — ran `CI=1 pnpm exec playwright test e2e/transport-deadline.spec.ts` (the CI shape: `pnpm build && pnpm start`, CI timeouts). Both cases passed (AC-6 2.0s, AC-1 30.0s); `pnpm build` also re-ran lint over the new files.

### Step 2 — vitest case (a) asserts a post-import call-count snapshot (2026-10-28)

- **What**: vitest clears mock call history before each test, so `expect(createGrpcTransport).not.toHaveBeenCalled()` inside the test was vacuous: an eager-build mutation still passed it. Case (a) instead records `createGrpcTransport.mock.calls.length` right after the dynamic import in `beforeAll` and asserts it is 0, then asserts exactly one build on the first RPC.
- **Disposition**: same assertion intent as the spec (no transport built at import, built on first RPC); the eager-build mutation now fails (`expected 10 to be +0`).

### Step 3 — Playwright verification run with `CI=1`; `tsc` pre-existing errors (2026-10-28)

- **What**: as in Step 2, the local `pnpm dev` warmup exceeded the 10s local test timeout on first compile, so `alert-stream.spec.ts` was run in the CI shape. The `--project=chromium` filter was added because `/opt/pw-browsers` has no Firefox build (CI runs `chromium` only). Separately, `tsc --noEmit` reports 2 pre-existing errors in `e2e/insights/backfills.spec.ts:135-136`, a file outside Step 3; the Step 3 files compile clean.
- **Disposition**: CI-equivalent fallback — `CI=1 pnpm exec playwright test e2e/trader/alert-stream.spec.ts --project=chromium`: 7/7 passed, including setup (AC-5 case 37.4s); the five existing alert-stream tests still pass, so the default stream still ends cleanly. `pnpm run lint` exits 0. The pre-existing `INVENTORY.md` prettier drift is unchanged by this step (not CI-enforced).

### Step 4 — `pnpm run format:check` fails on pre-existing drift (2026-10-29)

- **What**: the Step 4 **Verification** chain ends with `pnpm run format:check`, which exits 1 on the same 10 pre-existing files recorded under Step 1. `src/lib/identity.ts` is not among them.
- **Disposition**: CI-equivalent fallback, as in Step 1. `prettier --check src/lib/identity.ts` passes, the `timeoutMs: REFRESH_TIMEOUT_MS` grep matches (`identity.ts:17`), and `pnpm run lint` exits 0. Prettier wrapped the call across lines, but the grep still matches on its own line.

### Step 5 — Playwright run with `CI=1 --project=chromium`; explicit timeout on case (b); pre-existing drift (2026-10-29)

- **What**: as in Steps 2–3, `auth.spec.ts` was run in the CI shape (`CI=1`, `pnpm build && pnpm start`), chromium only, because `/opt/pw-browsers` has no Firefox build. Case (b) `request.post('/api/auth/refresh', …)` also passes `timeout: REFRESH_TIMEOUT_MS + 15_000`, the same bound case (a) specs, so the RED run fails at a fixed 25s rather than at Playwright's 30s default. Separately, `prettier --check e2e/fixtures/INVENTORY.md` fails on drift already present at `HEAD` (confirmed on the pre-step file; recorded under Step 3), and `tsc --noEmit` still reports the 2 pre-existing `e2e/insights/backfills.spec.ts:135-136` errors.
- **Disposition**: CI-equivalent fallback. All 23 `auth.spec.ts` tests pass (setup + 22), including both new AC-2 cases (10.0s / 10.2s). The vitest file passes 2/2, `test:coverage` passes 49 files / 244 tests with thresholds met, `lint` exits 0, and prettier is clean on the four code files.

### Step 6 — `pnpm run format:check` fails on pre-existing drift (2026-10-29)

- **What**: the Step 6 **Verification** chain ends with `pnpm run format:check`, which exits 1 on the same 10 pre-existing files recorded under Step 1. None of the four Step 6 files is among them. Separately, the step's `bffShared.ts` evidence lines had drifted by +4 (`forward()` at `:64-77`, `forwardAdmin` at `:80-84`, JSDoc `:79`); the symbols and signatures matched, so the instructions applied unchanged.
- **Disposition**: CI-equivalent fallback, as in Steps 1 and 4. Prettier `--write` left the four Step 6 files clean, and the `grep -c` counts match the spec (`insightsBff.ts` 6, `configUiBff.ts` 2, `traderBff.ts` 5). The `{ ...options, admin: true }` grep matches (`bffShared.ts:80`), and `pnpm run lint` exits 0.

### Step 7 — `bffDeadlines` runs 13 cases, not 9; admin JWT via the shared helper (2026-10-29)

- **What**: the step **Verification** asks to confirm "all 9 `bffDeadlines` cases". The **Instructions** list 6 long-RPC methods, 4 order mutations (operator 2026-10-22) and 3 preservation checks, which is 13. The "9" predates the order-mutation addition. All 13 cases ran. Separately, the admin cookie is signed with `signTestJwt(['admin'])` from `e2e/helpers/auth.ts` (the helper `configUiBff.test.ts` already uses), not an inline `jose` `SignJWT`, to keep a single JWT fixture (C-13). `FUNDAMENTALS_TIMEOUT_MS` is imported from `@/lib/deadlines`, where Step 1 moved it.
- **Disposition**: no behavior change; the assertions follow the step **Instructions** exactly. Verification: 18/18 targeted tests pass (5 `forward`/`forwardAdmin` + 13 `bffDeadlines`), `test:coverage` 50 files / 259 tests with thresholds met, `lint` exits 0.
