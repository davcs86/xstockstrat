# Product Spec: frontend-reverse-proxy

**Created**: 2026-05-11

---

## Problem Statement

The xstockstrat platform currently exposes three independent Next.js frontends (trader, insights, config-ui) on separate ports and domains. This creates operational friction: users must manage three different URLs, authentication and security middleware are duplicated across services, and cross-cutting concerns (CORS, rate limiting, security headers, JWT validation) are not centralized. A single reverse-proxy entry point would unify the user experience, centralize authentication, and reduce service-level middleware complexity.

## User Story

As a user of the xstockstrat platform, I want to access all three frontends (trader, insights, config-ui) through a unified public URL (e.g., `app.example.com/trader`, `app.example.com/insights`, `app.example.com/config-ui`) so that I can benefit from centralized authentication and middleware (CORS policies, rate limiting, security headers, JWT validation) instead of managing three separate domains and replicating auth logic across services.

## Functional Requirements

FR-1. Nginx reverse proxy listens on port 80 (HTTP) and routes requests based on path to the correct frontend service.

FR-2. Path-based routing:
- Requests to `/trader/*` → `xstockstrat-trader:3000`
- Requests to `/insights/*` → `xstockstrat-insights:3001`
- Requests to `/config-ui/*` → `xstockstrat-config-ui:3002`

FR-3. Each frontend is configured with a matching `basePath` in `next.config.js` so that all Next.js internal routing, links, and asset paths work relative to the reverse proxy path.

FR-4. HTTP headers are properly forwarded through the reverse proxy:
- `Host`, `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto` headers are set correctly.
- Proxy headers allow backends to understand the original client and protocol.

FR-5. The reverse proxy is operational in both local development (Docker Compose) and production (DigitalOcean App Platform).

FR-6. Service-to-service calls (e.g., trader → trading service) continue to use internal gRPC and Connect-RPC ports and are unaffected by the reverse proxy.

FR-7. Reverse proxy supports centralized middleware setup for:
- Advanced authentication (JWT validation, OAuth2 — implementation optional, setup infrastructure provided)
- CORS policy enforcement
- Rate limiting
- Security headers (CSP, X-Frame-Options, etc.)

## Out of Scope

- TLS/HTTPS certificate automation (will be added in a future phase)
- Advanced rate limiting rules (basic infrastructure provided; can be configured later)
- API gateway features beyond reverse proxying (service discovery, load balancing beyond round-robin)
- Reverse proxy for backend services (only frontend routing in scope)
- Breaking changes to service APIs or proto contracts

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-trader` — frontend UI, requires `basePath: '/trader'` in next.config.js
- `xstockstrat-insights` — frontend UI, requires `basePath: '/insights'` in next.config.js
- `xstockstrat-config-ui` — frontend UI, requires `basePath: '/config-ui'` in next.config.js

## Proto Contract Changes

- [x] No proto changes required

All proto contracts remain unchanged. The reverse proxy is a routing layer and does not affect gRPC or Connect-RPC contracts.

## Config Key Changes

- [x] No new config keys

No new configuration keys are required. The reverse proxy uses static nginx configuration.

## Database Changes

- [x] No schema changes

No database schema changes are required.

## Feature Workflow Notes

Branch to create: `feature/frontend-reverse-proxy` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] No proto changes (so "Proto Reviewer" approval not needed)
- [ ] Service owner approval from `xstockstrat-trader`, `xstockstrat-insights`, `xstockstrat-config-ui` (recommended: 1 approval)
- [ ] Platform Lead approval (for routing architecture and docker-compose/DO app spec changes)

## Acceptance Criteria

1. Nginx reverse proxy is defined in `nginx.conf` and builds successfully via `Dockerfile.nginx`.
2. `docker-compose.yml` includes nginx service on port 80, with all three frontends on their internal ports.
3. All three frontends have `basePath` configured in `next.config.js` (`/trader`, `/insights`, `/config-ui` respectively).
4. Local dev: access `http://localhost/trader`, `http://localhost/insights`, `http://localhost/config-ui` and verify each frontend loads correctly.
5. Internal links in each frontend (Next.js `<Link>`, `next/image`, static assets) resolve correctly with the basePath.
6. Service-to-service Connect-RPC calls (e.g., trader → trading service) continue to work without routing through nginx.
7. `.do/app.yaml` and `.do/app.dev.yaml` updated to expose nginx as the public HTTP service.
8. Production deployment (DigitalOcean App Platform) exposes single public URL with path-based routing working as expected.

## Open Questions

- [ ] Should TLS termination happen at nginx or via DigitalOcean load balancer? (TLS scope to be determined in Phase 2)
- [ ] Should advanced auth middleware (JWT validation) be configured in Phase 1 or deferred to Phase 2?
