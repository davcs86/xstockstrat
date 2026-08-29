# xstockstrat-ui — CLAUDE.md

<!-- context-forge:constitution-pointer:start -->
> **Constitution:** non-obvious local invariants (protobuf-es `{seconds: bigint}` Timestamp, per-(service×segment) browser clients, `forward`/`forwardAdmin`+userId-injection IDOR guard, `/accounts` REST divergence) live in [`docs/context-constitution.md`](docs/context-constitution.md); defects (⚠ audit-route admin gap, missing `BASE_PATH_ACCOUNTS`) in [`docs/context-constitution-findings.md`](docs/context-constitution-findings.md). Inherits the root [`PLAT-*` constitution](../../docs/context-constitution.md).
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

Consolidated from three separate frontends by feature 045 (`ui-consolidation-nextjs`); the nginx reverse
proxy was removed in the same feature.

## Language

Node.js 24, Next.js 15 (App Router, React 18), TypeScript. Package manager: pnpm 9.15.9.

## Styling

Tailwind v4 (CSS-first config — no `tailwind.config.js`; theme tokens live in `src/app/globals.css`'s
`@theme inline` block, which maps color/font/radius/animation names onto this app's own `:root`
color-role custom properties). PostCSS plugin: `@tailwindcss/postcss`. shadcn/ui manages
`src/components/ui/` primitives via `components.json` (feature 119 — migrated from a hand-rolled
Tailwind v3 + individual-`@radix-ui/*`-packages setup to the official shadcn CLI, adopting preset
`bLTl5gh6` (style `radix-rhea`); dark-only, no light-mode toggle, no preserved legacy branding —
theme values come entirely from the preset).

- **Adding a primitive not yet in `src/components/ui/`**: `npx shadcn@latest add <name>`.
- **Re-applying/updating the preset**: `printf 'y\n' | npx shadcn@latest apply --preset bLTl5gh6 --yes`
  — `components.json` must already exist (it does) or this hangs on an unsuppressable prompt;
  `apply --preset` also needs a piped `y` on stdin even with `--yes` to clear a confirmation prompt.
  This **overwrites every listed primitive file wholesale**, including this app's functional
  variant additions below — always re-run the reconciliation step (next bullet) after.
- **Functional variant customizations** (`buy`/`sell` on `Button`, `buy`/`sell`/`paper`/`live`/
  `warning`/`info` on `Badge` — order-side/paper-trading/status coloring, not part of the shadcn
  preset's own variant set) are hand-added back into each regenerated file's `cva()` `variants`
  object after any `add`/`apply --preset` run, marked with an `// app-specific` comment. A
  mechanical regression guard (`src/components/ui/button.test.ts`, `badge.test.ts`) asserts these
  keys render their expected classes — it fails loudly if a future regenerate silently drops them.
- **`sidebar.tsx`'s `data-active` fix** (feature 126): `SidebarMenuButton`/`SidebarMenuSubButton`
  set `data-active={isActive || undefined}`, not the bare `isActive` boolean — marked
  `// app-specific`. The vendored file's own `data-active:bg-sidebar-accent` Tailwind variant is a
  bare (unbracketed) data-attribute selector, which matches on attribute **presence**, not its
  string value — `data-active="false"` still satisfies `[data-active]`. Passing the raw boolean
  renders the attribute unconditionally (React stringifies `false` to `"false"` for custom `data-*`
  attributes, it does not omit it), so every row was permanently painted with the accent
  background regardless of actual active state. `isActive || undefined` omits the attribute
  entirely when inactive, restoring the intended distinction. Re-apply after any future
  `apply --preset` regeneration, same as the functional-variant bullet above.
- `combobox.tsx` is a full Base-UI (`@base-ui/react`) compound component (`Combobox`/
  `ComboboxInput`/`ComboboxContent`/`ComboboxList`/`ComboboxItem`/etc.), not the simple
  single-prop wrapper this app used before feature 119 — see its 3 call sites
  (`components/trader/ChartPanel.tsx`, `components/insights/{ComponentEditor,RuleEditor}.tsx`)
  for the controlled-`value`/`onValueChange` (strict) and controlled-`inputValue`/
  `onInputValueChange` (free-text) usage patterns.
- `vitest.config.ts` sets `resolve.alias: { '@': './src' }` — required because Vite/Vitest does
  not read `tsconfig.json`'s `paths` automatically the way Next's own bundler does, and the
  shadcn-CLI-regenerated `components/ui/*` files use `@/...` alias imports (the old hand-rolled
  files used relative imports, which never needed this).
- **Charting on `lightweight-charts` v5 (feature 146 superseded the old `recharts`-panels split).**
  The trader symbol page (`trader/positions/[symbol]/page.tsx`) and the trader dashboard
  (`ChartPanel.tsx`) both render on **`lightweight-charts` v5** (pinned exact in `package.json`) via
  the shared `useCandlestickChart.ts` hook — the hook's two real consumers. On the symbol page the
  OHLCV candlestick **and** every strategy indicator are drawn as native **multi-pane** series on ONE
  chart instance (pane 0 = price; panes 1..N = indicators), sharing one time scale and one native
  crosshair; `recharts` was dropped from that page by feature 146 (it originally sat on
  `recharts`/`ui/chart.tsx`). `recharts`/`ui/chart.tsx` **remain** for their other consumers
  (`insights/EquityCurveChart.tsx`, `insights/FormulaRunResult.tsx`, `insights/page.tsx`) — do not
  remove them. `recharts` has no first-party OHLCV candlestick geometry, and
  `e2e/trader/chart-panel.spec.ts` (and the symbol-page e2e) depend on `lightweight-charts`'s own
  injected `.tv-lightweight-charts` DOM class as an async-readiness signal. Do not re-flag the
  symbol-page charting as unconsolidated in a future audit. (Correcting prior doc-drift:
  `insights/market/[symbol]/page.tsx` renders **no** chart — it was never a hook consumer.)
- **Sanctioned exception — the unified `/trader/positions/[symbol]` page reuses `/insights`-segment
  browser clients.** `analysisClient`, `insightsIngestClient`, and `insightsPortfolioClient` (all
  `baseUrl: '/insights/api'`) are called directly from this `/trader`-segment page rather than
  re-registered in `traderBff.ts` (feature 125 design decision, 2026-08-10): the base URLs are
  root-relative so the browser `fetch()` stays same-origin regardless of which segment rendered the
  page; no segment-specific ingress routing exists — `.do/app.yaml`'s single `/` catch-all routes
  both `/trader/api` and `/insights/api` to the same DO component; the session cookie is
  `path: '/'`, not segment-scoped; and `bffShared.ts`'s `requireSession` re-checks the session on
  every dispatch independent of which BFF router handled it. This trades `/trader`'s BFF
  self-containment for avoiding duplicate one-line `forward()` registrations — do not re-flag this
  as an architecture violation in a future audit; do not treat it as precedent for arbitrary
  cross-segment reuse without re-verifying these four facts still hold.

## Docker Build Pattern

Next.js pattern — see `docs/patterns/docker-build.md`. Multi-stage `node:24-alpine` build
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
| `/accounts` | `/accounts` | OAuth authorized-apps (feature 051), MCP tool catalog | `src/app/accounts/...` |

`next.config.js` redirects `/` → `/trader` (`permanent: false`).

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
  and the Signal-detail page `insights/market/[symbol]`. Signal-detail is a two-column grammar:
  **left** = "Why this fired" (`EvaluateReadiness` for an explicit strategy — via a strategy picker,
  never a fabricated signal→strategy binding); **right** = an FR-6 order
  ticket re-presenting `OrderForm` inside its own `AccountProvider`. The header enriches from the
  ranked queue when the symbol is in it (action tag + Conviction from the matching `Opportunity`,
  Edge (BT) from `GetStrategyAnalytics`); it degrades to symbol + price only when the symbol is not
  a live opportunity (e.g. opened from Screener) — never fabricated.
- **Single-position detail** — the row-click `Sheet` on Book → Exposure (`trader/positions`) is
  risk-framed to mirror the Exposure table: a StatTile row (Open R / Risk at stop / Stop distance /
  Weight), a "Position risk" block (factor / exit rule / flag), then the read-only broker-reported
  values (C-10(b)) and the fill lineage.
- **Enum render maps** — `src/lib/opportunityShared.tsx` holds the exhaustive
  `Record<Enum, EnumRender>` maps (`OPPORTUNITY_ACTION`, `CONDITION_STATE`, `POSITION_RISK_FLAG`,
  `SOURCE_HEALTH`) + `EnumBadge`. Adding a proto enum value without a map entry fails `tsc` here.
- **Copilot rail (beta)** — `src/components/copilot/CopilotRail.tsx`, a 310px global rail mounted in
  `PlatformHeader`, default off via `src/context/ChromeContext.tsx` (`showCopilot`). Two no-LLM
  templated reads (pure helpers in `src/lib/copilot.ts`) + an **append-only** note thread persisted
  in the ledger. The thread routes live on `traderBff`'s `LedgerService` (`appendEvent` +
  copilot-aware `queryEvents`): the BFF forces `stream_key=copilot:<user>:default` +
  `event_type=copilot.message` server-side from the verified session, so the browser never learns
  the user id and can only touch its own thread. No agent DB, no LLM, no new pool (F-06).
- **Mobile companion** — one shared `src/components/mobile/SectionRenderer.tsx` (section kinds
  `head/stat/signal/signalGroup/chart/row/form/note/action`, ≥44px tap targets) drawn behind
  `sm:hidden` beside the desktop layout, plus a fixed `BottomTabBar` (mobile-only) mounted globally in
  `PlatformHeader`. Content wrappers add `pb-20 sm:pb-0` clearance. The flat `signal` kind and the
  per-symbol `signalGroup` card (feature 155, FR-4 — mirrors the desktop `SymbolGroupCard`) both
  render through one shared `SignalRow`, which carries the strategy id / source chips / expiry tags.
- **Non-happy states** — shared `src/components/ui/skeleton.tsx` (`Skeleton`) +
  `src/components/shared/EmptyState.tsx`; per-card errors reuse the existing `CardNotice` /
  `QueryStateMessages` (DRY).
- **Mobile offcanvas nav (feature 124)** — `PlatformHeader`'s Row 1 hamburger menu is a real
  vendored `ui/sidebar.tsx` (`Sidebar collapsible="offcanvas"`), not `Sheet`+`Accordion`. The whole
  `SidebarProvider`/trigger/panel subtree is wrapped in `sm:hidden` (not just the trigger) —
  `Sidebar`'s desktop/non-mobile branch renders off-screen via a negative `left` offset, not
  `display:none`, so without the wrapper its full nav content stays in the DOM and accessibility
  tree at `sm:`+ widths, duplicating Row 2's real `Section` nav links. `SidebarProvider` also needs
  `defaultOpen={false}` (a mobile-only offcanvas menu must start collapsed on desktop) and a
  `className="w-auto min-h-0"` override (the primitive's own wrapper defaults to
  `flex min-h-svh w-full`, sized for a page-level root, not an inline Row 1 subtree).
  `PlatformHeader`'s own Row 2 shared `Breadcrumb` landmark was removed — pages render their own via
  `src/components/shared/PageBreadcrumb.tsx` (`{ariaLabel, items: {label, href?}[]}`) instead.
  Each `NAV_GROUPS` entry renders as `SidebarGroup > SidebarGroupContent > SidebarMenu >
  SidebarMenuItem > Collapsible(className="group/collapsible") > CollapsibleTrigger(SidebarMenuButton)
  and CollapsibleContent(SidebarMenuSub > SidebarMenuSubItem)` (feature 126) — matching shadcn's own
  reference "Collapsible SidebarMenu" composition exactly, not a flattened shortcut. The chevron's
  rotation keys off `group-data-[state=open]/collapsible:rotate-90`, scoped to the `Collapsible`
  root's own `data-state` (Radix reflects it there directly), not `SidebarMenuButton`'s pre-existing
  `group/menu-button` name. Row styling is deliberately flat/typographic (font-weight + color for
  the active group, no persistent background fill) to match shadcn's own docs-site sidebar rather
  than a filled-pill-button look — see the `data-active` fix above, which was the actual root cause
  of the pill look, not a styling choice.

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
| `src/app/auth/layout.tsx` | Server | `export const dynamic = 'force-dynamic'` — forces every `/auth/*` page uncacheable (`Cache-Control: no-store`). **Do not remove.** Statically prerendered auth pages get `s-maxage=31536000`, and the prod edge (Cloudflare) ignores `Vary: RSC`, so it cross-serves the `text/x-component` RSC/Flight prefetch payload to document navigations — the browser then renders raw Flight text (incl. Next's built-in "404: This page could not be found." string), surfacing as the login route "not found". |
| `src/app/auth/{login,oauth-login}/page.tsx` | Browser | Unified login (domain root, outside all basePaths) + OAuth agent login. Kept non-static by the segment layout above. |
| `src/app/api/auth/{login,refresh,logout,me}/route.ts` | Node | Auth endpoints (set/clear cookies, current session) |
| `src/app/<segment>/api/[...connect]/route.ts` | Node | Segment BFF entrypoint — re-exports `dispatchConnect` |

## Browser typed clients

`src/lib/browserClients/*.ts` — connect-web clients, one per service, each bound to its segment's
`baseUrl` (e.g. `tradingClient` → `/trader/api`, `insightsMarketDataClient` → `/insights/api`). A browser
component imports only the client for its segment; the call marshals to
`POST /<segment>/api/<Service>/<Method>` and reaches that segment's BFF.

**Transport factory (feature 153).** Every client is built on `makeBrowserTransport(baseUrl)`
(`src/lib/browserClients/transport.ts`), **not** a bare `createConnectTransport` — the factory carries
a shared interceptor that on a gRPC `Unauthenticated` (session expired/invalid) runs "refresh-first,
then redirect to login": it attempts `POST /api/auth/refresh` once, retries the call on success, and
otherwise sends the browser to `/auth/login?redirect=<path>`. The refresh/redirect core (deduped
single-in-flight refresh, loop-guarded redirect, plus an `apiFetch` wrapper used by the `/accounts`
REST pages) lives in `src/lib/authRedirect.ts` — **browser-only, never imported from
`middleware.ts`/`auth.ts`** (Edge bundle). Add new clients via `makeBrowserTransport`, not
`createConnectTransport`, so no data-call path is left unguarded.

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
VAPID_PUBLIC_KEY            # feature 163 — Web Push public key, exposed to the browser via VapidKeyContext (server→client prop, NOT NEXT_PUBLIC_*); empty ⇒ push enable control reports "not configured"
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

## PWA & Push Notifications (feature 163)

The UI is an installable PWA that can receive OS-level Web Push notifications even when closed.

- **Served from `public/` at the domain root** (no `basePath`): `manifest.webmanifest` (`display:
  standalone`, `start_url: /trader`, 192/512 + maskable icons), the three `icon-*.png`, and a
  hand-written `sw.js` (no `next-pwa`). **`public/` is NOT auto-included by `output: standalone`** — the
  `Dockerfile` has an explicit `COPY … public …` step; don't drop it.
- **`sw.js`** handles `push` (always `showNotification` — the `userVisibleOnly` obligation — with a
  fallback on parse failure, and a deterministic `tag` for OS coalescing) and `notificationclick`
  (focus an existing window or open one). Its two decisions (parse-with-fallback, focus-vs-open) are
  the pure, unit-tested helpers in `src/lib/swHelpers.ts`, mirrored (inlined) into `sw.js` because a
  service worker can't import from the Next bundle.
- **`middleware.ts` matcher excludes** `sw.js` / `manifest.webmanifest` / the `icon-*.png` so they're
  served publicly (else the SW never registers). **`next.config.js headers()`** sends
  `Cache-Control: no-cache` for `sw.js` + `manifest.webmanifest` so an updated worker reaches clients.
- **`ServiceWorkerRegistrar`** (mounted in the root layout) registers `/sw.js` at root scope, covering
  all four segments.
- **Enable/disable control** at `/accounts/notifications` (Settings group — registered in **both**
  `PLATFORM_SUBNAV.accounts` and `NAV_GROUPS`). `PushToggle` requests permission, subscribes via the
  Push API with the VAPID **public** key, and calls `notifyClient.registerPushSubscription` /
  `unregisterPushSubscription`. Its four states (unsupported/blocked/enabled/default) route through
  `EmptyState`/`CardNotice`/`Switch` (C-17).
- **BFF**: `traderBff` `registerPushSubscription` **injects the session `user_id`** (IDOR guard — never
  `forward`); `unregisterPushSubscription` deletes by endpoint only. The `/accounts` page reuses the
  root-relative `notifyClient` (`/trader/api`) per the "Sanctioned exception" (four facts re-verified).
- **`VAPID_PUBLIC_KEY`** crosses server→client via `src/app/accounts/VapidKeyContext.tsx` (mirrors
  `AgentUrlContext`; the `/accounts` layout is already `force-dynamic`) — never `NEXT_PUBLIC_*`. The
  private key is notify-only.
- **iOS** requires adding the app to the Home Screen before Web Push works (standard behavior; not
  separately engineered).

## Observability

OTel via `src/telemetry.ts`, gated by `OTEL_ENABLED`; init failures are warnings only. See
`docs/patterns/observability.md`.

## Testing

**Unit (vitest, feature 065).** A node-environment **logic** unit layer lives beside the code as
`src/**/*.test.ts` (`vitest.config.ts`). Run `pnpm run test:unit` (or `test:unit:watch`) and
`pnpm run test:coverage` (lcov + text; the `node-test` CI job runs this and uploads
`coverage/lcov.info`). Coverage is scoped to `src/lib/**` with `coverage.all: false`, so the **40%**
threshold applies only to files a unit test actually exercises (e.g. `src/lib/scoreDisplay.ts`) and
grows as more unit tests are added — a whole-`src/lib` floor over the e2e-only codebase would be
unearnable. **Component/jsdom testing is intentionally out of scope** for this seed; UI behavior is
covered by the Playwright e2e suite below.

**E2E (Playwright).** In `e2e/`, organized by segment (`e2e/{trader,insights,config-ui,accounts}/`,
`e2e/auth.spec.ts`) against a mock gRPC backend (`e2e/mock-backend.ts`, `e2e/global-setup.ts`,
`e2e/helpers/`). Run `pnpm test:e2e` (or `pnpm test:e2e:ui`).

**CI runs chromium only** — Firefox is excluded in CI (the suite tests BFF RPC call chains and
React UI logic, not browser-specific rendering). CI is sharded across 2 parallel runners with a
shared pre-built Next.js bundle (`E2E_PREBUILT`). Locally, Firefox is included when available.

E2E harness internals — SSR pre-warming (`e2e/warmup.setup.ts` `ROUTES`), the serial-`describe` page-reuse optimization, and Playwright browser resolution (`launchOptions.executablePath`, Firefox drop, exact-version pin) — live on-demand in this service's `docs/` folder (**`e2e-testing.md`**).

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
| Shell nav model (083) | `src/components/shared/navGroups.tsx`, `src/components/shared/PlatformHeader.tsx` |
| Enum render maps (083) | `src/lib/opportunityShared.tsx` |
| Copilot rail (083) | `src/components/copilot/CopilotRail.tsx`, `src/context/ChromeContext.tsx`, `src/lib/copilot.ts` |
| Mobile companion (083) | `src/components/mobile/{SectionRenderer,BottomTabBar}.tsx`, `sections.ts` |
| State primitives (083) | `src/components/ui/skeleton.tsx`, `src/components/shared/EmptyState.tsx` |
| Mobile offcanvas nav (124) | `src/components/ui/sidebar.tsx`, `src/hooks/use-mobile.ts` |
| Page breadcrumb (124) | `src/components/shared/PageBreadcrumb.tsx` |
| Shared eyebrow label (124) | `src/components/shared/Eyebrow.tsx` |
