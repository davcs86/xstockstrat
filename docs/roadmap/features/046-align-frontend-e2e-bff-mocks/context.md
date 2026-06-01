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
