# Defect: UI server-side gRPC transport has no default deadline, and the middleware matcher sends segment health routes through auth

**Recorded**: 2026-10-21
**Severity**: SEV-3
**Impact type**: request-hang-and-health-probe-auth
**Environment**: dev (main-dev) @ a053b0e
**Affected service(s)**: xstockstrat-ui
**Config-only fix possible**: no
**Source**: repo-surveyor debt-radar scan (`docs/repo-surveyor/debt-radar-findings.md` @ 4535695), findings D-37, D-38. Re-verified against main-dev @ a053b0e.

## Observed

### D-37 — UI BFF / middleware gRPC transport has no default deadline

`makeTransport` builds the server-side `createGrpcTransport` with mTLS options but no default timeout,
and the wrapper forwards whatever `timeoutMs` the caller passes (usually none). Only a few BFF calls set
their own (`insightsBff.ts`, `traderBff.ts`). Every other BFF call, and `refreshSession` in
`lib/identity.ts` (called from the Node-runtime middleware on every request with an expired access
token), waits indefinitely on a black-holed backend. A hung identity call stalls the middleware, and so
every page navigation for that user.

### D-38 — middleware matcher exempts only root-level health paths

The middleware matcher's negative lookahead excludes `api/health` and `health` only immediately after
the leading `/`, i.e. `/api/health` and `/health`. No route exists at either path. The eight real health
routes are segment-scoped (`/trader/health`, `/trader/api/health`, `/insights/health`,
`/insights/api/health`, `/config-ui/health`, `/config-ui/api/health`, `/accounts/api/health`,
`/accounts/api/agent-health`), so all of them go through the auth gate. An unauthenticated probe gets a
redirect to `/auth/login` instead of the health response.

## Expected

- D-37: every server-side gRPC call from the UI has a bounded deadline by default (a transport-level
  default, overridable per call), and `refreshSession` in particular is bounded, so a hung backend
  produces a timely error instead of a hang.
- D-38: the matcher exempts the segment-scoped health routes, so an unauthenticated request to any of
  the eight health routes reaches the route handler.

## Reproduction

1. D-37: point `IDENTITY_ENDPOINT` at a TCP listener that accepts and never responds. Load any
   protected page with an expired access token and a valid refresh-token cookie. The request hangs
   until the client gives up; no server-side timeout fires.
2. D-38: with no session cookies, `curl -sI http://localhost:3000/trader/health`. Observe a redirect to
   `/auth/login` rather than a 200 health response. Repeat for the other seven segment routes.

## Evidence

### D-37 — no default deadline

`services/xstockstrat-ui/src/lib/connectClients.ts:53-62` (`makeTransport`)
> real = createGrpcTransport({
>   baseUrl: `https://${endpoint}`,
>   nodeOptions: { ca, cert, key, checkServerIdentity: ... },
> });

No `defaultTimeoutMs` anywhere under `services/xstockstrat-ui/src/`.

`services/xstockstrat-ui/src/lib/identity.ts:14` (`refreshSession`, called from `src/middleware.ts:40`)
> const data: AuthTokenResponse = await identityClient.refreshToken({ refreshToken });

Per-call timeouts exist only at `src/lib/insightsBff.ts:58`, `:103`, `:114` and `src/lib/traderBff.ts:78`
(plumbed through `src/lib/bffShared.ts:65-74`).

### D-38 — matcher exempts only root health paths

`services/xstockstrat-ui/src/middleware.ts:22`
> '/((?!_next/static|...|api/auth/login|api/auth/refresh|api/health|health|auth/login|auth/oauth-login|\\.well-known|api/oauth).+)',

Health routes present: `src/app/trader/health/route.ts`, `src/app/trader/api/health/route.ts`,
`src/app/insights/health/route.ts`, `src/app/insights/api/health/route.ts`,
`src/app/config-ui/health/route.ts`, `src/app/config-ui/api/health/route.ts`,
`src/app/accounts/api/health/route.ts`, `src/app/accounts/api/agent-health/route.ts`. `src/app/api/`
holds only `auth/` and `oauth/` (no root health route).

## Root cause hypothesis

- D-37: the transport was ported to mTLS without a default deadline, leaving each call site to opt in.
- D-38: the health routes moved under the segment prefixes (feature 045 consolidation) while the matcher
  kept the pre-consolidation root-level exclusions.

## Confidence

high
