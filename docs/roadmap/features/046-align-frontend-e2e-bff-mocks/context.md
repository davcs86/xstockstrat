# Context: align-frontend-e2e-bff-mocks

**Feature**: `docs/roadmap/features/046-align-frontend-e2e-bff-mocks/feature.md`
**Product Spec**: `docs/roadmap/features/046-align-frontend-e2e-bff-mocks/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/046-align-frontend-e2e-bff-mocks/implementation-spec.md`

---

## Session 2026-05-31 — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Surfaced as the explicit follow-up from PR #451 (connect-web BFF unification). The PR
  intentionally left the e2e backend mock out of scope: trader `e2e/mock-backend.ts` serves
  `connect+json` over HTTP keyed by Connect paths and is pointed at via `*_HTTP_ENDPOINT`,
  but runtime gRPC clients (`connectClients.ts`, `createGrpcTransport`) read `*_ENDPOINT`
  (`host:port`) and never `*_HTTP_ENDPOINT` — so in tests the BFF dials unreachable backend
  hosts and data-dependent specs cannot pass.
- Scope captured: realign the mock to be reachable by the server-side gRPC clients, update
  `playwright.config.ts` `webServer.env`, cover the connect-web call paths (incl.
  `NotifyService.StreamAlerts` server-streaming for trader `AlertStream`), and apply the same
  approach across all three frontends.

## Session 2026-06-01T00:00:00Z — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- All 3 open questions resolved at review gate:
  - Mock transport: H2C gRPC mock via `*_ENDPOINT` — `@connectrpc/connect-node` server on port
    50099; `playwright.config.ts` sets `<SERVICE>_ENDPOINT=localhost:50099`; no production code
    touched.
  - Mock scope: per-frontend — each service has its own `mock-backend.ts` with its own service
    set (trader: trading/portfolio/marketdata; insights: analysis/marketdata/portfolio;
    config-ui: config/ingest).
  - StreamAlerts: async generator yields 3 fixed Alert objects then returns; Playwright asserts
    first alert in DOM; bounded stream prevents test hangs.
- Warnings (advisory, no merge-order entries required):
  - `client-api-pattern` also modifies xstockstrat-trader, xstockstrat-insights, xstockstrat-config-ui
    — expected; 046 is test-infra alignment for the pattern 044 introduces; merge 044 first.
  - `formula-management-ui` also modifies xstockstrat-insights — coordinate merge order.

## Session 2026-06-01T00:00:00Z — sdd-spec

- Generated implementation-spec.md with 8 steps. Status → implementation-ready.
- Key codebase findings:
  - The H2C gRPC mock + `*_ENDPOINT` playwright.config.ts wiring is ALREADY in place for all
    three frontends (ports 9091/9092/9093). The product spec's context.md note that `*_HTTP_ENDPOINT`
    was the gap is now historical — the code has already been updated. The remaining gaps are:
  - Trader: `mock-backend.ts` has `listAlerts` but NOT `streamAlerts`; `alert-stream.spec.ts`
    still mocks the old SSE `/api/alerts/stream` route (non-existent); `api-smoke.spec.ts` and
    `chart-panel.spec.ts` test non-existent REST routes (`/api/orders`, `/api/portfolio`,
    `/api/chart`); `order-form.spec.ts` and `account-selector.spec.ts` mock non-existent REST
    paths. All trader spec files need rewriting to use BFF Connect paths.
  - Insights: `mock-backend.ts` is missing `MarketDataService`; `playwright.config.ts` is missing
    `MARKETDATA_ENDPOINT` (falls back to production default). `runBacktest` and `getStrategyReport`
    are also absent from the mock (no test currently exercises them but they would fail if hit).
  - Config-ui: fully aligned — no mock gaps, no missing env vars; only needs a comment in
    `global-setup.ts` and CLAUDE.md documentation.
  - `global-setup.ts` stale comment in trader: says `*_HTTP_ENDPOINT`; must be corrected.
  - No production code changes needed — all changes are in `e2e/` files and CLAUDE.md.

## Session 2026-06-01 — sdd-review impl-spec + decisions

- impl-spec review: PASS (0 failures, 6 advisory warnings).
- **W1 FIXED in spec**: Step 1 verification command changed from `node --input-type=module` (cannot execute TypeScript) to `pnpm exec tsc --noEmit` + export grep. Node.js cannot run `.ts` files directly without a TS transpiler.
- W2 (dense 5-file Step 2): accepted as-is; executor commits file-by-file within the step.
- W3 (failed order submission path underspecified): executor checks `mock-backend.ts` for existing `Code.InvalidArgument` response on `placeOrder`.
- W4 (runBacktest stub shape): executor greps `packages/proto/gen/ts/analysis/v1/` at step start.
- **W5 (CLAUDE.md conflict with 044)**: rebase `feature/align-frontend-e2e-bff-mocks` on `feature/client-api-pattern` before executing Step 7. Execution order enforces this (044 merges before 046).
- W6 (003 overlap): execution order (046 before 003) handles this.

## Session 2026-06-01 — sdd-execute

### Step 1 — trader mock: add `streamAlerts` and fix stale comment [done]
- Added `type Alert` to the `NotifyService` import in `mock-backend.ts`.
- Added `async *streamAlerts()` async generator yielding 3 bounded Alert objects then ending cleanly.
- Updated `global-setup.ts` JSDoc: replaced stale `*_HTTP_ENDPOINT` with `*_ENDPOINT env vars in playwright.config.ts webServer.env`.
- Files modified: `services/xstockstrat-trader/e2e/mock-backend.ts`, `services/xstockstrat-trader/e2e/global-setup.ts`
- Deviations: none

### Step 2 — trader specs: rewrite legacy REST specs to BFF paths [done]
- Rewrote all 5 trader e2e spec files to use Connect BFF paths instead of non-existent REST routes.
- `alert-stream.spec.ts`: removed SSE `page.route` mocks; tests navigate to `/trader` with auth cookie and assert against the real mock's bounded `streamAlerts` (3 alerts, badge shows "3", bg-destructive).
- `api-smoke.spec.ts`: replaced REST `page.request.get/post` with `page.evaluate` fetch POSTs to BFF Connect paths; asserts camelCase fields (orderId, filledQty, buyingPower, etc.).
- `chart-panel.spec.ts`: replaced `/api/chart` REST tests with BFF `GetBars`/`ListAssets` calls; kept component tests unchanged.
- `order-form.spec.ts`: added auth cookie + `ListBrokerAccounts` route intercept in beforeEach (using correct proto `id` field); success test asserts "mock-order-001" and "FILLED"; failure test intercepts `PlaceOrder` BFF path with Connect error JSON.
- `account-selector.spec.ts`: replaced `/trader/api/accounts` route mocks with BFF `ListBrokerAccounts` and `RegisterBrokerAccount` route intercepts; added auth cookie throughout.
- Files modified: `services/xstockstrat-trader/e2e/alert-stream.spec.ts`, `api-smoke.spec.ts`, `chart-panel.spec.ts`, `order-form.spec.ts`, `account-selector.spec.ts`
- Deviations: (1) For `order-form.spec.ts` failed-order test, added BFF `PlaceOrder` route intercept returning Connect error JSON (content-type: application/connect+json) — spec said "remove page.route mock" but that referred to the old REST route; BFF path intercept is the correct replacement. (2) `ListBrokerAccounts` mock in `order-form.spec.ts`/`account-selector.spec.ts` uses `id` (correct proto field) instead of the mock-backend.ts which incorrectly uses `accountId` — intercepting the BFF path bypasses this pre-existing mock bug.

### Step 3 — test: xstockstrat-trader — CI threshold compliance [done]
- Ran `node_modules/.bin/playwright test --project=chromium`: 36 passed, 0 failed.
- Additional fixes applied during this step (discovered by running the suite):
  - `mock-backend.ts`: fixed pre-existing `accountId` → `id` bug in `listBrokerAccounts` and `registerBrokerAccount` (proto field `BrokerAccount.id`, not `accountId`).
  - `alert-stream.spec.ts`: badge locator changed from `hasText: '3'` (substring) to `hasText: /^3$/` (exact regex) to avoid false matches against portfolio dollar amounts. Bell-button click changed to `badge.locator('..')` (badge's direct parent) to avoid picking the error-overlay navigation button. Applied to both "opening sheet" and "Clear all" tests.
  - `api-smoke.spec.ts`: enum field type assertions changed from `'number'` to `'string'` — Connect JSON (protobuf-es) serializes enum fields as string names (`ORDER_SIDE_BUY`, `ORDER_STATUS_FILLED`), not integers.
  - `chart-panel.spec.ts`: auth tests changed from `await res.json()` (throws SyntaxError on HTML redirect) to `res.text().includes('"bars"')` / `res.text().includes('"assets"')`. Bar-count test simplified to verify trigger text "100 bars" is visible (avoids Radix portal option query that fails headless). Chart container uses `[style*="320"]` partial style match.
  - `order-form.spec.ts`: combobox scoped to `page.locator('form').getByRole('combobox')` to avoid picking ChartPanel bar-count selector. FILLED success assertion tightened to `getByText(/Order placed:.*FILLED/)`.
- Files modified: `services/xstockstrat-trader/e2e/alert-stream.spec.ts`, `api-smoke.spec.ts`, `chart-panel.spec.ts`, `order-form.spec.ts`, `mock-backend.ts`
- Deviations: All deviations are test-spec corrections to match actual Connect/protobuf-es runtime behavior; no production code changed.

### Step 4 — insights mock: add MarketDataService and MARKETDATA_ENDPOINT [done]
- Added `import { MarketDataService }` to `services/xstockstrat-insights/e2e/mock-backend.ts` and added `router.service(MarketDataService, { async getBars() { ... } })` block after `PortfolioService`.
- Added `runBacktest` and `getStrategyReport` stub handlers to the `AnalysisService` block.
- Added `MARKETDATA_ENDPOINT: '127.0.0.1:9092'` to `services/xstockstrat-insights/playwright.config.ts` `webServer.env`.
- Files modified: `services/xstockstrat-insights/e2e/mock-backend.ts`, `services/xstockstrat-insights/playwright.config.ts`
- Deviations: Spec's `runBacktest` return shape was `{ result: { ... } }` — wrong. Proto says `rpc RunBacktest returns (BacktestResult)` directly. Fixed to return `BacktestResult` fields at top level. Spec's `getStrategyReport` return shape had `overallScore`/`rating` at top level — wrong. `StrategyReport` proto has `strategy_id`, `latest_backtest`, `score`, `metadata`. Returned minimal `{ strategyId }` stub instead.

### Step 5 — test: xstockstrat-insights — CI threshold compliance [done]
- Ran `node_modules/.bin/playwright test --project=chromium` in `services/xstockstrat-insights`: 22 passed, 0 failed.
- Additional fix during this step: `mock-backend.ts` had pre-existing `accountId` → `id` bug in `TradingService.listBrokerAccounts` (same bug as trader Step 3). The `AccountPortfolioSelector` component keyed accounts by `account.id`; with `accountId` the key was always `""` causing React duplicate-key crash and Next.js error overlay blocking all dashboard tests. Fixed `accountId` → `id` in insights mock.
- Files modified: `services/xstockstrat-insights/e2e/mock-backend.ts`
- Deviations: Applied `accountId` → `id` fix to insights mock (same proto field correction as Step 3 for trader mock). This was undetected in Step 4 because Step 4 verification only checked for the presence of `MarketDataService` imports, not a full suite run.

### Step 6 — config-ui: fix stale global-setup comment [done]
- Added JSDoc comment to `services/xstockstrat-config-ui/e2e/global-setup.ts` before `export default async function globalSetup()` documenting the *_ENDPOINT env var wiring pattern.
- Files modified: `services/xstockstrat-config-ui/e2e/global-setup.ts`
- Deviations: none
