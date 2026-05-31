# Context: upgrade-nextjs15

**Feature**: `docs/roadmap/features/041-upgrade-nextjs15/feature.md`
**Product Spec**: `docs/roadmap/features/041-upgrade-nextjs15/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/041-upgrade-nextjs15/implementation-spec.md`

---

## Session 2026-05-30T00:00:00Z — sdd-story

- Wrote product-spec.md from the existing `idea`-state feature.md backlog entry (created
  2026-05-27 after the DO deploy-failure investigation). Status: `idea` → `draft`.
- Part of a 4-feature spec batch (033, 041, 045, 044), each delivered as an independent PR off
  `main-dev`. Open questions deliberately left open for the `/sdd-review product-spec` gate.
- Grounded against current `main-dev`:
  - `xstockstrat-insights` and `xstockstrat-config-ui`: `next` `^14.2.3`, `react` `^18.3.1`,
    `eslint-config-next` `^14.2.35`, OTel `@opentelemetry/sdk-node` + `exporter-trace-otlp-http`
    at `^0.218.0`.
  - `xstockstrat-trader`: `next` `^15.5.15` (the realignment target).
- Open questions raised for review: exact v15 pin policy, React 18-vs-19 (and Radix/charting
  gating), whether the pnpm-workspace standalone-path workaround can be removed on v15, OTel
  package compatibility, and sequencing against features 045 (UI consolidation) and 044
  (client-api-pattern).
- Next action: `/sdd-review upgrade-nextjs15 product-spec`.

## Session 2026-05-31T00:00:00Z — sdd-spec

- Generated implementation-spec.md with 7 steps. Status: `draft` → `implementation-ready`.
- Key codebase findings:
  - React version decision: trader pairs Next.js 15.5.15 with React 18.3.1 (confirmed in `services/xstockstrat-trader/package.json` L38 and `pnpm-lock.yaml` L3767). Insights and config-ui will stay on React 18 — no React 19 bump needed.
  - OTel compatibility: trader uses identical `@opentelemetry/sdk-node ^0.218.0` + `exporter-trace-otlp-http ^0.218.0` pins with Next.js 15 (confirmed via Read). No OTel version changes required.
  - Async params scope: only two files need async-params fixes. In insights: `src/app/api/analysis/report/[id]/route.ts` L12 (Route Handler with `params.id`). In config-ui: `app/page.tsx` L29 (Server Component with synchronous `searchParams` prop). All other `params`/`searchParams` usages are in `'use client'` components (React hooks `useSearchParams`, `useParams`) or use `new URL(req.url).searchParams` — both are unaffected.
  - No `next/headers` imports in either service — no `cookies()` or `headers()` async migration needed.
  - `app/[namespace]/page.tsx` in config-ui has `'use client'` (L6) despite having `params`/`searchParams` in its type signature — Client Components are unaffected by the async-props change.
  - The pnpm-workspace standalone-path workaround in `docs/patterns/docker-build.md` (CMD using subdirectory `services/<service>/server.js`) is already implemented in both Dockerfiles. The behavior is expected to be unchanged on Next.js 15.

## Session 2026-05-31T00:00:00Z — sdd-review product-spec

- Retroactive product-spec review (gate was skipped when /sdd-spec ran directly from `draft`).
- Result: PASS after resolving 5 open questions.
- Warnings: 1 — feature `formula-management-ui` (003) also modifies `services/xstockstrat-insights/package.json`; merge conflict risk; coordinate merge order.
- Open questions resolved:
  1. Next.js version pin: `^15.5.15` (match trader exactly)
  2. React version: stay on 18.3.1 (trader confirmed on React 18 + Next 15)
  3. Standalone-path workaround: stays; behavior unchanged on v15
  4. OTel compatibility: no bump needed; ^0.218.0 confirmed via trader
  5. Sequencing vs 045: 041 proceeds independently; 045 still draft
- Status: lifecycle unchanged (already `implementation-ready`); product-spec.md open questions checked off.

### Step 2 — Fix next.config.js and async params in xstockstrat-insights [done]
- Renamed `experimental.serverComponentsExternalPackages` → top-level `serverExternalPackages` in `next.config.js`; `experimental` block removed.
- Original async-params target (`src/app/api/analysis/report/[id]/route.ts`) was deleted by 044. Exhaustive scan (Option A) found `src/app/strategies/[id]/page.tsx` failing TypeScript PageProps constraint. Fixed with `React.use(params)` pattern (client component pattern for Next.js 15).
- `pnpm run build` passes cleanly — full route table emitted, exit 0.
- Files modified: `services/xstockstrat-insights/next.config.js`, `services/xstockstrat-insights/src/app/strategies/[id]/page.tsx`
- Deviations: see Deviation Log — async-params fix applied to different file using client-component pattern

### Step 1 — Upgrade xstockstrat-insights to Next.js 15 [done]
- Changed `next` from `^14.2.3` to `^15.5.15` and `eslint-config-next` from `^14.2.35` to `^15` in `services/xstockstrat-insights/package.json`. `react`, `react-dom`, and all `@opentelemetry/*` versions unchanged.
- Ran `pnpm install --filter xstockstrat-insights` — completed with no peer-dependency errors; root `pnpm-lock.yaml` updated.
- Files modified: `services/xstockstrat-insights/package.json`, `pnpm-lock.yaml`
- Deviations: none

### Step 3 — E2E validation for xstockstrat-insights [done]
- All 44 E2E tests pass (Chromium + Firefox) after fixing tests stale from the 044 client-api-pattern merge.
- Root causes found and fixed:
  1. `connectClients.ts`: added `createConnectTransport` (with `useBinaryFormat: false`) as HTTP override path for test mocking; `makeTransport` now accepts optional `httpOverride` env var.
  2. `playwright.config.ts`: added missing `TRADING_HTTP_ENDPOINT` and `PORTFOLIO_HTTP_ENDPOINT` env vars pointing at mock backend (port 9092).
  3. `mock-backend.ts`: fixed Content-Type from `application/connect+json` (streaming) to `application/json` (Connect unary); fixed BrokerAccount and Portfolio field names to camelCase proto JSON; fixed identity response field names to camelCase (`accessToken`, `refreshToken`, `claims.userId`).
  4. `dashboard.spec.ts`, `account-portfolio.spec.ts`: replaced stale JSON route intercepts with Connect-RPC URL patterns (`**/xstockstrat.<svc>/...`); added `addAuthCookie()` for middleware pass-through; fixed content-type to `application/json`; fixed selector ambiguities (exact match, role-based).
  5. `api-smoke.spec.ts`: rewrote to call BFF via `page.evaluate()` (browser fetch) to avoid Next.js dev server Transfer-Encoding+Content-Length conflict with Playwright/undici; navigates to login page first for same-origin context.
  6. `auth.spec.ts`: updated protected-route test to use Connect-RPC BFF endpoint (POST) instead of deleted JSON route.
- connect-node `createConnectTransport` defaults `useBinaryFormat: true`; the mock needed `useBinaryFormat: false` to serve JSON.
- Files modified: `services/xstockstrat-insights/src/lib/connectClients.ts`, `services/xstockstrat-insights/playwright.config.ts`, `services/xstockstrat-insights/e2e/mock-backend.ts`, `services/xstockstrat-insights/e2e/dashboard.spec.ts`, `services/xstockstrat-insights/e2e/account-portfolio.spec.ts`, `services/xstockstrat-insights/e2e/api-smoke.spec.ts`, `services/xstockstrat-insights/e2e/auth.spec.ts`
- Deviations: expanded scope to fix 7 stale test files (Option A chosen); Docker build check deferred (no Docker daemon in environment).

### Steps 4–6 — Upgrade xstockstrat-config-ui to Next.js 15 + E2E validation [done]

**Step 4 — Upgrade xstockstrat-config-ui to Next.js 15**
- Changed `next` from `^14.2.3` to `^15.5.15` and `eslint-config-next` from `^14.2.35` to `^15` in `services/xstockstrat-config-ui/package.json`. `react`, `react-dom`, and all `@opentelemetry/*` versions unchanged.
- Ran `pnpm install --filter xstockstrat-config-ui` — completed with only pre-existing proto/gen/ts peer dependency warnings; root `pnpm-lock.yaml` updated.
- Files modified: `services/xstockstrat-config-ui/package.json`, `pnpm-lock.yaml`
- Deviations: none

**Step 5 — Fix next.config.js and async params in xstockstrat-config-ui**
- Renamed `experimental.serverComponentsExternalPackages` → top-level `serverExternalPackages` in `next.config.js`; `experimental` block removed.
- Spec targeted `app/page.tsx` (Server Component async `searchParams`): fixed with `async function HomePage` + `await searchParams` + `Promise<SearchParams>` type.
- Deviations (expanded scope — same root cause as Step 2 deviation for insights):
  1. `app/[namespace]/page.tsx` (`'use client'`): Next.js 15 TypeScript `PageProps` constraint enforced even on client components. Fixed with `React.use(params)` and `React.use(searchParams)` pattern.
  2. `app/layout.tsx`: `eslint-config-next@15` now errors on `<a>` elements for page navigation. Same-app `/config-ui` links converted to `<Link href="/">`. Cross-app `/trader` and `/insights` links kept as `<a>` (basePath would mangle `<Link>`) with `eslint-disable-next-line` comments.
- `pnpm run build` passes cleanly — 14 routes emitted, exit 0.
- Files modified: `services/xstockstrat-config-ui/next.config.js`, `services/xstockstrat-config-ui/app/page.tsx`, `services/xstockstrat-config-ui/app/[namespace]/page.tsx`, `services/xstockstrat-config-ui/app/layout.tsx`, `services/xstockstrat-config-ui/next-env.d.ts`, `services/xstockstrat-config-ui/tsconfig.json`

**Step 6 — E2E validation for xstockstrat-config-ui**
- All 62 E2E tests pass (Chromium + Firefox) after fixing tests stale from prior architecture changes.
- Root causes found and fixed:
  1. `connectClients.ts`: added `createConnectTransport` HTTP override path; `makeTransport` now accepts optional `httpOverride`. Matches insights pattern.
  2. `playwright.config.ts`: renamed `CONFIG_ENDPOINT` → `CONFIG_HTTP_ENDPOINT` (was causing double-http URL bug).
  3. `mock-backend.ts`: fixed Content-Type to `application/json`; fixed identity payload to camelCase; changed `hasCredentials: false` → `true` (proto3 zero-value booleans omitted from JSON encoding).
  4. `env-mode-switcher.spec.ts`, `namespace-nav.spec.ts`: added `addAuthCookie()` + called before all `page.goto()` — middleware protects all page routes.
  5. `api-smoke.spec.ts`: rewrote to call Connect BFF via `page.evaluate()`; corrected paths to `/config-ui/api/xstockstrat.config.v1.ConfigService/ListKeys` etc.; updated `isSecret` assertion for proto3 zero-value omission.
  6. `sources.spec.ts`: rewrote API tests to use Connect BFF via `page.evaluate()`; fixed `ManageSignalSource.operation` from integer to string (`'update'`, `'deactivate'`) — field is `string` type in proto.
- Key findings:
  - `ManageSignalSource.operation` is `string` type (ingest.proto L135), not an enum.
  - Proto3 zero-value booleans (`false`) are omitted from JSON encoding — test assertions must handle `undefined` as equivalent to `false`.
  - Old test routes `/api/config` and `/api/sources` don't exist; architecture uses Connect BFF catch-all.
- Files modified: `services/xstockstrat-config-ui/app/lib/connectClients.ts`, `services/xstockstrat-config-ui/playwright.config.ts`, `services/xstockstrat-config-ui/e2e/mock-backend.ts`, `services/xstockstrat-config-ui/e2e/env-mode-switcher.spec.ts`, `services/xstockstrat-config-ui/e2e/namespace-nav.spec.ts`, `services/xstockstrat-config-ui/e2e/api-smoke.spec.ts`, `services/xstockstrat-config-ui/e2e/sources.spec.ts`
