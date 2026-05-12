# Context: frontend-reverse-proxy

**Feature**: `docs/roadmap/features/005-frontend-reverse-proxy/feature.md`
**Product Spec**: `docs/roadmap/features/005-frontend-reverse-proxy/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/005-frontend-reverse-proxy/implementation-spec.md`

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

---

## Session 2026-05-11 — sdd-review impl-spec

**Review result**: ✓ PASS — All 6 steps pass quality checks; valid DAG ordering; no blocking failures.

**Per-step quality**: All steps have populated Codebase Evidence, exact file paths, runnable verification commands, and reference real symbols.

**Step ordering**: Valid DAG. Step 1 → Step 2 (depends on nginx.conf); Steps 3–5 independent; Step 6 depends on Steps 2–5. No circular or forward dependencies.

**Overlap findings** (3 WARN, 0 FAIL):
1. ⚠ `002-broker-accounts-ui` (code-completed) — modifies all 3 frontends; merge-conflict risk on component files. Mitigation: merge frontend-reverse-proxy first (only touches `next.config.js`, not components).
2. ⚠ `003-formula-management-ui` (implementation-ready) — modifies `xstockstrat-insights`. Mitigation: routing baseline merges first.
3. ⚠ `004-make-repo-public-secure` (in-progress) — modifies all 3 frontends and `.do/app.yaml/.dev.yaml`. Mitigation: frontend-reverse-proxy should merge before this so DO app specs can be updated with routing awareness.

**Recommended merge sequence**:
1. `005-frontend-reverse-proxy` (this feature — baseline routing)
2. `002-broker-accounts-ui` (UI features on top)
3. `003-formula-management-ui` (insights additions)
4. `004-make-repo-public-secure` (DO app specs with routing awareness)

**Decision**: No `merge-order.md` entries added (all overlaps are WARN, not FAIL). Merge sequencing is advisory; reviewers should coordinate.

**Feature status**: `implementation-ready` (unchanged — impl-spec review is advisory).

**Next action**: `/sdd-execute frontend-reverse-proxy` — begin step-by-step execution.

---

## Session 2026-05-12 — sdd-spec (refresh)

**Implementation spec regenerated**: Same 6-step shape; refreshed codebase evidence after re-grepping the current tree.

**Key codebase findings (verified this session)**:
- `find -maxdepth 2 -name "nginx*"` and `find -maxdepth 2 -name "Dockerfile.nginx"` → no matches; nothing has been created yet for the reverse proxy.
- `docker-compose.yml` frontend block line numbers shifted since the prior 2026-05-11 spec — the prior spec said trader at L418/435, insights at L447/465, config-ui at L476/491. Current state (verified via Read + grep):
  - `xstockstrat-trader` block L391–413; `container_name` L396; `"3000:3000"` L408.
  - `xstockstrat-insights` block L416–440; `container_name` L421; `"3001:3001"` L436.
  - `xstockstrat-config-ui` block L443–464; `container_name` L448; `"3002:3002"` L457.
  - File is 464 lines total — config-ui is the last service. New nginx block goes at end of `services:`.
- All three frontends use the YAML anchor `<<: *svc` (defined L30 with `networks: [xstockstrat]` + `restart: unless-stopped`). The new nginx service block now uses the same anchor for consistency (the 2026-05-11 spec redundantly inlined `networks:` and `restart:`).
- All three `next.config.js` files are byte-identical to the 2026-05-11 spec snapshots — no `basePath` present, `output: 'standalone'` present in all three. Trader uses the new `serverExternalPackages` key (Next.js 14 stable form); insights and config-ui use the legacy `experimental.serverComponentsExternalPackages` form.

**Spec-level refinements made vs 2026-05-11**:
- Removed the redundant trailing-slash `location /trader/ { proxy_pass http://trader_backend/; }` rules from nginx.conf; the single non-trailing-slash `location /trader { proxy_pass http://trader_backend; }` form is correct for basePath routing (trailing-slash form would strip the prefix and break Next.js).
- Added `proxy_http_version 1.1;` to nginx.conf for correct keep-alive + WebSocket upgrade behaviour.
- Used `<<: *svc` anchor in the new nginx service block (matches the existing app-service convention).
- Verification commands now use `docker compose` (Compose v2, no hyphen) consistent with current tooling.
- Reviewers snapshot now uses the verbatim `Review Focus` strings from `docs/runbooks/reviewer-registry.md` (the prior snapshot paraphrased them).

**Feature status**: `implementation-ready` (unchanged).

**Next action**: `/sdd-review frontend-reverse-proxy impl-spec` to re-validate the refreshed spec, then `/sdd-execute frontend-reverse-proxy`.
