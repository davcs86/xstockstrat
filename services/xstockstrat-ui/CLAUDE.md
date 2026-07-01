# xstockstrat-ui — CLAUDE.md

## Role

Consolidated Next.js frontend serving all three UI segments under path prefixes:
`/trader` (order execution, positions, accounts), `/insights` (strategy analytics, backtesting,
formula authoring, backfills), and `/config-ui` (runtime config, signal sources, audit log). A fourth
segment, `/accounts`, hosts the OAuth authorized-apps UI (feature 051).

It is the platform's **Backend-for-Frontend (BFF)**: backend services are gRPC-only, so the UI exposes
per-segment Connect-RPC routers that authenticate the request (JWT cookie), forward identity headers,
and proxy to the backend gRPC services. Browsers never talk to the backends directly — they call the
segment's BFF, which holds the typed gRPC clients.

Consolidated from three separate frontends by feature 045 (`ui-consolidation-nextjs`); the nginx reverse
proxy was removed in the same feature.

## Language

Node.js 22, Next.js 15 (App Router, React 18), TypeScript. Package manager: pnpm 9.15.0.

## Docker Build Pattern

Next.js pattern — see `docs/patterns/docker-build.md`. Multi-stage `node:22-alpine` build
(`base` → `deps` → `builder` → `runner`); production emits `output: 'standalone'` (`next.config.js`)
and the runner serves it on port 3000. **E2E builds set `NEXT_DISABLE_STANDALONE=1`** so the Playwright
`webServer` can use `next start` (unsupported with `output: 'standalone'`) — every other build keeps
standalone.

## Ports

| Protocol | Port | Purpose |
|---|---|---|
| HTTP | `3000` | Next.js server (`next dev` / `next start`) |

No gRPC server — this is a frontend. It is a gRPC *client* of the backend services (below).

## Segments

| Segment | Base path | Purpose | Per-segment files |
|---|---|---|---|
| `/trader` | `/trader` | Orders, positions, accounts, alert stream | `src/app/trader/{layout,providers}.tsx`, `src/app/trader/api/[...connect]/route.ts` |
| `/insights` | `/insights` | Strategies, backtests, formulas, backfills | `src/app/insights/...` |
| `/config-ui` | `/config-ui` | Config namespaces, signal sources, audit | `src/app/config-ui/...` |
| `/accounts` | `/accounts` | OAuth authorized-apps (feature 051) | `src/app/accounts/...` |

`next.config.js` redirects `/` → `/trader` (`permanent: false`).

## Dependencies

The UI consumes these backend services over gRPC via its segment BFFs (endpoints from `*_ENDPOINT` env vars):

| Dependency | gRPC | Used by |
|---|---|---|
| xstockstrat-identity | 50058 | Auth — login / refresh / logout (`src/lib/identity.ts`) |
| xstockstrat-trading | 50051 | Trader — orders, accounts |
| xstockstrat-portfolio | 50052 | Trader — positions, P&L |
| xstockstrat-marketdata | 50053 | Trader chart + Insights — OHLCV |
| xstockstrat-analysis | 50056 | Insights — strategies, backtests |
| xstockstrat-indicators | 50054 | Insights — formulas |
| xstockstrat-ingest | 50055 | Insights/Config-UI — signal sources, backfills |
| xstockstrat-notify | 50059 | Trader — alert stream |
| xstockstrat-ledger | 50057 | Insights — ledger reads |
| xstockstrat-config | 50060 | Config-UI — config read/write |
| TimescaleDB | — | Config-UI audit route only (see Database) |

## Auth + BFF

Implements the platform frontend-auth pattern — full details in `docs/patterns/frontend-auth.md`; header
propagation in `docs/patterns/header-propagation.md`.

| File | Runtime | Purpose |
|---|---|---|
| `src/lib/auth.ts` | **Edge-safe** | JWT verify (`jose`, `JWT_SECRET`), cookie helpers, scope bitmap (`ADMIN_SCOPE`, `hasAdminScope`), trace IDs. **Must not import `@connectrpc/connect-node` or any Node-only module** — `middleware.ts` bundles it for the Edge runtime. |
| `src/lib/identity.ts` | Node | `refreshSession` / `revokeToken` wrapping the identity gRPC client |
| `src/lib/connectClients.ts` | Node | Typed gRPC clients (`createGrpcTransport`) from `*_ENDPOINT` env vars |
| `src/lib/bffShared.ts` | Node | **Canonical** BFF plumbing shared by all three segment routers: `requireSession`, `backendHeaders`, `requireAdminScope`, `createBffRouter`, `createDispatch`. Do not re-implement these per segment (DRY guard rail). |
| `src/lib/{traderBff,insightsBff,configUiBff}.ts` | Node | Per-segment routers — register `router.service(...)` then `export const dispatchConnect = createDispatch(router, '<prefix>')`; all session/header/dispatch logic comes from `bffShared.ts`. |
| `src/lib/headers.ts` | shared | **Canonical** propagation header names (`HEADER_USER_ID` / `HEADER_ACCESS_SCOPE` / `HEADER_TRACE_ID`). The DRY guard rail bans the raw `x-*` literals elsewhere. |
| `src/lib/basepath.ts` | shared | **Canonical** segment base paths (`BASE_PATH_*`) for cross-segment links/fetches. |
| `src/hooks/useInvalidatingMutation.ts` | Browser | **Canonical** factory for "call a BFF RPC then invalidate query keys" mutation hooks (order + watchlist hooks build on it). |
| `src/middleware.ts` | Edge | Route protection, token refresh, trace-ID injection; matcher must include `/` |
| `src/app/auth/{login,oauth-login}/page.tsx` | Browser | Unified login (domain root, outside all basePaths) + OAuth agent login |
| `src/app/api/auth/{login,refresh,logout,me}/route.ts` | Node | Auth endpoints (set/clear cookies, current session) |
| `src/app/<segment>/api/[...connect]/route.ts` | Node | Segment BFF entrypoint — re-exports `dispatchConnect` |

## Browser typed clients

`src/lib/browserClients/*.ts` — connect-web clients, one per service, each bound to its segment's
`baseUrl` (e.g. `tradingClient` → `/trader/api`, `insightsMarketDataClient` → `/insights/api`). A browser
component imports only the client for its segment; the call marshals to
`POST /<segment>/api/<Service>/<Method>` and reaches that segment's BFF.

## Database

Only the **config-ui audit route** touches the DB: `src/app/config-ui/api/audit/route.ts` reads
`config.config_audit` via a `pg.Pool` whose `max` defaults to **1** (`DB_POOL_MAX`). This 1 connection is
part of the platform's 20-connection budget (root CLAUDE.md § Connection Pool Budget) — do not raise it
without re-checking that table. All other segments are stateless.

## Environment Variables

Per the root naming convention (`<SERVICE>_ENDPOINT`, gRPC `host:port`).

```text
JWT_SECRET                  # required — src/lib/auth.ts jose verification
IDENTITY_ENDPOINT=xstockstrat-identity:50058
TRADING_ENDPOINT=xstockstrat-trading:50051
PORTFOLIO_ENDPOINT=xstockstrat-portfolio:50052
MARKETDATA_ENDPOINT=xstockstrat-marketdata:50053
INDICATORS_ENDPOINT=xstockstrat-indicators:50054
INGEST_ENDPOINT=xstockstrat-ingest:50055
ANALYSIS_ENDPOINT=xstockstrat-analysis:50056
LEDGER_ENDPOINT=xstockstrat-ledger:50057
NOTIFY_ENDPOINT=xstockstrat-notify:50059
CONFIG_ENDPOINT=xstockstrat-config:50060
DATABASE_URL                # config-ui audit route only
DB_POOL_MAX=1               # config-ui audit pool cap
OTEL_ENABLED                # toggle OTel; init errors never block startup
OTEL_EXPORTER_OTLP_ENDPOINT
SERVICE_NAME=xstockstrat-ui
```

## Frontend gotchas

See `docs/patterns/nextjs-frontends.md` and `docs/patterns/client-api-pattern.md` for the full pattern.

- **BFF handler-map basePath**: handlers are keyed on the full pathname *including* the segment prefix
  (e.g. `/trader/api/...`); the router `PREFIX` must match the segment or every RPC 404s.
- **Browser `fetch()` is not basePath-aware**: use the full path (`/trader/api/auth/login`), or
  `new URL(path, req.url)` in middleware — never a bare `/api/...`.
- **Edge-runtime import trap**: keep Node-only code out of `auth.ts` (it bundles to Edge via middleware).
- **Middleware matcher must include `/`** — the negative-lookahead pattern alone does not match the bare root.
- **Suspense fallbacks** must render real shell/placeholder structure, not `null`, so SSR HTML isn't empty.
- **Radix primitives** (Select/Dialog) are Client Components (`'use client'`) to avoid hydration mismatch.

## Observability

OTel via `src/telemetry.ts`, gated by `OTEL_ENABLED`; init failures are warnings only. See
`docs/patterns/observability.md`.

## Testing

Playwright E2E in `e2e/`, organized by segment (`e2e/{trader,insights,config-ui,accounts}/`,
`e2e/auth.spec.ts`) against a mock gRPC backend (`e2e/mock-backend.ts`, `e2e/global-setup.ts`,
`e2e/helpers/`). Run `pnpm test:e2e` (or `pnpm test:e2e:ui`).

**Browser resolution.** `@playwright/test` is pinned to an **exact** version (no `^`) so the
managed browser build never drifts out from under a pre-baked sandbox. `playwright.config.ts`
adapts to environments that pre-install browsers and block downloads (`PLAYWRIGHT_BROWSERS_PATH`
+ `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`): it points chromium's `launchOptions.executablePath`
(NOT a top-level `use.executablePath`, which Playwright silently ignores) at the pre-installed
Chromium and drops the Firefox project when no Firefox build is present, so the suite runs on
whatever is actually installed instead of failing at launch. When `PLAYWRIGHT_BROWSERS_PATH` is
unset (normal CI / local), Playwright uses its own managed browsers and both projects run.
When bumping the pinned version, run `pnpm exec playwright install chromium firefox` (CI does
this in the `frontend-e2e` job) so the matching build is fetched.

## Running Locally

```bash
pnpm install
pnpm dev            # http://localhost:3000 (→ /trader)
pnpm build && pnpm start
pnpm lint           # next lint
pnpm test:e2e       # Playwright
```

Requires backend gRPC services on 50051–50060 (and TimescaleDB for the config-ui audit route), plus
`JWT_SECRET` and the `*_ENDPOINT` vars.

## Key File Paths Reference

| Area | Path |
|---|---|
| Edge-safe auth | `src/lib/auth.ts` |
| Node auth (identity) | `src/lib/identity.ts` |
| gRPC clients | `src/lib/connectClients.ts` |
| Segment BFFs | `src/lib/{traderBff,insightsBff,configUiBff}.ts` |
| Browser clients | `src/lib/browserClients/*.ts` |
| Middleware | `src/middleware.ts` |
| Auth routes | `src/app/api/auth/{login,refresh,logout,me}/route.ts` |
| Config-UI audit (DB) | `src/app/config-ui/api/audit/route.ts` |
| Next config | `next.config.js` |
| Dockerfile | `Dockerfile` |
| OTel | `src/telemetry.ts` |
| E2E | `e2e/`, `playwright.config.ts` |
