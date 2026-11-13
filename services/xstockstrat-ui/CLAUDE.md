# xstockstrat-ui — CLAUDE.md

<!-- context-forge:constitution-pointer:start -->
> **Constitution:** non-obvious local invariants (protobuf-es `{seconds: bigint}` Timestamp, per-(service×segment) browser clients, `forward`/`forwardAdmin`+userId-injection IDOR guard, `/accounts` REST divergence) live in [`docs/context-constitution.md`](docs/context-constitution.md); defects in [`docs/context-constitution-findings.md`](docs/context-constitution-findings.md). Inherits the root [`PLAT-*` constitution](../../docs/context-constitution.md).
<!-- context-forge:constitution-pointer:end -->

## Role

Consolidated Next.js frontend serving all three UI segments under path prefixes:
`/trader` (order execution, positions, accounts), `/insights` (strategy analytics, backtesting,
formula authoring, backfills), and `/config-ui` (runtime config, signal sources, audit log). A fourth
segment, `/accounts`, hosts the OAuth authorized-apps UI (feature 051) and the MCP tool catalog page
(`/accounts/mcp-tools`).

It is the platform's **Backend-for-Frontend (BFF)**: backend services are gRPC-only, so the UI exposes
per-segment Connect-RPC routers that authenticate the request (JWT cookie), forward identity headers,
and proxy to the backend gRPC services. Browsers never talk to the backends directly — they call the
segment's BFF, which holds the typed gRPC clients.

## Styling

Tailwind v4 (CSS-first config — no `tailwind.config.js`; theme tokens live in `src/app/globals.css`'s
`@theme inline` block, which maps color/font/radius/animation names onto this app's own `:root`
color-role custom properties). PostCSS plugin: `@tailwindcss/postcss`. shadcn/ui manages
`src/components/ui/` primitives via `components.json` (preset `bLTl5gh6`, style `radix-rhea`;
dark-only, no light-mode toggle — theme values come entirely from the preset).

- **Per-environment theme bundles (feature 307).** The `:root` token values live in
  `src/styles/themes/staging.css` (the preset "Nocturne" values, frozen) and `production.css`.
  `next.config.js` aliases `@theme-tokens` to the file named by the `UI_THEME` build arg (default
  `staging`; anything else fails the build) and keys the webpack cache by theme; `layout.tsx` imports
  it after `globals.css`. `UI_THEME` is build-time only — never read `APPLICATION_ENV` for it.
  - `pnpm build` chains `src/styles/themes/checkThemeBundle.cjs` (theme-contract gate).
  - **The trap:** any hardcoded colour in emitted CSS — a Tailwind default-palette utility (including
    its opacity-modifier fallback), a `var()` of a palette variable, or an arbitrary value — within ±1
    sRGB / ±0.01 alpha of a theme-specific token of either theme fails every build. Use the theme token.
  - A Next 16 / Turbopack switch needs the alias re-declared as `turbopack.resolveAlias`.

- **Adding a primitive not yet in `src/components/ui/`**: `npx shadcn@latest add <name>`.
- **Re-applying/updating the preset**: `printf 'y\n' | npx shadcn@latest apply --preset bLTl5gh6 --yes`
  — `components.json` must already exist (it does) or this hangs on an unsuppressable prompt;
  `apply --preset` also needs a piped `y` on stdin even with `--yes` to clear a confirmation prompt.
  This **overwrites every listed primitive file wholesale**, including this app's functional
  variant additions below — always re-run the reconciliation step (next bullet) after.
  A `shadcn apply --preset` writes the preset `:root` back into `globals.css`; that fails the
  production build closed (check (a)), and a changed preset fails staging too. Move the values back
  into `src/styles/themes/staging.css` and delete the re-added block.
- **Functional variant customizations** (`buy`/`sell` on `Button`, `buy`/`sell`/`paper`/`live`/
  `warning`/`info` on `Badge` — order-side/paper-trading/status coloring, not part of the shadcn
  preset's own variant set) are hand-added back into each regenerated file's `cva()` `variants`
  object after any `add`/`apply --preset` run, marked with an `// app-specific` comment. A
  mechanical regression guard (`src/components/ui/button.test.ts`, `badge.test.ts`) asserts these
  keys render their expected classes — it fails loudly if a future regenerate silently drops them.
- **`sidebar.tsx` `data-active={isActive || undefined}`** (feature 126, `// app-specific`) — re-apply after any
  `apply --preset`, like the variants above.
- `combobox.tsx` is a full Base-UI (`@base-ui/react`) compound component (`Combobox`/
  `ComboboxInput`/`ComboboxContent`/`ComboboxList`/`ComboboxItem`/etc.) — see its 3 call sites
  (`components/trader/ChartPanel.tsx`, `components/insights/{ComponentEditor,RuleEditor}.tsx`)
  for the controlled-`value`/`onValueChange` (strict) and controlled-`inputValue`/
  `onInputValueChange` (free-text) usage patterns.
- **Charting on `lightweight-charts` v5.**
  The trader symbol page (`trader/positions/[symbol]/page.tsx`) and the trader dashboard
  (`ChartPanel.tsx`) both render on **`lightweight-charts` v5** (pinned exact in `package.json`) via
  the shared `useCandlestickChart.ts` hook — the hook's two real consumers. On the symbol page the
  OHLCV candlestick **and** every strategy indicator are drawn as native **multi-pane** series on ONE
  chart instance (pane 0 = price; panes 1..N = indicators), sharing one time scale and one native
  crosshair. `recharts`/`ui/chart.tsx` **remain** for their other consumers
  (`insights/EquityCurveChart.tsx`, `insights/FormulaRunResult.tsx`, `insights/page.tsx`) — do not
  remove them. `recharts` has no first-party OHLCV candlestick geometry, and
  `e2e/trader/chart-panel.spec.ts` (and the symbol-page e2e) depend on `lightweight-charts`'s own
  injected `.tv-lightweight-charts` DOM class as an async-readiness signal.
- **Sanctioned exception** — `/trader/positions/[symbol]` reuses `/insights`-segment browser clients
  (constitution UI-2 exception; re-verify its four facts before reusing as precedent).

## Docker Build Pattern

**Production:** Next.js pattern — see `docs/patterns/docker-build.md`. Multi-stage `node:24-alpine`
build (`base` → `deps` → `builder` → `runner`); production emits `output: 'standalone'`
(`next.config.js`) and the runner serves it on port 3000. `ARG UI_THEME=staging` selects the theme
at build time (`docker-build.yml` passes `staging`/`production` per caller) and the runner records it
as `LABEL io.xstockstrat.ui-theme`, which every deploy path checks against its target environment
(`scripts/ui-theme-label.sh`).

**E2E tests:** `Dockerfile.e2e` (repo root) — hermetic Playwright container with baked Chromium,
non-standalone Next.js build, and the in-process mock gRPC backend. Run locally via
`scripts/run-e2e.py`; CI uses the same image with `docker/build-push-action` + GHA layer cache.
See `docs/patterns/docker-build.md` § E2E Test Container.

## Opportunities-first shell (feature 083)

The physical routes/segments above are **unchanged**; feature 083 layers an opportunities-first
"Nocturne" presentation over them. Non-obvious pieces:

- **Nav grouping** — the shared shell (`PlatformHeader`) presents four primary groups
  **Decide / Discover / Engine / Book** (+ a pinned **Settings** group) over the four physical
  segments. The nav model is the single source of truth in `src/components/shared/navGroups.tsx`
  (`NAV_GROUPS`) — imported by both the desktop header and the mobile `BottomTabBar`. **Do not
  import `NAV_GROUPS` from `PlatformHeader`** (that forms a `PlatformHeader ↔ BottomTabBar` import
  cycle → a prerender TDZ crash); import from `navGroups.tsx`.
- **Decide screens** — `insights/opportunities` (ranked queue over analysis `ListOpportunities`)
  and the Signal-detail page `trader/positions/[symbol]` (the unified symbol page).
  - Readiness (`SignalReadiness` → `EvaluateReadiness` for an explicit strategy, watchlist-gated,
    never a fabricated signal→strategy binding) sits beside an FR-6 order ticket (`OrderForm`, under
    the `/trader` segment's `AccountProvider`).
  - The header enriches from the symbol's own opportunity rows: action tag and Conviction from the
    matching `Opportunity`, and Edge (BT) from `GetStrategyAnalytics`. The rows are fetched with
    `useOpportunities(…, symbol)` → `ListOpportunitiesRequest.symbol` (feature 215), so they do not
    depend on queue rank (the queue's page 1 holds ≤50 rows). The `symbol = ''` default keeps the
    queue/CopilotRail shared page-1 cache key.
  - The header degrades to symbol + price only when the symbol has no opportunity row (e.g. opened
    from Screener). It is never fabricated.
  - Fundamentals-skip (feature 215) and formula-unreadable (289) rows: badge/test-id detail in this
    service's `docs/` folder (**`opportunities-shell.md`**). `readinessState`/`SignalItem` require `formulaUnreadable`, so `tsc` flags every call site.
- **Single-position detail** — the row-click `Sheet` on Book → Exposure (`trader/positions`) is
  risk-framed to mirror the Exposure table: a StatTile row (Open R / Risk at stop / Stop distance /
  Weight), a "Position risk" block (factor / exit rule / flag), then the read-only broker-reported
  values (C-10(b)) and the fill lineage.
- **Enum render maps** — exhaustive `Record<Enum, …>` maps + `EnumBadge` in `src/lib/opportunityShared.tsx`; a new proto
  enum value without an entry fails `tsc`.
- **Copilot rail (beta)** — `copilot/CopilotRail.tsx`, default off (`ChromeContext.showCopilot`); no-LLM reads in
  `lib/copilot.ts`; note thread on ledger, stream key forced by `traderBff` (UI-3).
- **Mobile companion** — one shared `src/components/mobile/SectionRenderer.tsx` (section kinds
  `head/stat/signal/signalGroup/chart/row/form/note/action`, ≥44px tap targets) drawn behind
  `sm:hidden` beside the desktop layout, plus a fixed `BottomTabBar` (mobile-only) mounted globally in
  `PlatformHeader`. Content wrappers add `pb-20 sm:pb-0` clearance. The flat `signal` kind and the
  per-symbol `signalGroup` card (feature 155, FR-4 — mirrors the desktop `SymbolGroupCard`) both
  render through one shared `SignalRow`, which carries the strategy id / source chips / expiry tags.
- **Mobile offcanvas nav (feature 124)** — `ui/sidebar.tsx` `collapsible="offcanvas"`; wrap the whole subtree in `sm:hidden`,
  `SidebarProvider defaultOpen={false}` + `className="w-auto min-h-0"`; pages render their own `PageBreadcrumb`.

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
| xstockstrat-notify | 50059 | Trader — alert stream; `/accounts/notifications` inbox read state (`AlertInbox`, feature 203) |
| xstockstrat-ledger | 50057 | Insights — ledger reads |
| xstockstrat-config | 50060 | Config-UI — config read/write |
| TimescaleDB | — | Config-UI audit route only (see Database) |

## Auth + BFF

Implements the platform frontend-auth pattern — full details in `docs/patterns/frontend-auth.md`; header
propagation in `docs/patterns/header-propagation.md`.

| File | Runtime | Purpose |
|---|---|---|
| `src/lib/auth.ts` | Node | JWT verify (`jose`, `JWT_SECRET`), cookie helpers, scope bitmap, trace IDs; keep it light (widely imported). |
| `src/lib/identity.ts` | Node | `refreshSession` / `revokeToken` wrapping the identity gRPC client — imported by the Node.js-runtime `middleware.ts` (feature 128) as well as the auth route handlers |
| `src/lib/connectClients.ts` | Node | Typed gRPC clients (`createGrpcTransport`) from `*_ENDPOINT` env vars |
| `src/lib/bffShared.ts` | Node | **Canonical** BFF plumbing shared by all three segment routers: `requireSession`, `backendHeaders`, `requireAdminScope`, `createBffRouter`, `createDispatch`. Do not re-implement these per segment (DRY guard rail). |
| `src/lib/{traderBff,insightsBff,configUiBff}.ts` | Node | Per-segment routers — register `router.service(...)` then `export const dispatchConnect = createDispatch(router, '<prefix>')`; all session/header/dispatch logic comes from `bffShared.ts`. |
| `src/lib/headers.ts` | shared | **Canonical** propagation header names (`HEADER_USER_ID` / `HEADER_ACCESS_SCOPE` / `HEADER_TRACE_ID`). The DRY guard rail bans the raw `x-*` literals elsewhere. |
| `src/lib/basepath.ts` | shared | **Canonical** segment base paths (`BASE_PATH_TRADER` / `_INSIGHTS` / `_CONFIG_UI`) for cross-segment links/fetches. `/accounts` has no constant — its hrefs are literals in `navGroups.tsx` / `PlatformHeader.tsx`. |
| `src/hooks/useInvalidatingMutation.ts` | Browser | **Canonical** factory for "call a BFF RPC then invalidate query keys" mutation hooks (order + watchlist hooks build on it). |
| `src/middleware.ts` | **Node.js runtime** (feature 128) | Route protection, in-process token refresh, trace-ID injection; matcher must include `/`. |
| `src/app/auth/layout.tsx` | Server | `export const dynamic = 'force-dynamic'` — forces every `/auth/*` page uncacheable (`Cache-Control: no-store`). **Do not remove** (rationale in the file). |
| `src/app/auth/{login,oauth-login}/page.tsx` | Browser / Server | Unified login (domain root, outside all basePaths) + OAuth agent login. Kept non-static by the segment layout above. `oauth-login` is a server page: it follows only the server-resolved `${AGENT_PUBLIC_URL}/oauth/callback` (exact `agent_cb` match, `src/lib/oauthCallback.ts`), never the client-supplied URL. |
| `src/app/api/auth/{login,refresh,logout,me}/route.ts` | Node | Auth endpoints (set/clear cookies, current session) |
| `src/app/<segment>/api/[...connect]/route.ts` | Node | Segment BFF entrypoint — re-exports `dispatchConnect` |

## Browser typed clients

`src/lib/browserClients/*.ts` — connect-web clients, one per service, each bound to its segment's
`baseUrl` (e.g. `tradingClient` → `/trader/api`, `insightsMarketDataClient` → `/insights/api`). A browser
component imports only the client for its segment; the call marshals to
`POST /<segment>/api/<Service>/<Method>` and reaches that segment's BFF.

**Transport factory (feature 153).** Build every client on `makeBrowserTransport(baseUrl)`
(`src/lib/browserClients/transport.ts`), never bare `createConnectTransport` — it carries the
refresh-then-redirect guard. The refresh/redirect core (deduped
single-in-flight refresh, loop-guarded redirect, plus an `apiFetch` wrapper used by the `/accounts`
REST pages) lives in `src/lib/authRedirect.ts` — **browser-only, never imported from
`middleware.ts`/`auth.ts`** (Edge bundle). Add new clients via `makeBrowserTransport`, not
`createConnectTransport`, so no data-call path is left unguarded.

## Database

Only the **config-ui audit route** touches the DB: `src/app/config-ui/api/audit/route.ts` reads
`config.config_audit` via a `pg.Pool` whose `max` defaults to **1** (`DB_POOL_MAX`). This 1 connection is
part of the platform's ~22-connection budget (root CLAUDE.md § Connection Pool Budget) — do not raise it
without re-checking that table. All other segments are stateless.

## Config Keys Consumed

Namespace: `ui` (plus `platform` for the positions banner). Read **one-shot** via `GetConfig(namespace: 'ui')` in `insightsBff.ts` — the UI is a
stateless BFF with **no `WatchConfig` subscription** (it cannot hold a server stream). Values are read
with an oneof-presence check (never `value || default`), so a stored `0` / empty string survives.

| Key | Type | Default | Description |
|---|---|---|---|
| `performance.risk_free_rate_annual` | float | `0.045` | Annualized risk-free rate for the `/insights/performance` dashboard rolling-30d Sharpe (feature 031, FR-3). A stored `0` is legitimate. Seed migration `023_ui_performance_keys`. |
| `performance.equity_curve_start_date` | string | `""` (auto = earliest closed-position date) | ISO date the cumulative-P&L equity curve starts from (feature 031, FR-1). Empty ⇒ the UI defaults to the earliest closed-position date. Seed migration `023_ui_performance_keys`. |
| `trading_state` (namespace `platform`) | string | *(none; owned by trading)* | Read one-shot by `/trader/positions` via `GetConfig(namespace: 'platform')` (`traderConfigClient`, polled every 30 s) to show the REDUCE_ONLY/HALTED banner; the UI never writes it. |

## Environment Variables

> mTLS (feature 210): `MTLS_CERT`/`MTLS_KEY`/`MTLS_CA_CERT` per root. The UI fails closed **lazily** — the first RPC throws if any is absent (`connectClients.ts`), so `next build` works without them.

```text
JWT_SECRET                  # required — src/lib/auth.ts jose verification
*_ENDPOINT                  # the 10 backends — see docker-compose.yml
AGENT_PUBLIC_URL            # runtime (never NEXT_PUBLIC_*): /accounts connector URL + the /auth/oauth-login callback check; unset ⇒ every OAuth agent login is rejected
VAPID_PUBLIC_KEY            # feature 165 — Web Push public key, exposed to the browser via VapidKeyContext (server→client prop, NOT NEXT_PUBLIC_*); empty ⇒ push enable control reports "not configured"
DATABASE_URL                # config-ui audit route only
DATABASE_CA_CERT            # feature 266 — config-ui audit route only; DB CA PEM, required unless DATABASE_URL has exactly sslmode=disable. Missing on a TLS URL (or any ssl*/uselibpqcompat URL param) ⇒ the route logs the error and returns a generic 500
DB_POOL_MAX=1               # config-ui audit pool cap
HOST_PROVIDER               # resource attribute host.provider (digitalocean|homelab; else unknown)
OTEL_EXPORTER_OTLP_ENDPOINT
```

## Frontend gotchas

See `docs/patterns/nextjs-frontends.md` and `docs/patterns/client-api-pattern.md` for the full pattern.

- **BFF handler-map basePath**: handlers are keyed on the full pathname *including* the segment prefix
  (e.g. `/trader/api/...`); the router `PREFIX` must match the segment or every RPC 404s.

## PWA & Push Notifications (feature 165)

PWA/Web Push (feature 165) — see this service's `docs/` folder (**`pwa-push.md`**); `VAPID_PUBLIC_KEY` crosses via `VapidKeyContext`, never `NEXT_PUBLIC_*`.

## Observability

OTel via `src/telemetry.ts`, loaded by the Next.js hook `src/instrumentation.ts` — it must stay in `src/` (a `src/` project ignores a root-level hook) with its `NEXT_RUNTIME === 'nodejs'` guard. Gated by `OTEL_ENABLED`; init failures are warnings only. The UI exports traces, metrics and logs (all OTLP/HTTP, env-only exporters): `src/lib/bffMetrics.ts` records `http.server.duration` for unary Connect BFF calls and the wrapped REST routes (server streams excluded), and `src/lib/serverLog.ts` writes the usual console line and also emits an OTel log record. `createDispatch` opens one SERVER span per Connect call and `backendHeaders` injects its W3C `traceparent` into the outbound gRPC headers; the span carries the edge `x-trace-id` as an attribute, and any dispatch ending ≥ 500 writes one WARN `bff upstream error` inside the span's context (`rpc_service`, `rpc_method`, `status`, `duration_ms`, `trace_id` = edge `x-trace-id`, `otel_trace_id` when OTel is on), so Loki lines join Tempo traces. `telemetry.ts`'s own console lines stay stdout-only (recursion guard). See
`docs/patterns/observability.md`.

**Feature 294-signal-map-instrumentation** (no `loop tick ok`: the UI has no tick loops): UI metrics `ui.auth.events` and `ui.bff.requests`; label sets pinned in `src/lib/__tests__/bffAllowlist.test.ts`.

## Testing

**Unit (vitest, feature 065).** A node-environment **logic** unit layer lives beside the code as
`src/**/*.test.ts` (`vitest.config.ts`). Run `pnpm run test:unit` (or `test:unit:watch`) and
`pnpm run test:coverage` (lcov + text; the `node-test` CI job runs this and uploads
`coverage/lcov.info`). Coverage is scoped to `src/lib/**` with `coverage.all: false`, so the **40%**
threshold applies only to files a unit test actually exercises (e.g. `src/lib/scoreDisplay.ts`) and
grows as more unit tests are added — a whole-`src/lib` floor over the e2e-only codebase would be
unearnable.

**E2E (Playwright).** In `e2e/`, organized by segment (`e2e/{trader,insights,config-ui,accounts}/`,
`e2e/auth.spec.ts`) against a mock gRPC backend (`e2e/mock-backend.ts`, `e2e/global-setup.ts`,
`e2e/helpers/`). Run `pnpm test:e2e` (or `pnpm test:e2e:ui`) locally, or `python3 scripts/run-e2e.py`
for a hermetic Docker-based run (no local Node/Playwright/Chromium needed — see `Dockerfile.e2e`).

E2E harness internals — SSR pre-warming (`e2e/warmup.setup.ts` `ROUTES`), the serial-`describe` page-reuse optimization, and Playwright browser resolution (`launchOptions.executablePath`, Firefox drop, exact-version pin) — live on-demand in this service's `docs/` folder (**`e2e-testing.md`**).

## Running Locally

E2E needs no real services: `python3 ../../scripts/run-e2e.py`.

## Key File Paths Reference

| Area | Path |
|---|---|
| Config-UI audit (DB) | `src/app/config-ui/api/audit/route.ts` |
| Next config | `next.config.js` |
| Dockerfile | `Dockerfile` |
| OTel | `src/instrumentation.ts` (hook), `src/telemetry.ts`, `src/lib/bffMetrics.ts`, `src/lib/serverLog.ts` |
| E2E | `e2e/`, `playwright.config.ts` |
| Mobile companion (083) | `src/components/mobile/{SectionRenderer,BottomTabBar}.tsx`, `sections.ts` |
| Mobile offcanvas nav (124) | `src/components/ui/sidebar.tsx`, `src/hooks/use-mobile.ts` |
| Page breadcrumb (124) | `src/components/shared/PageBreadcrumb.tsx` |
| Shared eyebrow label (124) | `src/components/shared/Eyebrow.tsx` |
