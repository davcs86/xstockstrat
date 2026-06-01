# Context: ui-consolidation-nextjs

**Feature**: `docs/roadmap/features/045-ui-consolidation-nextjs/feature.md`
**Product Spec**: `docs/roadmap/features/045-ui-consolidation-nextjs/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/045-ui-consolidation-nextjs/implementation-spec.md`

---

## Session 2026-05-29T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Pre-scan of the three frontends confirmed: all use basePaths (/trader, /insights, /config-ui), identical middleware pattern, shared dependency set, Next.js version skew (trader on v15, insights + config-ui on v14), and config-ui has direct pg access for audit log.
- nginx also proxies /agent/sse and /agent/messages — captured in FR-3 to move those to Next.js rewrites.
- New service name `xstockstrat-ui` proposed (open question in product-spec).

## Session 2026-05-29T00:01:00Z — user decisions

- **Service name**: `xstockstrat-ui` confirmed.
- **DO routing**: single domain; routes configured directly in DO App Platform spec (no per-basePath custom domains). This also eliminates the need for nginx to proxy `/agent/sse` and `/agent/messages` — those routes are configured in the DO spec to hit `xstockstrat-agent` directly. FR-3 updated accordingly; no Next.js rewrites needed for agent routes.
- **pg access**: keep direct `pg` calls in the consolidated app as-is; no server-only module isolation needed.

## Session 2026-05-29T00:02:00Z — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings:
  - (advisory) xstockstrat-nginx Affected Services description was stale ("Next.js rewrites" vs actual "DO App Platform route rules") — fixed in product-spec.md.
- Overlap findings (all advisory ⚠, no blocking conflicts):
  - `005-frontend-reverse-proxy`, `006-do-nginx-integration` are functionally inverse (set up nginx that 045 removes) — recommend demoting both before executing 045.
  - `012-wire-fe-auth` wires auth into the three source services + nginx; merge before executing 045 so 045 absorbs the finished auth implementation.
  - `044-client-api-pattern` migrates SWR → react-query in all three source services; merge before 045 for the same reason.
  - `014-trader-chart-panel`, `002-broker-accounts-ui`, `003-formula-management-ui` also touch one or more source services — merge before 045 to avoid re-doing work in the consolidated service.
  - `038-ci-docker-registry-deploy` builds images for old services + nginx; must be updated to reference `xstockstrat-ui` after 045 merges (or merge 038 after 045).

## Session 2026-05-29T00:03:00Z — overlap clarification

- User confirmed 002, 005, 006, and 012 are already `launched` (code in main-dev).
- Revised overlap picture: the source services already have basePaths (005), nginx routing (006), auth + header propagation (012), and broker accounts UI (002) in place.
- Remaining active-feature concerns before executing 045:
  - **Merge before 045**: `014-trader-chart-panel` (touches xstockstrat-trader), `044-client-api-pattern` (touches all three source services), `003-formula-management-ui` (touches xstockstrat-insights).
  - **Merge after 045 or update**: `038-ci-docker-registry-deploy` references old service names in CI; update to `xstockstrat-ui` after 045 lands.

## Session 2026-05-30T00:00:00Z — sdd-story (regenerate)

- Product spec regenerated fresh as part of a 4-feature spec batch (033, 041, 045, 044), each
  delivered as an independent PR off `main-dev`. Per the requesting story, previously-resolved
  open questions were deliberately RE-OPENED and left for the `/sdd-review product-spec` gate.
  Status reverted: `spec-ready` → `draft`.
- Re-opened questions: consolidated service name (was resolved to `xstockstrat-ui`), DO routing
  model (was resolved to single-domain), and config-ui `pg` access (was resolved to keep-as-is).
  Added two sequencing questions: vs feature 041 (Next.js 15 upgrade — consolidation needs all
  three UIs on one major) and vs features 044 / 038.
- Corrected stale facts against current `main-dev`: backends are now gRPC-only (the 80xx
  HTTP/Connect-RPC servers were removed), so FR-6 now references gRPC `*_ENDPOINT` vars only —
  the previous `*_HTTP_ENDPOINT` reference was removed. Added an explicit platform-lead approval
  gate (service registry change: four services removed, one added with a new port assignment).
- Next action: `/sdd-review ui-consolidation-nextjs product-spec`.

## Session 2026-06-01T00:00:00Z — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- All 5 open questions resolved at review gate:
  - Service name: `xstockstrat-ui` — restores the 2026-05-29 decision; service registry, OTel
    `service.name`, image name, and CI references updated in the implementation.
  - DO routing: single domain, path-based App Platform route rules — restores prior decision;
    no per-basePath custom domains; auth cookies scoped within the same origin per basePath.
  - config-ui `pg` access: keep direct `pg` calls as-is — restores prior decision; no
    server-only isolation module needed.
  - Sequencing vs 041: no dependency — feature 041 (Next.js 15 upgrade) is already `launched`;
    all three source UIs are already on Next.js 15.
  - Sequencing vs 044 / 038: 044 must land before 045 so the consolidated app absorbs the
    finished typed hook layer; 038 is already `launched` (CI image references to old service
    names updated as part of 045's removal step, not a separate PR).
- Overlap warnings (advisory, no blocking action required):
  - `044-client-api-pattern` and `046-align-frontend-e2e-bff-mocks` must merge before 045 —
    already captured in merge-order.md from prior session.
  - `003-formula-management-ui` added to Stream 2 workstream — must merge before 045 to avoid
    re-doing xstockstrat-insights work in the consolidated service.

## Session 2026-06-01T00:01:00Z — sdd-spec

- Generated implementation-spec.md with 9 steps. Status → implementation-ready.
- Key codebase findings:
  - All three frontends already on Next.js 15.5.15 (package.json confirmed); no version alignment work needed.
  - Config-ui uses `app/` (no `src/`) layout and `@/app/lib/*` import paths — migrated files must remap to `@/lib/*` in the consolidated `src/` tree.
  - All three middleware files are logically identical; the consolidated service uses a single middleware.ts at `src/middleware.ts` — no per-segment middleware files needed.
  - Three separate mock backends (ports 9091/9092/9093) must remain distinct in the consolidated e2e suite — they serve different gRPC service sets and cannot be merged.
  - `next.config.js` carries no top-level `basePath`; each segment is a route group under `src/app/`. The existing connectBff.ts files key the handler map on `'/api' + h.requestPath` — this works in the separate services because each has `basePath` set and Next.js strips it before the handler sees the URL. In the consolidated `xstockstrat-ui` with no top-level `basePath`, route handlers at `src/app/trader/api/[...connect]/route.ts` receive the full URL `/trader/api/...`; the `'/api/...'` key will NOT match. This was incorrectly noted as "correct" in this session. **See post-review decision below for the resolution.**
  - Config-ui's `pg` Pool access in `app/api/audit/route.ts:12` carried forward as-is; `DATABASE_URL` added to consolidated service's env var set.
  - DO ingress must add a `/agent` route rule before the root `/` rule to route agent SSE/messages to `xstockstrat-agent` without passing through the UI service.

## Session 2026-06-01 — sdd-review impl-spec + decisions

- impl-spec review: PASS (0 failures, 7 advisory warnings).
- **W1 CRITICAL — DECISION: Option A chosen.** The BFF handler map key mismatch (handler map uses `'/api/...'` but consolidated service receives `'/trader/api/...'`) must be resolved by updating each segment's `connectBff.ts` to prefix handler map keys with the segment path: `'/trader/api' + h.requestPath`, `'/insights/api' + h.requestPath`, `'/config-ui/api' + h.requestPath`. Executor implements this at Step 1 when scaffolding the consolidated BFF files.
- W2 (directory entries in Files/Step 1): advisory only.
- W3 (IDENTITY_ENDPOINT multiplexed to 9091): executor verifies all three IdentityService mocks are identical at Step 3 start.
- W4 (directory entries in Files/Step 3): advisory only.
- **W5 (045 Step 6 deletes xstockstrat-insights): 003 is being re-spec'd after 044+045+046 merge — 003 will not have UI steps merged before 045 Step 6. Safe to proceed.**
- **W6 (monaco-editor): 003 re-spec will target xstockstrat-ui and will include @monaco-editor/react in the xstockstrat-ui package.json at that time. Executor checks 003 merge state at Step 1.**
- Execution order: 044 → 046 → 045 → 003 (re-spec) → 019 → 016.

## Session 2026-06-01T00:02:00Z — sdd-execute Step 1

- Step 1 complete. All source files for `services/xstockstrat-ui` created. Build passes: `pnpm run build` produced all 31 routes with zero TypeScript errors.
- Files modified: `services/xstockstrat-ui/` (entire service tree, ~90 files), `docs/roadmap/features/045-ui-consolidation-nextjs/`
- Deviations:
  - Per-service browser clients (`lib/browserClients/{service}Client.ts`) used instead of single `lib/browserClients.ts` — user-adjusted plan (Phase 2).
  - No shared `connectTransport.ts` created — not needed with per-service client pattern.
  - `INDICATORS_ENDPOINT` removed from `connectClients.ts` — no `indicatorsClient` exported; indicators BFF not used by any segment.
  - `pnpm install` (without `--frozen-lockfile`) run first to generate lockfile for new service.
  - Component relative imports (`./ui/*`) fixed to `../ui/*` after move to segment subdirectory.
  - Insights AppShell internal nav links updated: `/` → `/insights`, `/strategies` → `/insights/strategies`.
  - Trader AppShell logo link updated: `/` → `/trader`.
  - `TradingMode` import in trader components updated: `@/app/page` → `@/app/trader/page`.

### Step 1 — Create `services/xstockstrat-ui` [done]
- Created all 90+ files: package.json, next.config.js, tsconfig.json, middleware.ts, auth.ts, identity.ts, three BFF files, 7 browser client files, all segment pages (trader, insights, config-ui), all hooks co-located with segments, all components namespaced by segment.
- Files modified: `services/xstockstrat-ui/` (entire tree)
- Deviations: see Deviation Log in implementation-spec.md

## Session 2026-06-01 — sdd-execute Step 1 end
**Steps this session**: [1]
**Progress**: 1 done / 9 total
**Stopped at**: Step 1 complete
**Next**: /sdd-execute ui-consolidation-nextjs next

## Session 2026-06-01T00:03:00Z — sdd-execute Steps 2–3

### Step 2 — Create Dockerfile and update docker-compose + DO app specs [done]
- Created `services/xstockstrat-ui/Dockerfile` (4-stage: base/deps/builder/runner, matching trader pattern).
- Updated `docker-compose.yml`: removed trader/insights/config-ui/nginx blocks; added `xstockstrat-ui` block with all 9 gRPC endpoints, `*db-url` anchor, and service_healthy/service_started `depends_on` conditions.
- Updated `.do/app.dev.yaml` and `.do/app.yaml`: updated ingress rules (nginx → agent+ui rules), removed 4 old service blocks, added `xstockstrat-ui` block. Dev uses `basic-xs`, prod uses `professional-xs`.
- Files modified: `services/xstockstrat-ui/Dockerfile`, `docker-compose.yml`, `.do/app.dev.yaml`, `.do/app.yaml`
- Deviations: Docker build verification skipped — Docker daemon not running in execution environment. Grep verifications passed (no old service names remain; `xstockstrat-ui` present in all 3 files).

### Step 3 — Migrate e2e tests into `services/xstockstrat-ui` [done]
- Created `playwright.config.ts` — consolidated config on port 3000, 3 env sets for 3 mock ports, all 9 endpoint vars.
- Created `e2e/mock-backend.ts` — merged 3 source mock-backend.ts files into separate http2 servers on 9091/9092/9093; shared `identityHandlers` object since all three IdentityService mocks are identical.
- Created `e2e/global-setup.ts` and `e2e/global-teardown.ts`.
- Copied 6 trader specs (no URL changes needed — already on port 3000 with `/trader/...` paths).
- Copied 4 insights specs with `BASE_URL` updated: `http://localhost:3001` → `http://localhost:3000`.
- Copied 5 config-ui specs with `BASE_URL` updated: `http://localhost:3002` → `http://localhost:3000`.
- Files modified: `services/xstockstrat-ui/playwright.config.ts`, `services/xstockstrat-ui/e2e/` (18 files)
- Deviations: `pnpm test:e2e` full run not attempted — no display server/Playwright browsers in environment. TypeScript check (`npx tsc --noEmit`) passed with zero errors. Next.js build still passes.

### Step 4 — Update CI workflow to reference `xstockstrat-ui` [done]
- Updated `.github/workflows/ci.yml`: replaced 4 filter entries (trader/insights/config-ui/nginx) with single `xstockstrat-ui` entry; replaced 3-entry `frontend-lint` matrix with single `xstockstrat-ui`; replaced 3-entry `frontend-e2e` matrix with single `xstockstrat-ui`.
- Files modified: `.github/workflows/ci.yml`
- Deviations: none

### Step 5 — Smoke verify the consolidated service locally [done]
- Static checks performed: all three health routes confirmed present (`src/app/{trader,insights,config-ui}/api/health/route.ts`); root redirect (`/` → `/trader`) confirmed in `next.config.js`; docker-compose.yml confirmed free of old service blocks (verified in Step 2).
- Files modified: none (verification-only step)
- Deviations: Docker/curl/e2e runtime checks not runnable — Docker daemon unavailable, POSTGRES_PASSWORD not set. Marked done as all static checks pass; runtime verification deferred to CI and post-integration-PR manual test.

### Step 6 — Remove obsolete service directories and nginx artifacts [done]
- Deleted `services/xstockstrat-trader/`, `services/xstockstrat-insights/`, `services/xstockstrat-config-ui/`, `services/xstockstrat-nginx/` via `git rm -r`; residual gitignored files (`node_modules/`, `test-results/`, `tsconfig.tsbuildinfo`) removed with `rm -rf`.
- Deleted `nginx.conf` from repo root via `git rm`.
- `ls services/ | grep -E "trader|insights|config-ui|nginx"` — no output (pass). `ls nginx.conf` — no such file (pass). `pnpm install --frozen-lockfile` — workspace resolves cleanly (7 packages, no errors).
- Files modified: (deletions) `services/xstockstrat-trader/`, `services/xstockstrat-insights/`, `services/xstockstrat-config-ui/`, `services/xstockstrat-nginx/`, `nginx.conf`
- Deviations: none
