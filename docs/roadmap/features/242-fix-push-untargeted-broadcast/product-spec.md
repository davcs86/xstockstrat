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
(`services/xstockstrat-portfolio/internal/service/portfolio_service.go:1004-1018`, `EmitAlertRequest` at
`:1008-1014` without `TargetUserId`), called from per-user `checkRiskLimits` (`:964`, invoked `:375`) for
concentration (`:991`) and per-account drawdown (`:999`); and the analysis live loop
(`services/xstockstrat-analysis/app/engine/live_loop.py`: `_emit_alert` `:824-845`, EmitAlert `:834`;
`_emit_fundamentals_unavailable_alert` `:847-861`, EmitAlert `:850`; owner-scoped strategies, owner =
`definition.user_id`). Trading also emits per-account CRITICAL alerts untargeted: reconciliation mismatch
(`services/xstockstrat-trading/internal/service/trading.go:1938-1944`) and account halt (`:2751-2757`).
Raising `notify.push.min_severity` reduces frequency but not scoping.

**Expected.** An untargeted alert is Web-Pushed only to subscriptions of users holding the admin role (operator
decision 2026-10-20). Device notifications never reach a non-admin user other than the alert's target. In-process
`StreamAlerts` broadcast semantics are unchanged.

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

FR-1. Web Push for an alert with empty `target_user_id` sends only to subscriptions of users holding the admin role (operator decision 2026-10-20); a non-admin user's subscriptions receive none. How notify resolves the admin role is a design question.
FR-2. A targeted alert pushes only to the target user's subscriptions (unchanged; regression guard).
FR-3. Per-user producers set `target_user_id` to the content owner: portfolio `emitRiskAlert` on both paths (concentration `:991`, drawdown `:999`; owner = `checkRiskLimits` `userID`) and analysis live-loop `_emit_alert` and `_emit_fundamentals_unavailable_alert` (owner = `definition.user_id`).

## Fix Scope

- [x] No proto changes anticipated (`EmitAlertRequest.target_user_id` already exists; `Alert.target_user_id` comment "empty = broadcast" at `notify.proto:45` describes StreamAlerts and stays)
- [ ] DB migration possible: only if design persists the admin audience on `notify.push_subscriptions`; it would be the next notify migration `004_<desc>.up.sql` + `.down.sql` (current max `services/xstockstrat-notify/migrations/003_alert_reads.up.sql`), run in notify's normal `scripts/db-migrate.sh` order
- [ ] Config key possible: only if design adds an audience toggle under `notify.push.*`; a seeded key takes the next free `services/xstockstrat-config/migrations/` NNN after those claimed by 243 (031) and 241, checked across remote branches at /sdd-spec; owner + config team approval
- [x] Behaviour change to feature 165 FR-3 (operator sign-off 2026-10-20); unit test `webPush.test.ts:147` (AC-4 broadcast) rewritten deliberately

## Consumer Surface(s)

- PWA device notifications (`/trader`, `/insights`, `/config-ui` installs): untargeted alerts stop reaching every non-admin device, the content owner's own device included; admin-role users' devices still receive them. FR-3 producers reach their owner's devices by targeting.
- Trading's untargeted per-account alerts (`trading.go:1938-1944`, `:2751-2757`) reach admin devices only after FR-1; the account owner loses the push for their own halt unless /sdd-design extends FR-3 to them (owner resolvable from `accountID`) or names a follow-up feature.
- In-app alert stream / history: unchanged (StreamAlerts broadcast kept)

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- `StreamAlerts` / alert-history broadcast visibility (`services/xstockstrat-notify/acceptance/alert-read-unread-persistence.feature:14`)
- Auditing other untargeted producers (agent `emit_alert`, ingest backfill, Go services) for per-user content beyond FR-3; trading's halt/reconciliation alerts are the exception, decided at /sdd-design (extend FR-3 or name a follow-up)
- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
