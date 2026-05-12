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

## Session 2026-05-11 — sdd-execute

**Boot**: Loaded authoritative spec from `origin/main-dev` (feature branch `feature/frontend-reverse-proxy` not yet pushed; created during BRANCH SYNC for Step 1).

**Branch model decision**: User selected the SDD branch model (integration branch `feature/frontend-reverse-proxy` + per-step `feature-steps/<slug>-step-N` sub-branches), not the harness-assigned `claude/frontend-reverse-proxy-next-MXsoC` branch.

### Step 1 — Create nginx reverse proxy configuration [done]
- Wrote `nginx.conf` at repo root with three upstream blocks (trader/insights/config_ui), six location blocks (`/trader`, `/trader/`, `/insights`, `/insights/`, `/config-ui`, `/config-ui/`), `/health` endpoint returning JSON, and proxy directives for streaming (`proxy_buffering off`, `Connection: upgrade`).
- Files modified: `nginx.conf`
- Deviations: 1 — verification (`nginx -t`) not runnable in sandbox (no Docker daemon, no local nginx, apt mirrors 404). Tracked as follow-up to Step 6, which builds + starts the full stack and would fail fast if the config is invalid. Full detail in Deviation Log.

### Step 2 — Create Dockerfile for nginx reverse proxy [done]
- Wrote `services/xstockstrat-nginx/Dockerfile` (moved from repo root to treat nginx as a service) with nginx:1.27-alpine base, COPY nginx.conf, HEALTHCHECK (10s/3s/5s/3r), EXPOSE 80, CMD with daemon off
- Files modified: `services/xstockstrat-nginx/Dockerfile`
- Deviations: 2 — (1) location moved to services/ per user feedback; (2) verification (`docker build`) not runnable in sandbox (no Docker daemon). Same as Step 1; deferred to Step 6 full-stack integration test.

## Open Items

| Item | Earliest step | Notes |
|---|---|---|
| Confirm `docker build` passes against `Dockerfile.nginx` | Step 6 | Step 6 verification runs `docker-compose build` + `docker-compose up -d`; Docker will fail if Dockerfile is invalid. If Step 6 verification runs in an env with Docker, this gap closes automatically.

### Session summary
**Steps this session**: [2]
**Progress**: 2 done / 6 total
**Stopped at**: Step 2 (per-step PR opened; SDD rule = one step per session)
**Next**: `/sdd-execute frontend-reverse-proxy next`

---

## Session 2026-05-12 — sdd-execute

**Boot**: Loaded authoritative spec from `origin/feature/frontend-reverse-proxy`. Current harness branch was `claude/frontend-reverse-proxy-next-3K9pE`; user reaffirmed SDD branch model (integration `feature/frontend-reverse-proxy` + per-step `feature-steps/<slug>-step-N` sub-branches). Ran BRANCH SYNC: checked out `feature/frontend-reverse-proxy`, merged latest `origin/main-dev` with `-X ours`, pushed integration branch, created `feature-steps/frontend-reverse-proxy-step-3`.

### Step 3 — Update xstockstrat-trader next.config.js with basePath [done]
- Added `basePath: '/trader'` to `services/xstockstrat-trader/next.config.js`. Preserved existing `output: 'standalone'`, `serverExternalPackages: ['@connectrpc/connect-node']`, and the existing inline comment.
- Verification: `pnpm install && pnpm run build` succeeded; `.next/required-server-files.json` confirms `"basePath": "/trader"`. 10 routes generated (all served under `/trader` prefix at runtime).
- Files modified: `services/xstockstrat-trader/next.config.js`
- Deviations: none

### Session summary
**Steps this session**: [3]
**Progress**: 3 done / 6 total
**Stopped at**: Step 3 (per-step PR will be opened; SDD rule = one step per session)
**Next**: `/sdd-execute frontend-reverse-proxy next`

---

## Session 2026-05-12 — sdd-execute

**Boot**: Loaded authoritative spec from `origin/feature/frontend-reverse-proxy`. Current harness branch was `claude/frontend-reverse-proxy-next-U1TAC`; following SDD branch model per prior session reaffirmations. Ran BRANCH SYNC: checked out `feature/frontend-reverse-proxy` (already up to date with `origin/main-dev`), created `feature-steps/frontend-reverse-proxy-step-4`.

### Step 4 — Update xstockstrat-insights next.config.js with basePath [done]
- Added `basePath: '/insights'` to `services/xstockstrat-insights/next.config.js`. Preserved existing `output: 'standalone'` and `experimental.serverComponentsExternalPackages: ['@connectrpc/connect-node']`.
- Verification: `pnpm install && pnpm run build` succeeded; `.next/required-server-files.json` confirms `"basePath": "/insights"` and `"assetPrefix": "/insights"`. 10 routes generated (all served under `/insights` prefix at runtime).
- Files modified: `services/xstockstrat-insights/next.config.js`
- Deviations: none

### Session summary
**Steps this session**: [4]
**Progress**: 4 done / 6 total
**Stopped at**: Step 4 (per-step PR will be opened; SDD rule = one step per session)
**Next**: `/sdd-execute frontend-reverse-proxy next`
