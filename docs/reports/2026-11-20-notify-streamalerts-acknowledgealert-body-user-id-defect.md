# Defect: notify StreamAlerts and AcknowledgeAlert trust a body user_id

**Recorded**: 2026-11-20
**Severity**: SEV-3
**Impact type**: authz-bypass
**Environment**: dev (main-dev), code-level; evidence from `feature/fix-read-path-owner-trust` @ 12fd7270
**Affected service(s)**: xstockstrat-notify
**Config-only fix possible**: no

## Observed

`StreamAlerts` takes its subscriber filter from the request body `user_id` and never reads the
`x-user-id` header. An empty body `user_id` subscribes to every user's targeted alerts, and a body
`user_id` naming another user subscribes to that user's alerts. `AcknowledgeAlert` updates any
`alert_id` with no owner check and writes `acknowledged_by` from the body `user_id`, so any caller
can acknowledge another user's alert under any (or an empty) name.

Feature 312 scoped only `ListAlerts` (now header-only, code 3 when the header is absent). These two
RPCs were left out of 312 on purpose (design D-11) and are filed here.

## Expected

Both RPCs take the owner from the trusted `x-user-id` header only, on the NOTIFY-5 model already used
by `ListAlerts`, `GetAlert` and `RegisterPushSubscription`: a missing header returns code 3
(`x-user-id header required`) and the body `user_id` is ignored. `StreamAlerts` delivers only alerts
targeted at the caller plus untargeted alerts. `AcknowledgeAlert` updates only an alert the caller
may see, and `acknowledged_by` is the header caller.

## Reproduction

1. Open `StreamAlerts` with `x-user-id: user-a` and an empty body `user_id`.
2. Emit an alert with `target_user_id = user-b`.
3. The user-a stream receives user-b's alert.
4. Call `AcknowledgeAlert{alert_id: <user-b's alert>, user_id: "anyone"}` with `x-user-id: user-a`.
5. The alert is acknowledged with `acknowledged_by = 'anyone'`.

## Evidence

`packages/proto/notify/v1/notify.proto:91`
> string user_id = 1;               // filter by user; empty = all

`packages/proto/notify/v1/notify.proto:99`
> string user_id = 2;

`services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts:160`
> userId: req.userId ?? '',

`services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts:388`
> if (sub.userId && alert.targetUserId && alert.targetUserId !== sub.userId) {

`services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts:184-193` (`acknowledgeAlert`, `:188`)
> [call.request.userId, call.request.alertId]

Header-only reference (NOTIFY-5), `services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts:301-304`
> const userId = (call.metadata?.get?.('x-user-id')?.[0] ?? '').toString();

## Root cause hypothesis

Pre-PLAT-11 body filters left in place. `matchesSubscriber` skips the owner check when the
subscriber `userId` is empty, and `acknowledgeAlert` was never given a header read or owner predicate.

## Confidence

high
