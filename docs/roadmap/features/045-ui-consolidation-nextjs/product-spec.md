# Product Spec: ui-consolidation-nextjs

**Created**: 2026-05-29

---

## Problem Statement

Running three separate Next.js services plus an nginx reverse proxy consumes 4 container slots on DigitalOcean App Platform, each billed independently. Since all three UIs already use distinct basePaths (`/trader`, `/insights`, `/config-ui`), they can be served from a single Next.js app with no route conflicts and no user-visible change.

## User Story

As an operator, I want all three frontend UIs (trader, insights, config-ui) served from a single Next.js service, so that I can reduce infrastructure container costs and operational surface area while retaining all existing functionality and URL paths.

## Functional Requirements

FR-1. The consolidated service (`xstockstrat-ui`) serves all routes previously handled by the three separate services under their existing basePaths: `/trader`, `/insights`, `/config-ui`.

FR-2. The root path `/` redirects to `/trader` (preserving the current nginx behavior).

FR-3. Agent SSE and messages endpoints (`/agent/sse`, `/agent/messages`) are routed directly to `xstockstrat-agent` via DO App Platform route rules in `.do/app.dev.yaml` and `.do/app.yaml` — no nginx and no Next.js rewrites needed. In `docker-compose.yml` the agent service remains directly accessible on its own port (9000).

FR-4. All existing JWT auth flows (login, refresh, logout) continue to function per-basePath: each app segment retains its own `/api/auth/*` routes and middleware protection covering only its own path prefix.

FR-5. `x-user-id`, `x-access-scope`, and `x-trace-id` headers are stripped from inbound external requests and re-injected by middleware (replicating the nginx `proxy_set_header` behavior that was removed).

FR-6. All Connect-RPC backend calls from the consolidated service continue to reach the correct backend services via the existing `*_HTTP_ENDPOINT` / `*_ENDPOINT` environment variables.

FR-7. OTel tracing is initialised once at service startup (not once per UI segment) and propagates `x-trace-id` across all three UI segments.

FR-8. The `xstockstrat-nginx` service and its Dockerfile, `nginx.conf`, and `docker-entrypoint.sh` are removed from the repository.

FR-9. `docker-compose.yml`, `.do/app.dev.yaml`, and `.do/app.yaml` are updated to reflect one `xstockstrat-ui` service on port 3000, with all four removed services (trader, insights, config-ui, nginx) deleted from the specs.

FR-10. The three original service directories (`services/xstockstrat-trader/`, `services/xstockstrat-insights/`, `services/xstockstrat-config-ui/`) and the nginx service directory (`services/xstockstrat-nginx/`) are removed after the consolidated service is verified.

FR-11. The root CLAUDE.md Service Registry and Language Map are updated to reflect the new consolidated service.

FR-12. CI Playwright e2e tests for all three UIs are migrated into the consolidated service and continue to pass.

## Out of Scope

- Any change to backend services (trading, portfolio, marketdata, indicators, ingest, analysis, ledger, identity, notify, config, agent).
- Any proto contract changes.
- Any database schema changes.
- Changing the URL paths visible to end users (basePaths are preserved).
- Introducing a shared component library as a separate package — code is merged directly.
- Adding new features to any UI.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-trader` — merged into consolidated service; directory removed
- `xstockstrat-insights` — merged into consolidated service; directory removed
- `xstockstrat-config-ui` — merged into consolidated service; directory removed
- `xstockstrat-nginx` — removed entirely (no replacement needed; agent routes handled by DO App Platform route rules)
- `xstockstrat-ui` (new) — new consolidated Next.js service on port 3000

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

- [x] No new config keys — all existing `*_HTTP_ENDPOINT` and `*_ENDPOINT` env vars are reused by the consolidated service

## Database Changes

- [x] No schema changes — `config-ui`'s direct `pg` access moves into the consolidated service as-is

## Feature Workflow Notes

Branch to create: `feature/ui-consolidation-nextjs` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking — no proto or schema changes)
- [ ] 2 service owners + platform lead (breaking proto change) — N/A
- [ ] DBA review + service owner (schema migration) — N/A

## Acceptance Criteria

1. `docker compose up` starts a single `xstockstrat-ui` container; no trader, insights, config-ui, or nginx containers exist.
2. `http://localhost:3000/trader` loads the trading dashboard; login and all existing trading UI flows work end-to-end.
3. `http://localhost:3000/insights` loads the analytics dashboard; strategy browsing and market data charts work.
4. `http://localhost:3000/config-ui` loads the config management UI; namespace CRUD and audit log work (including direct PostgreSQL access).
5. `http://localhost:3000/` redirects to `/trader`.
6. In the DO environments, `/agent/sse` and `/agent/messages` route directly to `xstockstrat-agent` via App Platform route rules (no proxy hop through the UI service). In local docker-compose, the agent is reachable on its own port.
7. JWT auth (login, refresh, logout) works independently on each basePath segment.
8. `x-trace-id` header is present on all backend calls made from the consolidated service.
9. OTel traces appear in Grafana Cloud under the new service name `xstockstrat-ui`.
10. All Playwright e2e tests pass against the consolidated service.
11. `services/xstockstrat-trader/`, `services/xstockstrat-insights/`, `services/xstockstrat-config-ui/`, and `services/xstockstrat-nginx/` no longer exist in the repository.
12. `.do/app.dev.yaml` and `.do/app.yaml` each reference only one UI component (`xstockstrat-ui`).

## Open Questions

- [x] ~~Should the consolidated service keep the name `xstockstrat-ui` or reuse `xstockstrat-trader` as the canonical name?~~ **Resolved**: `xstockstrat-ui`.
- [x] ~~Does the DigitalOcean dev app need a custom domain per basePath, or is a single domain with sub-paths sufficient?~~ **Resolved**: single domain; routes configured directly in DO App Platform spec.
- [x] ~~Should the `pg` dependency (currently in config-ui for audit log reads) be isolated in a server-only module, or is the current direct pattern acceptable in the consolidated app?~~ **Resolved**: keep direct `pg` calls as-is.
