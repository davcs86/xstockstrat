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
