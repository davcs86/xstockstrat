# Frontend Authentication Pattern

Every Next.js frontend (`trader`, `insights`, `config-ui`, and future siblings) **must** implement this auth pattern. Reference implementation: `services/xstockstrat-trader/`.

This doc covers the **auth-specific** rules. For general Next.js patterns (basePath, middleware matcher, Suspense fallbacks, Radix hydration, app icons), read `docs/patterns/nextjs-frontends.md`.

---

## Required files

| File | Runtime | Purpose |
|---|---|---|
| `src/lib/auth.ts` | **Edge-safe** | JWT verification, cookie helpers, role bitmap, trace IDs |
| `src/lib/identity.ts` | **Node-only** | `refreshSession`, `revokeToken` — calls `identityClient` |
| `src/lib/connectClients.ts` | **Node-only** | Typed Connect clients + `connectCodeToHttp` helper |
| `src/middleware.ts` | **Edge runtime** | Auth gate, redirects to `/login`, near-expiry refresh |
| `src/app/login/page.tsx` | Browser | Login form |
| `src/app/api/auth/login/route.ts` | Node | `AuthenticateUser` → sets cookies |
| `src/app/api/auth/refresh/route.ts` | Node | `RefreshToken` (calls `identity.ts`) |
| `src/app/api/auth/logout/route.ts` | Node | `RevokeToken` + clears cookies (calls `identity.ts`) |

---

## The Edge-runtime trap (read this first)

> **`src/lib/auth.ts` MUST NOT statically import anything that pulls in `@connectrpc/connect-node` or any other Node-only API.**

Why: `middleware.ts` statically imports `auth.ts`, and Next.js bundles `middleware.ts` for the **Edge runtime** (`next-on-edge`). The Edge bundler cannot resolve Node-only modules (`node:http`, `net`, `tls`, `child_process`, …). If it sees them, the entire app fails to build with:

```
Module not found: Can't resolve 'node:http'
Import trace for requested module:
  ./src/lib/connectClients.ts
  ./src/lib/auth.ts
  ./src/middleware.ts
> Build failed because of webpack errors
```

This happened on PRs #409 and #410 in the Connect-client migration. The fix:

| Stays in `lib/auth.ts` (Edge-safe) | Lives in `lib/identity.ts` (Node-only) |
|---|---|
| `JwtClaims` interface | `refreshSession(refreshToken)` |
| `ACCESS_TOKEN_REFRESH_THRESHOLD_SECONDS` | `revokeToken(token)` |
| `verifyAccessToken(token)` (uses `jose`) | |
| `getSessionFromRequest(req)` | |
| `setSessionCookies` / `clearSessionCookies` | |
| `rolesToAccessScope(roles)` | |
| `generateTraceId()` | |

Only `lib/auth.ts` may be imported from `middleware.ts`. `lib/identity.ts` is only ever imported from `app/api/auth/refresh/route.ts` and `app/api/auth/logout/route.ts` (both Node-runtime routes).

If you add **any new import to `lib/auth.ts`**, ask: does this transitively pull in `@connectrpc/connect-node`, `node:*`, `fs`, `net`, `http`, etc.? If yes, it belongs in a separate Node-only file.

---

## `lib/auth.ts` — required exports

Edge-runtime compatible. Uses `jose` for JWT (Edge-compatible Web Crypto under the hood). No `@connectrpc/connect-node`, no `node:*` imports.

```ts
import { jwtVerify } from 'jose';
import type { NextRequest, NextResponse } from 'next/server';

export interface JwtClaims {
  user_id: string;
  email: string;
  roles: string[];
  issued_at: number;
  expires_at: number;
}

export const ACCESS_TOKEN_REFRESH_THRESHOLD_SECONDS = 60;

export async function verifyAccessToken(token: string): Promise<JwtClaims | null> { /* jose */ }
export async function getSessionFromRequest(req: NextRequest): Promise<JwtClaims | null>;
export function setSessionCookies(res: NextResponse, accessToken: string, refreshToken: string): void;
export function clearSessionCookies(res: NextResponse): void;
export function rolesToAccessScope(roles: string[]): number;  // bitmap: READ=1, WRITE=2, ADMIN=4, TRADING=8
export function generateTraceId(): string;                    // crypto.randomUUID()
```

## `lib/identity.ts` — Node-only helpers

```ts
/**
 * Server-only identity helpers. NEVER import this from middleware.ts
 * or any module middleware.ts transitively imports — it pulls in
 * @connectrpc/connect-node which uses Node-only APIs.
 */
import { identityClient } from '@/lib/connectClients';
import type { JwtClaims } from '@/lib/auth';

export async function refreshSession(refreshToken: string): Promise<{ accessToken: string; refreshToken: string; claims: JwtClaims } | null>;
export async function revokeToken(token: string): Promise<void>;
```

---

## `middleware.ts` — required behaviour

- Protect all routes **except** `/login`, `/api/auth/login`, `/api/health`, `/health`, and Next.js asset paths.
- **Matcher must include `/` explicitly** — the regex `/((?!...).*)` does not match the bare root. See `docs/patterns/nextjs-frontends.md` for the canonical matcher.
- If `getSessionFromRequest` returns claims → allow request, inject `x-trace-id` upstream.
- If access token is within `ACCESS_TOKEN_REFRESH_THRESHOLD_SECONDS` of expiry → call `/api/auth/refresh` via `fetch` (do NOT statically import `refreshSession` — that would re-trigger the Edge trap).
- Otherwise → redirect to `/login?redirect=<encoded pathname>`.

---

## API routes — Connect-RPC client + header forwarding

Outbound calls to backend services must:
1. Use the typed client from `lib/connectClients.ts` (not raw `fetch`).
2. Forward the three propagation headers as a `Headers` object on the call options.
3. Catch `ConnectError` and map to HTTP status via `connectCodeToHttp`.

```ts
import { NextRequest, NextResponse } from 'next/server';
import { ConnectError } from '@connectrpc/connect';
import { connectCodeToHttp, tradingClient } from '@/lib/connectClients';
import { getSessionFromRequest, rolesToAccessScope, generateTraceId } from '@/lib/auth';

// Next 15 — params is a Promise. See nextjs-frontends.md §9.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const claims = await getSessionFromRequest(req);
  if (!claims) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const headers = new Headers({
    'x-user-id':      claims.user_id,
    'x-access-scope': String(rolesToAccessScope(claims.roles)),
    'x-trace-id':     req.headers.get('x-trace-id') ?? generateTraceId(),
  });
  try {
    const order = await tradingClient.getOrder({ orderId: id }, { headers });
    return NextResponse.json(order);
  } catch (err) {
    if (err instanceof ConnectError) {
      return NextResponse.json({ error: err.rawMessage }, { status: connectCodeToHttp(err.code) });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
```

### `connectClients.ts` conventions

- Import service descriptors from `@xstockstrat/proto/<service>/v1/<service>_pb` — the `GenService` runtime values produced by protobuf-es v2. **Never use hand-rolled descriptor objects** (`typeName: '...'`, `I: {} as any`).
- Use `createGrpcTransport({ baseUrl: \`http://\${endpoint}\` })` from `@connectrpc/connect-node`. This is H2C (cleartext HTTP/2) to the gRPC ports (50xxx). **Never use `createConnectTransport`** — HTTP/1.1 on the 80xx ports is reserved for the MCP agent and webhook callers, not server-side route handlers.
- Read endpoints from `process.env.*_ENDPOINT` in `host:port` format (no protocol). Never read `*_HTTP_ENDPOINT` from frontend `connectClients.ts`.
- Export one typed `Client<ServiceDescriptor>` per service. No `UntypedClient` cast: connect v2 + protobuf-es v2 `GenService` descriptors give fully-typed clients whose methods accept `MessageInitShape<I>` (a partial plain object), so plain object inputs pass the type-checker without any cast.
- Export the shared `connectCodeToHttp` helper.

```ts
import { createClient } from '@connectrpc/connect';
import { createGrpcTransport } from '@connectrpc/connect-node';
import { TradingService } from '@xstockstrat/proto/trading/v1/trading_pb';

const TRADING_ENDPOINT = process.env.TRADING_ENDPOINT ?? 'xstockstrat-trading:50051';

function makeTransport(endpoint: string) {
  return createGrpcTransport({ baseUrl: `http://${endpoint}` });
}

export const tradingClient = createClient(TradingService, makeTransport(TRADING_ENDPOINT));
```

### The `connectCodeToHttp` helper

```ts
export function connectCodeToHttp(code: Code): number {
  switch (code) {
    case Code.InvalidArgument:
    case Code.FailedPrecondition:
    case Code.OutOfRange:      return 400;
    case Code.Unauthenticated: return 401;
    case Code.PermissionDenied: return 403;
    case Code.NotFound:        return 404;
    case Code.AlreadyExists:
    case Code.Aborted:         return 409;
    case Code.ResourceExhausted: return 429;
    case Code.Unimplemented:   return 501;
    case Code.Unavailable:     return 503;
    case Code.DeadlineExceeded: return 504;
    default:                   return 500;
  }
}
```

### `/api/auth/login` is the exception

It runs **before** the user has a session, so it does not propagate `x-user-id` / `x-access-scope` / `x-trace-id`. It uses the typed `identityClient.authenticateUser(...)` and **must distinguish credential failures from service failures**:

```ts
import { ConnectError, Code } from '@connectrpc/connect';

try {
  const data = await identityClient.authenticateUser({ email, password });
  const response = NextResponse.json({ ok: true });
  setSessionCookies(response, data.accessToken, data.refreshToken);
  return response;
} catch (err) {
  if (err instanceof ConnectError && err.code === Code.Unauthenticated) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }
  // Service failure — log internally, return generic 503 (not 401)
  console.error('[login] identity service error:', err);
  return NextResponse.json(
    { error: 'Authentication service unavailable. Please try again.' },
    { status: 503 },
  );
}
```

**Why not a catch-all 401?** Mapping every error to 401 "Invalid credentials" masks service-level failures (identity down, JWT_SECRET not set, network error). On DigitalOcean, the first symptom of a missing `JWT_SECRET` was users being shown "Invalid credentials" even with correct passwords — the real cause was a 503 from the identity service that got swallowed. `Code.Unauthenticated` is the only code the identity service returns for a bad password; anything else is a service-level problem that should surface as 503.

### Auth gate on every authenticated API route

Every API route under `/api/*` (except `/api/auth/login`, `/api/auth/refresh` which use the cookie, `/api/health`) **must** start with:

```ts
const claims = await getSessionFromRequest(req);
if (!claims) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
```

Middleware only catches **browser navigations**, not direct `curl` calls. The `/api/portfolio/accounts`, `/api/accounts`, and `/api/accounts/[id]` routes shipped without this check and leaked broker accounts to any unauthenticated caller — fixed in PR #411. Don't add a route without the gate.

---

## Required environment variables

| Variable | Where set | Notes |
|---|---|---|
| `JWT_SECRET` | `docker-compose.yml`, `.do/app.dev.yaml`, `.do/app.yaml` | ≥32 chars; same value across all frontends and the identity service |
| `IDENTITY_ENDPOINT` | Same | `host:port` format (no protocol). DO: `${xstockstrat-identity.PRIVATE_DOMAIN}:50058`; local: `xstockstrat-identity:50058` |

`auth.ts` does **not** read `IDENTITY_ENDPOINT` directly — it's consumed by `connectClients.ts` for the `identityClient` gRPC transport.

## Required `package.json` additions

```json
"jose": "^5.x.x",
"@connectrpc/connect": "^x.x.x",
"@connectrpc/connect-node": "^x.x.x",
"@bufbuild/protobuf": "^x.x.x"
```

---

## Adding a new frontend service — checklist

1. Copy `auth.ts`, `identity.ts`, `connectClients.ts`, `middleware.ts`, and `app/login/`, `app/api/auth/*` from `xstockstrat-trader`.
2. In `connectClients.ts`, add only the gRPC clients your frontend actually calls. Use `createGrpcTransport` + `*_ENDPOINT` vars. See `docs/patterns/nextjs-frontends.md` §10 for the hard transport rule.
3. Add `JWT_SECRET` and `IDENTITY_ENDPOINT` (format: `host:port`) to `docker-compose.yml`, `.do/app.dev.yaml`, `.do/app.yaml`. Add `http2_ports: [50058]` to the identity service block in both DO app specs.
4. Add `xstockstrat-identity` to `depends_on` in `docker-compose.yml`.
5. Every new API route under `/api/*` calls `getSessionFromRequest` + 401-on-null before touching a backend.
6. Every outbound call uses the typed gRPC client with `Headers` propagation and `connectCodeToHttp` on `ConnectError`.
7. Follow `docs/patterns/nginx-routing.md` for the nginx upstream and location.
8. In `app/login/page.tsx`, use the full basePath-prefixed path in the login `fetch`: `fetch('/mybasepath/api/auth/login', ...)`. A bare `fetch('/api/auth/login')` resolves from the document root, hits nginx with no matching route, and silently returns HTML — see `docs/patterns/nextjs-frontends.md` §1.
9. **Run `pnpm --filter <new-service> build` locally before opening a PR.** The Edge-runtime trap is invisible in source review — only a build catches it.
