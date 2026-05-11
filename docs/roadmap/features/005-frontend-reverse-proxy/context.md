# Context: frontend-reverse-proxy

**Feature**: `docs/roadmap/features/002-frontend-reverse-proxy/feature.md`
**Product Spec**: `docs/roadmap/features/002-frontend-reverse-proxy/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/002-frontend-reverse-proxy/implementation-spec.md`

---

## Session 2026-05-11 — sdd-story

**User request**: Design a frontend reverse proxy to route all public URLs (`/trader`, `/insights`, `/config-ui`) to the correct service and centralize authentication/middleware.

**Use case**: Blocking — needed soon for shared authentication/middleware and production deployment.

**Decisions**:
1. **Nginx reverse proxy** chosen over Traefik or application-level routing for simplicity and battle-tested reliability.
2. **Path-based routing** (`/trader/*` → trader:3000, etc.) chosen over subdomain routing to avoid DNS complexity and multi-domain TLS.
3. **Next.js basePath** used (not `assetPrefix` alone) to ensure all Next.js internal routing, links, and asset resolution work correctly.
4. **Service-to-service calls unchanged** — backends continue using internal gRPC/Connect-RPC, no changes to service discovery.
5. **Advanced auth middleware** (JWT validation, OAuth2) deferred to Phase 2; Phase 1 provides the infrastructure setup.
6. **TLS/HTTPS** deferred — local dev and DO deployment can use DigitalOcean load balancer or manual nginx cert management (Phase 2).

**Exploration findings** (from prior /sdd-execute):
- Current state: three independent Next.js services on ports 3000/3001/3002, no reverse proxy.
- Branch `claude/frontend-reverse-proxy-fbAOj` exists but not yet merged into main-dev.
- No nginx.conf, no basePath in next.config.js files.
- Service Dockerfiles and docker-compose.yml expose ports directly.

**Artifacts created**:
- feature.md (lifecycle tracker)
- product-spec.md (requirements, governance, acceptance criteria)
- context.md (this file)

**Next action**: `/sdd-review frontend-reverse-proxy product-spec` (AI review gate)

---

## Session 2026-05-11 — sdd-spec

**Implementation spec generated**: 6 concrete steps with exact file paths and codebase evidence.

**Step summary**:
1. Create `nginx.conf` with path-based routing upstream blocks and location rules
2. Create `Dockerfile.nginx` with nginx:1.27-alpine base and healthcheck
3. Update `services/xstockstrat-trader/next.config.js` to add `basePath: '/trader'`
4. Update `services/xstockstrat-insights/next.config.js` to add `basePath: '/insights'`
5. Update `services/xstockstrat-config-ui/next.config.js` to add `basePath: '/config-ui'`
6. Add nginx service to `docker-compose.yml` with port 80 exposure, depends_on all three frontends, healthcheck

**Key findings**:
- No existing nginx.conf or reverse proxy infrastructure in repo
- All three frontends already have `output: 'standalone'` in next.config.js (Phase 5 already added this)
- Frontend services currently expose ports directly: 3000, 3001, 3002; will remain accessible for backwards-compatible debugging
- All service ports confirmed: trader → 3000 (L435), insights → 3001 (L465), config-ui → 3002 (L491) per docker-compose.yml
- Phase 5 deviations already document Next.js build config requirements; basePath is minimal addition
- Connect-RPC calls to backends happen on internal ports (8051, 8052, etc.) and route through service network, not nginx

**Reviewers snapshot** (from registry.md):
- Platform Lead (architecture)
- xstockstrat-trader owner (routing + Connect-RPC safety)
- xstockstrat-insights owner (routing + SSE polling)
- xstockstrat-config-ui owner (routing + config mutations)

**Feature status**: `implementation-ready` (draft product-spec still; `/sdd-review product-spec` recommended before execution)
