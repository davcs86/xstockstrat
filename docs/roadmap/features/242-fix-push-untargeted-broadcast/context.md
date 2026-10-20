# Context Log: fix-push-untargeted-broadcast

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-20 (/sdd-triage)

- Bug recorded as defect report `docs/reports/2026-10-19-notify-untargeted-push-broadcasts-all-users-defect.md`
  (Issues disabled): untargeted alert sends a Web Push to every user's devices.
- Severity: SEV-2. Environment: dev (main-dev) @ 1302e6d. Config-only fix: no. Routed to SDD path (Track C).
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1..AC-4), context.md.
- Affected services (from report): xstockstrat-notify, xstockstrat-portfolio, xstockstrat-analysis.
- Root cause hypothesis: feature 165 FR-3 copied StreamAlerts' empty-target-means-everyone rule into Web Push
  (`webPush.ts:88-101`); per-user producers (portfolio `emitRiskAlert` `portfolio_service.go:934`, analysis
  `live_loop.py:834,850`) never set `target_user_id`.
- Confirmation evidence (report, confidence high): a unit-level scratch test made 4 `sendNotification` calls across
  3 users for one untargeted WARNING alert; a targeted control reached only its own user. Triage re-grep
  2026-10-20 confirmed `webPush.ts:88,99`, `webPush.test.ts:147`, `portfolio_service.go:894,934-943`
  (`checkRiskLimits` has `userID`; `EmitAlertRequest` built without `TargetUserId`).
- **Changes feature 165 FR-3 behaviour.** The pinned unit test `services/xstockstrat-notify/src/__tests__/webPush.test.ts:147`
  ("AC-4: broadcast (empty targetUserId) queries all subscriptions") asserts the bug and must be rewritten
  deliberately as this feature's red test, not "fixed to pass".
- C-16 check: grep of `services/xstockstrat-notify/acceptance/` for `broadcast|target_user_id|untargeted`.
  `pwa-notifications.feature` (promoted from 165) carries **no** broadcast scenario; its `@AC-4 @FR-3 @feature-165`
  is the targeted case and stays valid. So this is **not** a C-16 CHANGE; this feature's scenarios are a C-16 ADD at
  launch. `alert-read-unread-persistence.feature:14` has a broadcast scenario for read state (StreamAlerts/history),
  not push, so it is unaffected.
- Design forks for /sdd-design: (a) skip untargeted push vs opt-in/admin audience (latter may need a column and/or
  config key); (b) whether producer targeting (FR-3, AC-3/AC-4) is in this feature or split; (c) other untargeted
  producers (agent `emit_alert`, ingest backfill auto-alert, Go services) audited for per-user content.
- Recommended design depth: full → `/sdd-design fix-push-untargeted-broadcast` (rationale: SEV-2; 3 affected
  services; reverses a launched feature's FR; possible migration/config if an opt-in audience is chosen).
- Development branch: feature/fix-push-untargeted-broadcast

## Session 2026-10-20 — sdd-review product-spec

- Product spec approved (PASS WITH WARNINGS; overlap WARN, no FAIL, no floor breach). Status: draft → spec-ready.
- Warnings (spec-reviewer):
  1. C-01 stale portfolio lines. Corrected in product-spec.md: `emitRiskAlert` `portfolio_service.go:1004-1018`
     (`EmitAlertRequest` `:1008-1014`), `checkRiskLimits` `:964` (invoked `:375`), concentration emit `:991`,
     drawdown emit `:999`. Supersedes the triage entry's `:894,934-943` (lines from 1302e6d, pre-feature-240).
  2. C-15 @AC-1 left the audience fork open. Shared givens now state neither user-42 nor user-77 is admin and add
     admin user-99 (`https://push.example/admin`); @AC-1 retitled to non-admin devices; new @AC-5 pins the admin
     push; @AC-2 also asserts no push to the admin endpoint.
  3. C-15 FR-3 partly covered. Added @AC-6 (drawdown path, `:999`, body from `evaluateDrawdowns`
     `portfolio_service.go:956-958`) and @AC-7 (`_emit_fundamentals_unavailable_alert` `live_loop.py:847-861`,
     called `:727`). FR-3 now names both portfolio paths and both analysis emitters.
  4. C-14/C-10 Consumer Surface understated. Now states untargeted push stops on every non-admin device, the
     owner's included. Trading's untargeted per-account CRITICAL alerts (`trading.go:1938-1944` reconciliation,
     `:2751-2757` halt) named in Problem Statement, Consumer Surface and Out of Scope; systemic REDUCE_ONLY alert
     (`trading.go:2183-2189`) reaches admin devices under the operator's admin audience. Open for /sdd-design:
     extend FR-3 to trading (owner from `accountID`) or name a follow-up feature.
  5. C-07 conditional migration. Fix Scope now commits to notify `004_<desc>.up.sql` + `.down.sql` (max
     `003_alert_reads`) if design persists the admin audience on `notify.push_subscriptions`.
  - Not evaluable by reviewer: feature-165 FR-3 quote via `git show 519e730:...` (product-spec.md pruned from tree).
- Overlap findings (feature-overlap, WARN):
  1. `services/xstockstrat-portfolio/internal/service/portfolio_service.go` shared with 251-fix-getpnl-source-service
     (GetPnL `:753`, `:798`); ~250 lines apart; 251 excludes emitRiskAlert. Rebase-only, no hard order.
  2. `services/xstockstrat-analysis/app/engine/live_loop.py` shared conditionally with 244-fix-python-config-zero-trap
     (`:351`; 244's primary site is `app/config/watcher.py:97,105,134`). Disjoint regions, rebase-only.
  3. Conditional config migration: 243-fix-sandbox-seed-keys claims config `031`; 241 may add one. A seeded
     `notify.push.*` key takes the next free NNN after both, checked across remote branches at /sdd-spec
     (recorded in product-spec.md Fix Scope). Notify migrations dir untouched by any other feature.
- C-16 note: triage classed this a C-16 ADD (no durable broadcast scenario in
  `services/xstockstrat-notify/acceptance/pwa-notifications.feature`); the operator decision below treats the
  feature-165 FR-3 reversal as a signed-off C-16 CHANGE. Either reading is covered.
- Product spec FR-1 / Expected rewritten to the operator's admin-only audience; FR-3 scope fixed per operator
  decision ("scope confirmed at design" removed). Admin-role resolution mechanism in notify left to /sdd-design.
- Next: `/sdd-design fix-push-untargeted-broadcast` (full — operator: no quick designs).

### Operator decisions

OPERATOR DECISIONS (binding, recorded 2026-10-20):
- Standing authorization: designs run in FULL mode only (no quick designs for automated fixes); the orchestrator auto-approves the design gate once rounds >= 2, no unresolved Floor (F-*) breach remains, no blocking objection remains, and every CHANGE to an existing @AC business rule is covered by an operator decision below.
- Untargeted alerts (empty target_user_id) Web-Push ONLY to users holding the admin role — operator sign-off for the C-16 CHANGE reversing feature 165 FR-3 broadcast; the pinned test webPush.test.ts AC-4 broadcast case is rewritten deliberately.
- Per-user producers (portfolio emitRiskAlert, analysis live_loop strategy/fundamentals alerts) set target_user_id to the owning user.
