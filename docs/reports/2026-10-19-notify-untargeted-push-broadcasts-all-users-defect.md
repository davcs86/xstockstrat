# Defect: Untargeted alert sends a Web Push to every user's devices

**Recorded**: 2026-10-19
**Severity**: SEV-2
**Impact type**: cross-user-notification-leak
**Environment**: dev (main-dev) @ 1302e6d
**Affected service(s)**: xstockstrat-notify
**Config-only fix possible**: no
**Source**: `services/xstockstrat-notify/docs/context-constitution-findings.md` § Open questions bullet 5 (empty `targetUserId` broadcasts Web Push)

## Observed
`WebPushDispatcher.dispatch` selects subscriptions by `user_id` only when `alert.targetUserId` is set.
For an untargeted alert it selects every row in `notify.push_subscriptions` and sends an OS-level
notification (title and body) to every installed PWA of every user. Producers that emit without a
target (agent `emit_alert`, analysis loops, ingest backfill auto-alert, Go services) therefore push
their content to all users' devices. Raising `notify.push.min_severity` reduces how often this happens but does not change the scoping.

## Expected
An untargeted alert skips Web Push, or only reaches an explicitly opted-in or admin audience. Device notifications should never be cross-user by default.

## Reproduction
1. Register push subscriptions for user A and user B (`RegisterPushSubscription` with each `x-user-id`).
2. `EmitAlert` with severity of at least WARNING and an empty `targetUserId`.
3. Both A's and B's devices receive the notification.

## Evidence
`services/xstockstrat-notify/src/fanout/webPush.ts:88`
> `      // Target by user (empty targetUserId = broadcast to every subscription). Reuse the injected`

`services/xstockstrat-notify/src/fanout/webPush.ts:99`
> `              'SELECT subscription_id, endpoint, p256dh, auth FROM notify.push_subscriptions',`

## Root cause hypothesis
The `StreamAlerts` in-app broadcast behaviour (empty target means everyone) was copied to a per-device channel that has a different privacy expectation.

## Confidence
low (the behaviour is confirmed; whether it is intended is still an open maintainer question)
