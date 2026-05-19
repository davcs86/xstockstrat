# Context: wire-fe-auth

**Feature**: `docs/roadmap/features/012-wire-fe-auth/feature.md`
**Product Spec**: `docs/roadmap/features/012-wire-fe-auth/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/012-wire-fe-auth/implementation-spec.md`

---

## Session 2026-05-18T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Key decisions captured:
  - No new frontend service — auth wired into existing trader/insights/config-ui frontends.
  - userId propagated via `x-user-id` gRPC metadata header on service-to-service calls; nginx strips it on inbound external requests to prevent spoofing.
  - **No Bearer token forwarding to backend services.** The frontend is the auth boundary: it validates the JWT locally in `middleware.ts`, extracts `userId` from claims, and passes `x-user-id` on all outbound Connect-RPC calls. Backend services trust `x-user-id` from internal callers only.
  - Shared `@xstockstrat/auth` workspace package left as an open question for impl-spec time.
  - Hardcoded `userId ?? 'default'` fallback removed from `xstockstrat-trader` API routes (`/api/orders`, `/api/portfolio`) — routes now return 401 if no userId is available, making the auth gap explicit rather than silent.

## Session 2026-05-18T00:00:00Z — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings: (1) AC-5 omits the 60s refresh threshold from FR-4; (2) ACs are qualitative rather than quantitative.
- Open questions resolved: OQ-1 deferred to impl-spec; OQ-2 deferred/out of scope; OQ-3 resolved as stateless cookie-read per request (no server-side session store).
- Overlap findings: formula-management-ui (003) and do-nginx-integration (006) both touch xstockstrat-insights; do-nginx-integration (006) also touches xstockstrat-trader, xstockstrat-config-ui, xstockstrat-nginx — advisory WARNs only, no FAIL-level conflicts. Recommend merging 006 and 011 before running /sdd-spec so nginx and identity baselines are stable.

## Session 2026-05-18T00:00:00Z — scope expansion (pre-execution)

- Expanded scope to add `x-access-scope` (permissions bitmap) and `x-trace-id` (UUID v4) alongside the existing `x-user-id`.
- Key decisions:
  - `x-access-scope` is computed from JWT `roles` by each frontend's auth lib using `rolesToAccessScope()`. Bit map: read=0x01, write=0x02, admin=0x04, trading=0x08. Backend services forward verbatim — no re-computation.
  - `x-trace-id` is generated in `middleware.ts` (UUID v4 via `crypto.randomUUID()`) if not already present on the incoming request and injected into forwarded request headers (upstream only).
  - **Propagation is upstream only (request direction).** Headers are never set on responses. The redirect-to-login path does NOT set `x-trace-id` as a response header.
  - nginx strips all three headers from inbound external requests (FR-7 updated).
  - Backend propagation: Go services use `grpc.ChainUnaryInterceptor` (server) + `grpc.WithChainUnaryInterceptor` (client). Python services use per-method `context.invocation_metadata()` extraction + `metadata=` kwarg on stub calls. Node.js backend services (leaf nodes — no outbound service calls) use AsyncLocalStorage wrapping the HTTP Connect-RPC handler.
  - Implementation spec grew from 12 → 15 steps. Step 13 (Go), Step 14 (Python), Step 15 (Node.js backend) are Wave 4, independent of Wave 2 and can execute in parallel.
  - All 10 backend services now listed in Affected Services.

## Session 2026-05-18T00:00:00Z — sdd-spec

- Generated implementation-spec.md with 12 steps. Status → implementation-ready.
- Key codebase findings:
  - OQ-1 resolved: no shared `@xstockstrat/auth` workspace package. Auth utilities are replicated as `src/lib/auth.ts` per service (trader/insights) and `app/lib/auth.ts` (config-ui). This avoids pnpm workspace dep complexity for a small utility file, consistent with how each service manages its own Connect-RPC transport module.
  - Identity service uses `jsonwebtoken` (HS256 HMAC). JWT payload fields are snake_case: `user_id`, `email`, `roles`, `issued_at`, `expires_at` — confirmed at `services/xstockstrat-identity/src/grpc/identityServiceImpl.ts:L61–L67`.
  - Frontends must use `jose` (not `jsonwebtoken`) for JWT verification because Next.js `middleware.ts` runs in the Edge Runtime which lacks Node.js built-ins. `jose` is not currently in any frontend `package.json`.
  - config-ui uses `app/` directory layout (not `src/app/`); middleware must live at `services/xstockstrat-config-ui/middleware.ts` (service root), not inside `app/` or `src/`.
  - `JWT_SECRET` is in `.do/app.dev.yaml` and `.do/app.yaml` only for the identity service. All three frontends need it added.
  - `IDENTITY_HTTP_ENDPOINT` is missing from `docker-compose.yml` and DO specs for `xstockstrat-config-ui` — confirmed via grep.
  - Existing API routes in trader already have `TODO(wire-fe-auth)` comments at `orders/route.ts:L28,57` and `portfolio/route.ts:L14` — exact replace targets confirmed.

## Session 2026-05-18T00:00:00Z — sdd-review impl-spec

- Ran `/sdd-review wire-fe-auth impl-spec`. Advisory review (no lifecycle change).
- Steps 1–12 passed all criteria.
- **3 FAILs fixed**: Steps 13, 14, 15 were `service` steps for non-frontend services with no corresponding `test` step. Added **Step 16** (test: Verify Wave 4 backend service test suites) to cover all 10 backend services. Total steps: 15 → 16.
- Step 16 runs existing test suites with explicit thresholds: Go ≥40%, Python ≥40% (indicators ≥50%), Node.js ≥40%.
- Warnings (advisory, not fixed): Step 9 Verification grep exits 1 on success; Step 12 E2E lacks explicit threshold statement (by design for Playwright).
- Overlap WARNs with `formula-management-ui` (003): both touch `xstockstrat-insights` and `xstockstrat-indicators`; `package.json` and `servicer.py` are shared write targets. Recommend executing `wire-fe-auth` first so formula routes are written against the auth-enabled baseline.

## Session 2026-05-18T00:00:00Z — sdd-execute

### Step 1 — Add `jose` dependency to all three Next.js frontends [done]
- Added `"jose": "^5.0.0"` alphabetically to dependencies in trader, insights, and config-ui package.json files. Ran `pnpm install` from repo root; lockfile updated cleanly.
- Files modified: `services/xstockstrat-trader/package.json`, `services/xstockstrat-insights/package.json`, `services/xstockstrat-config-ui/package.json`, `pnpm-lock.yaml`
- Deviations: none

### Step 2 — Create `src/lib/auth.ts` in xstockstrat-trader [done]
- Created `services/xstockstrat-trader/src/lib/auth.ts` with all 10 exports: `JwtClaims`, `ACCESS_TOKEN_REFRESH_THRESHOLD_SECONDS`, `verifyAccessToken`, `getSessionFromRequest`, `refreshSession`, `revokeToken`, `setSessionCookies`, `clearSessionCookies`, `rolesToAccessScope`, `generateTraceId`. Lint passed with no errors (pre-existing warnings in other files only).
- Files modified: `services/xstockstrat-trader/src/lib/auth.ts`
- Deviations: Inlined `IDENTITY_ENDPOINT` constant instead of importing from `connectTransport.ts` to preserve Edge Runtime compatibility (connectTransport imports `@connectrpc/connect-node`). Full detail in Deviation Log.

### Step 3 — Create `src/lib/auth.ts` in xstockstrat-insights and `app/lib/auth.ts` in xstockstrat-config-ui [done]
- Created `services/xstockstrat-insights/src/lib/auth.ts` and `services/xstockstrat-config-ui/app/lib/auth.ts` (creating the `app/lib/` directory). Both files export all 10 symbols with identical contract to Step 2. Lint passed with no errors in either service (pre-existing warnings in other files only).
- Files modified: `services/xstockstrat-insights/src/lib/auth.ts`, `services/xstockstrat-config-ui/app/lib/auth.ts`
- Deviations: Insights — inlined `IDENTITY_ENDPOINT` constant instead of importing `IDENTITY_BASE_URL` from `connectTransport.ts` (same Edge Runtime constraint as Step 2; connectTransport.ts imports `@connectrpc/connect-node`). Full detail in Deviation Log.

## Session 2026-05-18T00:00:00Z — sdd-execute (Step 3)
**Steps this session**: [3]
**Progress**: 3 done / 16 total
**Stopped at**: Step 3 (step complete — PR created)
**Next**: /sdd-execute wire-fe-auth next

### Step 4 — Add `/login` page and `/api/auth/*` routes to xstockstrat-trader [done]
- Created `src/app/api/auth/login/route.ts`, `refresh/route.ts`, `logout/route.ts`, and `src/app/login/page.tsx`. Login page wraps `useSearchParams()` in a `<Suspense>` boundary per Next.js 14 App Router requirement. All routes import from `@/lib/auth`. Lint passed with no new errors.
- Files modified: `services/xstockstrat-trader/src/app/api/auth/login/route.ts`, `services/xstockstrat-trader/src/app/api/auth/refresh/route.ts`, `services/xstockstrat-trader/src/app/api/auth/logout/route.ts`, `services/xstockstrat-trader/src/app/login/page.tsx`
- Deviations: none

## Session 2026-05-19T00:00:00Z — sdd-execute (Step 4)
**Steps this session**: [4]
**Progress**: 4 done / 16 total
**Stopped at**: Step 4 (step complete — PR created)
**Next**: /sdd-execute wire-fe-auth next

### Step 5 — Add `middleware.ts` to xstockstrat-trader [done]
- Created `services/xstockstrat-trader/src/middleware.ts` with matcher (excludes static assets, auth login, and health routes), JWT session check, near-expiry token refresh via `/api/auth/refresh`, and trace ID propagation (request direction only). Lint passed with no new errors.
- Files modified: `services/xstockstrat-trader/src/middleware.ts`
- Deviations: none

## Session 2026-05-19T00:00:00Z — sdd-execute (Step 5)
**Steps this session**: [5]
**Progress**: 5 done / 16 total
**Stopped at**: Step 5 (step complete — PR created)
**Next**: /sdd-execute wire-fe-auth next

### Step 6 — Fix API routes in xstockstrat-trader to extract userId from JWT [done]
- Updated `orders/route.ts` (POST + GET), `portfolio/route.ts` (GET), and `alerts/stream/route.ts` (GET). All three handlers now call `getSessionFromRequest()` at entry and return 401 if no valid session. All outbound Connect-RPC fetch calls receive `x-user-id`, `x-access-scope`, and `x-trace-id` propagation headers. The `listAlerts` function in alerts/stream was moved inside GET to close over the captured claims and headers. Lint passed with no new errors (only pre-existing `any` warnings throughout the codebase).
- Files modified: `services/xstockstrat-trader/src/app/api/orders/route.ts`, `services/xstockstrat-trader/src/app/api/portfolio/route.ts`, `services/xstockstrat-trader/src/app/api/alerts/stream/route.ts`
- Deviations: none

## Session 2026-05-19T00:00:00Z — sdd-execute (Step 6)
**Steps this session**: [6]
**Progress**: 6 done / 16 total
**Stopped at**: Step 6 (step complete — PR created)
**Next**: /sdd-execute wire-fe-auth next

### Step 7 — Add login page, auth API routes, and middleware to xstockstrat-insights [done]
- Created `src/app/api/auth/login/route.ts`, `refresh/route.ts`, `logout/route.ts` and `src/app/login/page.tsx` (title: "xstockstrat Insights"). Created `src/middleware.ts` with identical matcher and redirect logic as trader. Updated all four API route files (`backtest`, `strategies`, `report/[id]`, `portfolio`) to call `getSessionFromRequest()` at entry (401 if null) and add all three propagation headers to every outbound fetch. Replaced `userId: ''` with `claims.user_id` in `strategies` route's `ListStrategies` call. Lint passed with no new errors.
- Files modified: `services/xstockstrat-insights/src/app/api/auth/login/route.ts`, `services/xstockstrat-insights/src/app/api/auth/refresh/route.ts`, `services/xstockstrat-insights/src/app/api/auth/logout/route.ts`, `services/xstockstrat-insights/src/app/login/page.tsx`, `services/xstockstrat-insights/src/middleware.ts`, `services/xstockstrat-insights/src/app/api/analysis/backtest/route.ts`, `services/xstockstrat-insights/src/app/api/analysis/strategies/route.ts`, `services/xstockstrat-insights/src/app/api/analysis/report/[id]/route.ts`, `services/xstockstrat-insights/src/app/api/portfolio/route.ts`
- Deviations: none

## Session 2026-05-19T00:00:00Z — sdd-execute (Step 7)
**Steps this session**: [7]
**Progress**: 7 done / 16 total
**Stopped at**: Step 7 (step complete — PR created)
**Next**: /sdd-execute wire-fe-auth next

### Step 8 — Add login page, auth API routes, and middleware to xstockstrat-config-ui [done]
- Modified tsconfig.json to add `"./app/*"` to `@/*` paths (user chose Option A when gap surfaced). Created `app/api/auth/login/route.ts`, `refresh/route.ts`, `logout/route.ts`, `app/login/page.tsx` (title: "xstockstrat Config"), and `middleware.ts` at service root. Modified `app/api/config/route.ts` (both GET and POST: auth-gated, propagation headers added, author replaced with `claims.user_id`) and `app/api/audit/route.ts` (auth-gated only; no header forwarding needed for direct DB query). Login page uses `@components/ui/*` alias since `@/` resolves to `src/` not root. Lint passed with no new errors.
- Files modified: `services/xstockstrat-config-ui/tsconfig.json`, `services/xstockstrat-config-ui/app/api/auth/login/route.ts`, `services/xstockstrat-config-ui/app/api/auth/refresh/route.ts`, `services/xstockstrat-config-ui/app/api/auth/logout/route.ts`, `services/xstockstrat-config-ui/app/login/page.tsx`, `services/xstockstrat-config-ui/middleware.ts`, `services/xstockstrat-config-ui/app/api/config/route.ts`, `services/xstockstrat-config-ui/app/api/audit/route.ts`
- Deviations: tsconfig.json moved from Step 9 to Step 8 scope (user Option A); login page uses `@components/ui/*` alias for UI imports. Full detail in Deviation Log.

## Session 2026-05-19T00:00:00Z — sdd-execute (Step 8)
**Steps this session**: [8]
**Progress**: 8 done / 16 total
**Stopped at**: Step 8 (step complete — PR created)
**Next**: /sdd-execute wire-fe-auth next

### Step 9 — Read tsconfig.json in config-ui to verify `@/` alias resolution [done]
- Step 8's tsconfig change (`"@/*": ["./src/*", "./app/*"]`) caused a webpack build error: `Module not found: Can't resolve '@/app/lib/auth'`. The double-array pattern caused `@/app/lib/auth` to resolve to `./app/app/lib/auth` (double `app/` prefix). Fixed by changing to `"@/*": ["./*"]` (root-relative wildcard). Build passes with zero TypeScript or module-resolution errors.
- Files modified: `services/xstockstrat-config-ui/tsconfig.json`
- Deviations: corrected Step 8's tsconfig path; full detail in Deviation Log.

## Session 2026-05-19T00:00:00Z — sdd-execute (Step 9)
**Steps this session**: [9]
**Progress**: 9 done / 16 total
**Stopped at**: Step 9 (step complete — PR created)
**Next**: /sdd-execute wire-fe-auth next

### Step 10 — Strip x-user-id from inbound external requests in nginx [done]
- Added three `proxy_set_header x-user-id "";`, `proxy_set_header x-access-scope "";`, `proxy_set_header x-trace-id "";` directives to the `server {}` block in `nginx.conf` after the existing proxy header section. These clear all three propagation headers for every inbound external request, preventing spoofing.
- Files modified: `nginx.conf`
- Deviations: Docker unavailable for verification; nginx syntax manually verified as correct. Full detail in Deviation Log.

## Session 2026-05-19T00:00:00Z — sdd-execute (Step 10)
**Steps this session**: [10]
**Progress**: 10 done / 16 total
**Stopped at**: Step 10 (step complete — PR created)
**Next**: /sdd-execute wire-fe-auth next

### Step 11 — Wire JWT_SECRET and IDENTITY_HTTP_ENDPOINT env vars [done]
- Added `JWT_SECRET: ${JWT_SECRET:?JWT_SECRET is required}` to trader and insights environment blocks in docker-compose.yml. Added `IDENTITY_HTTP_ENDPOINT` + `JWT_SECRET` to config-ui environment block. Added `xstockstrat-identity: condition: service_started` to config-ui `depends_on`. Applied identical changes (JWT_SECRET as `type: SECRET` + IDENTITY_HTTP_ENDPOINT for config-ui) to both `.do/app.dev.yaml` and `.do/app.yaml`. Verification: `grep -c "JWT_SECRET" .do/app.dev.yaml` = 4; `grep -c "JWT_SECRET" .do/app.yaml` = 4.
- Files modified: `docker-compose.yml`, `.do/app.dev.yaml`, `.do/app.yaml`
- Deviations: `docker compose config` not available; YAML correctness verified by grep.

## Session 2026-05-19T00:00:00Z — sdd-execute (Step 11)
**Steps this session**: [11]
**Progress**: 11 done / 16 total
**Stopped at**: Step 11 (step complete — PR created)
**Next**: /sdd-execute wire-fe-auth next

### Step 12 — test: Add auth E2E smoke tests to all three frontends [done]
- Created `services/xstockstrat-trader/e2e/auth.spec.ts`, `services/xstockstrat-insights/e2e/auth.spec.ts`, `services/xstockstrat-config-ui/e2e/auth.spec.ts` with login/logout/redirect/cookie-clearing tests using `{ page }` fixture.
- Modified `mock-backend.ts` in all three services (made `startMockBackend()` async, added `AuthenticateUser`/`RefreshToken`/`RevokeToken` identity RPC responses with dynamically-signed JWTs via `jose`).
- Modified `playwright.config.ts` in all three services to add `IDENTITY_HTTP_ENDPOINT` and `JWT_SECRET` to `webServer.env`.
- Modified `services/xstockstrat-trader/e2e/api-smoke.spec.ts`, `services/xstockstrat-insights/e2e/api-smoke.spec.ts`, `services/xstockstrat-config-ui/e2e/api-smoke.spec.ts` (Option A expansion): added `addAuthCookie(page)` helper generating JWT via `jose.SignJWT`, changed `{ request }` → `{ page }`, changed `request.get/post` → `page.request.get/post`, added `await addAuthCookie(page)` at start of each test.
- Files modified: `services/xstockstrat-trader/e2e/auth.spec.ts` (create), `services/xstockstrat-trader/e2e/mock-backend.ts`, `services/xstockstrat-trader/playwright.config.ts`, `services/xstockstrat-trader/e2e/api-smoke.spec.ts`, `services/xstockstrat-insights/e2e/auth.spec.ts` (create), `services/xstockstrat-insights/e2e/mock-backend.ts`, `services/xstockstrat-insights/playwright.config.ts`, `services/xstockstrat-insights/e2e/api-smoke.spec.ts`, `services/xstockstrat-config-ui/e2e/auth.spec.ts` (create), `services/xstockstrat-config-ui/e2e/mock-backend.ts`, `services/xstockstrat-config-ui/playwright.config.ts`, `services/xstockstrat-config-ui/e2e/api-smoke.spec.ts`
- Deviations: Expanded scope (Option A, user approved) to update smoke tests for auth — existing `{ request }` tests would 302 after middleware added. Full detail in Deviation Log.

## Session 2026-05-19T00:00:00Z — sdd-execute (Step 12)
**Steps this session**: [12]
**Progress**: 12 done / 16 total
**Stopped at**: Step 12 (step complete — PR created)
**Next**: /sdd-execute wire-fe-auth next
