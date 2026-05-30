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
| **Server-side code uses `createGrpcTransport` (port 50xxx) only** | gRPC is the authoritative inter-service protocol. HTTP/1.1 Connect-RPC on 80xx ports exists only for the MCP agent and webhook callers. |
| **Never import `createConnectTransport` in `connectClients.ts`** | That function is for browser code only (`connectTransport.ts`). Using it server-side routes calls to the wrong port and protocol. |
| **`*_ENDPOINT` env vars are `host:port` (no protocol)** | Prefixed with `http://` inside `createGrpcTransport`. Using a full URL here would double-prefix it. |
| **`*_HTTP_ENDPOINT` env vars are reserved for agent/webhooks** | The three services the MCP agent calls over HTTP — ingest (8055), analysis (8056), notify (8059) — use `*_HTTP_ENDPOINT`. Nothing in `connectClients.ts` should read these. |
| **No `UntypedClient` cast** | connect v2 + protobuf-es v2 `GenService` descriptors give a properly typed `Client<T>` where methods accept `MessageInitShape<I>` (plain objects). No cast needed. Using one silently hides proto field name bugs. |
| **DO app specs need `http2_ports: [50xxx]`** | Without it, DO's internal load balancer negotiates HTTP/1.1 to gRPC ports and all calls fail. Add it to both `app.yaml` and `app.dev.yaml` for every service with a gRPC port. |

### BFF catch-all: one file per frontend

Each frontend has two BFF files:

```
lib/connectBff.ts           ← router setup, auth helpers, dispatchConnect()
app/api/[...connect]/route.ts  ← two lines: export GET/POST = dispatchConnect
```

`connectBff.ts` registers services via `createConnectRouter` (from `@connectrpc/connect`) and builds a handler map keyed by `basePath + '/api' + handler.requestPath`. The `dispatchConnect` function adapts Web API `Request`/`Response` to `UniversalServerRequest`/`UniversalServerResponse`.

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

---

## File / route summary table

| File | Runtime | Purpose |
|---|---|---|
| `next.config.js` | build | sets `basePath`; `output: 'standalone'` |
| `src/middleware.ts` | Edge | auth gate; only imports Edge-safe code |
| `src/lib/auth.ts` | Edge-safe | JWT, cookies, role bitmap, trace IDs |
| `src/lib/identity.ts` | Node | `refreshSession`, `revokeToken` (uses Connect client) |
| `src/lib/connectClients.ts` | Node | typed gRPC clients (`createGrpcTransport`, 50xxx) + `connectCodeToHttp` |
| `src/lib/connectTransport.ts` | Browser | `browserTransport` — Connect-RPC to BFF catch-all |
| `src/lib/connectBff.ts` | Node | `createConnectRouter` service impls + `dispatchConnect()` |
| `src/app/api/[...connect]/route.ts` | Node | BFF catch-all — exports `GET`/`POST = dispatchConnect` |
| `src/app/layout.tsx` | server | global `<html>` / `<body>` shell |
| `src/app/page.tsx` | client (`'use client'`) | dashboard; **must** have non-null Suspense fallback |
| `src/app/login/page.tsx` | client | login form; same Suspense rule |
| `src/app/icon.svg` | static | metadata icon (auto-linked into `<head>`) |
| `src/app/api/**/route.ts` | Node | always gate with `getSessionFromRequest`; use typed Connect client |
