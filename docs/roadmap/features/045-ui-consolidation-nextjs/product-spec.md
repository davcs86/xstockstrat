# Product Spec: ui-consolidation-nextjs

**Created**: 2026-05-29
**Last Updated**: 2026-05-30

---

## Problem Statement

Running three separate Next.js services (`xstockstrat-trader`, `xstockstrat-insights`,
`xstockstrat-config-ui`) plus an `xstockstrat-nginx` reverse proxy consumes four container slots
on DigitalOcean App Platform, each billed and operated independently. Because all three UIs
already use distinct basePaths (`/trader`, `/insights`, `/config-ui`) and nginx only multiplexes
them by path, they can be served from a single Next.js app with no route conflicts and no
user-visible change — collapsing four containers to one and removing nginx as an operational
surface.

## User Story

As an operator, I want all three frontend UIs served from a single Next.js service, so that I can
reduce infrastructure container cost and operational surface area while retaining every existing
URL path, auth flow, and observability behavior.

## Functional Requirements

FR-1. A single consolidated service serves all routes previously handled by the three separate
services under their existing basePaths: `/trader`, `/insights`, `/config-ui`.

FR-2. The root path `/` redirects to `/trader`, preserving the current nginx behavior.

FR-3. Agent SSE and messages endpoints (`/agent/sse`, `/agent/messages`) reach
`xstockstrat-agent` without going through nginx. In the DO environments this is done via App
Platform route rules in `.do/app.dev.yaml` and `.do/app.yaml`; in `docker-compose.yml` the agent
remains directly reachable on its own port (9000).

FR-4. All existing JWT auth flows (login, refresh, logout) continue to function per-basePath:
each app segment keeps its own `/api/auth/*` routes and middleware protection scoped to its own
path prefix.

FR-5. `x-user-id`, `x-access-scope`, and `x-trace-id` headers are stripped from inbound external
requests and re-injected by middleware, replicating the `proxy_set_header` behavior that nginx
performed before removal.

FR-6. All backend calls from the consolidated service continue to reach the correct backend
services via the existing gRPC `*_ENDPOINT` environment variables (backends are gRPC-only; there
are no `*_HTTP_ENDPOINT` vars to carry over).

FR-7. OTel tracing is initialised once at service startup (not once per UI segment) and
propagates `x-trace-id` across all three UI segments.

FR-8. The `xstockstrat-nginx` service — its Dockerfile, `nginx.conf`, and
`docker-entrypoint.sh` — is removed from the repository.

FR-9. `docker-compose.yml`, `.do/app.dev.yaml`, and `.do/app.yaml` are updated to reflect one
consolidated UI service on port 3000, with all four removed services (trader, insights,
config-ui, nginx) deleted from the specs.

FR-10. The three original frontend service directories and the nginx service directory are
removed from `services/` after the consolidated service is verified.

FR-11. The root CLAUDE.md Service Registry, Language Map, and inter-service dependency graph are
updated to reflect the consolidated service.

FR-12. CI Playwright e2e tests for all three UIs are migrated into the consolidated service and
continue to pass.

## Out of Scope

- Any change to backend services (trading, portfolio, marketdata, indicators, ingest, analysis,
  ledger, identity, notify, config, agent).
- Any proto contract or database schema changes (config-ui's direct `pg` access moves into the
  consolidated service unchanged).
- Changing the URL paths visible to end users — basePaths are preserved.
- Introducing a shared component library as a separate package — code is merged directly.
- Adding new features to any UI.
- The Next.js version upgrade itself (feature 041) — see Open Questions for the dependency.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-trader` — merged into consolidated service; directory removed
- `xstockstrat-insights` — merged into consolidated service; directory removed
- `xstockstrat-config-ui` — merged into consolidated service; directory removed
- `xstockstrat-nginx` — removed entirely; agent routes handled by DO App Platform route rules
- consolidated UI service (new) — single Next.js service on port 3000 (name is an Open Question)

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

- [x] No new config keys — all existing gRPC `*_ENDPOINT` env vars are reused by the
  consolidated service

## Database Changes

- [x] No schema changes — config-ui's direct `pg` access moves into the consolidated service
  as-is

## Feature Workflow Notes

Branch to create: `feature/ui-consolidation-nextjs` (branch from `main-dev`).
Approval gates required (per `docs/runbooks/feature-workflow.md`):
- [x] 1 service owner approval (non-breaking — no proto or schema changes)
- [x] Platform lead (service registry change: four services removed, one new service + port
  assignment)
- [ ] 2 service owners + platform lead (breaking proto change) — N/A
- [ ] DBA review + service owner (schema migration) — N/A

## Acceptance Criteria

1. `docker compose up` starts a single consolidated UI container; no trader, insights,
   config-ui, or nginx containers exist.
2. `http://localhost:3000/trader` loads the trading dashboard; login and all existing trading UI
   flows work end-to-end.
3. `http://localhost:3000/insights` loads the analytics dashboard; strategy browsing and market
   data charts work.
4. `http://localhost:3000/config-ui` loads the config management UI; namespace CRUD and audit log
   work (including direct PostgreSQL access).
5. `http://localhost:3000/` redirects to `/trader`.
6. In the DO environments, `/agent/sse` and `/agent/messages` route directly to
   `xstockstrat-agent` via App Platform route rules (no proxy hop through the UI service). In
   local docker-compose the agent is reachable on its own port.
7. JWT auth (login, refresh, logout) works independently on each basePath segment.
8. `x-trace-id` is present on all backend calls made from the consolidated service.
9. OTel traces appear in Grafana Cloud under the consolidated service name.
10. All Playwright e2e tests pass against the consolidated service.
11. The three frontend service directories and `services/xstockstrat-nginx/` no longer exist.
12. `.do/app.dev.yaml` and `.do/app.yaml` each reference only one UI component.

## Open Questions

_Left open for the `/sdd-review product-spec` gate — do not resolve inline._

- [ ] **Consolidated service name.** Adopt a new `xstockstrat-ui` name, or reuse
  `xstockstrat-trader` as the canonical host? A new name is cleaner but touches the service
  registry, OTel service.name, image names, and CI references (feature 038); reuse minimizes
  churn. Decide before impl-spec.
- [ ] **DO routing model.** Single domain with sub-path route rules (one app, path-based
  routing), or a custom domain per basePath? Single-domain is simpler and is the assumed default,
  but confirm it satisfies auth-cookie scoping and the agent route-rule approach.
- [ ] **config-ui `pg` access.** Keep direct `pg` calls in the consolidated app as-is, or isolate
  them in a server-only module to guarantee they never bundle into client code once the apps
  share one build?
- [ ] **Sequencing vs feature 041.** Consolidation requires all three UIs on one Next.js major.
  trader is on 15; insights/config-ui are on 14.2 (feature 041 upgrades them). Should 041 land
  first so this feature merges three already-aligned UIs, or should the consolidation perform the
  version alignment itself? Establishes a merge-order dependency.
- [ ] **Sequencing vs feature 044 (client-api-pattern) and CI feature 038.** 044 migrates SWR →
  react-query in the three source services; 038 builds images referencing the old service names.
  Confirm whether 044 must land before this feature (so the consolidated app absorbs the finished
  hook layer) and how 038's CI references are updated post-consolidation.
