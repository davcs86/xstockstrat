# Product Spec: fix-push-untargeted-broadcast

**Type**: bug
**GitHub Issue**: none. Defect report: `docs/reports/2026-10-19-notify-untargeted-push-broadcasts-all-users-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-20

---

## Problem Statement

**Observed.** `WebPushDispatcher.dispatch` filters subscriptions by `user_id` only when `alert.targetUserId` is
set. For an untargeted alert it selects every row of `notify.push_subscriptions`
(`services/xstockstrat-notify/src/fanout/webPush.ts:88`, `:99`) and sends an OS-level notification (title and
body) to every installed PWA of every user. Producers that emit without a target (agent `emit_alert`, analysis
loops, ingest backfill auto-alert, Go services) push their content to all users' devices. Two of them carry
per-user content at WARNING: portfolio `emitRiskAlert`
(`services/xstockstrat-portfolio/internal/service/portfolio_service.go:934-943`, called from per-user
`checkRiskLimits` `:894`) and the analysis live loop (`services/xstockstrat-analysis/app/engine/live_loop.py:834`,
`:850`, owner-scoped strategies). Raising `notify.push.min_severity` reduces frequency but not scoping.

**Expected.** An untargeted alert skips Web Push, or reaches only an explicitly opted-in or admin audience. Device
notifications are never cross-user by default. In-process `StreamAlerts` broadcast semantics are unchanged.

## Reproduction Steps

1. Register push subscriptions for user A and user B (`RegisterPushSubscription` with each `x-user-id`).
2. `EmitAlert` with severity ≥ WARNING and an empty `target_user_id`.
3. Both A's and B's devices receive the notification.

## Root Cause Hypothesis

Feature 165 FR-3 deliberately copied the `StreamAlerts` broadcast rule (empty target = everyone) into the
per-device push channel (`git show 519e730:docs/roadmap/features/165-pwa-notifications/product-spec.md`) without
weighing OS-level notification privacy. The broadcast is pinned by the unit test
`services/xstockstrat-notify/src/__tests__/webPush.test.ts:147` ("AC-4: broadcast … queries all subscriptions").
Per-user producers never set `target_user_id` (field 6 of `EmitAlertRequest`, `packages/proto/notify/v1/notify.proto:71`).

## Affected Services

- xstockstrat-notify (push audience selection in `webPush.ts`)
- xstockstrat-portfolio (`emitRiskAlert` omits `TargetUserId` although `checkRiskLimits` has `userID`)
- xstockstrat-analysis (live-loop strategy alerts omit `target_user_id` for owner-scoped strategies)

## Functional Requirements

FR-1. Web Push for an alert with empty `target_user_id` sends to no subscription by default (opt-in/admin audience is a design fork).
FR-2. A targeted alert pushes only to the target user's subscriptions (unchanged; regression guard).
FR-3. Per-user producers set `target_user_id` to the content owner: portfolio risk alerts and analysis live-loop alerts for owner-scoped strategies (scope confirmed at design).

## Fix Scope

- [x] No proto changes anticipated (`EmitAlertRequest.target_user_id` already exists; `Alert.target_user_id` comment "empty = broadcast" at `notify.proto:45` describes StreamAlerts and stays)
- [ ] DB migration possible: only if design adds an opt-in/admin broadcast audience column on `notify.push_subscriptions`
- [ ] Config key possible: only if design adds a broadcast-audience toggle (e.g. under `notify.push.*`); none if untargeted push is simply skipped
- [x] Behaviour change to feature 165 FR-3; unit test `webPush.test.ts:147` (AC-4 broadcast) rewritten deliberately

## Consumer Surface(s)

- PWA device notifications (`/trader`, `/insights`, `/config-ui` installs): untargeted alerts stop appearing on other users' devices
- In-app alert stream / history: unchanged (StreamAlerts broadcast kept)

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- `StreamAlerts` / alert-history broadcast visibility (`services/xstockstrat-notify/acceptance/alert-read-unread-persistence.feature:14`)
- Auditing every other untargeted producer (agent `emit_alert`, ingest backfill, Go services) for per-user content beyond FR-3's two
- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
