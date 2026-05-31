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
