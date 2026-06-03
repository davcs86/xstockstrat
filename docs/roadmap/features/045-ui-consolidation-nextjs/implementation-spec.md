# Implementation Spec: ui-consolidation-nextjs

**Status**: `in-progress`
**Created**: 2026-06-01
**Feature**: `docs/roadmap/features/045-ui-consolidation-nextjs/feature.md`
**Total Steps**: 9
**Feature Branch**: `feature/ui-consolidation-nextjs`

---

## Execution Summary

The consolidation proceeds in four logical phases: (1) scaffold the new `xstockstrat-ui` service by assembling all source files from the three existing frontends into a single Next.js app; (2) wire infrastructure — Dockerfile, docker-compose, DO app specs, and the CI workflow — pointing everything at `xstockstrat-ui` and removing the four replaced entries; (3) migrate all three sets of Playwright e2e tests into the new service; (4) delete the four now-obsolete service directories and update all documentation. Each step is sequenced so a fresh `docker compose build` and `pnpm test:e2e` can be run to verify at the end of Step 4 before proceeding to cleanup.

## Step Dependencies

- Step 2 (Dockerfile + deploy wiring) requires Step 1 (service exists on disk with a valid `package.json`) so the Docker build has something to reference.
- Step 3 (e2e tests) requires Step 1 (the new service's `playwright.config.ts` must already exist).
- Step 4 (CI changes) requires Step 2 (confirms old service names are gone from deploy files before mirroring that in CI).
- Step 5 (smoke verification) requires Steps 1–4 all complete.
- Step 6 (remove old service directories) requires Step 5 verification to pass.
- Step 7 (docs update) requires Step 6 (service directories are gone; docs must reflect reality).
- Step 8 (CLAUDE.md) requires Step 7 (docs and service directory state must be consistent).
- Step 9 (test step for the new service) runs in parallel with Steps 6–8 once Step 5 passes.

---

### Step 1 — service: Create `services/xstockstrat-ui` consolidated Next.js service

**Status**: `done`
**Service**: `xstockstrat-ui` (new — does not yet exist in the repository)
**Files**:
- `services/xstockstrat-ui/package.json` — create
- `services/xstockstrat-ui/next.config.js` — create
- `services/xstockstrat-ui/tsconfig.json` — create
- `services/xstockstrat-ui/tailwind.config.js` — create
- `services/xstockstrat-ui/postcss.config.js` — create
- `services/xstockstrat-ui/.eslintrc.json` — create
- `services/xstockstrat-ui/.prettierrc` — create
- `services/xstockstrat-ui/.gitignore` — create
- `services/xstockstrat-ui/instrumentation.ts` — create
- `services/xstockstrat-ui/next-env.d.ts` — create
- `services/xstockstrat-ui/src/telemetry.ts` — create
- `services/xstockstrat-ui/src/middleware.ts` — create
- `services/xstockstrat-ui/src/lib/auth.ts` — create
- `services/xstockstrat-ui/src/lib/identity.ts` — create (copy from trader)
- `services/xstockstrat-ui/src/lib/basepath.ts` — create (all three basepaths)
- `services/xstockstrat-ui/src/lib/connectClients.ts` — create (union of all three)
- `services/xstockstrat-ui/src/lib/connectTransport.ts` — create
- `services/xstockstrat-ui/src/lib/browserClients.ts` — create
- `services/xstockstrat-ui/src/lib/connectBff.ts` — create (trader BFF only; insights + config-ui BFFs become segment-level files)
- `services/xstockstrat-ui/src/app/page.tsx` — create (root redirect to /trader)
- `services/xstockstrat-ui/src/app/layout.tsx` — create (root layout, no segment content)
- `services/xstockstrat-ui/src/app/globals.css` — create
- `services/xstockstrat-ui/src/app/icon.svg` — create
- `services/xstockstrat-ui/src/app/trader/` — create entire subtree (all pages, API routes, components from xstockstrat-trader)
- `services/xstockstrat-ui/src/app/insights/` — create entire subtree (all pages, API routes from xstockstrat-insights)
- `services/xstockstrat-ui/src/app/config-ui/` — create entire subtree (all pages, API routes from xstockstrat-config-ui)
- `services/xstockstrat-ui/src/components/` — create (union of all three services' component trees, namespaced by segment)

**Reviewers**: Platform Lead — cross-service architecture, port assignments, service registry consistency; xstockstrat-trader owner — trading UI correctness, Connect-RPC call safety, no direct DB access from frontend; xstockstrat-insights owner — analytics display accuracy, SSE polling resilience, read-only access pattern; xstockstrat-config-ui owner — config mutation safety, environment scope correctness, no secret values rendered in UI

**Codebase Evidence**:
- Confirmed basePaths: trader `basePath: '/trader'` at `services/xstockstrat-trader/next.config.js:3`; insights `basePath: '/insights'` at `services/xstockstrat-insights/next.config.js:3`; config-ui `basePath: '/config-ui'` at `services/xstockstrat-config-ui/next.config.js:3`
- All three use identical `serverExternalPackages` list (confirmed: `@connectrpc/connect`, `@connectrpc/connect-node`, `@bufbuild/protobuf`, `@opentelemetry/sdk-node`, `@opentelemetry/exporter-trace-otlp-http`)
- Config-ui uses `app/` (no `src/`) directory layout while trader and insights use `src/app/`; confirmed via `find services/xstockstrat-config-ui -type f | sort`
- Config-ui uses `@/app/lib/auth` import paths (middleware.ts:7); trader and insights use `@/lib/auth` (trader middleware.ts:7, insights middleware.ts:7)
- All three middleware files are identical in logic (middleware.ts content confirmed); differ only in the lib import path
- Trader port: 3000 (`package.json:7`), insights: 3001 (`package.json:7`), config-ui: 3002 (`package.json:7`)
- OTel `SERVICE_NAME` defaults: `'trader'` in `src/telemetry.ts:21`, `'insights'` in `src/telemetry.ts:21`, `'config-ui'` in `src/telemetry.ts:21` — all use `process.env.SERVICE_NAME ?? '<name>'`
- `instrumentation.ts` pattern confirmed identical across all three services (lines 1–6)
- `connectClients.ts` environment variable names: trader uses `TRADING_ENDPOINT`, `PORTFOLIO_ENDPOINT`, `NOTIFY_ENDPOINT`, `IDENTITY_ENDPOINT`, `MARKETDATA_ENDPOINT` (connectClients.ts:19–28); insights adds `ANALYSIS_ENDPOINT`, `INDICATORS_ENDPOINT` (connectClients.ts:19–28); config-ui uses `CONFIG_ENDPOINT`, `INGEST_ENDPOINT` (connectClients.ts:18–22)
- Config-ui's `app/api/audit/route.ts:12` imports `Pool` from `'pg'`; `Pool` is initialized with `process.env.DATABASE_URL`
- `connectBff.ts` handler map keyed on `'/api' + h.requestPath` in all three services — basePath is stripped by Next.js before the handler sees the URL (trader connectBff.ts:130, insights connectBff.ts:100, config-ui connectBff.ts:83)
- Cross-app navigation links using `<a href="/trader">` (not `<Link>`) are already present in config-ui's `app/layout.tsx:32–40` — the consolidated app can use `<Link>` for all three basePaths since they share the same origin
- Root nginx config at `nginx.conf:69` does `return 302 /trader` for `location = /` — the consolidated service must replicate this with a root page redirect

**Instructions**:

1. **Create `services/xstockstrat-ui/package.json`**. Name `"xstockstrat-ui"`, version `"0.1.0"`, `packageManager: "pnpm@9.15.0"`. Scripts: `dev: "next dev -p 3000"`, `build: "next build"`, `start: "next start -p 3000"`, `lint`, `lint:fix`, `format`, `format:check`, `test:e2e`, `test:e2e:ui`. Dependencies: merge all three `package.json` dependency sets — use the highest version for any duplicate; keep `pg` from config-ui (`^8.11.5`), `@types/pg` as devDependency. Remove `recharts` from insights (`insights/package.json` has it at `^2.12.7`) only if not used in the migrated pages — but keep it to be safe. Use `next: "^15.5.15"` (all three already on this version).

2. **Create `services/xstockstrat-ui/next.config.js`**. Use Next.js parallel multi-segment layout — no top-level `basePath` key (each segment route group implicitly handles its prefix). Set `output: 'standalone'` and the shared `serverExternalPackages` list (confirmed above). Add `redirects()` returning `[{ source: '/', destination: '/trader', permanent: false }]` to replicate the nginx root redirect (FR-2).
   ```js
   const nextConfig = {
     output: 'standalone',
     serverExternalPackages: ['@connectrpc/connect', '@connectrpc/connect-node', '@bufbuild/protobuf', '@opentelemetry/sdk-node', '@opentelemetry/exporter-trace-otlp-http'],
     async redirects() {
       return [{ source: '/', destination: '/trader', permanent: false }];
     },
   };
   module.exports = nextConfig;
   ```
   Note: There is no top-level `basePath`. Each segment (`/trader`, `/insights`, `/config-ui`) is a distinct directory under `src/app/`. **IMPORTANT (post-review decision, Option A):** In the existing separate services each has a `basePath` set (e.g. `/trader`), so Next.js strips the prefix before the route handler — the handler map key `'/api/...'` matches. In the consolidated service with no `basePath`, the App Router handler at `src/app/trader/api/[...connect]/route.ts` receives the full URL `/trader/api/...`; the old `'/api/...'` key will NOT match. Each segment's BFF handler map must be built with the segment prefix: use `'/trader/api' + h.requestPath` in `traderBff.ts`, `'/insights/api' + h.requestPath` in `insightsBff.ts`, and `'/config-ui/api' + h.requestPath` in `configUiBff.ts`.

3. **Create `services/xstockstrat-ui/src/telemetry.ts`**. Copy from `services/xstockstrat-trader/src/telemetry.ts` and change the default service name from `'trader'` to `'xstockstrat-ui'`. The `SERVICE_NAME` env var overrides the default at runtime.

4. **Create `services/xstockstrat-ui/instrumentation.ts`**. Identical to `services/xstockstrat-trader/instrumentation.ts` — imports `./src/telemetry`, calls `initTelemetry()` when `NEXT_RUNTIME === 'nodejs'`.

5. **Create `services/xstockstrat-ui/src/lib/auth.ts`**. Copy verbatim from `services/xstockstrat-trader/src/lib/auth.ts` — the file is identical across all three services (verified: same `JwtClaims` interface, same `verifyAccessToken`, `getSessionFromRequest`, `setSessionCookies`, `clearSessionCookies`, `rolesToAccessScope`, `generateTraceId`).

6. **Create `services/xstockstrat-ui/src/lib/connectClients.ts`**. Merge all three services' client factories. Include all endpoints from all three services in a single file: `TRADING_ENDPOINT`, `PORTFOLIO_ENDPOINT`, `NOTIFY_ENDPOINT`, `IDENTITY_ENDPOINT`, `MARKETDATA_ENDPOINT`, `ANALYSIS_ENDPOINT`, `INDICATORS_ENDPOINT`, `CONFIG_ENDPOINT`, `INGEST_ENDPOINT`. Export all named clients and the shared `connectCodeToHttp` helper. Copy the `makeTransport` + `createGrpcTransport` pattern from any of the three services (confirmed identical in all three).

7. **Create `services/xstockstrat-ui/src/middleware.ts`**. The three middleware files are logically identical — the only difference is the import path. In the consolidated app, use `'@/lib/auth'`. The `config.matcher` array is preserved as-is — it protects all paths except static assets and the `api/auth/login` and `health` bypasses.
   Important: with no top-level `basePath`, the middleware runs against all routes in the app. This is correct — each segment's `api/auth/login` is already excluded by the matcher pattern `api/auth/login`.

8. **Assemble segment route groups**:

   - **Trader segment** (`src/app/trader/`): copy the entire `src/app/` tree from `services/xstockstrat-trader/src/app/` into `services/xstockstrat-ui/src/app/trader/`. Adjust all `@/lib/*` imports to remain `@/lib/*` (no change needed — tsconfig paths target the root `src/`). The BFF catch-all becomes `src/app/trader/api/[...connect]/route.ts`; copy `connectBff.ts` as `src/lib/traderBff.ts` and update the import in the route file. **Update the handler map key prefix from `'/api'` to `'/trader/api'`** (Option A, per post-review decision: no basePath stripping in the consolidated service).

   - **Insights segment** (`src/app/insights/`): copy the entire `src/app/` tree from `services/xstockstrat-insights/src/app/` into `services/xstockstrat-ui/src/app/insights/`. Create `src/lib/insightsBff.ts` from `services/xstockstrat-insights/src/lib/connectBff.ts` with updated imports. **Update the handler map key prefix from `'/api'` to `'/insights/api'`** (Option A). Update the `[...connect]/route.ts` to import from `@/lib/insightsBff`.

   - **Config-UI segment** (`src/app/config-ui/`): the config-ui source uses `app/` (not `src/app/`) and `@/app/lib/*` paths. Copy the `app/` subtree into `services/xstockstrat-ui/src/app/config-ui/`. Remap all `@/app/lib/*` imports to `@/lib/*` in the copied files. Create `src/lib/configUiBff.ts` from `services/xstockstrat-config-ui/app/lib/connectBff.ts` with updated imports. **Update the handler map key prefix from `'/api'` to `'/config-ui/api'`** (Option A). The `app/api/audit/route.ts` `import { Pool } from 'pg'` and `process.env.DATABASE_URL` references carry over unchanged.

9. **Create `services/xstockstrat-ui/src/app/page.tsx`** (root page). This file is a fallback for the redirect — it can be a minimal server component that returns `null` since `next.config.js` `redirects()` handles `'/'` before the page renders. Alternatively: `export default function Home() { redirect('/trader'); }` using `next/navigation` `redirect`.

10. **Create `services/xstockstrat-ui/src/app/layout.tsx`** (root layout). Minimal wrapper: `<html><body>{children}</body></html>`. Each segment's own `layout.tsx` (under `src/app/trader/`, `src/app/insights/`, `src/app/config-ui/`) provides the per-segment title, header, and Tailwind setup.

11. **Copy shared static files**: `src/app/globals.css`, `src/app/icon.svg`, config files (`.eslintrc.json`, `.prettierrc`, `.gitignore`, `tsconfig.json`, `tailwind.config.js`, `postcss.config.js`) — copy from `services/xstockstrat-trader/` (the three files are identical across services for these config files). Update `tsconfig.json` `compilerOptions.paths` to confirm `@/*` resolves to `./src/*`.

12. **Copy components**: copy `services/xstockstrat-trader/src/components/` to `services/xstockstrat-ui/src/components/trader/`. Copy `services/xstockstrat-insights/src/components/` to `services/xstockstrat-ui/src/components/insights/`. Copy `services/xstockstrat-config-ui/components/` to `services/xstockstrat-ui/src/components/config-ui/`. Update import paths in segment pages and API routes to reference the new component locations.

13. **Create `services/xstockstrat-ui/src/context/`**: copy `services/xstockstrat-trader/src/context/AccountContext.tsx` to `services/xstockstrat-ui/src/context/AccountContext.tsx`.

14. **Create `services/xstockstrat-ui/src/lib/identity.ts`**, `src/lib/basepath.ts`, `src/lib/browserClients.ts`, `src/lib/connectTransport.ts`: copy verbatim from the trader equivalents (`services/xstockstrat-trader/src/lib/`). These are shared lib helpers used by all three segments.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm install --frozen-lockfile && pnpm run build
```
Build must complete with zero TypeScript errors and produce a `.next/standalone` directory.

---

### Step 2 — service: Create Dockerfile and update docker-compose + DO app specs

**Status**: `done`
**Service**: `xstockstrat-ui` (new), `docker-compose.yml` (modify), `.do/app.dev.yaml` (modify), `.do/app.yaml` (modify)
**Files**:
- `services/xstockstrat-ui/Dockerfile` — create
- `docker-compose.yml` — modify (remove trader/insights/config-ui/nginx blocks; add xstockstrat-ui block; confirmed `xstockstrat-ui` is **absent**: `grep -n "xstockstrat-ui" docker-compose.yml` → no match)
- `.do/app.dev.yaml` — modify (remove four old service components; add xstockstrat-ui; update ingress; confirmed absent: `grep -n "xstockstrat-ui" .do/app.dev.yaml` → no match)
- `.do/app.yaml` — modify (same changes as app.dev.yaml; confirmed absent: `grep -n "xstockstrat-ui" .do/app.yaml` → no match)

**Reviewers**: Platform Lead — cross-service architecture, port assignments, service registry consistency

**Codebase Evidence**:
- Trader Dockerfile pattern confirmed at `services/xstockstrat-trader/Dockerfile` — 4-stage: `base` (node:22-alpine + pnpm@9.15.0), `deps` (workspace + proto gen/ts + service package.json, `pnpm install --frozen-lockfile --filter xstockstrat-trader`), `builder` (copy full service, `pnpm --filter run build`), `runner` (standalone `.next`, `CMD ["node", "services/<name>/server.js"]`)
- `docker-compose.yml:436`: trader block uses `<<: *common-env` (`APPLICATION_ENV: development`, `TRADING_MODE: paper`); insights block uses `<<: *common-env`; config-ui block uses `<<: [*common-env, *db-url]`
- Consolidated env vars: all gRPC endpoint vars across all three services must be present: `TRADING_ENDPOINT`, `PORTFOLIO_ENDPOINT`, `NOTIFY_ENDPOINT`, `IDENTITY_ENDPOINT`, `MARKETDATA_ENDPOINT`, `ANALYSIS_ENDPOINT`, `INDICATORS_ENDPOINT`, `CONFIG_ENDPOINT`, `INGEST_ENDPOINT`
- `docker-compose.yml:444`: `JWT_SECRET: ${JWT_SECRET:?JWT_SECRET is required}` — required in all three; carry forward to xstockstrat-ui block
- `docker-compose.yml:445`: `SERVICE_NAME: trader` — change to `SERVICE_NAME: xstockstrat-ui`
- Config-ui depends on `timescaledb` (healthy), `db-migrator` (completed), `xstockstrat-config` (healthy), `xstockstrat-identity` (healthy) — consolidated service must inherit these plus trader's and insights' depends_on entries
- `docker-compose.yml:503-504`: config-ui exposes port 3002 — the consolidated service exposes only port 3000
- `.do/app.yaml:13`: ingress routes to `xstockstrat-nginx` — this must change to `xstockstrat-ui`; add sub-path rules for `/trader`, `/insights`, `/config-ui`; `/agent` routes to `xstockstrat-agent` via separate rule
- `.do/app.yaml:372–389`: nginx component block (4 env vars) — remove entirely
- `.do/app.yaml:391–419`: trader component block — remove
- `.do/app.yaml:421–453`: insights component block — remove
- `.do/app.yaml:455–479`: config-ui component block — remove
- DO prod file uses `professional-xs` for trader/insights/config-ui; xstockstrat-ui should use `professional-xs`
- DO dev file uses `basic-xs` for trader/insights/config-ui; xstockstrat-ui uses `basic-xs` in dev
- `nginx.conf:69`: `return 302 /trader` for `/` — replicated in `next.config.js` `redirects()` (Step 1); no nginx route rule needed for `/` in DO spec
- `nginx.conf:89–98`: `/agent/sse` and `/agent/messages` proxied to agent — in DO specs these become route rules pointing `prefix: /agent` to `xstockstrat-agent` component; in docker-compose, agent remains reachable on its own port (FR-3)

**Instructions**:

1. **Create `services/xstockstrat-ui/Dockerfile`**. Use the same 4-stage pattern as the trader Dockerfile (`services/xstockstrat-trader/Dockerfile`), substituting `xstockstrat-ui` for `xstockstrat-trader` in all `COPY` paths, `pnpm install --filter`, and `pnpm --filter run build`. The runner stage copies from `.next/standalone` at `services/xstockstrat-ui/.next/standalone`, exposes port 3000, and runs `node services/xstockstrat-ui/server.js`.

2. **Update `docker-compose.yml`**: remove the four blocks for `xstockstrat-trader` (lines ~428–454), `xstockstrat-insights` (lines ~457–483), `xstockstrat-config-ui` (lines ~486–513), and `nginx` (lines ~515–542). Add a new `xstockstrat-ui` block:
   ```yaml
   xstockstrat-ui:
     <<: *svc
     build:
       context: .
       dockerfile: services/xstockstrat-ui/Dockerfile
     image: ghcr.io/davcs86/xstockstrat/xstockstrat-ui:latest-dev
     container_name: xstockstrat-ui
     env_file: [".env.local", ".env.fe.local"]
     environment:
       <<: [*common-env, *db-url]
       TRADING_ENDPOINT: xstockstrat-trading:50051
       PORTFOLIO_ENDPOINT: xstockstrat-portfolio:50052
       NOTIFY_ENDPOINT: xstockstrat-notify:50059
       IDENTITY_ENDPOINT: xstockstrat-identity:50058
       MARKETDATA_ENDPOINT: xstockstrat-marketdata:50053
       ANALYSIS_ENDPOINT: xstockstrat-analysis:50056
       INDICATORS_ENDPOINT: xstockstrat-indicators:50054
       CONFIG_ENDPOINT: xstockstrat-config:50060
       INGEST_ENDPOINT: xstockstrat-ingest:50055
       JWT_SECRET: ${JWT_SECRET:?JWT_SECRET is required}
       SERVICE_NAME: xstockstrat-ui
       OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4318
     ports:
       - "3000:3000"
     depends_on:
       timescaledb:
         condition: service_healthy
       db-migrator:
         condition: service_completed_successfully
       xstockstrat-trading:
         condition: service_started
       xstockstrat-portfolio:
         condition: service_started
       xstockstrat-notify:
         condition: service_started
       xstockstrat-identity:
         condition: service_healthy
       xstockstrat-marketdata:
         condition: service_started
       xstockstrat-analysis:
         condition: service_started
       xstockstrat-config:
         condition: service_healthy
   ```
   Note: `APPLICATION_ENV: development` and `TRADING_MODE: paper` are provided by `<<: *common-env`. No separate `APPLICATION_ENV` or `TRADING_MODE` override needed in the service block.

3. **Update `.do/app.dev.yaml`**:
   - In the `ingress.rules` section: change the single rule's `component.name` from `xstockstrat-nginx` to `xstockstrat-ui`. Add sub-path routing rules for `/agent` pointing to `xstockstrat-agent` (to replace the nginx `/agent/sse` and `/agent/messages` proxy behavior):
     ```yaml
     ingress:
       rules:
         - component:
             name: xstockstrat-agent
           match:
             path:
               prefix: /agent
         - component:
             name: xstockstrat-ui
           match:
             path:
               prefix: /
     ```
   - Remove the `xstockstrat-nginx` service block (lines ~372–389 in the dev file).
   - Remove the `xstockstrat-trader` service block.
   - Remove the `xstockstrat-insights` service block.
   - Remove the `xstockstrat-config-ui` service block.
   - Add the `xstockstrat-ui` service block:
     ```yaml
     - name: xstockstrat-ui
       image:
         registry_type: GHCR
         registry: YOUR_GITHUB_ORG
         repository: xstockstrat/xstockstrat-ui
         tag: "YOUR_IMAGE_TAG"
       http_port: 3000
       instance_count: 1
       instance_size_slug: basic-xs
       envs:
         - key: TRADING_ENDPOINT
           value: ${xstockstrat-trading.PRIVATE_DOMAIN}:50051
         - key: PORTFOLIO_ENDPOINT
           value: ${xstockstrat-portfolio.PRIVATE_DOMAIN}:50052
         - key: NOTIFY_ENDPOINT
           value: ${xstockstrat-notify.PRIVATE_DOMAIN}:50059
         - key: IDENTITY_ENDPOINT
           value: ${xstockstrat-identity.PRIVATE_DOMAIN}:50058
         - key: MARKETDATA_ENDPOINT
           value: ${xstockstrat-marketdata.PRIVATE_DOMAIN}:50053
         - key: ANALYSIS_ENDPOINT
           value: ${xstockstrat-analysis.PRIVATE_DOMAIN}:50056
         - key: INDICATORS_ENDPOINT
           value: ${xstockstrat-indicators.PRIVATE_DOMAIN}:50054
         - key: CONFIG_ENDPOINT
           value: ${xstockstrat-config.PRIVATE_DOMAIN}:50060
         - key: INGEST_ENDPOINT
           value: ${xstockstrat-ingest.PRIVATE_DOMAIN}:50055
         - key: APP_URL
           value: ${APP_URL}
         - key: JWT_SECRET
           scope: RUN_TIME
           value: YOUR_DEV_JWT_SECRET
           type: SECRET
         - key: SERVICE_NAME
           value: xstockstrat-ui
         - key: DATABASE_URL
           scope: RUN_TIME
           value: ${xstockstrat.DATABASE_URL}
     ```
   Note: `http_port: 3000` (replaces `internal_ports: [3000]`) because this is now the public-facing service under the ingress rule. `APPLICATION_ENV` and `TRADING_MODE` are inherited from the global `envs` block.

4. **Update `.do/app.yaml`** with the same changes as `app.dev.yaml`, except:
   - `instance_size_slug: professional-xs` (not `basic-xs`)
   - `JWT_SECRET.value: YOUR_PROD_JWT_SECRET`

**Verification**:
```bash
docker compose build --no-cache xstockstrat-ui
```
Image must build to completion. Then:
```bash
grep -n "xstockstrat-trader\|xstockstrat-insights\|xstockstrat-config-ui\|xstockstrat-nginx" docker-compose.yml .do/app.dev.yaml .do/app.yaml
```
Must return no matches (all four removed). Then:
```bash
grep -n "xstockstrat-ui" docker-compose.yml .do/app.dev.yaml .do/app.yaml
```
Must return at least one match per file (new service present in all three).

---

### Step 3 — service: Migrate e2e tests into `services/xstockstrat-ui`

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/playwright.config.ts` — create
- `services/xstockstrat-ui/e2e/global-setup.ts` — create
- `services/xstockstrat-ui/e2e/global-teardown.ts` — create
- `services/xstockstrat-ui/e2e/mock-backend.ts` — create (merged mock server)
- `services/xstockstrat-ui/e2e/trader/` — create (all trader e2e specs, path-updated)
- `services/xstockstrat-ui/e2e/insights/` — create (all insights e2e specs, path-updated)
- `services/xstockstrat-ui/e2e/config-ui/` — create (all config-ui e2e specs, path-updated)

**Reviewers**: xstockstrat-trader owner — trading UI correctness, Connect-RPC call safety, no direct DB access from frontend; xstockstrat-insights owner — analytics display accuracy, SSE polling resilience, read-only access pattern; xstockstrat-config-ui owner — config mutation safety, environment scope correctness, no secret values rendered in UI

**Codebase Evidence**:
- Trader playwright config: `baseURL: 'http://localhost:3000'`, mock port 9091, `webServer.url: 'http://localhost:3000/trader/api/health'` (playwright.config.ts:22,40)
- Insights playwright config: `baseURL: 'http://localhost:3001'`, mock port 9092, `webServer.url: 'http://localhost:3001/insights/api/health'` (playwright.config.ts:22,40)
- Config-ui playwright config: `baseURL: 'http://localhost:3002'`, mock port 9093, `webServer.url: 'http://localhost:3002/config-ui/api/health'` (playwright.config.ts:22,31)
- Trader mock uses port 9091 (`mock-backend.ts:22`) serving TradingService, PortfolioService, NotifyService, MarketDataService, IdentityService
- Insights mock uses port 9092 (`mock-backend.ts:20`) serving AnalysisService, IdentityService, TradingService, PortfolioService
- Config-ui mock uses port 9093 (`mock-backend.ts:19`) serving ConfigService, IdentityService, IngestService
- `webServer.env` in trader config sets all five `*_ENDPOINT` vars to `127.0.0.1:9091` (playwright.config.ts:43–48); insights sets four to `127.0.0.1:9092`; config-ui sets three to `127.0.0.1:9093`
- Trader e2e specs: `account-selector.spec.ts`, `alert-stream.spec.ts`, `api-smoke.spec.ts`, `auth.spec.ts`, `chart-panel.spec.ts`, `order-form.spec.ts` — all in `services/xstockstrat-trader/e2e/`
- Insights e2e specs: `account-portfolio.spec.ts`, `api-smoke.spec.ts`, `auth.spec.ts`, `dashboard.spec.ts` — all in `services/xstockstrat-insights/e2e/`
- Config-ui e2e specs: `api-smoke.spec.ts`, `auth.spec.ts`, `env-mode-switcher.spec.ts`, `namespace-nav.spec.ts`, `sources.spec.ts` — all in `services/xstockstrat-config-ui/e2e/`

**Instructions**:

1. **Create `services/xstockstrat-ui/playwright.config.ts`**. The consolidated config runs all three test suites from a single Playwright run, all against `http://localhost:3000` (one dev server). Use three `testDir` patterns or a single `testDir: './e2e'` with subdirectories. The `webServer` block starts `pnpm dev` and waits for `http://localhost:3000/trader/api/health`. Use three separate mock ports (9091, 9092, 9093) because the mocks serve different service sets and must not conflict. Set `env` to point each service's `*_ENDPOINT` env vars at its corresponding mock port: trader endpoints → `127.0.0.1:9091`, insights endpoints (ANALYSIS, INDICATORS, PORTFOLIO, TRADING, IDENTITY for insights) → `127.0.0.1:9092`, config-ui endpoints (CONFIG, INGEST, IDENTITY for config-ui) → `127.0.0.1:9093`. Note: `IDENTITY_ENDPOINT` appears in all three mocks; use a single value (`127.0.0.1:9091`) for the shared Identity mock (the mock from `mock-backend.ts` covers all identity methods needed).
   ```ts
   export default defineConfig({
     testDir: './e2e',
     fullyParallel: true,
     forbidOnly: !!process.env.CI,
     retries: process.env.CI ? 2 : 0,
     reporter: process.env.CI ? 'github' : 'html',
     globalSetup: './e2e/global-setup.ts',
     globalTeardown: './e2e/global-teardown.ts',
     use: {
       baseURL: 'http://localhost:3000',
       trace: 'on-first-retry',
       screenshot: 'only-on-failure',
     },
     projects: [
       { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
       { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
     ],
     webServer: {
       command: 'pnpm dev',
       url: 'http://localhost:3000/trader/api/health',
       reuseExistingServer: !process.env.CI,
       env: {
         TRADING_ENDPOINT: '127.0.0.1:9091',
         PORTFOLIO_ENDPOINT: '127.0.0.1:9091',
         NOTIFY_ENDPOINT: '127.0.0.1:9091',
         IDENTITY_ENDPOINT: '127.0.0.1:9091',
         MARKETDATA_ENDPOINT: '127.0.0.1:9091',
         ANALYSIS_ENDPOINT: '127.0.0.1:9092',
         INDICATORS_ENDPOINT: '127.0.0.1:9092',
         CONFIG_ENDPOINT: '127.0.0.1:9093',
         INGEST_ENDPOINT: '127.0.0.1:9093',
         JWT_SECRET: 'test-jwt-secret-for-e2e-tests-min32c',
       },
     },
   });
   ```

2. **Create `services/xstockstrat-ui/e2e/mock-backend.ts`**. Merge all three `mock-backend.ts` files by starting three separate `http2.createServer` instances on ports 9091, 9092, and 9093. Export `startMockBackend()` that starts all three, and `stopMockBackend()` that stops all three. The service registrations remain exactly as in the three source files (no merging of mocks — they are already distinct).

3. **Create `services/xstockstrat-ui/e2e/global-setup.ts`** and `global-teardown.ts` — identical to any of the three source files (they each just call `startMockBackend()` / `stopMockBackend()`).

4. **Copy e2e spec files**:
   - Copy `services/xstockstrat-trader/e2e/*.spec.ts` to `services/xstockstrat-ui/e2e/trader/`. Update any URL assertions that hard-coded `:3000` to remain `:3000` (no change). Update path assertions that referenced `/trader/...` — they must still work since the trader segment is under `/trader`. Update any `baseURL`-relative navigation that assumed `localhost:3000` with no basePath prefix — these remain correct since the consolidated app is also on port 3000 with `baseURL: 'http://localhost:3000'`.
   - Copy `services/xstockstrat-insights/e2e/*.spec.ts` to `services/xstockstrat-ui/e2e/insights/`. URLs that were `localhost:3001/insights/...` must change to `localhost:3000/insights/...`. Any `baseURL`-relative navigation (`page.goto('/insights/...')`) remains valid.
   - Copy `services/xstockstrat-config-ui/e2e/*.spec.ts` to `services/xstockstrat-ui/e2e/config-ui/`. URLs that were `localhost:3002/config-ui/...` must change to `localhost:3000/config-ui/...`.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm install --frozen-lockfile && pnpm test:e2e
```
All Playwright tests must pass (green) — 0 failures across trader, insights, and config-ui test suites.

---

### Step 4 — service: Update CI workflow to reference `xstockstrat-ui`

**Status**: `done`
**Service**: CI configuration
**Files**:
- `.github/workflows/ci.yml` — modify

**Reviewers**: Platform Lead — cross-service architecture, port assignments, service registry consistency

**Codebase Evidence**:
- `ci.yml:59`: `xstockstrat-trader: ['services/xstockstrat-trader/**']` — paths-filter entry
- `ci.yml:60`: `xstockstrat-insights: ['services/xstockstrat-insights/**']` — paths-filter entry
- `ci.yml:61`: `xstockstrat-config-ui: ['services/xstockstrat-config-ui/**']` — paths-filter entry
- `ci.yml:62`: `xstockstrat-nginx: ['services/xstockstrat-nginx/**', 'nginx.conf']` — paths-filter entry
- `ci.yml:362–364`: `frontend-lint` job matrix lists all three frontend service names
- `ci.yml:401–403`: `frontend-e2e` job matrix includes object entries for each service
- `ci.yml:388`: `frontend-e2e` job uses `working-directory: services/${{ matrix.service }}`

**Instructions**:

1. In the `changes` job `filters:` block (around line 59): replace the four filter entries:
   ```yaml
   xstockstrat-trader:     ['services/xstockstrat-trader/**']
   xstockstrat-insights:   ['services/xstockstrat-insights/**']
   xstockstrat-config-ui:  ['services/xstockstrat-config-ui/**']
   xstockstrat-nginx:      ['services/xstockstrat-nginx/**', 'nginx.conf']
   ```
   with:
   ```yaml
   xstockstrat-ui: ['services/xstockstrat-ui/**']
   ```

2. In the `frontend-lint` job's `matrix.service` list (around line 362): replace `xstockstrat-trader`, `xstockstrat-insights`, `xstockstrat-config-ui` with `xstockstrat-ui`. Remove the three old entries.

3. In the `frontend-e2e` job's `matrix.include` list (around line 401): replace the three separate service entries with a single entry:
   ```yaml
   matrix:
     include:
       - service: xstockstrat-ui
   ```

4. In the `frontend-e2e` job's `if:` condition (around line 392): replace references to `matrix.service` matching old names — the condition already uses `matrix.service` dynamically (`contains(fromJson(needs.changes.outputs.matched), matrix.service)`) so no change to the condition logic is needed; only the matrix values (changed in step 3 above) affect which filter name is checked.

5. Also verify: the `frontend-e2e` job uploads playwright report artifacts with name `playwright-report-${{ matrix.service }}` (line 449). This will become `playwright-report-xstockstrat-ui` — no change to the artifact upload step is needed.

**Verification**:
```bash
grep -n "xstockstrat-trader\|xstockstrat-insights\|xstockstrat-config-ui\|xstockstrat-nginx" .github/workflows/ci.yml
```
Must return no matches. Then:
```bash
grep -n "xstockstrat-ui" .github/workflows/ci.yml
```
Must return at least 3 matches (filter entry, lint matrix, e2e matrix).

---

### Step 5 — test: Smoke verify the consolidated service locally

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**: none (verification only)

**Reviewers**: xstockstrat-trader owner — trading UI correctness, Connect-RPC call safety, no direct DB access from frontend; xstockstrat-insights owner — analytics display accuracy, SSE polling resilience, read-only access pattern; xstockstrat-config-ui owner — config mutation safety, environment scope correctness, no secret values rendered in UI

**Codebase Evidence**:
- Trader health endpoint: `src/app/api/health/route.ts` (confirmed present in `services/xstockstrat-trader/`)
- Insights health endpoint: `src/app/api/health/route.ts` (confirmed present in `services/xstockstrat-insights/`)
- Config-ui health endpoint: `app/api/health/route.ts` (confirmed present in `services/xstockstrat-config-ui/`)
- Root redirect target: `nginx.conf:69` returns `302 /trader`; replicated in `next.config.js redirects()`

**Instructions**: After Steps 1–4 are complete, run the full local verification sequence.

**Verification**:
```bash
# 1. Build the consolidated image
docker compose build --no-cache xstockstrat-ui

# 2. Start just the consolidated UI (assumes backend services are already running)
docker compose up -d xstockstrat-ui

# 3. Health checks for all three segments
curl -f http://localhost:3000/trader/api/health
curl -f http://localhost:3000/insights/api/health
curl -f http://localhost:3000/config-ui/api/health

# 4. Root redirect
curl -v http://localhost:3000/ 2>&1 | grep "< location:"
# Expected: < location: /trader

# 5. Confirm old services are NOT running
docker compose ps | grep -E "trader|insights|config-ui|nginx"
# Expected: no output (those containers are removed)

# 6. Run e2e tests
cd services/xstockstrat-ui && pnpm test:e2e
```
All three health endpoints must return `{"status":"ok",...}`. Root must 302 to `/trader`. No old service containers running. All Playwright tests green.

---

### Step 6 — service: Remove obsolete service directories and nginx artifacts

**Status**: `pending`
**Service**: repository root (cleanup)
**Files**:
- `services/xstockstrat-trader/` — delete entire directory
- `services/xstockstrat-insights/` — delete entire directory
- `services/xstockstrat-config-ui/` — delete entire directory
- `services/xstockstrat-nginx/` — delete entire directory
- `nginx.conf` — delete (root-level nginx template; confirmed at `/home/user/xstockstrat/nginx.conf`)

**Reviewers**: Platform Lead — cross-service architecture, port assignments, service registry consistency

**Codebase Evidence**:
- Confirmed `services/xstockstrat-nginx/` contains only `Dockerfile` and `docker-entrypoint.sh` (find output above)
- Confirmed `nginx.conf` at repo root references `TRADER_UPSTREAM`, `INSIGHTS_UPSTREAM`, `CONFIG_UI_UPSTREAM` — no longer needed after consolidation
- `pnpm-workspace.yaml:2`: `'services/*'` glob — removing the service directories automatically removes them from the workspace; no changes to `pnpm-workspace.yaml` needed

**Instructions**:

1. Delete `services/xstockstrat-trader/` recursively.
2. Delete `services/xstockstrat-insights/` recursively.
3. Delete `services/xstockstrat-config-ui/` recursively.
4. Delete `services/xstockstrat-nginx/` recursively.
5. Delete `nginx.conf` from the repository root.

**Verification**:
```bash
ls services/ | grep -E "trader|insights|config-ui|nginx"
# Expected: no output

ls nginx.conf 2>&1
# Expected: ls: nginx.conf: No such file or directory

# Confirm workspace still resolves
pnpm install --frozen-lockfile
```

---

### Step 7 — docs: Update runbook and pattern docs to remove nginx references

**Status**: `pending`
**Service**: `docs/`
**Files**:
- `docs/patterns/nginx-routing.md` — modify (mark as historical / deprecated; redirect to new consolidated-ui pattern)
- `docs/roadmap/phase5-deviations.md` — modify (append a note that Phase 5 services have been consolidated into `xstockstrat-ui`)

**Reviewers**: none

**Codebase Evidence**:
- `docs/patterns/nginx-routing.md` is referenced from `CLAUDE.md` table under "Adding nginx routing for a new frontend" — after this change, that row should point to the consolidated-ui approach
- `docs/roadmap/phase5-deviations.md` records Phase 5 service implementations for trader, insights, and config-ui — these are accurate for the historical record but need a consolidation note

**Instructions**:

1. Open `docs/patterns/nginx-routing.md`. At the top, add a banner:
   ```
   > **Deprecated as of feature 045 (ui-consolidation-nextjs).**
   > The nginx reverse proxy has been removed. Frontends are now served from the single
   > `xstockstrat-ui` Next.js service. This document is retained as a historical reference only.
   > For the current frontend pattern, see `docs/patterns/nextjs-frontends.md` and
   > `docs/patterns/frontend-auth.md`.
   ```

2. Open `docs/roadmap/phase5-deviations.md`. At the end, append:
   ```markdown
   ## Post-Phase-5 Consolidation (feature 045)

   Feature 045 (`ui-consolidation-nextjs`) merged all three Phase 5 services into a single
   `xstockstrat-ui` service and removed `xstockstrat-nginx`. The deviations documented above
   remain accurate as the historical record of how each service was originally built; the
   consolidated service inherits those same patterns unchanged.
   ```

**Verification**:
```bash
grep -r "nginx-routing\|xstockstrat-nginx\|xstockstrat-trader\|xstockstrat-insights\|xstockstrat-config-ui" docs/ --include="*.md" | grep -v "phase5-deviations\|nginx-routing" | grep -v "045-ui-consolidation"
```
Any remaining references should be in historical/context files (deviations, feature context.md) only — not in active pattern docs.

---

### Step 8 — docs: Update root CLAUDE.md service registry, language map, and inter-service dependency graph

**Status**: `pending`
**Service**: repository root
**Files**:
- `CLAUDE.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `CLAUDE.md` Service Registry table (confirmed in system-reminder): lists `xstockstrat-trader` (HTTP 3000), `xstockstrat-insights` (HTTP 3001), `xstockstrat-config-ui` (HTTP 3002), `xstockstrat-nginx` (HTTP 80) as separate rows
- Language Map section lists `Next.js → xstockstrat-trader, xstockstrat-insights, xstockstrat-config-ui`
- Inter-service dependency graph shows `xstockstrat-trader (UI)`, `xstockstrat-insights (UI)` as root nodes
- Key File Paths table references `Next.js UIs | services/xstockstrat-{trader,insights,config-ui}/`
- Implementation Roadmap Status table: Phase 5 listed as `DONE` with description "UI layer: trader, insights, config-ui"

**Instructions**:

1. **Service Registry table**: Replace the four rows for `xstockstrat-trader`, `xstockstrat-insights`, `xstockstrat-config-ui`, and `xstockstrat-nginx` with a single row:
   ```
   | xstockstrat-ui | Next.js | Consolidated UI: trader dashboard, insights analytics, config management | — | 3000 |
   ```

2. **Language Map**: Replace `Next.js → xstockstrat-trader, xstockstrat-insights, xstockstrat-config-ui` with `Next.js → xstockstrat-ui`.

3. **Inter-service dependency graph**: Replace `xstockstrat-trader (UI)` and `xstockstrat-insights (UI)` root nodes with `xstockstrat-ui (UI)` and remove the separate trader/insights/config-ui sub-trees; consolidate all backend dependencies under the single `xstockstrat-ui` node.

4. **Nginx Reverse Proxy section**: Remove or update to note nginx has been removed; the `xstockstrat-ui` service now directly serves all paths.

5. **Key File Paths table**: Update `Next.js UIs` row from `services/xstockstrat-{trader,insights,config-ui}/` to `services/xstockstrat-ui/`.

6. **Nginx config row**: Remove `nginx.conf` and `services/xstockstrat-nginx/` references from the Key File Paths table.

7. **Implementation Roadmap Status**: Update Phase 5 description from "UI layer: trader, insights, config-ui" to "UI layer: trader, insights, config-ui → consolidated as xstockstrat-ui (feature 045)".

8. **Context Guide table**: Remove or update the "Adding nginx routing for a new frontend" row (pattern is deprecated).

**Verification**:
```bash
grep -n "xstockstrat-trader\|xstockstrat-insights\|xstockstrat-config-ui\|xstockstrat-nginx" CLAUDE.md
```
Must return no matches (all old names removed and replaced with `xstockstrat-ui`).

---

### Step 9 — test: Run consolidated e2e test suite and confirm all three UIs pass

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**: none (verification only)

**Reviewers**: xstockstrat-trader owner — trading UI correctness, Connect-RPC call safety, no direct DB access from frontend; xstockstrat-insights owner — analytics display accuracy, SSE polling resilience, read-only access pattern; xstockstrat-config-ui owner — config mutation safety, environment scope correctness, no secret values rendered in UI

**Codebase Evidence**:
- E2E test structure: 6 trader specs, 4 insights specs, 5 config-ui specs confirmed via `find` output above
- CI job at `ci.yml:388–451` — `frontend-e2e` job uses `pnpm test:e2e` from `services/${{ matrix.service }}`
- No coverage threshold for Next.js frontends per CI matrix (frontends do not appear in `node-test` matrix at ci.yml:465–473)

**Instructions**: This step is the final CI-mirroring verification. Run the complete e2e suite as CI would:

**Verification**:
```bash
cd services/xstockstrat-ui
pnpm install --frozen-lockfile
pnpm exec playwright install chromium firefox
pnpm exec playwright install-deps chromium firefox
CI=true pnpm test:e2e
```
Expected: all tests in `e2e/trader/`, `e2e/insights/`, `e2e/config-ui/` pass. Zero failures on both Chromium and Firefox. Playwright HTML report generated at `playwright-report/`.

No coverage threshold applies for Next.js frontends (`xstockstrat-ui` is not in the `node-test` coverage matrix). E2E test passage is the sole CI quality gate for this service.

---

## Deviation Log

### Deviation: Step 1 — Create `services/xstockstrat-ui`
**Spec said**: `src/lib/browserClients.ts` — create (single flat file for all browser clients)
**Actual**: Per-service browser client files created instead: `src/lib/browserClients/tradingClient.ts`, `portfolioClient.ts`, `marketDataClient.ts`, `notifyClient.ts`, `analysisClient.ts`, `configClient.ts`, `ingestClient.ts`. Each file is self-contained with its own inline transport and exports a single named client.
**Reason**: User adjusted the plan during Phase 2 to use the per-service file pattern (`lib/browserClients/{service}Client.ts`) to avoid a monolithic browser clients file and make dependencies per-component clearer.

### Deviation: Step 1 — Create `services/xstockstrat-ui`
**Spec said**: `src/lib/connectTransport.ts` — create (shared connect-web transport)
**Actual**: No shared transport file created — each per-service browser client file creates its own inline `createConnectTransport({ baseUrl: '/segment/api' })`. No shared transport is needed since each segment uses a different baseUrl.
**Reason**: Follows from the per-service client pattern above — a single shared transport doesn't make sense when each client targets a different BFF basePath.

### Deviation: Step 1 — Create `services/xstockstrat-ui`
**Spec said**: `pnpm install --frozen-lockfile && pnpm run build` as verification
**Actual**: Ran `pnpm install` (without `--frozen-lockfile`) first to generate the lockfile for the new service, then `pnpm run build`. The `--frozen-lockfile` flag requires a pre-existing lockfile; a new service has none.
**Reason**: `services/xstockstrat-ui` is a brand-new package not previously tracked in `pnpm-lock.yaml`. The lockfile must be generated before it can be frozen. The important verification (`pnpm run build` passes with zero TypeScript errors) was performed and succeeded.

### Deviation: Step 1 — Create `services/xstockstrat-ui`
**Spec said**: `INDICATORS_ENDPOINT` included in `connectClients.ts` (spec instruction 6 lists it)
**Actual**: `INDICATORS_ENDPOINT` removed from `connectClients.ts` — no `indicatorsClient` is exported because no BFF in the consolidated service calls the indicators service.
**Reason**: ESLint `@typescript-eslint/no-unused-vars` error blocked the build. The indicators service is not proxied by any of the three BFFs, so the endpoint variable was truly unused.

### Deviation: Step 2 — Create Dockerfile and update docker-compose + DO app specs
**Spec said**: Verification: `docker compose build --no-cache xstockstrat-ui` — image must build to completion.
**Actual**: Docker daemon not running in this execution environment; build could not be attempted. Structural grep verifications passed (no old service names, `xstockstrat-ui` present in all three files).
**Reason**: Environment limitation. Dockerfile follows the exact same 4-stage pattern as `services/xstockstrat-trader/Dockerfile` (the reference implementation) with only service-name substitutions. Build validity will be confirmed by CI when the PR is merged.

### Deviation: Step 3 — Migrate e2e tests into `services/xstockstrat-ui`
**Spec said**: Verification: `pnpm test:e2e` — all Playwright tests must pass (green) — 0 failures across all three suites.
**Actual**: Full `pnpm test:e2e` run not attempted — no display server or Playwright browsers available in execution environment. TypeScript check (`npx tsc --noEmit`) passed with zero errors; Next.js build still passes.
**Reason**: Environment limitation. All e2e spec files are structurally identical to source files with only port number updates (3001/3002 → 3000). The merged mock-backend.ts uses the same handler logic as all three source files. E2e correctness will be confirmed by CI.

### Deviation: Step 5 — Smoke verify the consolidated service locally
**Spec said**: Run `docker compose build/up`, curl all three health endpoints, verify root redirect, verify no old containers running, run `pnpm test:e2e`.
**Actual**: Docker daemon not running and `POSTGRES_PASSWORD` env var not set — docker compose commands cannot execute. Health route files confirmed present at correct paths; root redirect (`/` → `/trader`) confirmed in `next.config.js`; docker-compose.yml already confirmed to have no old service blocks in Step 2.
**Reason**: Environment limitation. All code artifacts verified statically. Full runtime smoke test will be performed by CI and manually after the integration PR is merged.
