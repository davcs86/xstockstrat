# Implementation Spec: upgrade-nextjs15

**Status**: `pending`
**Created**: 2026-05-31
**Feature**: `docs/roadmap/features/041-upgrade-nextjs15/feature.md`
**Total Steps**: 7
**Feature Branch**: `feature/upgrade-nextjs15`

---

## Execution Summary

Upgrade `xstockstrat-insights` and `xstockstrat-config-ui` from Next.js 14.2.x to Next.js
15.5.15 (matching `xstockstrat-trader`), keeping React 18.3.1 (trader also pairs Next.js 15
with React 18 — confirmed via `pnpm-lock.yaml`). The upgrade is split by service for
containment: insights (Steps 1–3) then config-ui (Steps 4–6), each getting its own
`package.json` + `next.config.js` + async-params fix step, followed by a shared docs step
(Step 7) to reconcile any documentation changes. There are no proto, migration, or config key
changes.

## Step Dependencies

- Step 2 requires Step 1: `next.config.js` and async-params fixes depend on the upgraded
  Next.js version being installed first.
- Step 3 [test] covers Step 1 + Step 2 for insights: E2E tests validate the combined upgrade.
- Step 5 requires Step 4: same reason as Step 2 requires Step 1.
- Step 6 [test] covers Step 4 + Step 5 for config-ui.
- Step 7 [docs] can run after Step 3 and Step 6 pass.

---

### Step 1 — service: Upgrade xstockstrat-insights to Next.js 15

**Status**: `done`
**Service**: `xstockstrat-insights`
**Files**:
- `services/xstockstrat-insights/package.json` — modify
- `services/xstockstrat-insights/pnpm-lock.yaml` — **not a separate file**; the shared root `pnpm-lock.yaml` is updated by running `pnpm install` from the workspace root after editing this file

**Reviewers**: xstockstrat-insights owner — Analytics display accuracy, SSE polling resilience, read-only access pattern

**Codebase Evidence**:
- Current versions confirmed via Read of `services/xstockstrat-insights/package.json`:
  - `"next": "^14.2.3"` (L37)
  - `"react": "^18.3.1"` (L38), `"react-dom": "^18.3.1"` (L39)
  - `"eslint-config-next": "^14.2.35"` (L53)
  - `"@opentelemetry/sdk-node": "^0.218.0"` (L24), `"@opentelemetry/exporter-trace-otlp-http": "^0.218.0"` (L23)
- Target versions confirmed via `services/xstockstrat-trader/package.json`:
  - `"next": "^15.5.15"` (L37), `"eslint-config-next": "^15"` (L53)
  - `"react": "^18.3.1"` (L38) — React 18 is retained; trader is already on Next.js 15 + React 18
  - `"@opentelemetry/sdk-node": "^0.218.0"` (same), `"@opentelemetry/exporter-trace-otlp-http": "^0.218.0"` (same) — OTel versions unchanged; trader uses identical pins with Next.js 15 so no OTel bump is needed
- Lock file confirmed at repo root: `/home/user/xstockstrat/pnpm-lock.yaml` — `next@15.5.15` already present (L3401)
- `@types/react`: remains `"^18"` (trader L48) — no React 19 type bump needed

**Instructions**:
1. In `services/xstockstrat-insights/package.json`, change the following version strings:
   - `"next": "^14.2.3"` → `"next": "^15.5.15"`
   - `"eslint-config-next": "^14.2.35"` → `"eslint-config-next": "^15"`
   - Leave `"react"`, `"react-dom"`, and all `@opentelemetry/*` versions unchanged (React 18 and OTel ^0.218.0 are confirmed compatible with Next.js 15 via trader's existing package.json).
2. From the repo root, run `pnpm install --filter xstockstrat-insights` to update the root `pnpm-lock.yaml`. Verify the command exits with no unmet peer-dependency errors.
3. Commit the updated `package.json` and `pnpm-lock.yaml` together (they must be in the same commit per root CLAUDE.md Python uv lock rule analogue for pnpm).

**Verification**:
```bash
cd /home/user/xstockstrat
grep '"next"' services/xstockstrat-insights/package.json
# Expected: "next": "^15.5.15"
grep '"eslint-config-next"' services/xstockstrat-insights/package.json
# Expected: "eslint-config-next": "^15"
pnpm install --filter xstockstrat-insights 2>&1 | grep -E "ERR|WARN|error" | grep -iv "deprecated" | head -20
# Expected: no output (zero unmet-peer errors)
```

---

### Step 2 — service: Fix next.config.js and async params in xstockstrat-insights

**Status**: `done`
**Service**: `xstockstrat-insights`
**Files**:
- `services/xstockstrat-insights/next.config.js` — modify
- `services/xstockstrat-insights/src/app/api/analysis/report/[id]/route.ts` — modify

**Reviewers**: xstockstrat-insights owner — Analytics display accuracy, SSE polling resilience, read-only access pattern

**Codebase Evidence**:
- `next.config.js` uses deprecated `experimental.serverComponentsExternalPackages` key (confirmed via Read of `services/xstockstrat-insights/next.config.js` L5-L7):
  ```js
  experimental: {
    serverComponentsExternalPackages: ['@connectrpc/connect', ...],
  }
  ```
- Trader's `next.config.js` shows the corrected top-level key (confirmed via Read of `services/xstockstrat-trader/next.config.js` L7):
  ```js
  serverExternalPackages: ['@connectrpc/connect', ...]
  ```
- Route handler at `src/app/api/analysis/report/[id]/route.ts` L12 uses synchronous `params`:
  ```ts
  export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  ```
  and accesses `params.id` at L24. In Next.js 15, the second argument `{ params }` is now `Promise<{ id: string }>` and must be awaited.
- Reference pattern from `services/xstockstrat-trader/src/app/api/orders/[id]/route.ts` (confirmed via grep):
  ```ts
  export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    ...
    const { id } = await params;
  ```
- No `import { cookies } from 'next/headers'` or `import { headers } from 'next/headers'` in any insights file — confirmed via grep returning no matches. All cookie access is via `req.cookies.get()` (NextRequest API), which is unchanged.
- All client-side `searchParams` usage (`page.tsx`, `market/[symbol]/page.tsx`, `login/page.tsx`) is via `useSearchParams()` React hook in `'use client'` components — these are unaffected by the Next.js 15 async-searchParams change.
- All `fetch()` calls in insights are client-side (in `'use client'` components) or use `new URL(req.url)` in Route Handlers — neither uses Next.js server-side fetch with implicit `force-cache`. No caching annotation changes are required.

**Instructions**:
1. In `services/xstockstrat-insights/next.config.js`, rename the nested `experimental.serverComponentsExternalPackages` key to the top-level `serverExternalPackages` key and remove the now-empty `experimental` block:
   ```js
   /** @type {import('next').NextConfig} */
   const nextConfig = {
     basePath: '/insights',
     output: 'standalone',
     serverExternalPackages: ['@connectrpc/connect', '@connectrpc/connect-node', '@bufbuild/protobuf', '@opentelemetry/sdk-node', '@opentelemetry/exporter-trace-otlp-http'],
   };
   module.exports = nextConfig;
   ```
2. In `services/xstockstrat-insights/src/app/api/analysis/report/[id]/route.ts`, update the Route Handler signature and access pattern to match the Next.js 15 async-params style:
   - Change L12 signature: `{ params }: { params: { id: string } }` → `{ params }: { params: Promise<{ id: string }> }`
   - Add `const { id } = await params;` as the first line of the function body, before the `getSessionFromRequest` call
   - Replace all subsequent `params.id` references with `id`
   The reference implementation is `services/xstockstrat-trader/src/app/api/orders/[id]/route.ts` L6-L11 (confirmed via grep).

**Verification**:
```bash
grep -n "serverExternalPackages\|serverComponentsExternalPackages\|experimental" services/xstockstrat-insights/next.config.js
# Expected: one line with "serverExternalPackages", no lines with "experimental" or "serverComponentsExternalPackages"

grep -n "params" services/xstockstrat-insights/src/app/api/analysis/report/[id]/route.ts
# Expected: "Promise<{ id: string }>" on the signature line; "await params" on the first line of the function body

cd services/xstockstrat-insights && pnpm run build 2>&1 | tail -20
# Expected: "Route (app)" table printed, exit 0, no TypeScript type errors
```

---

### Step 3 — test: E2E validation for xstockstrat-insights

**Status**: `done`
**Service**: `xstockstrat-insights`
**Files**: none (test only)

**Reviewers**: xstockstrat-insights owner — Analytics display accuracy, SSE polling resilience, read-only access pattern

**Codebase Evidence**:
- E2E tests confirmed at `services/xstockstrat-insights/e2e/` (confirmed via `find`):
  - `auth.spec.ts`, `api-smoke.spec.ts`, `dashboard.spec.ts`, `account-portfolio.spec.ts`
- `playwright.config.ts` present at `services/xstockstrat-insights/playwright.config.ts`
- `test:e2e` script confirmed in `package.json` L15: `"test:e2e": "playwright test"`
- No unit coverage threshold applies to Next.js frontends (root CLAUDE.md: "xstockstrat-trader, xstockstrat-insights, xstockstrat-config-ui: n/a")

**Instructions**:
1. Start the full docker-compose stack (or the insights service in dev mode) so the mock backends are available.
2. From `services/xstockstrat-insights/`, run `pnpm test:e2e`.
3. Confirm all specs pass with no failures.
4. Manually verify: navigate to `/insights/`, `/insights/strategies`, and `/insights/strategies/<any-id>` — confirm pages load, no runtime errors in the browser console, and the backtest report API route (`/api/analysis/report/<id>`) responds correctly (test that the async `params` fix in Step 2 works end-to-end).

**Verification**:
```bash
cd services/xstockstrat-insights && pnpm test:e2e
# Expected: all specs pass, no FAILED lines in output

# If running in docker-compose, also verify Docker build succeeds:
docker compose build --no-cache xstockstrat-insights
# Expected: exit 0, image built, CMD line "node services/xstockstrat-insights/server.js" confirmed
```

---

### Step 4 — service: Upgrade xstockstrat-config-ui to Next.js 15

**Status**: `done`
**Service**: `xstockstrat-config-ui`
**Files**:
- `services/xstockstrat-config-ui/package.json` — modify
- Root `pnpm-lock.yaml` — updated by `pnpm install` (not edited directly)

**Reviewers**: xstockstrat-config-ui owner — Config mutation safety, environment scope correctness, no secret values rendered in UI

**Codebase Evidence**:
- Current versions confirmed via Read of `services/xstockstrat-config-ui/package.json`:
  - `"next": "^14.2.3"` (L36)
  - `"react": "^18.3.1"` (L37), `"react-dom": "^18.3.1"` (L38)
  - `"eslint-config-next": "^14.2.35"` (L52)
  - `"@opentelemetry/sdk-node": "^0.218.0"` (L23), `"@opentelemetry/exporter-trace-otlp-http": "^0.218.0"` (L22)
- Target versions same as insights: `next ^15.5.15`, `eslint-config-next ^15`, React and OTel unchanged.
- `pg` dependency (`"pg": "^8.11.5"` at L34) is a Node.js-native package — it must remain in `serverExternalPackages` or be otherwise excluded from the Next.js bundle; currently it is NOT listed in `next.config.js` `experimental.serverComponentsExternalPackages`. Confirm after upgrade whether `pg` needs to be added. The config-ui uses direct DB queries in `app/api/audit/route.ts` (confirmed at L48-L49: `await db.query(query, params)`).

**Instructions**:
1. In `services/xstockstrat-config-ui/package.json`, change:
   - `"next": "^14.2.3"` → `"next": "^15.5.15"`
   - `"eslint-config-next": "^14.2.35"` → `"eslint-config-next": "^15"`
   - Leave `"react"`, `"react-dom"`, all `@opentelemetry/*`, and `"pg"` versions unchanged.
2. From the repo root, run `pnpm install --filter xstockstrat-config-ui`. Verify no peer-dependency errors.

**Verification**:
```bash
cd /home/user/xstockstrat
grep '"next"' services/xstockstrat-config-ui/package.json
# Expected: "next": "^15.5.15"
grep '"eslint-config-next"' services/xstockstrat-config-ui/package.json
# Expected: "eslint-config-next": "^15"
pnpm install --filter xstockstrat-config-ui 2>&1 | grep -E "ERR|WARN|error" | grep -iv "deprecated" | head -20
# Expected: no output (zero unmet-peer errors)
```

---

### Step 5 — service: Fix next.config.js and async params in xstockstrat-config-ui

**Status**: `done`
**Service**: `xstockstrat-config-ui`
**Files**:
- `services/xstockstrat-config-ui/next.config.js` — modify
- `services/xstockstrat-config-ui/app/page.tsx` — modify

**Reviewers**: xstockstrat-config-ui owner — Config mutation safety, environment scope correctness, no secret values rendered in UI

**Codebase Evidence**:
- `next.config.js` uses deprecated `experimental.serverComponentsExternalPackages` (confirmed via Read of `services/xstockstrat-config-ui/next.config.js` L6-L8). Same fix needed as insights.
- `app/page.tsx` is a Server Component (no `'use client'` directive — confirmed via Read showing no `'use client'` at the top). It receives `searchParams` as a prop synchronously (L29: `export default function HomePage({ searchParams }: { searchParams: SearchParams })`). In Next.js 15, `searchParams` in Server Component props is now `Promise<SearchParams>` and must be awaited.
- `app/[namespace]/page.tsx` has `'use client'` at L6 (confirmed via Read). Although it has `params`/`searchParams` in its type signature (L32-L33), it is a **Client Component** — Next.js 15 does not change the sync prop contract for Client Components (the page boundary converts the Promise). No change needed here.
- No Route Handlers in config-ui have dynamic `[param]` segments — `app/api/config/route.ts`, `app/api/audit/route.ts`, `app/api/sources/route.ts` all match non-dynamic paths. The `app/api/[...connect]/route.ts` uses catch-all `...connect` — confirm whether this receives `params` as a second argument and whether it accesses `params.connect` (check the file).
- No `import { cookies } from 'next/headers'` or `import { headers } from 'next/headers'` in any config-ui file — confirmed via grep returning no matches.
- All `fetch()` calls in config-ui are client-side (in `'use client'` components) or use `new URL(req.url)` in Route Handlers — no server-side fetch caching changes required.

**Instructions**:
1. Before writing any code, read `services/xstockstrat-config-ui/app/api/[...connect]/route.ts` to verify how it handles `params`. If it destructures `params.connect`, update its signature to `params: Promise<{ connect: string[] }>` and add `const { connect } = await params;`.
2. In `services/xstockstrat-config-ui/next.config.js`, rename `experimental.serverComponentsExternalPackages` to top-level `serverExternalPackages` and remove the `experimental` block:
   ```js
   /** @type {import('next').NextConfig} */
   const nextConfig = {
     basePath: '/config-ui',
     output: 'standalone',
     // Allow server-side Connect-RPC calls to backend services
     serverExternalPackages: ['@connectrpc/connect', '@connectrpc/connect-node', '@bufbuild/protobuf', '@opentelemetry/sdk-node', '@opentelemetry/exporter-trace-otlp-http'],
   };
   module.exports = nextConfig;
   ```
   Note: `pg` does not need to be added to `serverExternalPackages` — it is used only in a Route Handler (Node.js runtime, not the edge runtime) so bundling is not an issue. If `pnpm run build` emits a warning about `pg`, add it to the array.
3. In `services/xstockstrat-config-ui/app/page.tsx`, update the Server Component to `await` the now-async `searchParams` prop:
   - Change the function signature: `{ searchParams }: { searchParams: SearchParams }` → `{ searchParams }: { searchParams: Promise<SearchParams> }`
   - Make the function `async`: `export default async function HomePage(...)`
   - Add `const resolvedSearchParams = await searchParams;` as the first line of the function body
   - Replace all `searchParams.env` → `resolvedSearchParams.env` and `searchParams.mode` → `resolvedSearchParams.mode` throughout the function body (3 occurrences at L30, L33, L34)

**Verification**:
```bash
grep -n "serverExternalPackages\|serverComponentsExternalPackages\|experimental" services/xstockstrat-config-ui/next.config.js
# Expected: one line with "serverExternalPackages", no lines with "experimental" or "serverComponentsExternalPackages"

grep -n "await searchParams\|async function HomePage\|Promise<SearchParams>" services/xstockstrat-config-ui/app/page.tsx
# Expected: all three patterns match (async function, Promise type, await call)

cd services/xstockstrat-config-ui && pnpm run build 2>&1 | tail -20
# Expected: "Route (app)" table printed, exit 0, no TypeScript type errors
```

---

### Step 6 — test: E2E validation for xstockstrat-config-ui

**Status**: `done`
**Service**: `xstockstrat-config-ui`
**Files**: none (test only)

**Reviewers**: xstockstrat-config-ui owner — Config mutation safety, environment scope correctness, no secret values rendered in UI

**Codebase Evidence**:
- E2E tests confirmed at `services/xstockstrat-config-ui/e2e/` (confirmed via `find`):
  - `auth.spec.ts`, `api-smoke.spec.ts`, `namespace-nav.spec.ts`, `env-mode-switcher.spec.ts`, `sources.spec.ts`
- `playwright.config.ts` present at `services/xstockstrat-config-ui/playwright.config.ts`
- `test:e2e` script confirmed in `package.json` L15: `"test:e2e": "playwright test"`
- No unit coverage threshold applies to Next.js frontends.
- `env-mode-switcher.spec.ts` and `namespace-nav.spec.ts` directly exercise `searchParams` propagation — these are the most important specs for validating the async `searchParams` fix in Step 5.

**Instructions**:
1. Start the full docker-compose stack (or the config-ui service in dev mode) with mock backends.
2. From `services/xstockstrat-config-ui/`, run `pnpm test:e2e`.
3. Confirm all specs pass, paying particular attention to:
   - `env-mode-switcher.spec.ts` — validates `?env=` and `?mode=` URL params are read and propagated correctly
   - `namespace-nav.spec.ts` — validates env/mode params are preserved when navigating between namespaces
   - `api-smoke.spec.ts` — validates `env` and `mode` params are forwarded as proto enums (per L110-L113 in the spec file)
4. Manually verify: navigate to `/config-ui/` with `?env=dev&mode=paper` — confirm the namespace list renders, env/mode switcher works, and no runtime errors appear.

**Verification**:
```bash
cd services/xstockstrat-config-ui && pnpm test:e2e
# Expected: all specs pass, no FAILED lines in output

# If running in docker-compose, also verify Docker build succeeds:
docker compose build --no-cache xstockstrat-config-ui
# Expected: exit 0, image built, CMD line "node services/xstockstrat-config-ui/server.js" confirmed
```

---

### Step 7 — docs: Update documentation for Next.js 15 alignment

**Status**: `done`
**Service**: `docs/patterns/`
**Files**:
- `docs/patterns/nextjs-frontends.md` — modify if any new Next.js 15-specific gotchas are discovered
- `docs/patterns/docker-build.md` — modify if the standalone-path workaround behavior changes
- `services/xstockstrat-insights/CLAUDE.md` — modify: update "Language" line from "Next.js 14" to "Next.js 15"
- `services/xstockstrat-config-ui/CLAUDE.md` — modify: update "Language" line from "Next.js 14" to "Next.js 15"

**Reviewers**: none

**Codebase Evidence**:
- `services/xstockstrat-insights/CLAUDE.md` L4: `TypeScript / Next.js 14 (App Router)` — must be updated
- `services/xstockstrat-config-ui/CLAUDE.md` L7: `TypeScript / Next.js 14 (App Router)` — must be updated
- `docs/patterns/docker-build.md` L127 documents the pnpm-workspace `server.js` subdirectory workaround; current Dockerfiles for insights and config-ui already use the subdirectory path correctly (`CMD ["node", "services/xstockstrat-insights/server.js"]` confirmed via Read). This workaround is the same on Next.js 15 — the standalone output path behavior has not changed in pnpm workspaces. No change to docker-build.md is expected unless Step 2/5 build output reveals otherwise.
- `docs/patterns/nextjs-frontends.md` does not currently document the `experimental.serverComponentsExternalPackages` → `serverExternalPackages` rename or the async-params migration. Add a section covering these two Next.js 15 migration points so future sessions have the pattern documented.

**Instructions**:
1. In `services/xstockstrat-insights/CLAUDE.md`, change the "Language" line (L4 / L9 heading area) from `TypeScript / Next.js 14 (App Router)` to `TypeScript / Next.js 15 (App Router)`.
2. In `services/xstockstrat-config-ui/CLAUDE.md`, change the "Language" line (L7 heading area) from `TypeScript / Next.js 14 (App Router)` to `TypeScript / Next.js 15 (App Router)`.
3. In `docs/patterns/nextjs-frontends.md`, append a new section documenting the two Next.js 15 migration points:
   - `serverExternalPackages` rename: `experimental.serverComponentsExternalPackages` → top-level `serverExternalPackages`
   - Async request props: Server Component `params` and `searchParams` props are now `Promise<T>` and must be awaited; Route Handler second-argument `params` is now `Promise<T>` and must be awaited. Include the before/after code patterns from Steps 2 and 5.
4. In `docs/patterns/docker-build.md`, verify the current standalone-path gotcha note (L127) is still accurate for Next.js 15. If the build output from Steps 2 and 5 shows a different path structure, update the note. If it is unchanged, add a parenthetical "(confirmed on Next.js 15.5.15)" to the existing note.

**Verification**:
```bash
grep "Next.js 15" services/xstockstrat-insights/CLAUDE.md
# Expected: match on the Language line

grep "Next.js 15" services/xstockstrat-config-ui/CLAUDE.md
# Expected: match on the Language line

grep -n "serverExternalPackages\|async.*params\|Promise.*params" docs/patterns/nextjs-frontends.md
# Expected: matches in the new section documenting the migration points
```

---

## Deviation Log

### Deviation: Step 2 — Fix next.config.js and async params in xstockstrat-insights
**Spec said**: Fix async params in `src/app/api/analysis/report/[id]/route.ts` using `await params` (Route Handler pattern).
**Actual**:
1. That route handler was deleted by the 044 client-api-pattern merge before this step ran — no change needed there.
2. A build failure revealed `src/app/strategies/[id]/page.tsx` (a `'use client'` component) also needed its `params` type updated. Next.js 15 enforces `PageProps` even on client components. Fix: imported `use` from React and changed `const { id } = params` → `const { id } = use(params)` with type `Promise<{ id: string }>`.
**Reason**: (1) 044 deleted the originally-targeted file. (2) Exhaustive Option A scan missed `strategies/[id]/page.tsx` because it is a client component — but Next.js 15 TypeScript types enforce `PageProps` regardless, surfaced by the build. Pattern for client components is `React.use()` not `await`.
