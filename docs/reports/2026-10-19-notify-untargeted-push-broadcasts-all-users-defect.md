# Defect: Untargeted alert sends a Web Push to every user's devices

**Recorded**: 2026-10-19
**Severity**: SEV-2
**Impact type**: cross-user-notification-leak
**Environment**: dev (main-dev) @ 1302e6d
**Affected service(s)**: xstockstrat-notify, xstockstrat-portfolio, xstockstrat-analysis
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
Feature 165 FR-3 deliberately copied the `StreamAlerts` broadcast semantics (empty target means everyone) into the per-device push channel (`git show 519e730:docs/roadmap/features/165-pwa-notifications/product-spec.md`: "a broadcast alert with empty `target_user_id` goes to all subscriptions"), without weighing the different privacy expectation of OS-level notifications. Producers that build per-user content never set `target_user_id`: portfolio `emitRiskAlert` (`services/xstockstrat-portfolio/internal/service/portfolio_service.go:937`, called from the per-user `checkRiskLimits`) and the analysis live loop (`services/xstockstrat-analysis/app/engine/live_loop.py:834` and `:850`, for owner-scoped strategies), both at WARNING. A fix in notify must also change the AC-4 test `services/xstockstrat-notify/src/__tests__/webPush.test.ts:147`, which currently asserts the broadcast.

## Confidence
high. The behaviour was reproduced by a unit-level scratch test: one untargeted WARNING alert made 4 `sendNotification` calls across 3 users, and a targeted control reached only its own user. It is reachable in practice through portfolio `emitRiskAlert` and analysis `live_loop` (per-user content, WARNING, no target). The broadcast was intended by feature 165 FR-3 (`519e730` product-spec.md) and is pinned by `webPush.test.ts:147`, but its per-device privacy impact was never considered.
