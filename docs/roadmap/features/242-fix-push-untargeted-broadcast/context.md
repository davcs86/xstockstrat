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

## Session 2026-10-20 — sdd-review product-spec (re-review)

- Re-review: PASS WITH WARNINGS (6 WARN, 4 NOTE; no FAIL, no Floor breach); overlap WARN, no FAIL. Status stays
  `spec-ready` (already advanced by the prior entry). Status History records `spec-ready` (unchanged), per the
  127/200 re-review rows, not a second `draft` → `spec-ready`.
- Both reviewers cited the pre-review triage text (`portfolio_service.go:894`, `:934-943`; no @AC-5..@AC-7), present
  only in `origin/ccr-f537be2d-6mwmqf`'s product-spec.md (`:18-19`). Several warnings were already fixed by the prior
  entry.
- Warnings (spec-reviewer) and disposition:
  1. C-15 coverage. (a) drawdown and (b) fundamentals-unavailable already covered by @AC-6 / @AC-7. (c) Shared givens
     were Feature-description prose; now explicit `Given` steps in @AC-1, @AC-2, @AC-5. No `Background:`: @AC-3/4/6/7
     are portfolio/analysis producer scenarios promoted to other service suites at launch (C-16).
  2. C-14 consumer surface. (1) Agent `emit_alert` `broadcast=true` (`services/xstockstrat-agent/app/tools.py:690-692`,
     `:699`; `docs/runbooks/mcp-tools.md:256`) now named in Consumer Surface; wording update in-feature (adds
     xstockstrat-agent) vs named follow-up left to /sdd-design. (2) "In-app ... unchanged" replaced: FR-3-targeted
     alerts leave non-owners' `ListAlerts` (`services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts:202`, `:210`)
     and `StreamAlerts` (`:274`), admins included; accepted under the operator decision (matches recon.md § Risks).
  3. FR-1 consequence for untargeted operator alerts: settled by the operator's admin audience. Consumer Surface now
     lists them as admin-only: trading systemic `trading.go:2183-2189`, marketdata `marketdata_service.go:1567`,
     ingest `servicer.py:473`, fundsignal `fundsignal_loop.py:618`. Trading per-account `:1938-1944`, `:2751-2757`
     stay open for /sdd-design (extend FR-3 or name a follow-up).
  4. Criterion 2 forks in FR text: already resolved by the prior entry (FR-1 admin-only, FR-3 scope fixed). Only the
     admin-role resolution mechanism in notify remains for design.
  5. Criteria 6/7/9: Fix Scope notify `004_*` line now cites F-01; config line now requires `notify.push.<key>` (C-05)
     registered in `docs/patterns/config-governance.md` (beside `:528`) and the notify `CLAUDE.md` table.
  6. C-01 stale lines: already corrected by the prior entry. FR-3 now states `emitRiskAlert(ctx, msg)` takes no
     owner (signature change).
  - NOTE criterion 1: Problem Statement now names the harmed persona (content owner).
  - NOTE C-16 / doc drift: Fix Scope names the notify `CLAUDE.md` Web Push paragraph and
    `services/xstockstrat-notify/docs/context-constitution-findings.md:38` as docs that change with the fix. Slack /
    SendGrid fanout (`src/fanout/fanout.ts`, no target filter) added to Out of Scope, flagged for design. design.md
    records the feature-165 FR-3 preserve/extend/change analysis and the operator sign-off.
  - NOTE trading-domain C-1..C-5 not triggered; remaining criteria pass.
- Overlap findings (feature-overlap, WARN):
  1. New: `215-block-fundamentals-strategy-on-etf` (in-progress), same function `_emit_fundamentals_unavailable_alert`
     (`services/xstockstrat-analysis/app/engine/live_loop.py:847-861`, already on trunk; 215 impl-spec `:1057`,
     `:1088` stale). Whichever merges second carries `target_user_id=definition.user_id` on that alert, or the
     broadcast returns. Re-scan at /sdd-spec.
  2. `244-fix-python-config-zero-trap` (draft): `live_loop.py:351`, disjoint; rebase-only.
  3. `240-offline-account-full-pnl`: already on main-dev; disjoint functions in `portfolio_service.go`; rebase-only.
  4. `251-fix-getpnl-source-service`: same-function on `emitRiskAlert` only if 251's design touches it (251 cites
     stale `:943`/`:958`). Re-scan at /sdd-spec.
  - Clean: config keys (243 claims config `031`, trunk tip `030`), notify migrations (`000`-`003`, next `004`), proto.
    No merge-order.md row required (no FAIL).
- Next: `/sdd-design fix-push-untargeted-broadcast` (full — operator: no quick designs). recon.md (Phase 0) is on
  the branch; Phase 1 debate next.

### Operator decisions

OPERATOR DECISIONS (binding, recorded 2026-10-20):
- Standing authorization: designs run in FULL mode only (no quick designs for automated fixes); the orchestrator auto-approves the design gate once rounds >= 2, no unresolved Floor (F-*) breach remains, no blocking objection remains, and every CHANGE to an existing @AC business rule is covered by an operator decision below.
- Untargeted alerts (empty target_user_id) Web-Push ONLY to users holding the admin role — operator sign-off for the C-16 CHANGE reversing feature 165 FR-3 broadcast; the pinned test webPush.test.ts AC-4 broadcast case is rewritten deliberately.
- Per-user producers (portfolio emitRiskAlert, analysis live_loop strategy/fundamentals alerts) set target_user_id to the owning user.
