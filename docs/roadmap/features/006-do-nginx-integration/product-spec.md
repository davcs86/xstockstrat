# Product Spec: do-nginx-integration

**Created**: 2026-05-12

---

## Problem Statement

Feature 005 (frontend-reverse-proxy) established nginx path-based routing (`/trader`, `/insights`, `/config-ui`) in local development via `docker-compose.yml`. However, the DigitalOcean App Platform specs (`.do/app.yaml` for production, `.do/app.dev.yaml` for dev) still expose the three Next.js frontends directly on ports 3000, 3001, and 3002 with no unified entry point. This means the DO deployment does not match the local routing baseline and the three frontends remain separately addressable in production.

## User Story

As a platform operator, I want the DigitalOcean deployment to route all frontend requests through the nginx reverse proxy (just like local docker-compose), so that users access a single unified URL structure and any future auth middleware or rate limiting only needs to be configured in one place.

## Functional Requirements

FR-1. The nginx service (`services/xstockstrat-nginx/Dockerfile`) must be declared as a service in both `.do/app.dev.yaml` (dev) and `.do/app.yaml` (production).
FR-2. The nginx service must be configured as the HTTP ingress service on port 80, replacing any direct port-80 exposure of the frontend services.
FR-3. The three Next.js frontends (`xstockstrat-trader`, `xstockstrat-insights`, `xstockstrat-config-ui`) must remain as internal services — accessible by nginx on the DO internal network but not publicly exposed via their own routes.
FR-4. The routing paths `/trader/*`, `/insights/*`, `/config-ui/*` must resolve correctly through nginx to the respective frontend services, matching the local docker-compose behavior.
FR-5. The nginx `/health` endpoint (`GET /health` → `{"status":"ok","service":"nginx-reverse-proxy"}`) must be usable by DO App Platform health checks.
FR-6. DigitalOcean deploy CI (`deploy-dev.yml` → `doctl apps update`) must succeed after these changes without manual intervention.
FR-7. Service-to-service Connect-RPC calls (e.g. trader → xstockstrat-trading:8051) must remain unaffected — they use the internal DO network, not the nginx HTTP ingress.

## Out of Scope

- TLS/HTTPS termination at nginx level (handled by DigitalOcean load balancer or managed cert at DO ingress layer).
- Auth middleware (JWT validation, OAuth2) — deferred to a future phase per 005 product-spec decisions.
- Rate limiting or CORS headers in nginx (deferred, hooks left as comments in nginx.conf).
- Any changes to backend service DO configurations (only frontend + nginx entries are in scope).

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-trader` — frontend routing changes from direct exposure to nginx-internal
- `xstockstrat-insights` — frontend routing changes from direct exposure to nginx-internal
- `xstockstrat-config-ui` — frontend routing changes from direct exposure to nginx-internal
- `xstockstrat-nginx` (new DO service entry) — nginx reverse proxy declared in app specs

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

- [x] No new config keys

## Database Changes

- [x] No schema changes

## Feature Workflow Notes

Branch to create: `feature/do-nginx-integration` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking infrastructure change)
- [ ] 2 service owners + platform lead (not required — no breaking proto change)
- [ ] DBA review + service owner (not required — no schema migration)

**Dependency**: Feature 005 (`frontend-reverse-proxy`) must be merged to `main-dev` before this feature is deployed. The `services/xstockstrat-nginx/Dockerfile` and `nginx.conf` created by feature 005 must exist on `main-dev` for the DO app spec changes to reference them.

## Acceptance Criteria

1. `doctl apps update --spec .do/app.dev.yaml` succeeds without errors.
2. `doctl apps update --spec .do/app.yaml` succeeds without errors.
3. After dev deployment, `GET <dev-app-url>/health` returns `{"status":"ok","service":"nginx-reverse-proxy"}`.
4. After dev deployment, `GET <dev-app-url>/trader/` returns HTTP 200 with HTML containing `/trader/_next/static/` asset references.
5. After dev deployment, `GET <dev-app-url>/insights/` returns HTTP 200 with HTML containing `/insights/_next/static/` asset references.
6. After dev deployment, `GET <dev-app-url>/config-ui/` returns HTTP 200 with HTML containing `/config-ui/_next/static/` asset references.
7. Backend Connect-RPC calls from trader to xstockstrat-trading:8051 are unaffected (service-to-service on internal DO network).
8. The three frontend services are not publicly accessible via their own DO HTTP routes (only nginx ingress on port 80 is public).

## Open Questions

- [x] DigitalOcean App Platform build context for nginx: DO builds from GitHub — `dockerfile` path `services/xstockstrat-nginx/Dockerfile` and `nginx.conf` at repo root are both reachable from the repo root build context in `.do/app.yaml`. ✓ Confirmed.
- [x] Port configuration in DO App Platform: DO uses `http_port` in the service spec (not the docker `ports` mapping). Nginx listens on port 80 per Dockerfile `EXPOSE 80` directive, matching `http_port: 80` in app specs. ✓ Confirmed.
- [x] Internal service discovery on DO App Platform: nginx upstream blocks in `nginx.conf` will be templated at container startup using `envsubst` to substitute DO private URL env vars (e.g. `${XSTOCKSTRAT_TRADER_PRIVATE_URL}:3000`) instead of container-name DNS. This resolves the mismatch: local docker-compose uses container names, but DO uses private URL env vars. ✓ In-scope for implementation.
