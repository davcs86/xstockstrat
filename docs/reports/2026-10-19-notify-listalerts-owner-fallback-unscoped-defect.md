# Defect: ListAlerts trusts the body userId and is unscoped with no identity

**Recorded**: 2026-10-19
**Severity**: SEV-3
**Impact type**: authz-bypass
**Environment**: dev (main-dev) @ 1302e6d
**Affected service(s)**: xstockstrat-notify
**Config-only fix possible**: no
**Source**: `services/xstockstrat-notify/docs/context-constitution.md` NOTIFY-7; `services/xstockstrat-notify/CLAUDE.md` § Key Design

## Observed
`ListAlerts` resolves the owner from the `x-user-id` header, then the request-body `userId`, then
`null`. With `null`, the query predicate `$1::text IS NULL OR …` returns every user's targeted alerts.
With a body `userId`, a direct caller reads another user's alerts. The UI BFF always injects the
header, so only direct gRPC callers (any mTLS peer) are exposed. This is a defense-in-depth gap against root PLAT-11.

## Expected
Require `x-user-id` and reject with INVALID_ARGUMENT or UNAUTHENTICATED when it is absent, as `registerPushSubscription` already does (NOTIFY-5). Ignore the body `userId`.

## Reproduction
1. Emit alerts targeted to users A and B.
2. Call `NotifyService.ListAlerts({})` over mTLS with no metadata.
3. Alerts for both A and B are returned.

## Evidence
`services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts:192`
> `    const userId = call.metadata?.get?.('x-user-id')?.[0]?.toString() || req.userId || null;`

`services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts:202`
> `           WHERE ($1::text IS NULL OR a.target_user_id = $1 OR a.target_user_id IS NULL)`

## Root cause hypothesis
A body `userId` fallback was kept "for direct gRPC test callers" (inline comment) and never removed once the BFF began injecting the header.

## Confidence
high
