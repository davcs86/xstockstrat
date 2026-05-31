# Next.js Frontend Patterns

General-purpose Next.js conventions for `trader`, `insights`, `config-ui`, and future frontends. For auth specifically (middleware, route handlers, Connect-RPC client), read `docs/patterns/frontend-auth.md`. This file covers everything else.

Each section pairs a rule with a real bug that motivated it (PR link), so future sessions can verify the rule still holds.

---

## 1. basePath: `<Link>` is basePath-aware, raw `<a>` is not

Every frontend sets `basePath` in `next.config.js` (e.g. `/trader`, `/insights`, `/config-ui`). Next.js auto-prefixes the basePath onto **`<Link>` hrefs** and onto `redirect()` from `next/navigation` — but **NOT onto raw `<a href>` tags**.

| Use case | Tag | Example |
|---|---|---|
| In-app navigation (stay in the same frontend) | `<Link>` | `<Link href="/strategies">` → `/insights/strategies` |
| Cross-app navigation (escape the basePath, re-enter via nginx) | plain `<a>` | `<a href="/trader">` stays `/trader` |

**Bug avoided** ([PR #399](https://github.com/davcs86/xstockstrat/pull/399)): the config-ui ENV/MODE switcher used `<a href="/?env=production&mode=paper">`. Without basePath prefixing, this navigated to the site root (`https://host/?...`) instead of `/config-ui/?...`. Switched the four anchors to `<Link>`. The four cross-app nav links in each AppShell stay as `<a>` because we **want** them to escape the basePath.

```tsx
// In-app — Link, basePath added automatically
<Link href="/strategies">Strategies</Link>            // /insights/strategies

// Cross-app — plain a, basePath NOT added
<a href="/trader">Trader</a>                          // /trader (proxied by nginx)
<a href="/insights">Insights</a>                      // /insights
<a href="/config-ui">Config</a>                       // /config-ui
```

### Client-side `fetch()` is NOT basePath-aware

Unlike `<Link>` and `redirect()`, a raw `fetch('/api/auth/login')` in a browser component is resolved from the document root — Next.js does **not** prepend the basePath automatically.

```ts
// ✗ Wrong — browser sends POST /api/auth/login → nginx has no route → 404 HTML
const res = await fetch('/api/auth/login', { method: 'POST', body });

// ✓ Correct — browser sends POST /trader/api/auth/login → nginx → Next.js route
const res = await fetch('/trader/api/auth/login', { method: 'POST', body });
```

**Bug fixed** ([PR #417](https://github.com/davcs86/xstockstrat-orchestration/pull/417)): all three login pages used `fetch('/api/auth/login')`. Nginx returned a 404 HTML page; JSON parsing that HTML body failed, and the catch block showed "Login failed. Please check your credentials." regardless of whether the credentials were correct. Fixed by using the full basePath-prefixed path in all three `login/page.tsx` files.

The same rule applies to any client-side `fetch` that targets an API route in the **same** frontend (e.g. `/trader/api/orders`, `/insights/api/analysis`). Middleware `fetch` calls (which run server-side) are unaffected — use `new URL(\`\${req.nextUrl.basePath}/api/auth/refresh\`, req.url)` there.

---

### Never hardcode `http://localhost:300X`

The first version of every AppShell shipped with `href="http://localhost:3000"` etc. ([PR #398](https://github.com/davcs86/xstockstrat/pull/398)). These 404 on every deployed environment. Always use platform-relative paths (`/trader`, `/insights`, `/config-ui`) — nginx routes them correctly in every environment, including local docker-compose.

---

## 2. Middleware matcher must include the bare `/`

The pattern `'/((?!_next/static|...).*)'` matches `/anything` but **does not** match the bare `/`. Without an explicit `'/'` entry, the root landing page of every frontend (`/trader`, `/insights`, `/config-ui` after basePath stripping) bypasses the middleware entirely. Unauthenticated visitors would see a statically prerendered dashboard shell stuck on "Loading…" forever instead of being bounced to `/login`.

**Bug avoided** ([PR #401](https://github.com/davcs86/xstockstrat/pull/401)). Canonical matcher:

```ts
export const config = {
  matcher: [
    '/',
    '/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|api/auth/login|api/health|health).+)',
  ],
};
```

Note `.+` (not `.*`) in the second entry so the two entries don't double-match.

### The exclusion list must include every metadata icon you serve

If you add an `app/icon.svg` (or `apple-icon.png`) for Next.js' metadata file convention, add the filename to the matcher exclusion or browsers will receive a 307 redirect to `/login` when requesting the favicon. Default exclusions: `favicon.ico`, `icon.svg`, `apple-icon.png`. Add more as needed.

---

## 3. App icons via `app/icon.svg`

Next.js' metadata file convention auto-emits `<link rel="icon" href="/<basePath>/icon.svg">` when you place an `icon.svg` at `app/icon.svg`. No manual `<head>` editing required.

```
services/xstockstrat-trader/src/app/icon.svg     # cyan Activity glyph
services/xstockstrat-insights/src/app/icon.svg   # violet bar chart
services/xstockstrat-config-ui/app/icon.svg      # green layers
```

**Bug avoided** ([PR #402](https://github.com/davcs86/xstockstrat/pull/402)): none of the three frontends had an icon, so browsers got HTML 200 or 404 for `/favicon.ico` requests and the tab icon was empty. `/trader/icon.svg` 307'd to `/login` because the middleware matcher didn't exclude it.

Use distinct colors per app so users can tell tabs apart at a glance.

---

## 4. SSR Suspense fallbacks — never empty, never `null`

When a client component uses `useSearchParams()`, Next.js requires it to be wrapped in `<Suspense>`. During SSR, Next.js emits `BAILOUT_TO_CLIENT_SIDE_RENDERING` for the Suspense subtree and renders the **fallback** instead. If the fallback is `null` or absent, the server-rendered HTML body is effectively empty until JS hydrates.

**Bug avoided** ([PR #400](https://github.com/davcs86/xstockstrat/pull/400)). Measured on staging:

| Page | Before | After |
|---|---|---|
| `/insights/login` | 84 byte body (just the bailout marker) | full card skeleton |
| `/insights` (dashboard) | 5.5 KB (no header, no skeleton) | full AppShell + two card skeletons |

### Rule

Every `<Suspense>` boundary in a `page.tsx` **must** have a non-trivial `fallback` that:
1. Renders the page's outer chrome (AppShell, header, padding) so users see structure immediately.
2. Includes placeholder content (animated `bg-secondary` pulses, loading text, or the real layout populated with empty data).

```tsx
function LoginSkeleton() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader><CardTitle className="text-2xl">xstockstrat Trader</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="h-10 rounded-md bg-secondary animate-pulse" />
            <div className="h-10 rounded-md bg-secondary animate-pulse" />
            <div className="h-10 rounded-md bg-secondary/80 animate-pulse" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginSkeleton />}>
      <LoginForm />
    </Suspense>
  );
}
```

---

## 5. Radix `<Select>` triggers render empty pre-hydration

Radix's `SelectValue` cannot map `value` → label during SSR because `SelectContent` items aren't mounted yet. If the trigger has a value but no `children`, the resulting `<button>` renders an **empty `<span>`** until hydration.

**Bug avoided** ([PR #404](https://github.com/davcs86/xstockstrat/pull/404)). Two trader dropdowns flashed empty pills on first paint:

- `OrderForm` order-type select — value defaulted to `'market'`, placeholder ignored.
- `ChartPanel` bar-count select — no placeholder, no children, fully empty pill.

### Rule

Pass a `SelectValue` child that reflects current state, sourced from a `<value, label>` map:

```tsx
const ORDER_TYPE_LABEL: Record<OrderType, string> = {
  market: 'Market', limit: 'Limit', stop: 'Stop', stop_limit: 'Stop Limit',
};

<Select value={orderType} onValueChange={(v) => setOrderType(v as OrderType)}>
  <SelectTrigger>
    <SelectValue placeholder="Order type">{ORDER_TYPE_LABEL[orderType]}</SelectValue>
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="market">Market</SelectItem>
    {/* ... */}
  </SelectContent>
</Select>
```

The child renders until Radix matches a `SelectItem`; pick labels identical to the corresponding `SelectItem` text so there's no flicker on hydration.

---

## 6. Cross-frontend / cross-page navigation

| What | Where | Pattern |
|---|---|---|
| Header brand → home of current app | logo in AppShell | `<Link href="/">` (basePath-prefixed) |
| Cross-app tabs (Trader / Insights / Config) | AppShell platform nav | plain `<a href="/trader">`, `/insights`, `/config-ui` |
| In-app subnav (Dashboard / Strategies / …) | AppShell | `<Link href="/strategies">` |
| Click a row to drill in (e.g. Order book row → detail) | Component | `<Link href={`/orders/${id}`}>` |
| Empty-state CTA ("Run a backtest") | Component | `<Link href="/strategies">` |

The bare domain (no basePath) should redirect to the primary app:

```nginx
location = / {
    return 302 /trader;
}
```

See [PR #403](https://github.com/davcs86/xstockstrat/pull/403).

---

## 7. Pre-PR build verification — required when touching middleware or its imports

The Edge-runtime constraint described in `frontend-auth.md` is **invisible in source review**. The only reliable way to catch it is to run the build:

```bash
pnpm --filter xstockstrat-<service> build
```

If you've modified **any** of these, the build is mandatory before pushing:
- `src/middleware.ts`
- `src/lib/auth.ts` (or anything else `middleware.ts` statically imports)
- `src/lib/connectClients.ts`
- Any new file imported transitively by `middleware.ts`

PRs #409 and #410 both shipped Edge-incompatible code that passed local TypeScript checks but failed CI's build step. Catch this at the keyboard, not in CI.

---

## 8. Stacking PRs

When PR B depends on PR A (e.g. B imports a helper A introduces), open B with **base = A's branch** rather than `main-dev`. GitHub will:
- show only B's incremental diff,
- auto-retarget B to `main-dev` once A merges.

This was the pattern used for #406 (depends on #409) and #411 (depends on #409). Always note the dependency in the PR body.

---

## 9. Next 15 dynamic route handlers — `params` is a Promise

Next.js 15 made the second argument to dynamic route handlers async. The signature changed from:

```ts
// ❌ Next 14 — sync params, fails to build under Next 15
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const order = await tradingClient.getOrder({ orderId: params.id }, { headers });
}
```

to:

```ts
// ✅ Next 15 — Promise params
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = await tradingClient.getOrder({ orderId: id }, { headers });
}
```

**Bug avoided** ([PR #413](https://github.com/davcs86/xstockstrat/pull/413), originally introduced by [#406](https://github.com/davcs86/xstockstrat/pull/406) before the Next 15 upgrade landed). The compile error looks like:

```
Type error: Route "src/app/api/orders/[id]/route.ts" has an invalid "GET" export:
  Type "{ params: { id: string; }; }" is not a valid type for the function's second argument.
```

The rule applies to every dynamic segment — `[id]`, `[symbol]`, `[namespace]`, `[...slug]`. All other trader/insights/config-ui routes already use the `Promise<{...}>` shape; new code must match.

---

## 10. Transport protocol — hard architecture requirement

> **Every Next.js frontend in this platform is a BFF (Backend-for-Frontend). This section is non-negotiable.**

### The required call chain

```
Browser (React Client Components)
  └── Connect-RPC (HTTP/1.1, basePath + /api)
        └── Next.js BFF catch-all  app/api/[...connect]/route.ts
              via lib/connectBff.ts (createConnectRouter + dispatchConnect)
                └── gRPC H2C (HTTP/2, port 50xxx)
                      └── Backend services
```

### Rules

| Rule | Rationale |
|---|---|
| **Server-side code uses `createGrpcTransport` (port 50xxx) only** | gRPC is the authoritative — and only — backend protocol. Backend services no longer run HTTP/Connect-RPC (80xx) servers; the MCP agent also calls them over gRPC. |
| **Never import `createConnectTransport` in `connectClients.ts`** | That function is for browser code only (`connectTransport.ts`). Using it server-side routes calls to the wrong port and protocol. |
| **`*_ENDPOINT` env vars are `host:port` (no protocol)** | Prefixed with `http://` inside `createGrpcTransport`. Using a full URL here would double-prefix it. |
| **`*_HTTP_ENDPOINT` env vars are obsolete** | The backend HTTP (80xx) servers were removed. No runtime code reads `*_HTTP_ENDPOINT` (only test-only Playwright mocks may still set it). Use `*_ENDPOINT` (gRPC). |
| **No `UntypedClient` cast** | connect v2 + protobuf-es v2 `GenService` descriptors give a properly typed `Client<T>` where methods accept `MessageInitShape<I>` (plain objects). No cast needed. Using one silently hides proto field name bugs. |
| **DO app specs need `http2_ports: [50xxx]`** | Without it, DO's internal load balancer negotiates HTTP/1.1 to gRPC ports and all calls fail. Add it to both `app.yaml` and `app.dev.yaml` for every service with a gRPC port. |

### BFF catch-all: one file per frontend

Each frontend has two BFF files:

```
lib/connectBff.ts           ← router setup, auth helpers, dispatchConnect()
app/api/[...connect]/route.ts  ← two lines: export GET/POST = dispatchConnect
```

`connectBff.ts` registers services via `createConnectRouter` (from `@connectrpc/connect`) and builds a handler map keyed by **`'/api' + handler.requestPath`** — i.e. the **basePath-relative** path, NOT `basePath + '/api' + ...`. The `dispatchConnect` function adapts Web API `Request`/`Response` to `UniversalServerRequest`/`UniversalServerResponse`.

> ⚠️ **The #1 BFF footgun — do not prefix the basePath onto the handler-map keys.**
> Next.js **strips the configured `basePath` from `req.url` before the route handler runs.** Inside `dispatchConnect`, `new URL(req.url).pathname` is therefore basePath-relative — e.g. `/api/xstockstrat.portfolio.v1.PortfolioService/ListPortfolios`, **not** `/trader/api/...`. If you build the map with `const PREFIX = '/trader/api'` (the public URL the browser sees), **every lookup misses and every RPC returns 404.** The browser hits `/trader/api/...` (correct — `browserTransport.baseUrl` includes the basePath, and nginx forwards it intact), but by the time it reaches `dispatchConnect` the `/trader` prefix is gone. Key the map on `'/api'` only:
> ```ts
> // ✓ Correct — matches the basePath-relative pathname dispatchConnect actually receives
> const PREFIX = '/api';
> const handlerMap = new Map(router.handlers.map((h) => [PREFIX + h.requestPath, h]));
> ```
> **Bug fixed** ([PR #453](https://github.com/davcs86/xstockstrat/pull/453)): all three BFFs keyed on `'/<basePath>/api'`. Latent until the trader frontend actually started calling its BFF (connect-web migration, [PR #451](https://github.com/davcs86/xstockstrat/pull/451)) — then **every** method (`ListOrders`, `ListPortfolios`, `RegisterBrokerAccount`, `ListBrokerAccounts`, `StreamAlerts`, `ListAssets`) 404'd in production. See "Verifying a BFF route actually resolves" below — a `next build` pass does **not** catch this.

All existing specific App Router routes (`auth/*`, `health`, `alerts/stream`, `audit`, etc.) take precedence over the `[...connect]` catch-all due to Next.js route ordering (static > required catch-all).

### Browser-side: `connectTransport.ts`

Browser components call the BFF via `browserTransport`:

```ts
// lib/connectTransport.ts — browser only
import { createConnectTransport } from '@connectrpc/connect-web';
export const browserTransport = createConnectTransport({ baseUrl: '/trader/api' });
```

`baseUrl` is `/<basePath>/api`. The browser sends Connect-RPC (HTTP/1.1) to the catch-all; the BFF proxies it as gRPC H2C to the backend.

### What breaks if you violate this

- Using `createConnectTransport` server-side → routes calls to 80xx ports → those ports are either absent in DO (removed) or serve HTTP/1.1 only → gRPC calls time out silently.
- Using `UntypedClient` → proto field name bugs compile and run silently (e.g. `{startTime: x}` instead of `{start: x}` reaches the backend as `undefined`).
- Missing `http2_ports` in DO → all gRPC calls fail in production with connection errors even though local docker-compose works fine.
- Prefixing the basePath onto the BFF handler-map keys → every RPC 404s (see the footgun callout above).

### Browser components consume the typed message — do NOT hand-map JSON

Browser Client Components MUST call backend RPCs through `browserClients.ts`
(`@connectrpc/connect-web` typed clients on `browserTransport`) and consume the
returned **protobuf-es message directly**: **camelCase fields and numeric enums**
(`order.orderId`, `account.id`, `order.side === OrderSide.BUY`,
`OrderStatus[order.status]` for a label). This is the single canonical contract
end-to-end — there is no per-route JSON adapter to map snake_case ⇄ camelCase or
string-enum ⇄ numeric-enum.

| Do | Don't |
|---|---|
| `useSWR(['orders', mode], () => tradingClient.listOrders({ tradingMode }))` | `useSWR('/trader/api/orders', fetcher)` against a bespoke JSON route |
| `account.id`, `account.displayName`, `account.brokerType === BrokerType.IBKR` | `account.account_id`, `account.display_name`, `account.broker_type === 2` |
| `order.side === OrderSide.BUY`, label via `OrderStatus[order.status]` | `order.side === 'ORDER_SIDE_BUY'`, `order.status.replace('ORDER_STATUS_','')` |
| import enums from `@xstockstrat/proto/<svc>/v1/<svc>_pb` / `common/v1/common_pb` | hardcode magic numbers (`2` for IBKR) |

**Bug fixed** ([PR #451](https://github.com/davcs86/xstockstrat/pull/451)): the trader frontend mixed bespoke JSON `/api/*` routes with components written for a snake_case + string-enum shape, while the gRPC-transport clients emit camelCase + numeric enums. Broker-account registration and the orders/portfolio/positions views silently broke (e.g. `data.account.account_id` was `undefined`, so a newly registered account was never selected). Fixed by routing every browser call through the connect-web BFF and reading the typed shape. **A raw `fetch('/api/...')` in a browser component is now a smell** — the only non-BFF routes are `auth/{login,refresh,logout}` and `health`.

> **`NextResponse.json(protobufEsMessage)` is not a safe contract.** It emits camelCase keys, a leaking `$typeName`, numeric enums, and **throws on any int64 field** (BigInt isn't JSON-serializable). If you ever must return JSON from a route (you generally shouldn't), use `toJson(Schema, msg, { useProtoFieldName: true })` — never the raw object.

### Verifying a BFF route actually resolves — `next build` is NOT enough

`tsc`, `next lint`, and `next build` all pass even when **every** BFF RPC 404s
(the handler-map key bug above, and any path/middleware mismatch, are runtime-only).
Before declaring a BFF change done, smoke-test the actual request against a
**production** standalone build:

```bash
# 1. production build + run the standalone server with a JWT secret
next build
JWT_SECRET=<32+ char secret> NODE_ENV=production PORT=3100 HOSTNAME=127.0.0.1 \
  node .next/standalone/services/xstockstrat-<svc>/server.js &

# 2. forge a session cookie (jose, same secret) and POST a real method path
#    NOTE: the path includes the basePath — the browser/nginx see /<basePath>/api/...
curl -i -X POST "http://127.0.0.1:3100/<basePath>/api/xstockstrat.<pkg>.v1.<Service>/<Method>" \
  -H 'Content-Type: application/json' -H "Cookie: access_token=<jwt>" --data '{}'
```

Interpreting the status (no backend running locally is fine):

| Status | Meaning |
|---|---|
| **404** (5-byte Next body) | Route never reached `dispatchConnect`, or handler-map miss — **the bug**. Add a temporary `console.error('miss %j keys=%j', pathname, [...handlerMap.keys()])` before the 404 to see pathname-vs-keys. |
| **307** → `/login` | Request had no valid `access_token` cookie (middleware redirect) — forge the cookie. |
| **415** | Reached the Connect handler; rejected the raw body for lacking a Connect content-type — **routing is correct.** |
| **503 `unavailable: ENOTFOUND <service>`** | Passed `requireSession`, attempted the backend gRPC dial — **fully wired**; resolves to 200 in an environment where the backend is reachable. |

This is exactly the gap that let [PR #451](https://github.com/davcs86/xstockstrat/pull/451) ship the basePath 404 ([PR #453](https://github.com/davcs86/xstockstrat/pull/453)): it was build-/typecheck-verified only. The frontend e2e suites should cover this leg — see feature `046-align-frontend-e2e-bff-mocks`.

---

## File / route summary table

| File | Runtime | Purpose |
|---|---|---|
| `next.config.js` | build | sets `basePath`; `output: 'standalone'` |
| `src/middleware.ts` | Edge | auth gate; only imports Edge-safe code |
| `src/lib/auth.ts` | Edge-safe | JWT, cookies, role bitmap, trace IDs |
| `src/lib/identity.ts` | Node | `refreshSession`, `revokeToken` (uses Connect client) |
| `src/lib/connectClients.ts` | Node | typed gRPC clients (`createGrpcTransport`, 50xxx) used **only inside `connectBff.ts`** + `connectCodeToHttp` |
| `src/lib/connectTransport.ts` | Browser | `browserTransport` — `createConnectTransport` to BFF catch-all (`baseUrl: '/<basePath>/api'`) |
| `src/lib/browserClients.ts` | Browser | typed connect-web clients on `browserTransport`; **the only client import allowed in Client Components** |
| `src/lib/connectBff.ts` | Node | `createConnectRouter` service impls + `dispatchConnect()`; handler map keyed on **`'/api'`** (basePath-relative), never `'/<basePath>/api'` |
| `src/app/api/[...connect]/route.ts` | Node | BFF catch-all — exports `GET`/`POST = dispatchConnect` |
| `src/app/layout.tsx` | server | global `<html>` / `<body>` shell |
| `src/app/page.tsx` | client (`'use client'`) | dashboard; **must** have non-null Suspense fallback |
| `src/app/login/page.tsx` | client | login form; same Suspense rule |
| `src/app/icon.svg` | static | metadata icon (auto-linked into `<head>`) |
| `src/app/api/**/route.ts` | Node | always gate with `getSessionFromRequest`; use typed Connect client |

---

## Next.js 15 Migration Reference

All three frontends (`trader`, `insights`, `config-ui`) are on **Next.js 15.5.15** as of feature `041-upgrade-nextjs15`. Key breaking changes and their fixes:

### 1. `serverExternalPackages` rename

```js
// Before (Next.js 14) — WRONG in v15, emits a deprecation warning
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['@connectrpc/connect', '@connectrpc/connect-node', ...],
  },
};

// After (Next.js 15) — top-level key, no experimental wrapper
const nextConfig = {
  serverExternalPackages: ['@connectrpc/connect', '@connectrpc/connect-node',
    '@bufbuild/protobuf', '@opentelemetry/sdk-node', '@opentelemetry/exporter-trace-otlp-http'],
};
```

### 2. Async request props (`params` and `searchParams`)

In Next.js 15, both `params` and `searchParams` in page/layout/route-handler props are now `Promise<T>` and must be awaited. The pattern differs by component type:

**Server Components** — use `async` function + `await`:
```tsx
// Before (Next.js 14)
export default function HomePage({ searchParams }: { searchParams: { env?: string } }) {
  const env = searchParams.env ?? 'dev';

// After (Next.js 15)
export default async function HomePage({ searchParams }: { searchParams: Promise<{ env?: string }> }) {
  const resolvedSearchParams = await searchParams;
  const env = resolvedSearchParams.env ?? 'dev';
```

**Client Components** (`'use client'`) — use `React.use()` (cannot `await` in a non-async render function):
```tsx
// Before (Next.js 14)
export default function NamespacePage({ params }: { params: { id: string } }) {
  const { id } = params;

// After (Next.js 15)
import { use } from 'react';
export default function NamespacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
```

> **Note:** Next.js 15 enforces the `PageProps` TypeScript constraint on **all** page components, including `'use client'` ones. The TypeScript build will error if params/searchParams are typed as sync even in client components. The `React.use()` pattern is required (not `await`) since client component render functions are not `async`.

**Route Handlers** (in `app/api/[id]/route.ts`) — same `await` pattern as Server Components:
```ts
// Before (Next.js 14)
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const id = params.id;

// After (Next.js 15)
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
```

Catch-all route handlers (`[...connect]/route.ts`) that receive `Request` directly (no params destructuring) are **unaffected**.

### 3. Cross-app `<a>` links and `@next/next/no-html-link-for-pages`

`eslint-config-next@15` now errors (previously warned) on `<a>` elements that appear to navigate to internal pages. Cross-app links (e.g. `<a href="/trader">`) will be flagged even though they intentionally escape the current app's `basePath`.

Fix: add `{/* eslint-disable-next-line @next/next/no-html-link-for-pages */}` before each cross-app `<a>` link in layout files. Do NOT use `<Link>` for cross-app links — `basePath` would mangle the href (e.g. `/config-ui/trader` instead of `/trader`).

### 4. Test infrastructure: `@connectrpc/connect-node` JSON mode

`@connectrpc/connect-node`'s `createConnectTransport` defaults to **binary protobuf** (`useBinaryFormat: true`), unlike the browser transport which defaults to JSON. When using an HTTP mock backend in E2E tests, explicitly set `useBinaryFormat: false`:

```ts
// In connectClients.ts — HTTP override path for test mocking
function makeTransport(grpcEndpoint: string, httpOverride?: string) {
  if (httpOverride) {
    return createConnectTransport({ baseUrl: httpOverride, httpVersion: '1.1', useBinaryFormat: false });
  }
  return createGrpcTransport({ baseUrl: `http://${grpcEndpoint}` });
}
```

Mock backend must return `Content-Type: application/json` (not `application/connect+json`, which is for streaming). Proto3 zero-value fields (`false`, `0`, `""`) are omitted from JSON — test assertions must handle `undefined` as semantically equivalent to the zero value.
