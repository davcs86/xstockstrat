# Implementation Spec: align-frontend-e2e-bff-mocks

**Status**: `pending`
**Created**: 2026-06-01
**Feature**: `docs/roadmap/features/046-align-frontend-e2e-bff-mocks/feature.md`
**Total Steps**: 8
**Feature Branch**: `feature/align-frontend-e2e-bff-mocks`

---

## Execution Summary

The mock infrastructure (H2C gRPC server via `connectNodeAdapter`, `*_ENDPOINT` env vars in
`playwright.config.ts`) is already in place for all three frontends. The remaining work is
closing three concrete gaps: (1) trader `mock-backend.ts` and `alert-stream.spec.ts` still
reference the pre-044 SSE bridge — `streamAlerts` must be added to the mock and the spec
rewritten to exercise the Connect server-streaming path through the BFF; (2) the legacy REST
smoke tests (`api-smoke.spec.ts`, `chart-panel.spec.ts`) and page-route mocks
(`order-form.spec.ts`, `account-selector.spec.ts`) test non-existent JSON routes — they must
be rewritten to use the BFF Connect paths that actually exist; (3) insights `mock-backend.ts`
is missing `MarketDataService`, and `playwright.config.ts` is missing `MARKETDATA_ENDPOINT`,
so any `getBars` call falls through to the unreachable production default.

Steps 1–3 address trader, steps 4–5 address insights, step 6 addresses config-ui (minimal
gaps), step 7 adds CLAUDE.md documentation across all three frontends, and step 8 is the
cross-frontend end-to-end CI validation test.

## Step Dependencies

- Step 2 (trader spec rewrites) requires Step 1 (trader mock updated): specs are rewritten to
  match the BFF paths that the updated mock covers.
- Step 5 (insights spec rewrites) requires Step 4 (insights mock updated): the `getBars` spec
  depends on the mock returning valid bar data.
- Step 7 (docs) has no code dependencies — can run in parallel with any step.
- Step 8 (CI validation) is the final gate — must follow all prior steps.

---

### Step 1 — service: xstockstrat-trader mock — add `streamAlerts` and remove stale comment

**Status**: `pending`
**Service**: `xstockstrat-trader`
**Files**:
- `services/xstockstrat-trader/e2e/mock-backend.ts` — modify
- `services/xstockstrat-trader/e2e/global-setup.ts` — modify

**Reviewers**: `xstockstrat-trader` owner — Trading UI correctness, Connect-RPC call safety, no direct DB access from frontend

**Codebase Evidence**:
- Confirmed via: `Read services/xstockstrat-trader/e2e/mock-backend.ts` — `NotifyService` is registered at L127 with only `listAlerts`; `streamAlerts` is absent.
- Confirmed via: `Read services/xstockstrat-trader/src/lib/connectBff.ts` L110–120 — BFF registers `NotifyService.streamAlerts` as a server-streaming handler: `async *streamAlerts(req, ctx) { ... yield* notifyClient.streamAlerts(...) }`.
- Confirmed via: `Read services/xstockstrat-trader/src/components/AlertStream.tsx` L27–32 — browser component calls `notifyClient.streamAlerts(...)` via the Connect BFF, iterating with `for await`.
- Confirmed via: `Read services/xstockstrat-trader/e2e/global-setup.ts` L6 — comment says "configured to use this mock via *_HTTP_ENDPOINT env vars" — stale, `playwright.config.ts` uses `*_ENDPOINT`.
- Confirmed via: `Read packages/proto/notify/v1/notify.proto` L18 — `StreamAlerts` is `rpc StreamAlerts(StreamAlertsRequest) returns (stream Alert)`.
- Confirmed via: `Read services/xstockstrat-trader/e2e/mock-backend.ts` L127–150 — the existing `router.service(NotifyService, { ... })` block registers only `listAlerts` — `streamAlerts` must be added as an async generator.
- Product spec decision (context.md, session 2026-06-01): `streamAlerts` mock yields 3 fixed `Alert` objects then returns.

**Instructions**:

1. In `services/xstockstrat-trader/e2e/mock-backend.ts`, update the `router.service(NotifyService, { ... })` block (currently at approx. L127) to add a `streamAlerts` async generator that yields 3 fixed `Alert` objects:

```typescript
router.service(NotifyService, {
  async *streamAlerts() {
    const alerts: Alert[] = [
      {
        alertId: 'alert-stream-001',
        severity: 2,           // ALERT_SEVERITY_WARNING
        category: 'RISK',
        title: 'Position limit approaching',
        body: 'AAPL position is at 80% of max allowed.',
        sourceService: 'trading',
      },
      {
        alertId: 'alert-stream-002',
        severity: 4,           // ALERT_SEVERITY_CRITICAL
        category: 'SYSTEM',
        title: 'Order rejected',
        body: 'Insufficient buying power for TSLA order.',
        sourceService: 'trading',
      },
      {
        alertId: 'alert-stream-003',
        severity: 1,           // ALERT_SEVERITY_INFO
        category: 'TRADE',
        title: 'Order filled',
        body: 'AAPL market order for 10 shares filled at $189.80.',
        sourceService: 'trading',
      },
    ];
    for (const alert of alerts) {
      yield alert;
    }
    // Stream ends cleanly — no hang in tests.
  },
  async listAlerts() {
    return {
      alerts: [
        // ... keep existing listAlerts body unchanged
      ],
    };
  },
});
```

   Add `import type { Alert } from '@xstockstrat/proto/notify/v1/notify_pb';` at the top of
   the file alongside the existing `NotifyService` import (same import line if the type is
   exported from the same file, otherwise a separate `import type` statement).

2. In `services/xstockstrat-trader/e2e/global-setup.ts`, update the JSDoc comment at L3–7
   to remove "via *_HTTP_ENDPOINT env vars" and replace with:
   "The Next.js dev server is configured to dial this mock via `*_ENDPOINT` env vars
   in `playwright.config.ts` `webServer.env`."

**Verification**:
```bash
# Confirm TypeScript compiles (confirms exports exist and types are correct):
pnpm --filter xstockstrat-trader exec tsc --noEmit
# Expected: 0 errors

# Confirm the new exports are present:
grep -n "export.*startMockBackend\|export.*stopMockBackend" \
  services/xstockstrat-trader/e2e/mock-backend.ts
# Expected: 2 matches
```

---

### Step 2 — service: xstockstrat-trader specs — rewrite legacy REST specs to BFF paths

**Status**: `pending`
**Service**: `xstockstrat-trader`
**Files**:
- `services/xstockstrat-trader/e2e/alert-stream.spec.ts` — modify
- `services/xstockstrat-trader/e2e/api-smoke.spec.ts` — modify
- `services/xstockstrat-trader/e2e/chart-panel.spec.ts` — modify
- `services/xstockstrat-trader/e2e/order-form.spec.ts` — modify
- `services/xstockstrat-trader/e2e/account-selector.spec.ts` — modify

**Reviewers**: `xstockstrat-trader` owner — Trading UI correctness, Connect-RPC call safety, no direct DB access from frontend

**Codebase Evidence**:

- **alert-stream.spec.ts gap** (confirmed via Read at L10–134): all 6 tests mock
  `/trader/api/alerts/stream` with `page.route()` delivering SSE bodies. No such route exists
  — the only API routes are `[...connect]`, `auth/*`, and `health`
  (`find services/xstockstrat-trader/src/app/api -type f`). The `AlertStream.tsx` component
  calls `notifyClient.streamAlerts(...)` via `browserTransport` (baseUrl `/trader/api`) which
  routes to `/trader/api/xstockstrat.notify.v1.NotifyService/StreamAlerts`. The mock now
  handles this path (Step 1).

- **api-smoke.spec.ts gap** (confirmed via Read at L52, L90, L143): calls
  `page.request.get('/trader/api/orders?trading_mode=paper')` and
  `page.request.post('/trader/api/orders', ...)` and
  `page.request.get('/trader/api/portfolio?trading_mode=paper')`. None of these REST routes
  exist; the BFF exposes Connect paths
  (`/trader/api/xstockstrat.trading.v1.TradingService/ListOrders`, etc.). The component
  (`OrderBook.tsx` L33–38) calls `tradingClient.listOrders(...)` via browser Connect; the BFF
  (`connectBff.ts` L59–65) forwards to the mock's `TradingService.listOrders`.
  Expected field names from `api-smoke.spec.ts` L63–77 (`order_id`, `ORDER_SIDE_BUY`,
  `ORDER_STATUS_`) are snake_case JSON API shapes — the protobuf-es JSON codec emits camelCase
  (`orderId`, numeric enum `1`) matching the proto-generated types.

- **chart-panel.spec.ts gap** (confirmed via Read at L36, L77): calls
  `/trader/api/chart?...` and `POST /trader/api/chart` — no such routes exist. The ChartPanel
  component (`ChartPanel.tsx`) uses `marketDataClient` browser client → BFF path
  `/trader/api/xstockstrat.marketdata.v1.MarketDataService/GetBars` and
  `/trader/api/xstockstrat.marketdata.v1.MarketDataService/ListAssets`.

- **order-form.spec.ts gap** (confirmed via Read at L47–75): `page.route('/trader/api/orders')`
  mocks a non-existent REST route. The `OrderForm.tsx` (L53–63) calls
  `tradingClient.placeOrder(...)` via browser Connect BFF. Success message:
  `Order placed: ${order.orderId} (${OrderStatus[order.status] ?? 'UNKNOWN'})` — uses camelCase
  `orderId` and numeric `status` enum resolved through `OrderStatus[N]`.

- **account-selector.spec.ts gap** (confirmed via Read at L10–70): `page.route('/trader/api/accounts')`
  mocks a non-existent REST route. The AccountSelector/AccountManagementPanel use
  `tradingClient.listBrokerAccounts()` and `tradingClient.registerBrokerAccount()` via browser
  Connect BFF path.

**Instructions**:

**2a. `alert-stream.spec.ts`** — Replace all 6 SSE-mocked tests with Connect streaming tests:

- Remove the `sseBody` helper function and all `page.route('/trader/api/alerts/stream', ...)` mocks.
- The `AlertStream` component subscribes to `notifyClient.streamAlerts` on mount (via
  browser Connect → BFF → mock). With the mock now yielding 3 bounded alerts and the stream
  ending, the component will call `setAlerts((prev) => [alert, ...prev].slice(0, 50))` for
  each alert received, then stop.
- Rewrite tests to navigate to `/trader` with auth cookie (use the `addAuthCookie` pattern
  from `chart-panel.spec.ts` L15–34, which signs a JWT with `test-jwt-secret-for-e2e-tests-min32c`),
  then assert that the bell icon and alert badge appear after the stream completes.
- Keep the existing assertion patterns (`page.locator('span.bg-destructive')`,
  `page.locator('span').filter({ hasText: '3' })` for 3-alert count, "Order rejected" text).
- Include one test that asserts at least one alert title appears in the sheet after clicking the bell.
- Keep the "Clear all" test (click bell, click "Clear all", assert badge disappears).
- Do NOT use `page.route` for the Connect BFF path — the mock handles it via the H2C gRPC
  server on port 9091 pointed at by `NOTIFY_ENDPOINT=127.0.0.1:9091` in `playwright.config.ts`.

**2b. `api-smoke.spec.ts`** — Rewrite to call BFF Connect paths via `page.evaluate`:

- Replace `page.request.get('/trader/api/orders?trading_mode=paper')` with a `page.evaluate`
  `fetch` POST to `/trader/api/xstockstrat.trading.v1.TradingService/ListOrders` with
  `content-type: application/json` body `{"tradingMode":1}`. Use the `addAuthCookie` + BFF
  pattern matching `insights/e2e/api-smoke.spec.ts` (which calls BFF via `page.evaluate` to
  avoid the undici Transfer-Encoding quirk — confirmed at `insights/e2e/api-smoke.spec.ts` L37–47).
- Assert on camelCase protobuf-es JSON fields: `body.orders`, `order.orderId`, `order.symbol`,
  `order.side` (numeric `1` for BUY, `2` for SELL, matching mock at
  `trader/e2e/mock-backend.ts` L57), `order.qty`, `order.filledQty`, `order.filledAvgPrice`,
  `order.status` (numeric `3` for FILLED).
- Replace the `POST /api/orders` test with a BFF call to
  `/trader/api/xstockstrat.trading.v1.TradingService/PlaceOrder` — assert `body.orderId` is
  a non-empty string; `body.status` is a number (the mock returns `3`).
- Replace the `GET /api/portfolio` test with a BFF call to
  `/trader/api/xstockstrat.portfolio.v1.PortfolioService/GetPortfolio` — assert `body.equity`,
  `body.cash`, `body.buyingPower`, `body.dayPnl`, `body.dayPnlPct`, `body.totalPnl` are
  numeric (camelCase, matching mock response at `trader/e2e/mock-backend.ts` L96–105).
  Assert `body.positions` is an array with `symbol` and `unrealizedPnl` numeric fields.
- `addAuthCookie` function must be added (copy from `chart-panel.spec.ts` L15–34, identical
  JWT signing logic with `test-jwt-secret-for-e2e-tests-min32c`).

**2c. `chart-panel.spec.ts`** — Replace REST calls with BFF Connect calls:

- Replace `page.request.get('/trader/api/chart?symbol=AAPL&timeframe=1Day&limit=100')` with
  a `page.evaluate` fetch POST to
  `/trader/api/xstockstrat.marketdata.v1.MarketDataService/GetBars` with body
  `{"symbol":"AAPL","timeframe":"1Day","limit":100}`. The mock returns 2 bars
  (`mock-backend.ts` L153–191).
- Assert `body.bars` is an array; each bar has `symbol`, `open`, `high`, `low`, `close`,
  `volume` (note: `BigInt` proto fields are serialized as string in protobuf-es JSON —
  assert `typeof bar.volume === 'string'` not number).
- Replace the 400/401 REST tests with appropriate BFF-level tests: remove the 400 test for
  missing symbol (BFF does not validate query params — it is a proto field); keep the 401 test
  by calling the BFF path without auth cookie and asserting a Connect Unauthenticated error
  response (HTTP 401 or a JSON Connect error with `code: "unauthenticated"`).
- Replace `POST /api/chart` (ListAssets) with a `page.evaluate` fetch to
  `/trader/api/xstockstrat.marketdata.v1.MarketDataService/ListAssets` with body `{}`.
  Assert `body.assets` is an array; each item has `symbol`, `exchange`, `assetClass`
  (camelCase, matching mock L184–191).
- Keep the component-level tests (`test.describe('ChartPanel component')`) unchanged —
  they go to `/trader/` and assert DOM elements; no route mocking needed.

**2d. `order-form.spec.ts`** — Replace `page.route('/trader/api/orders')` mocks:

- The component tests that check rendering (`'renders the Place Order card'`,
  `'limit price field is hidden for market orders'`, `'limit price field appears when order type is Limit'`,
  etc.) do NOT call the API — they are already BFF-agnostic and can remain as-is after removing
  the non-existent route mocks (the `page.route` calls in `successful order submission` and
  `failed order submission` tests).
- For `'successful order submission shows order_id and status'`: remove the `page.route(...)` mock.
  Navigate to `/trader` with auth cookie (use `addAuthCookie` from `chart-panel.spec.ts`).
  The real `tradingClient.placeOrder()` browser call goes through the BFF to the mock, which
  returns `{ orderId: 'mock-order-001', status: 3, tradingMode: 1 }`. The component displays
  `Order placed: mock-order-001 (FILLED)` (`OrderStatus[3]` = `'FILLED'` via the enum reverse
  map). Update the assertion to `page.getByText(/mock-order-001/)` and
  `page.getByText(/FILLED/)` (not `ORDER_STATUS_FILLED` — the component uses enum name, not
  the string prefix form).
- For `'failed order submission shows error message'`: remove the `page.route(...)` mock.
  With a valid auth cookie and empty/invalid form fields, the ConnectError from the BFF is
  caught and shown. The mock accepts any `placeOrder` and always succeeds — to produce an
  error, submit with empty symbol (validation in the form's `required` attribute or client-side
  check). Update the assertion to match whatever error the component renders for an empty
  symbol field or network failure path.
- Add `addAuthCookie` (from `chart-panel.spec.ts`) so the component can initialize.

**2e. `account-selector.spec.ts`** — Replace `page.route('/trader/api/accounts')` mocks:

- The mock's `TradingService.listBrokerAccounts` (confirmed at `mock-backend.ts` L75–82)
  returns two accounts (`alpaca-default`, `ibkr-001`). The `AccountSelector` component calls
  `tradingClient.listBrokerAccounts()` via browser Connect.
- Tests `'Place Order button is disabled when no account is selected'` and
  `'enabled when an account is selected'` use `page.route('/trader/api/accounts', ...)` to
  override account data. Replace with: add auth cookie, navigate to `/trader`, and intercept
  the BFF Connect path instead:
  `page.route('**/xstockstrat.trading.v1.TradingService/ListBrokerAccounts', ...)` — returning
  Connect JSON (same `application/json` content-type pattern used in
  `insights/e2e/account-portfolio.spec.ts` L36–50).
- For the `'Account Management Panel opens via gear icon'` and
  `'Add Account form clears credential fields on success'` tests: add auth cookie so the
  page loads; replace `page.route('/trader/api/accounts', ...)` for the POST mock with
  `page.route('**/xstockstrat.trading.v1.TradingService/RegisterBrokerAccount', ...)`.
  The mock returns `{ account: { accountId: 'new-account-001', ... } }` (camelCase).
  Update the assertion for credential field clearing to match the existing form behavior.

**Verification**:
```bash
cd services/xstockstrat-trader && pnpm test:e2e --project=chromium 2>&1 | tail -20
```
All tests must pass. Specifically confirm: `alert-stream.spec.ts` passes with badge count `3`
visible, `api-smoke.spec.ts` passes with camelCase field assertions, `chart-panel.spec.ts`
passes against `/MarketDataService/GetBars`, `order-form.spec.ts` passes showing `FILLED`,
`account-selector.spec.ts` passes via Connect BFF route intercept.

---

### Step 3 — test: xstockstrat-trader — CI threshold compliance

**Status**: `pending`
**Service**: `xstockstrat-trader`
**Files**: none (verification only)

**Reviewers**: `xstockstrat-trader` owner — Trading UI correctness, Connect-RPC call safety, no direct DB access from frontend

**Codebase Evidence**:
- No coverage threshold applies to Next.js frontend e2e tests (confirmed from CI overview:
  threshold only applies to Go/Python/Node.js backend services). E2E pass/fail is the gate.

**Instructions**:
New logic lands only in `e2e/` files. No coverage threshold applies to frontend e2e suites.
Integration test verification is sufficient.

**Verification**:
```bash
cd services/xstockstrat-trader && pnpm test:e2e 2>&1 | grep -E "passed|failed|error"
```
All tests passed, 0 failed.

---

### Step 4 — service: xstockstrat-insights mock — add `MarketDataService` and `MARKETDATA_ENDPOINT`

**Status**: `pending`
**Service**: `xstockstrat-insights`
**Files**:
- `services/xstockstrat-insights/e2e/mock-backend.ts` — modify
- `services/xstockstrat-insights/playwright.config.ts` — modify

**Reviewers**: `xstockstrat-insights` owner — Analytics display accuracy, SSE polling resilience, read-only access pattern

**Codebase Evidence**:
- Confirmed via: `Read services/xstockstrat-insights/e2e/mock-backend.ts` — `MarketDataService`
  is absent. The file imports `AnalysisService`, `IdentityService`, `TradingService`,
  `PortfolioService` but NOT `MarketDataService`.
- Confirmed via: `grep -n "MARKETDATA" services/xstockstrat-insights/playwright.config.ts` →
  no output — `MARKETDATA_ENDPOINT` is absent from `webServer.env`.
- Confirmed via: `Read services/xstockstrat-insights/src/lib/connectClients.ts` L21–22 —
  `const MARKETDATA_ENDPOINT = process.env.MARKETDATA_ENDPOINT ?? 'xstockstrat-marketdata:50053'`.
  Without the env var override in tests, `getBars` dials the production host and fails.
- Confirmed via: `Read services/xstockstrat-insights/src/lib/connectBff.ts` L72–76 —
  `router.service(MarketDataService, { async getBars(req, ctx) { ... return marketDataClient.getBars(...) } })`.
  The BFF exposes this path; the mock must handle it.
- Confirmed via: `grep -n "runBacktest\|getStrategyReport" services/xstockstrat-insights/e2e/mock-backend.ts`
  → no output — `runBacktest` and `getStrategyReport` are also absent from the mock but ARE
  registered in the BFF. Add them here for completeness (no tests exercise them yet, but
  leaving them unhandled causes a connect-node `Unimplemented` error if any test page navigates
  to strategy detail).

**Instructions**:

1. In `services/xstockstrat-insights/e2e/mock-backend.ts`:
   - Add `import { MarketDataService } from '@xstockstrat/proto/marketdata/v1/marketdata_pb';`
     alongside the existing imports at the top of the file.
   - Add a `router.service(MarketDataService, { ... })` block inside the `connectNodeAdapter`
     routes callback, after the existing `PortfolioService` block:
   ```typescript
   router.service(MarketDataService, {
     async getBars() {
       return {
         bars: [
           { symbol: 'AAPL', open: 188.0, high: 190.5, low: 187.2, close: 189.8,
             volume: BigInt(45000000), vwap: 189.1, tradeCount: 120000,
             timeframe: '1Day', source: 'alpaca' },
           { symbol: 'AAPL', open: 189.8, high: 192.0, low: 188.5, close: 191.5,
             volume: BigInt(38000000), vwap: 190.5, tradeCount: 98000,
             timeframe: '1Day', source: 'alpaca' },
         ],
       };
     },
   });
   ```
   - Update `AnalysisService` block to add `runBacktest` and `getStrategyReport` stub handlers:
   ```typescript
   async runBacktest() {
     return {
       result: {
         strategyId: 'strat-high-001',
         symbol: 'AAPL',
         trades: [{ pnl: 150.0 }, { pnl: -50.0 }],
       },
     };
   },
   async getStrategyReport() {
     return {
       strategyId: 'strat-high-001',
       overallScore: 0.87,
       rating: 'A',
     };
   },
   ```

2. In `services/xstockstrat-insights/playwright.config.ts`, add `MARKETDATA_ENDPOINT` to
   `webServer.env`:
   ```typescript
   env: {
     ANALYSIS_ENDPOINT:    '127.0.0.1:9092',
     MARKETDATA_ENDPOINT:  '127.0.0.1:9092',   // ← add this line
     IDENTITY_ENDPOINT:    '127.0.0.1:9092',
     TRADING_ENDPOINT:     '127.0.0.1:9092',
     PORTFOLIO_ENDPOINT:   '127.0.0.1:9092',
     JWT_SECRET:           'test-jwt-secret-for-e2e-tests-min32c',
   },
   ```
   All services are multiplexed on the same single mock server at port 9092
   (confirmed: `mock-backend.ts` L20 `export const MOCK_PORT = 9092`; single
   `http2.createServer(handler)` serves all registered services).

**Verification**:
```bash
grep -n "MARKETDATA_ENDPOINT" services/xstockstrat-insights/playwright.config.ts
```
Confirms `MARKETDATA_ENDPOINT: '127.0.0.1:9092'` present.

```bash
grep -n "MarketDataService" services/xstockstrat-insights/e2e/mock-backend.ts
```
Confirms import and `router.service(MarketDataService, ...)` present.

---

### Step 5 — test: xstockstrat-insights — CI threshold compliance

**Status**: `pending`
**Service**: `xstockstrat-insights`
**Files**: none (verification only)

**Reviewers**: `xstockstrat-insights` owner — Analytics display accuracy, SSE polling resilience, read-only access pattern

**Codebase Evidence**:
- No coverage threshold applies to Next.js frontend e2e tests. E2E pass/fail is the gate.

**Instructions**:
New logic lands only in `e2e/` files. No coverage threshold applies to frontend e2e suites.
Integration test verification is sufficient.

**Verification**:
```bash
cd services/xstockstrat-insights && pnpm test:e2e 2>&1 | grep -E "passed|failed|error"
```
All tests passed, 0 failed.

---

### Step 6 — service: xstockstrat-config-ui — fix stale global-setup comment

**Status**: `pending`
**Service**: `xstockstrat-config-ui`
**Files**:
- `services/xstockstrat-config-ui/e2e/global-setup.ts` — modify

**Reviewers**: `xstockstrat-config-ui` owner — Config mutation safety, environment scope correctness, no secret values rendered in UI

**Codebase Evidence**:
- Confirmed via: `Read services/xstockstrat-config-ui/e2e/global-setup.ts` — file currently
  has no JSDoc comment (unlike trader's global-setup which had the stale `*_HTTP_ENDPOINT`
  comment). The config-ui global-setup.ts body is clean (3 lines).
- Confirmed via: `Read services/xstockstrat-config-ui/playwright.config.ts` — `webServer.env`
  already uses `CONFIG_ENDPOINT`, `IDENTITY_ENDPOINT`, `INGEST_ENDPOINT` (all `*_ENDPOINT`,
  not `*_HTTP_ENDPOINT`). No stale references.
- Confirmed via: `Read services/xstockstrat-config-ui/e2e/mock-backend.ts` — mock covers
  `ConfigService` (`listKeys`, `setConfig`) and `IngestService` (`listSignalSources`,
  `manageSignalSource`) and `IdentityService` — all services registered in the BFF
  (`connectBff.ts` L47–74). No gaps.
- **Net finding**: config-ui mock and playwright.config.ts are fully aligned. Only improvement:
  add a JSDoc comment to `global-setup.ts` matching the documented pattern in the other two
  frontends (FR-4: documentation in each frontend's CLAUDE.md or a shared doc).

**Instructions**:

In `services/xstockstrat-config-ui/e2e/global-setup.ts`, add a JSDoc header comment before
`export default async function globalSetup()`:

```typescript
/**
 * Starts the mock gRPC backend before the Playwright test suite.
 * The Next.js dev server (started by webServer in playwright.config.ts) is
 * configured to dial this mock via *_ENDPOINT env vars (CONFIG_ENDPOINT,
 * IDENTITY_ENDPOINT, INGEST_ENDPOINT all set to 127.0.0.1:9093).
 */
```

**Verification**:
```bash
head -8 services/xstockstrat-config-ui/e2e/global-setup.ts
```
Confirm JSDoc comment is present.

---

### Step 7 — docs: add e2e mock wiring note to each frontend's CLAUDE.md

**Status**: `pending`
**Service**: `xstockstrat-trader`, `xstockstrat-insights`, `xstockstrat-config-ui`
**Files**:
- `services/xstockstrat-trader/CLAUDE.md` — modify
- `services/xstockstrat-insights/CLAUDE.md` — modify
- `services/xstockstrat-config-ui/CLAUDE.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- Confirmed via: `grep -n "e2e\|mock\|playwright" services/xstockstrat-trader/CLAUDE.md` →
  no e2e or mock documentation in the trader CLAUDE.md.
- Confirmed via: `grep -n "e2e\|mock\|playwright" services/xstockstrat-insights/CLAUDE.md` →
  no e2e or mock documentation.
- Confirmed via: `grep -n "e2e\|mock\|playwright" services/xstockstrat-config-ui/CLAUDE.md` →
  no e2e or mock documentation.
- Product spec Acceptance Criterion 4: "A short note in each frontend's CLAUDE.md explains
  how the e2e backend mock is wired to the BFF."

**Instructions**:

Add a new `## E2E Backend Mock` section at the end of each frontend's CLAUDE.md.

**`services/xstockstrat-trader/CLAUDE.md`** — append:
```markdown
## E2E Backend Mock

Playwright e2e tests run against a real H2C gRPC mock server (`e2e/mock-backend.ts`) that
registers the same service descriptors (`TradingService`, `PortfolioService`, `MarketDataService`,
`NotifyService`, `IdentityService`) as the production BFF. The mock starts in `e2e/global-setup.ts`
on port 9091 before the Next.js dev server.

`playwright.config.ts` `webServer.env` sets every `*_ENDPOINT` to `127.0.0.1:9091`, so the BFF's
`createGrpcTransport` clients dial the mock exactly as they would dial real backends. No production
code is modified.

- `TRADING_ENDPOINT`, `PORTFOLIO_ENDPOINT`, `NOTIFY_ENDPOINT`, `IDENTITY_ENDPOINT`,
  `MARKETDATA_ENDPOINT` → all `127.0.0.1:9091`
- `NotifyService.StreamAlerts` is implemented as a bounded async generator (yields 3 alerts then
  ends) to prevent test hangs.
- Do not use `*_HTTP_ENDPOINT` — that env var is not read by any runtime code.
```

**`services/xstockstrat-insights/CLAUDE.md`** — append:
```markdown
## E2E Backend Mock

Playwright e2e tests run against a real H2C gRPC mock server (`e2e/mock-backend.ts`) that
registers the same service descriptors (`AnalysisService`, `MarketDataService`, `PortfolioService`,
`TradingService`, `IdentityService`) as the production BFF. The mock starts in `e2e/global-setup.ts`
on port 9092 before the Next.js dev server.

`playwright.config.ts` `webServer.env` sets every `*_ENDPOINT` to `127.0.0.1:9092`, so the BFF's
`createGrpcTransport` clients dial the mock exactly as they would dial real backends. No production
code is modified.

- `ANALYSIS_ENDPOINT`, `MARKETDATA_ENDPOINT`, `PORTFOLIO_ENDPOINT`, `TRADING_ENDPOINT`,
  `IDENTITY_ENDPOINT` → all `127.0.0.1:9092`
- Do not use `*_HTTP_ENDPOINT` — that env var is not read by any runtime code.
```

**`services/xstockstrat-config-ui/CLAUDE.md`** — append:
```markdown
## E2E Backend Mock

Playwright e2e tests run against a real H2C gRPC mock server (`e2e/mock-backend.ts`) that
registers the same service descriptors (`ConfigService`, `IngestService`, `IdentityService`)
as the production BFF. The mock starts in `e2e/global-setup.ts` on port 9093 before the Next.js
dev server.

`playwright.config.ts` `webServer.env` sets every `*_ENDPOINT` to `127.0.0.1:9093`, so the BFF's
`createGrpcTransport` clients dial the mock exactly as they would dial real backends. No production
code is modified.

- `CONFIG_ENDPOINT`, `INGEST_ENDPOINT`, `IDENTITY_ENDPOINT` → all `127.0.0.1:9093`
- The `audit` route bypasses the mock — it queries `config.config_audit` via `DATABASE_URL` directly
  and is not covered by the gRPC mock.
- Do not use `*_HTTP_ENDPOINT` — that env var is not read by any runtime code.
```

**Verification**:
```bash
grep -n "E2E Backend Mock" services/xstockstrat-trader/CLAUDE.md \
  services/xstockstrat-insights/CLAUDE.md \
  services/xstockstrat-config-ui/CLAUDE.md
```
Confirms all three CLAUDE.md files contain the section.

---

### Step 8 — test: cross-frontend CI validation

**Status**: `pending`
**Service**: `xstockstrat-trader`, `xstockstrat-insights`, `xstockstrat-config-ui`
**Files**: none (verification only)

**Reviewers**: `xstockstrat-trader` owner — Trading UI correctness, Connect-RPC call safety, no direct DB access from frontend; `xstockstrat-insights` owner — Analytics display accuracy, SSE polling resilience, read-only access pattern; `xstockstrat-config-ui` owner — Config mutation safety, environment scope correctness, no secret values rendered in UI

**Codebase Evidence**:
- Confirmed via: `Read .github/workflows/ci.yml` L388–441 — `frontend-e2e` job runs
  `pnpm test:e2e` in each `services/${{ matrix.service }}` directory with `CI=true`.
- Confirmed via: `Read .github/workflows/ci.yml` L430–435 — installs only `chromium` and
  `firefox` browsers.
- Acceptance Criteria 1 (product spec): "trader, insights, and config-ui e2e suites pass in CI
  without any real backend services."
- Acceptance Criteria 2: "trader `AlertStream` spec receives at least one alert through the
  connect-web server-streaming path."
- Acceptance Criteria 3: "`playwright.config.ts` no longer sets `*_HTTP_ENDPOINT`."

**Instructions**:
No code changes. Run all three suites against chromium to simulate CI.

**Verification**:
```bash
cd services/xstockstrat-trader && CI=true pnpm test:e2e --project=chromium 2>&1 | tail -5
```
```bash
cd services/xstockstrat-insights && CI=true pnpm test:e2e --project=chromium 2>&1 | tail -5
```
```bash
cd services/xstockstrat-config-ui && CI=true pnpm test:e2e --project=chromium 2>&1 | tail -5
```

Each must report 0 failed tests. Specifically verify:
- Trader: alert badge shows count ≥ 1 (acceptance criterion 2).
- All three: grep confirms no `*_HTTP_ENDPOINT` in any `playwright.config.ts`:
```bash
grep -rn "HTTP_ENDPOINT" \
  services/xstockstrat-trader/playwright.config.ts \
  services/xstockstrat-insights/playwright.config.ts \
  services/xstockstrat-config-ui/playwright.config.ts
```
Must return no matches (acceptance criterion 3).

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
