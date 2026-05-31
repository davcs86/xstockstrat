# Product Spec: align-frontend-e2e-bff-mocks

**Created**: 2026-05-31

---

## Problem Statement

The Next.js frontend Playwright e2e suites mock the backend at endpoint env vars that the runtime no longer reads, so they cannot exercise the connect-web → BFF → backend gRPC path adopted by `044-client-api-pattern`. As a result, data-dependent e2e specs can't validate the unified API pattern, and regressions like the broker-account registration bug (PR #451) are not caught by CI.

## User Story

As a platform developer, I want the frontend Playwright e2e suites (trader, insights, config-ui) to exercise the connect-web → BFF → backend gRPC path against a reachable mock, so that CI validates the unified `044-client-api-pattern` end-to-end — including server-streaming alerts.

## Background

- After `044-client-api-pattern` (+ PR #451 for trader), browser Client Components call backend RPCs via `@connectrpc/connect-web` typed clients → the Connect BFF (`src/app/api/[...connect]/route.ts` → `connectBff.ts`) → backend gRPC services via `connectClients.ts` (`createGrpcTransport`, H2C).
- `connectClients.ts` reads `<SERVICE>_ENDPOINT` (`host:port`). The trader e2e harness (`e2e/mock-backend.ts` + `playwright.config.ts` `webServer.env`) starts an HTTP `connect+json` mock on port 9091 and points `<SERVICE>_HTTP_ENDPOINT` at it. **No runtime code reads `*_HTTP_ENDPOINT`**, so the BFF's gRPC clients dial the unreachable defaults (e.g. `xstockstrat-trading:50051`) during tests.
- Root CLAUDE.md already notes `*_HTTP_ENDPOINT` is legacy/test-only and unread at runtime.

## Functional Requirements

FR-1. The e2e harness MUST stand up a backend mock reachable by the server-side gRPC clients — either an H2C gRPC mock addressed via `<SERVICE>_ENDPOINT`, or a documented test-only transport override — so the full browser → BFF → backend path resolves in tests.
FR-2. `playwright.config.ts` `webServer.env` MUST be updated to the chosen mechanism (`*_ENDPOINT` or override) and the dead `*_HTTP_ENDPOINT` vars removed.
FR-3. The mock MUST cover every RPC the frontends call through the BFF, including server-streaming `NotifyService.StreamAlerts` for the trader `AlertStream`.
FR-4. Mock responses MUST be consumable by the connect-web/protobuf-es clients (correct framing/field names/enums) so component assertions see realistic data.
FR-5. The same approach MUST be applied consistently across all three frontends (trader, insights, config-ui), each with its own service set.
FR-6. Existing e2e specs MUST be updated where they assumed the old JSON-route data shape; the suites MUST pass in CI.

## Out of Scope

- Any change to production runtime code or the connect-web/BFF pattern itself (covered by `044-client-api-pattern` / PR #451).
- Adding new product features or UI; this is test-infrastructure alignment only.
- Backend service e2e/integration tests outside the Next.js frontends.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-trader` — e2e mock + specs; includes `StreamAlerts` server-streaming path.
- `xstockstrat-insights` — e2e mock + specs for analysis/marketdata/portfolio/trading reads.
- `xstockstrat-config-ui` — e2e mock + specs for config/ingest; audit route remains direct-DB.

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

- [x] No new config keys

## Database Changes

- [x] No schema changes

## Feature Workflow Notes

Branch to create: `feature/align-frontend-e2e-bff-mocks` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval — `test` category, non-breaking, test-infrastructure only
- [ ] 2 service owners + platform lead (breaking proto change) — N/A
- [ ] DBA review + service owner (schema migration) — N/A

## Acceptance Criteria

1. With the mock running, the trader, insights, and config-ui e2e suites pass in CI without any real backend services.
2. The trader `AlertStream` spec receives at least one alert through the connect-web server-streaming path (not SSE).
3. `playwright.config.ts` no longer sets `*_HTTP_ENDPOINT`; the mock is reached via the same env/transport the BFF actually uses.
4. A short note in each frontend's CLAUDE.md (or a shared doc) explains how the e2e backend mock is wired to the BFF.

## Open Questions

- [ ] H2C gRPC mock vs. a test-only transport override in `connectClients.ts` — which is simpler/more robust given the BFF uses `createGrpcTransport`?
- [ ] Can a single shared mock module be reused across all three frontends, or does each need its own service-set fixture?
- [ ] How should `StreamAlerts` be mocked for a deterministic, bounded stream in tests (emit N alerts then end)?
