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
