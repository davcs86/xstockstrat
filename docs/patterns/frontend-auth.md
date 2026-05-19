# Frontend Authentication Pattern

Every new Next.js frontend service **must** implement the following auth pattern. This was established by feature `wire-fe-auth` and applies to trader, insights, config-ui, and all future frontends.

Reference implementation: `services/xstockstrat-trader/` (auth.ts, middleware.ts, app/login/, app/api/auth/).

## Required files (relative to the service root)

| File | Purpose |
|---|---|
| `lib/auth.ts` (or `src/lib/auth.ts`) | Shared auth utilities — Edge Runtime compatible |
| `app/login/page.tsx` | Login form — renders when middleware redirects unauthenticated users |
| `app/api/auth/login/route.ts` | Authenticates credentials via `xstockstrat-identity`, sets cookies |
| `app/api/auth/refresh/route.ts` | Refreshes the access token using the refresh token cookie |
| `app/api/auth/logout/route.ts` | Revokes token and clears cookies |
| `middleware.ts` | Route protection — runs on every request in the Edge Runtime |

## `lib/auth.ts` — required exports

Must be **Edge Runtime compatible** (no Node.js-only imports). Use `jose` for JWT operations.

```typescript
export const IDENTITY_HTTP_ENDPOINT =
  process.env.IDENTITY_HTTP_ENDPOINT ?? 'http://xstockstrat-identity:8058';
// NOTE: do NOT import this from connectTransport.ts — that file imports
// @connectrpc/connect-node which is not Edge Runtime compatible.

export type JwtClaims = { user_id: string; email: string; roles: string[] };

export async function verifyAccessToken(token: string): Promise<JwtClaims | null>
export async function getSessionFromRequest(req: NextRequest): Promise<JwtClaims | null>
export async function refreshSession(refreshToken: string): Promise<{ accessToken: string; refreshToken: string; claims: JwtClaims } | null>
export async function revokeToken(token: string): Promise<void>
export function rolesToAccessScope(roles: string[]): number  // bitmap
export function generateTraceId(): string                    // crypto.randomUUID()
```

## `middleware.ts` — required behaviour

- Protect all routes **except** `/login` and `/api/auth/*`.
- If the access token cookie is valid: allow the request and inject `x-trace-id` (generate if absent).
- If the access token is expired but a refresh token exists: attempt silent refresh, rewrite cookies, allow.
- Otherwise: redirect to `/login?next=<encoded-url>`.

## API routes — header forwarding (required)

Every outbound `fetch` call from an API route to a backend service **must** forward the three propagation headers:

```typescript
const claims = await getSessionFromRequest(req);  // guaranteed non-null — middleware already verified
const accessScope = String(rolesToAccessScope(claims.roles));
const traceId = req.headers.get('x-trace-id') ?? generateTraceId();

fetch(upstreamUrl, {
  headers: {
    'Content-Type': 'application/connect+json',
    'x-user-id':      claims.user_id,
    'x-access-scope': accessScope,
    'x-trace-id':     traceId,
  },
  // ...
});
```

## Required environment variables

| Variable | Where set | Notes |
|---|---|---|
| `JWT_SECRET` | `docker-compose.yml`, `.do/app.dev.yaml`, `.do/app.yaml` | Must be `≥32` chars; same value across all frontends and identity service |
| `IDENTITY_HTTP_ENDPOINT` | Same | DO: use `${xstockstrat-identity.PRIVATE_URL}`; local: `http://xstockstrat-identity:8058` |

## Required `package.json` additions

```json
"jose": "^5.x.x"
```

## Adding a new frontend service checklist

1. Copy the auth file structure from `xstockstrat-trader` (reference implementation).
2. Add `JWT_SECRET` and `IDENTITY_HTTP_ENDPOINT` to `docker-compose.yml`, `.do/app.dev.yaml`, and `.do/app.yaml` under the new service.
3. Add `xstockstrat-identity` to the new service's `depends_on` in `docker-compose.yml`.
4. Ensure all outbound Connect-RPC `fetch` calls in API routes forward the three propagation headers.
5. Follow `docs/patterns/nginx-routing.md` for the nginx upstream and location rules.
