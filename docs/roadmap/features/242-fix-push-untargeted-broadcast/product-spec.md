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
Raising `notify.push.min_severity` reduces frequency but not scoping. Who is harmed: the content owner (the user whose
account breaches a risk limit, or whose live strategy fires) has that content shown on every other user's installed PWA.

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
- xstockstrat-identity (new SAN-gated `ListAdminUserIds` RPC; added at /sdd-design 2026-10-21, design.md)
- xstockstrat-agent (`emit_alert` `broadcast=true` wording only, `app/tools.py:690-699`; added at /sdd-design 2026-10-21)

## Functional Requirements

FR-1. Web Push for an alert with empty `target_user_id` sends only to subscriptions of users holding the admin role (operator decision 2026-10-20); a non-admin user's subscriptions receive none. How notify resolves the admin role is a design question.
FR-2. A targeted alert pushes only to the target user's subscriptions (unchanged; regression guard).
FR-3. Per-user producers set `target_user_id` to the content owner: portfolio `emitRiskAlert` on both paths (concentration `:991`, drawdown `:999`; owner = `checkRiskLimits` `userID`; `emitRiskAlert(ctx, msg)` takes no owner today) and analysis live-loop `_emit_alert` and `_emit_fundamentals_unavailable_alert` (owner = `definition.user_id`).
FR-4. Notify resolves the admin audience through a live, uncached identity RPC `ListAdminUserIds` (additive, `packages/proto/identity/v1/identity.proto` beside `ListUsers` `:41`), gated on the mTLS peer SAN `xstockstrat-notify` only and header-blind; it returns active admin user IDs only (amended at /sdd-design 2026-10-21, P-03; design.md).

## Fix Scope

- [x] Proto change (amended 2026-10-21, FR-4): additive `IdentityService.ListAdminUserIds` in `packages/proto/identity/v1/identity.proto`; buf lint/breaking + `./scripts/buf-gen.sh`, identity-owner approval (C-09). Notify proto unchanged (`EmitAlertRequest.target_user_id` exists; `Alert.target_user_id` "empty = broadcast" at `notify.proto:45` describes StreamAlerts and stays)
- [ ] DB migration: none (design chose the live identity lookup, 2026-10-21). Superseded conditional: only if design persists the admin audience on `notify.push_subscriptions`; it would be the next notify migration `004_<desc>.up.sql` + `.down.sql` (current max `services/xstockstrat-notify/migrations/003_alert_reads.up.sql`), run in notify's normal `scripts/db-migrate.sh` order; an applied migration is never edited (F-01)
- [ ] Config key: none (`ADMIN_LOOKUP_DEADLINE_MS` is a mechanism constant, design.md F-07). Superseded conditional: only if design adds an audience toggle, named `notify.push.<key>` (C-05) and registered in `docs/patterns/config-governance.md` (beside `notify.push.min_severity`, `:528`) and the notify `CLAUDE.md` config table; a seeded key takes the next free `services/xstockstrat-config/migrations/` NNN after those claimed by 243 (031) and 241, checked across remote branches at /sdd-spec; owner + config team approval
- [x] Behaviour change to feature 165 FR-3 (operator sign-off 2026-10-20); unit test `webPush.test.ts:147` (AC-4 broadcast) rewritten deliberately
- [x] Docs that describe the broadcast change with the fix: the Web Push paragraph in `services/xstockstrat-notify/CLAUDE.md` ("empty ⇒ broadcast to all subscriptions") and the open bullet `services/xstockstrat-notify/docs/context-constitution-findings.md:38`

## Consumer Surface(s)

- PWA device notifications (`/trader`, `/insights`, `/config-ui` installs): untargeted alerts stop reaching every non-admin device, the content owner's own device included; admin-role users' devices still receive them. FR-3 producers reach their owner's devices by targeting.
- Untargeted operator alerts reach admin-role devices only; non-admin users stop receiving them (accepted under the operator decision): trading systemic REDUCE_ONLY (`trading.go:2183-2189`), marketdata feed error (`services/xstockstrat-marketdata/internal/service/marketdata_service.go:1567`), ingest backfill (`services/xstockstrat-ingest/app/handlers/servicer.py:473`), analysis fundsignal `_emit_warning` (`services/xstockstrat-analysis/app/engine/fundsignal_loop.py:618`).
- Trading's untargeted per-account alerts (`trading.go:1938-1944`, `:2751-2757`) reach admin devices only after FR-1; the account owner loses the push for their own halt unless /sdd-design extends FR-3 to them (owner resolvable from `accountID`) or names a follow-up feature.
- Agent MCP tool `emit_alert`: `broadcast=true` sends `target_user_id=""` (`services/xstockstrat-agent/app/tools.py:690-692`, `:699`), so after FR-1 it pushes to admin devices only. Its "system-wide broadcast" wording there and in `docs/runbooks/mcp-tools.md:256` stays true for the in-app stream but not for push; /sdd-design either updates that wording in this feature (adding xstockstrat-agent) or names a follow-up.
- In-app alert stream / history: untargeted alerts keep the StreamAlerts / ListAlerts broadcast. FR-3-targeted portfolio and live-loop alerts leave every non-owner's in-app view, admins included (`ListAlerts` filter `services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts:202`, `:210`; `StreamAlerts` `matchesSubscriber` `:274`). Accepted under the operator decision; not offset by a second untargeted copy.

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- `StreamAlerts` / alert-history broadcast visibility (`services/xstockstrat-notify/acceptance/alert-read-unread-persistence.feature:14`)
- Auditing other untargeted producers (agent `emit_alert`, ingest backfill, Go services) for per-user content beyond FR-3; trading's halt/reconciliation alerts are the exception, decided at /sdd-design (extend FR-3 or name a follow-up)
- Slack / SendGrid fanout audience (feature 020, `services/xstockstrat-notify/src/fanout/fanout.ts`): it posts qualifying alerts to one shared operator channel regardless of `target_user_id`; flagged for /sdd-design, not changed here
- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
