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

## Session 2026-10-21 — sdd-design

- Phase 0 Recon: recon.md was already on the branch (services: notify, portfolio, analysis). Key reuse: the
  injected-pool audience query inside the `webPush.ts:116-118` catch-all; trading's `TargetUserId` precedent
  (`trading.go:3348`). Added the `@AC-10 @FR-10 @feature-183` PRESERVE row this session.
- Persistence (P-04/P-05), stated plainly: rounds r1-r4 were carried in-band only, in each round's synthesis, with
  no on-disk checkpoint. An r4 claim of an intact checkpoint at `seeds/242/state-r3.json` was false; that file never
  existed. No decision was lost, because each synthesis carried the full prior state forward, but none was durable
  until r5. This entry and design.md are the first durable record.
- Phase 1 Grilling: 5 rounds (full). Auto-approved under the operator standing authorization (`:75`, `:129`):
  rounds 5 >= 2, no Floor breach, no blocking objection, and the only CHANGE is operator-covered.
  - Chosen approach: a live, uncached identity `ListAdminUserIds` RPC. It is SAN-gated (`xstockstrat-notify`)
    and header-blind. Notify's single-flight `AdminDirectory` relays the trio. The untargeted branch selects
    `WHERE user_id = ANY($1::text[])`. Portfolio and live-loop producers set `target_user_id` to the owner.
  - Rejected: a register-time admin bit (stale on demotion), a TTL cache, ledger-event sets, a cross-schema
    read, a config list, loosening `adminGate` or minting scope, reusing `ListUsers`, a SAN+`x-internal-caller`
    gate, trace-only forwarding with a C-03 exception, and ERROR only on codes 7/12/13. The full list is in
    design.md § Rejected Alternatives.
  - Per-round decisions:
    - r1-r2: fork (b), a new narrow SAN-gated RPC.
    - r3-r4: the module shape with no relative imports; test matrix (i)-(vii); real-socket case on the
      generated descriptor; `PRIVATE_DOMAIN` env; @AC-8..11 numbering.
    - r5: C-03 closed by trio forwarding; trio-safety rationale corrected to "the RPC is header-blind"
      (EmitAlert is unauthenticated, `notifyServiceImpl.test.ts:219-224`), with case (vi-b) added; escalation
      widened to any lookup failure, rate-limited to once per 60s; the `md?.get?.(h)?.[0]` idiom
      (`notifyServiceImpl.ts:232`); `header-propagation.md` added to the same-PR docs.
- Pre-gate amendments made this session, all in-feature:
  - product-spec: FR-4 added; Affected Services gain identity and agent; the proto box reflects the additive RPC
    (P-03).
  - recon.md: the `@AC-10 @feature-183` PRESERVE row.
  - acceptance.feature: @AC-8..@AC-11 minted from the feature branch (which held @AC-1..7).
- Constitution rules touched: C-03, C-16, C-15, C-09, C-08, P-06, P-02/P-04/P-05, C-10, C-01/P-03, C-11, C-14,
  C-18, F-04, F-06, F-07. Floor breaches: none.
- Status: spec-ready → design-approved.

### Decisions

- The admin audience is a live identity lookup through `ListAdminUserIds`, gated on the mTLS SAN only. There is
  no migration and no config key.
- The C-03 trio is relayed in full. The relay is safe only because the receiving RPC ignores all headers.
- Trading's per-account CRITICAL alerts (`trading.go:1938-1944`, `:2751-2757`) are not targeted in this
  feature. They go to a C-14 follow-up.
- The agent `emit_alert` wording is updated in-feature (`tools.py:690-699`, `mcp-tools.md:256`).

### Open Threads

- [ ] Silent fail-closed admin-push outage (SAN, endpoint or identity drift). Mitigations: rate-limited ERROR,
  a startup ERROR, the real-socket test, `PRIVATE_DOMAIN`, and a NON-WAIVABLE dev launch gate (an admin device
  receives an untargeted WARNING push; a non-admin device does not). Target: the notify and env steps, plus
  the launch smoke test.
- [ ] Header-blindness is the only guard on the relayed trio. Target: the identity step (cases vi/vi-b and the
  constraint comment).
- [ ] Load on identity's direct pool (max 2) from untargeted bursts. Target: the notify step (single-flight),
  then watch in dev.
- [ ] Single-flight joiners lose trace correlation (accepted). Target: the notify step, noted in the PR body.
- [ ] Acceptance-ID collision from a stale checkout. Target: /sdd-spec, minting only from the feature branch.
- [ ] Strip-types load evidence for the guarded `identityServiceImpl.test.ts` on Node 24. Target: the identity
  test step (P-06).
- [ ] Canonical `user_id` form match between `push_subscriptions` and `identity.users`. Target: the notify step.
- [ ] Empty-owner producers degrade silently to an admin-only push. Target: the portfolio and analysis steps.
- [ ] Merge-order coupling with 215 and the open `emitRiskAlert` concentration defect. Target: the /sdd-spec
  overlap re-scan.
- [ ] Trading halt and reconciliation alerts are admin-only until the follow-up ships. Target: before merge,
  file the defect report with a `.status` sidecar and record a follow-up slug or operator sign-off (C-14).
- [ ] Scope growth: 5 services plus agent wording, a proto RPC, a new edge, 3 env specs and 4+ docs. Target:
  /sdd-spec step sizing, plus identity-owner proto approval.
- [ ] Two Node test runners (`fails.md:2239-2241`). Target: the identity and notify test steps (both suites,
  both `tsc` builds).

### Operator decisions

OPERATOR DECISIONS (binding, recorded 2026-10-21):
- Standing authorization: designs run in FULL mode only (no quick designs for automated fixes); the orchestrator auto-approves the design gate once rounds >= 2, no unresolved Floor (F-*) breach remains, no blocking objection remains, and every CHANGE to an existing @AC business rule is covered by an operator decision below.
- Untargeted alerts (empty target_user_id) Web-Push ONLY to users holding the admin role — operator sign-off for the C-16 CHANGE reversing feature 165 FR-3 broadcast; the pinned test webPush.test.ts AC-4 broadcast case is rewritten deliberately.
- Per-user producers (portfolio emitRiskAlert, analysis live_loop strategy/fundamentals alerts) set target_user_id to the owning user.

## Session 2026-10-21 — sdd-spec

- Generated implementation-spec.md with 15 steps. Status → implementation-ready.
- Governance reads: root `CLAUDE.md`, `docs/sdd/constitution.md`, ledger (fails.md:116-125, :531-534,
  :2224-2245; insights.md:459-473, :2144-2151), `docs/runbooks/reviewer-registry.md`,
  `docs/runbooks/proto-versioning.md`, phase3/4/6 deviation notes (no relevant deviation).
- Design consumed as mandatory: Chosen Approach build order (`design.md:22-23`); Rejected Alternatives
  excluded; recon.md Patterns to REUSE cited per step. No migration, no config key.
- Key codebase findings (beyond recon.md):
  - Identity: `IdentityServiceImpl` is registered via the generated `IdentityServiceService`
    (`services/xstockstrat-identity/src/index.ts:50-53`), so a delegate method suffices; `index.ts` unchanged.
    Admin predicate at `identityServiceImpl.ts:851` (also `:893`). Identity tests run strip-types and are
    excluded from `tsc` (`tsconfig.json` exclude); generated-stub test import precedent `identityServiceImpl.test.ts:229`.
  - Notify: `tsconfig.json` includes tests, so a required 3rd `AdminDirectory` constructor arg forces every
    existing `new StubbedDispatcher(...)` in `webPush.test.ts` (`:110`..`:201`) to pass a stub (Step 8). No
    log-capture precedent in notify tests; the rate-limited ERROR is verified through a `protected
    logAdminLookupError` seam, same rationale as `deliver` (`webPush.ts:121-122`).
  - Env: `IDENTITY_ENDPOINT` absent from notify blocks; insert after `LEDGER_ENDPOINT`
    (`docker-compose.yml:231`, `.do/app.yaml:521`, `.do/app.dev.yaml:518`); DO form
    `${xstockstrat-identity.PRIVATE_DOMAIN}:50058` (`.do/app.yaml:264-265`).
  - Canonical `user_id`: JWT `user_id` (`identityServiceImpl.ts:167`) → `x-user-id`
    (`services/xstockstrat-ui/src/lib/bffShared.ts:39`) → register (`notifyServiceImpl.ts:232`); matches
    `user_id::text`. No normalization needed.
  - Portfolio: `expectDrawdowns` hard-codes `"u1"` (`portfolio_quote_deadline_test.go:367-373`); the AC-6 test
    inlines its own `account_balances` expectation for `user-42` instead of changing the shared helper.
  - Overlap re-scan: only 215 (`_emit_fundamentals_unavailable_alert`) among non-terminal features; the branch
    has no diff vs `origin/main-dev` on any touched file.
- C-14 follow-up slug named for Step 15: `fix-trading-account-alert-targeting`.
- Non-waivable dev launch gate carried into the spec (§ Launch gate).

### Decisions

- Notify is split into AdminDirectory client + env (Steps 5-6) and dispatcher audience (Steps 7-8).
- `createAdminDirectory(endpoint = process.env.IDENTITY_ENDPOINT, client?)`: optional client injection for the
  single-flight/deadline unit tests. The on-the-wire trio test lives in notify `mtls.test.ts` to reuse its PKI
  helpers (no duplicate `mintPki`).
- Agent wording is a `docs` step (docstring only, `design.md:218`); reviewers none per the matrix.

### Open Threads

- [x] Canonical `user_id` form match: closed at spec level (evidence above).
- [x] Merge-order coupling re-scan: done; 215 only (spec § Step Dependencies).
- [ ] Remaining design Open Threads carry to /sdd-execute at the steps named in the spec.

## Session 2026-10-21 — sdd-review impl-spec (advisory)

- Result: 0 failures, 12 warnings, 0 floor breaches; overlap WARN, no FAIL (advisory — did not block).
  Status stays `implementation-ready`. Every claim re-verified against the tree before editing.
- Addressed in implementation-spec.md (Total Steps 15 → 16):
  - [x] Step 2 **Files** names exact generated files (go `identity.pb.go`/`identity_grpc.pb.go`; python
    `identity_pb2.py`/`identity_pb2_grpc.py`/`__init__.py`; ts `identity.ts`/`identity_pb.ts`/`identity_connect.ts`;
    `gen/ts/dist/identity/v1/identity{,_pb}.{js,d.ts}`, `.gitignore:27`). Evidence lines fixed to
    `scripts/buf-gen.sh:41` (breaking, gated by `:38`) and `:48` (generate) (C-01/F-08).
  - [x] Steps 4, 6, 8 Verification state `≥ 40% lines (c8 --lines 40, package.json:13)` (C-08).
  - [x] Step 13 adds `docs/runbooks/mcp-tools.md:246` (emit_alert intro "system-wide broadcast") to evidence and
    instructions (C-01).
  - [x] Step 6 missing-endpoint case calls `createAdminDirectory('')`; `undefined` would hit the
    `process.env.IDENTITY_ENDPOINT` default.
  - [x] Steps 5, 10, 13 Verification: service commands in subshells, greps repo-root-relative; Step 5 env check
    scoped to the notify block via awk (prints 1 per file); Step 10 uses `export GOWORK=off` (ci.yml:256-257 form).
  - [x] Step 14 split (7 files → Step 14 platform docs, 4 files; Step 15 service docs, 5 files). Step 15 adds
    `services/xstockstrat-notify/docs/context-constitution.md` (`:37` pointer, new audience rule) and
    `services/xstockstrat-identity/docs/context-constitution.md` (SAN-only RPC vs IDENTITY-5 `:22`; IDENTITY-3 `:20`
    exception). Identity CLAUDE.md "eleven methods" replaced by an uncounted phrase (proto has 21 RPCs; rest stays
    with `docs/reports/2026-10-19-identity-claude-md-drift-defect.md`). Teardown runs once in Step 15 for both steps.
  - [x] C-14: no-UI-step note mirrored in ## Step Dependencies (`PushToggle.tsx:80`; no stale copy in
    `PushToggle.tsx`/`AlertInbox.tsx`). Follow-up slug `fix-trading-account-alert-targeting` marked provisional
    (NNN from /sdd-triage); old Step 15 → Step 16.
  - [x] F-07: `ADMIN_LOOKUP_ERROR_INTERVAL_MS` step text now carries the F-07 rationale; not a Floor breach, so the
    `design.md:284` config-key fallback is not taken.
  - [x] Step 4 evidence: `identityServiceImpl.test.ts:229` `.js` specifier marked do-not-copy (exports
    `"./*": "./dist/*.js"`, `packages/proto/gen/ts/package.json:5-6` → `identity.js.js`).
  - [x] Step 8 evidence: constructor sites `webPush.test.ts:113,123,132,150,160,171,184`; `ExposedDispatcher` `:203`
    also needs the 3rd arg (instruction added).
  - [x] Step 1 buf breaking now against `$(git rev-parse --path-format=absolute --git-common-dir)#branch=main-dev,subdir=packages/proto`
    (worktree-safe; matches `scripts/buf-gen.sh:37-41`).
  - [x] Overlap 252 (identity runner / `mtls.test.ts`) and the notify/identity CLAUDE.md drift defects recorded
    in ## Step Dependencies.
- Open Threads (still open; announce at every /sdd-execute checkpoint, P-03):
  - [ ] Step 1: buf breaking needs a local `refs/heads/main-dev`. A detached worktree may lack it; create it
    only where no other worktree holds `main-dev`.
  - [ ] Step 11 vs `215-block-fundamentals-strategy-on-etf` (in-progress): same function
    `_emit_fundamentals_unavailable_alert` (`live_loop.py:847-861`). Second to merge keeps
    `target_user_id=definition.user_id`. Soft merge-order row (Resolved=No) recommended; not written
    (`merge-order.md` is outside this session's write scope). Operator to decide.
  - [ ] Step 4 vs `252-fix-identity-ledger-test-suites` (draft): may change the identity runner and
    `mtls.test.ts`. Second to land re-verifies the strip-types static-import posture. Soft merge-order row
    recommended, not written.
  - [ ] Step 5 vs `084-droplet-compose-deploy` (spec-ready): `docker-compose.yml` / `.do/app.dev.yaml` edits.
    Product-level only; rebase-only.
  - [ ] Steps 9-10 vs 240 (on main-dev) and `251-fix-getpnl-source-service` (draft) in `portfolio_service.go`:
    disjoint hunks, rebase-only.
  - [ ] Step 13 vs 215/240 in `app/tools.py` and `docs/runbooks/mcp-tools.md`: docstring/section-disjoint,
    rebase-only.
  - [ ] Re-run Mode B overlap once 241/243-252 reach `implementation-ready` (this scan saw them only at
    product-spec/context depth).

## Session 2026-10-28 — sdd-execute re-spec (§5.3, post main-dev merge)

- Branch setup: detached checkout of `origin/feature/fix-push-untargeted-broadcast`, `git merge -X ours origin/main-dev`
  (merge commit `90ad4051`), pushed.
- Re-specced step bodies only (Instructions / Codebase Evidence / Files / Verification) to the current tree:
  - Step 3: identity anchors moved +4 by the refresh-token fix (`5bd271d8`): admin predicate `:855` (copy `:897`),
    `adminGate` `:739-749`, error echo `:788` (15 occurrences), `setUserActive` `:882`, class closes `:935`;
    `bffShared.ts:40` is `[HEADER_USER_ID]: claims.user_id`.
  - Step 8: unauthenticated-caller pin is comment `:219-225` + `it(...)` `:226`.
  - Step 10: AC3/AC9 funcs at `:441`/`:461`. C-13 premise restated — `"user-42"`/`"acct-1"` already appear inline as
    scenario sentinels in other portfolio tests; verification grep scoped to `portfolio_quote_deadline_test.go`.
  - Step 11: `fundsignal_loop._emit_warning` now `:642` (callers `:283`, `:632`).
  - Step 14: `inter-service-mtls.md` is 90 lines (still no peer-SAN section).
  - Step 16: systemic escalation alert `trading.go:2183-2189` (system-wide, `reconciliation`) named explicitly as
    out of scope — admin-only is intended; not to be confused with the per-account alert `:1938-1944`.
- No scope, step count, or @AC coverage change.

## Session 2026-10-28 — sdd-execute sequential (sdd-batch-execute)

- Status `implementation-ready` → `in-progress`.
- Up-front confirmation (sequential mode entry): the plan was approved under the operator's standing authorization
  (operator chat 2026-10-28, session_01NpS3HShZK6pSnogA7CFo2f: "Start executing features 241-276" via batch-execute).
  Answers recorded: checkpoints unattended (checkpoint mode `report`); C-16 promotion auto-confirmed unless it
  changes an existing @AC rule; merge-train authorized; 255/275 deferred; operator-only DB/prod steps — open the
  integration PR, hold the merge.
- Note: this feature's C-16 promotion CHANGES an existing rule (feature-165 FR-3 broadcast, `design.md:290`), so the
  auto-confirm does not apply to it; that CHANGE is covered by the binding operator decision recorded 2026-10-21
  (§ Operator decisions, sdd-design session).
- Open Threads from the impl-spec review session remain open (announce at each checkpoint, P-03).

## Session 2026-10-28 — sdd-execute sequential, Step 1 (proto)

- Step 1 done: `packages/proto/identity/v1/identity.proto` gains `rpc ListAdminUserIds(ListAdminUserIdsRequest)
  returns (ListAdminUserIdsResponse)` after `SetUserActive` (2-line SAN-only constraint comment) and the two messages
  appended after `SetUserActiveResponse` (`repeated string user_ids = 1`). No other proto change.
- TDD: N/A (proto, non-code-bearing). Verification: `buf lint` exit 0; `buf breaking` exit 0 against both local
  `main-dev` (0fc13c41) and `origin/main-dev` (fa40c8a4), via archive extracts (Deviation Log: the guard refused
  the `<git-common-dir>#branch=` form). Open Thread "Step 1 needs local refs/heads/main-dev" is resolved: it exists.
- Stubs not regenerated here; Step 2 owns them, so `proto-freshness` is red on this branch until Step 2 commits.
- C-09 reminder: identity-owner proto approval must be recorded in this file before Step 2 commits; not yet recorded.

## Session 2026-10-29 — sdd-execute sequential, C-09 identity-owner proto approval

- C-09 identity-owner approval recorded (operator, acting as `xstockstrat-identity` owner, 2026-10-29): "identity
  owner approves additive ListAdminUserIds, 2026-10-29". Scope: `rpc ListAdminUserIds`, `ListAdminUserIdsRequest {}`,
  `ListAdminUserIdsResponse { repeated string user_ids = 1; }` — additive only. Resolves the Step 2 blocker
  (Option A); Step 2 may commit.

## Session 2026-10-29 — sdd-execute sequential, Step 2 (proto-gen)

- Step 2 done: `./scripts/buf-gen.sh` regenerated the identity stubs (Go `identity.pb.go`, `identity_grpc.pb.go`,
  `identityv1connect/identity.connect.go`; Python `identity_pb2.py`, `identity_pb2_grpc.py`; TS `identity.ts`,
  `identity_pb.ts`, `identity_connect.ts` + `dist/identity/v1/*`). `IdentityServiceService.listAdminUserIds` and
  `IdentityServiceClient.listAdminUserIds` now exist for Steps 3 and 5.
- TDD: N/A (generated code). RED: `grep -rl ListAdminUserIds packages/proto/gen/` -> 0 files. GREEN: 12 files.
  Verification: non-identity gen drift empty; second `buf-gen.sh` run after staging -> `git diff --exit-code
  packages/proto/gen/` exit 0. `buf lint` + `buf breaking` (vs `main-dev` extract) exit 0.
- Toolchain parity (Deviation Log): Go plugins rebuilt with `GOTOOLCHAIN=go1.27.0` because the provisioned go1.24.7
  build reflowed a comment in `analysis.pb.go`; `pnpm install --frozen-lockfile` so `tsc` is the lockfile's 5.9.3.

## Session 2026-10-29 — sdd-execute sequential, Step 3 (identity handler)

- Step 3 done. Created `services/xstockstrat-identity/src/grpc/adminDirectory.ts`. It imports only `@grpc/grpc-js`
  and `type { Pool }` from `pg`, opens with the 2-line constraint comment, and keeps module-private
  `ADMIN_DIRECTORY_PEER_SANS = ['xstockstrat-notify']`, the verbatim `peerDnsSans` copy (C-18 runtime copy #2),
  exact-match `hasAdminDirectoryPeer` and `PEER_SAN_ERROR`. The exported `listAdminUserIds(pool, call, callback)`
  denies with PERMISSION_DENIED before touching the pool. It queries `user_id::text` for
  `is_active = true AND 'admin' = ANY(roles)`, returns `{ userIds }` only, and on throw returns a generic INTERNAL
  `admin directory lookup failed` without the thrown text.
- `identityServiceImpl.ts` gains only the import beside `./ledgerAudit` and the `listAdminUserIds` delegate at the
  end of the class. `adminGate`, `authz.ts` and `index.ts` are unchanged (`git diff --stat` is empty).
- TDD (scratch suite mirroring Step 4 (i)-(vii), uncommitted; Step 4 owns the committed tests). AC-9/AC-10 red:
  `ERR_MODULE_NOT_FOUND ... src/grpc/adminDirectory.ts` → green: `tests 7, pass 7, fail 0`.
- Verification:
  - `pnpm run build`: exit 0.
  - `pnpm run lint`: exit 0, 0 errors.
  - `prettier --check src/grpc/adminDirectory.ts`: clean.
  - Imports grep: exactly the 2 allowed.
  - Header grep: only the comment line matches.
  - Existing identity suite: `pnpm test` gives 78 pass, 0 fail.
- Toolchain: Node v24.20.0, pnpm 9.15.9, `pnpm install --frozen-lockfile` at the worktree root.
- Deviation Log entry added for formatting and TDD mechanics; there is no behaviour deviation.
- Still pending: the Step 15 docs note (the `grpc.status` use is a second IDENTITY-3 exception).

## Session 2026-10-29 — sdd-execute sequential, Step 4 (identity tests)

- Step 4 done. Created `services/xstockstrat-identity/src/__tests__/adminDirectory.test.ts`: static import of
  `../grpc/adminDirectory.ts` (no skip guard), a harness `typeof` case, and cases (i)-(vii) with an inline fake
  pool and `callWith` helper. (i) and (vi-b) are `@AC-9`; (ii)-(vi) are `@AC-10` and assert zero queries; (vii) is
  untagged.
- `mtls.test.ts`: `mintPki` mints an `xstockstrat-notify` leaf (`notifyCert`/`notifyKey`). A new `describe` serves
  the generated `IdentityServiceService` with `mtls.serverCredentials()` and dials with `IdentityServiceClient` +
  `mtls.targetOverride(SVC)`. The `xstockstrat-client` leaf gets PERMISSION_DENIED with zero pool queries (AC-10).
  The `xstockstrat-notify` leaf gets `['user-99']` (AC-9). Proto import has no `.js` suffix.
- TDD (P-06). AC-9/AC-10 red: with `src/grpc/adminDirectory.ts` moved aside, both files fail with
  `ERR_MODULE_NOT_FOUND ... src/grpc/adminDirectory.ts`. Green: 9 + 2 new cases pass. Identity suite went from
  78 to 89 pass, with 0 fail and 0 skipped.
- Verification:
  - `node --version`: v24.20.0.
  - `pnpm run test:coverage`: exit 0, all files 98.64% lines, threshold 40.
  - `pnpm run build`: exit 0.
  - `pnpm run lint`: 0 errors, 186 warnings. These are the same pre-existing warnings recorded at Step 3, none new.
  - `@AC-9`/`@AC-10` grep: hits in both files.
  - `__tests__/fixtures` grep: none.
- P-06 load check (Instruction 5) finds the guarded suite is vacuous on Node 24.20.0. Under
  `--experimental-strip-types`:
  - `import('./src/grpc/identityServiceImpl.ts')` throws `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` (parameter property).
  - `import('./src/grpc/identityServiceImpl.js')` throws `ERR_MODULE_NOT_FOUND`.
  - As a result, `identityServiceImpl.test.ts`'s `before()` try/catch swallows the failure.
  - Its `IdentityServiceImpl`/`authz`-dependent cases return early. The suite reports 70 pass while executing none
    of those assertions.
  - `fails.md:2222` claims Node 24 handles both; that claim is false. It is corrected by an appended ledger entry.
- Out of scope (pre-existing defect, not fixed here): the vacuous `identityServiceImpl.test.ts`, which CI also runs
  on Node 24. This means the Step 3 `listAdminUserIds` delegate in `identityServiceImpl.ts` has no executing test.
  The handler itself is covered directly. Hand this to `/sdd-qa defect`.


## Session 2026-10-29 — sdd-execute sequential, Step 5 (notify AdminDirectory client + env wiring)

- Step 5 done. Created `services/xstockstrat-notify/src/services/adminDirectory.ts`: `AdminDirectory`,
  `ADMIN_LOOKUP_DEADLINE_MS = 2000` (F-07 mechanism constant), module-private `PROPAGATED_HEADERS`, `AdminLookupClient`
  (`Pick<IdentityServiceClient, 'listAdminUserIds'>`) and `createAdminDirectory(endpoint = process.env.IDENTITY_ENDPOINT,
  client?)`. Unset endpoint with no client logs ERROR once and returns a directory that rejects `IDENTITY_ENDPOINT unset`
  (no default host). Otherwise one long-lived client (`mtls.clientCredentials()` + `targetOverride('xstockstrat-identity')`);
  calls are single-flight (slot cleared in `finally`, no TTL cache), relay the trio via `md?.get?.(h)?.[0]`, and pass only
  `{ deadline }` (no `waitForReady`). `index.ts` untouched (Step 7 wires it).
- `IDENTITY_ENDPOINT` added after `LEDGER_ENDPOINT` in the notify block of `docker-compose.yml`
  (`xstockstrat-identity:50058`) and `.do/app.yaml` / `.do/app.dev.yaml` (`${xstockstrat-identity.PRIVATE_DOMAIN}:50058`).
  `WAIT_FOR` and `depends_on` unchanged.
- TDD (P-06), uncommitted scratch suite mirroring Step 6 (Step 6 owns the committed tests). Red:
  `tsc` → `TS2307: Cannot find module '../services/adminDirectory.js'` → green: `tests 5, pass 5, fail 0`.
- Verification:
  - `pnpm run build`: exit 0.
  - `pnpm run lint`: 0 errors (211 pre-existing warnings); `eslint src/services/adminDirectory.ts` clean; prettier-clean.
  - Notify-block `IDENTITY_ENDPOINT` counts: compose 1, `.do/app.yaml` 1, `.do/app.dev.yaml` 1.
  - Trio grep hits `:11` and `:44`; `waitForReady` / default-host grep: none; `src/middleware`: absent.
  - Existing notify suite: `pnpm test` gives 70 pass, 0 fail, 0 skipped.
- Toolchain: Node v24.20.0, pnpm 9.15.9, `pnpm install --frozen-lockfile` at the worktree root.

## Session 2026-10-29 — sdd-execute sequential, Step 6 (notify AdminDirectory tests)

- Step 6 done.
  - Created `services/xstockstrat-notify/src/__tests__/adminDirectory.test.ts`. It uses a static import, a harness
    assertion, and an inline fake `AdminLookupClient` (single consumer, C-13). Its cases are:
    - `@AC-8` freshness (two lookups → two client calls, `['user-99']` then `[]`);
    - single-flight (one call for two concurrent callers, the same array; a new call after settle);
    - deadline within `ADMIN_LOOKUP_DEADLINE_MS` and no `waitForReady`;
    - trio-only relay;
    - `@AC-11` UNAVAILABLE rejects and clears the slot;
    - get-less or `undefined` metadata;
    - `@AC-11` `createAdminDirectory('')` rejects `IDENTITY_ENDPOINT unset`.
  - `mtls.test.ts` gains an `xstockstrat-identity` leaf in `mintPki` and a new describe. It serves the generated
    `IdentityServiceService` over `mtls.serverCredentials()` and dials it through `createAdminDirectory('127.0.0.1:<port>')`
    with the notify-side client leaf. The trio arrives on the wire, and the result is `['user-99']`.
- TDD (P-06). AC-8/AC-11 red. Moving `adminDirectory.ts` aside gives `TS2307`. A mutation (single-flight removed +
  `waitForReady` added) gives `tests 79, pass 77, fail 2`. Green: `tests 79, pass 79, fail 0, skipped 0`. The restored
  file is byte-identical.
- Verification:
  - `pnpm run test:coverage`: exit 0, all files 90.39% lines, threshold 40.
  - `pnpm run lint`: 0 errors (211 pre-existing warnings); eslint on both touched files is clean.
  - `@AC-8` / `@AC-11` grep: hits at `:54`, `:117`, `:142`.
  - `__tests__/fixtures` grep: none.
- Deviation Log: test mechanics only (see implementation-spec.md). No out-of-scope changes.

## Session 2026-10-29 — sdd-execute sequential, Steps 7 + 8 (notify admin push audience + tests)

- Operator decision (binding, 2026-10-29), Option B on the Step 7 blocker: Steps 7 and 8 merge into ONE commit with
  one red→green cycle on Step 8's tests, and both are marked done. Step 7's required 3rd constructor argument breaks
  `tsc` on every existing test site until Step 8 lands. This is recorded in the Deviation Log.
- Step 7 done:
  - `webPush.ts`: constructor `(pool, config, admins: AdminDirectory, now = Date.now)`; `dispatch(alert, md?)`.
  - The targeted SQL and params are unchanged.
  - The untargeted branch calls `admins.listAdminUserIds(md)`. An empty list returns with no query. Otherwise it
    runs `SELECT … WHERE user_id = ANY($1::text[])`.
  - A lookup failure of any code calls `reportAdminLookupError`, which logs one ERROR per 60s through the protected
    `logAdminLookupError` seam (`ADMIN_LOOKUP_ERROR_INTERVAL_MS`, F-07 constant). It then returns without pushing.
  - The VAPID and severity gates still run before the lookup. Other push errors stay WARN. Comments `:29` and the
    branch comment are rewritten.
  - `notifyServiceImpl.ts`: `dispatch(alert, call.metadata)`; nothing else changes.
  - `index.ts`: `new WebPushDispatcher(pool, configWatcher, createAdminDirectory())`.
- Step 8 done:
  - `webPush.test.ts` adds the inline `stubAdmins`, `sqlPool` (an unfiltered SELECT throws), `GIVENS` and `RISK`
    helpers (C-13, single consumer).
  - The feature-165 "broadcast queries all subscriptions" case is replaced by `@AC-5` (admin only, `ANY` params
    `[['user-99']]`), `@AC-1` (no non-admin endpoint) and an empty-list case (no query).
  - The targeted case gains `@AC-2`: exactly `/one` and `/two`, and admins are not called.
  - It adds `@AC-8` (re-resolved per alert), `@AC-11` for codes 14 and 13 and for the 60s clock window (0/30s/59s →
    1, 60s → 2), a gates-before-lookup case, and md pass-through.
  - `notifyServiceImpl.test.ts`: `recordingWebPush` records the 2nd argument, and an `@AC-1` EmitAlert case checks
    that an `alertId` comes back, the subscriber receives 1, and push receives `(alert, md)`.
  - The `:219-226` pin and the push-isolation case are unchanged and green.
- TDD (P-06). RED: `tsc` reports TS2554 ×17, and the emitted `dist` gives `tests 61, pass 53, fail 8`. GREEN:
  `tests 88, pass 88, fail 0, skipped 0`.
- Verification:
  - `pnpm run test:coverage`: exit 0, 90.56% lines, `webPush.js` 95.68%.
  - `pnpm run build`: exit 0.
  - `pnpm run lint`: 0 errors, 233 warnings, all `no-explicit-any`.
  - The unfiltered-SELECT grep finds nothing. `WHERE user_id = $1` is at `:101` and `ANY($1::text[])` at `:116`.
  - `dispatch(alert, call.metadata)` is at `:109`.
  - The old broadcast test title is gone.
  - `@AC-*` greps: 7 hits in webPush and 1 in notifyServiceImpl. The fixtures grep finds nothing.
- Files modified: `services/xstockstrat-notify/src/fanout/webPush.ts`, `src/grpc/notifyServiceImpl.ts`, `src/index.ts`,
  `src/__tests__/webPush.test.ts`, `src/__tests__/notifyServiceImpl.test.ts`.
- Out of scope: none. The notify `CLAUDE.md` Web Push paragraph still says empty target ⇒ broadcast. Step 15 owns
  that doc fix.

## Session 2026-10-29 — sdd-execute sequential, Step 9 (portfolio risk alerts target the owner)

- Step 9 done. In `services/xstockstrat-portfolio/internal/service/portfolio_service.go`, `emitRiskAlert` is now
  `(ctx, userID, msg string)` and sets `TargetUserId: userID`. Both call sites in `checkRiskLimits` (concentration
  and drawdown) pass the `checkRiskLimits` owner. The ledger event is unchanged. There is no empty-owner guard
  (`design.md:262`).
- TDD (P-06), on an uncommitted scratch test that Step 10 replaces. RED: `want 1 risk alert targeted at u1, got
  [... category:"risk" ... source_service:"portfolio"]` (no `target_user_id`). GREEN: `--- PASS`. Existing
  `TestCheckRiskLimits_AC3`/`_AC9` still pass.
- Verification: `GOWORK=off go build ./...` OK. `golangci-lint run` reports `0 issues.` using a go1.27 rebuild of
  v2.14.0, because the provisioned binary is go1.26 (see the Deviation Log). `go test ./internal/service/...` ok.
  The greps find `TargetUserId:  userID` at `:1014` and the 2 call sites at `:991` and `:999`.
- Files modified: `services/xstockstrat-portfolio/internal/service/portfolio_service.go`.
- Out of scope: none. The trading precedent citation is `trading.go:3347`, not `:3348` (citation drift only).

## Session 2026-10-29 — sdd-execute sequential, Step 10 (portfolio owner-targeting tests)

- Step 10 done. In `portfolio_quote_deadline_test.go`, `recordingNotify` also records each request in `reqs`.
  `TestCheckRiskLimits_AC3_SumsAcrossAccounts` asserts each alert has target `u1`, category `risk` and severity
  WARNING. `TestCheckRiskLimits_AC9_...` asserts its drawdown alert targets `u1`. The new
  `TestCheckRiskLimits_242_AC6_DrawdownTargetsOwner` (owner `user-42`, account `acct-1`, 8500/10000) asserts exactly
  one alert with the 15.0% drawdown body, category `risk`, severity WARNING and target `user-42`. `expectDrawdowns`
  is unchanged.
- TDD: RED ran against the pre-Step-9 `portfolio_service.go`, swapped in and then restored. AC-3 red: `target=""
  ... want target u1`. AC-9 red: `drawdown alert TargetUserId = "", want u1`. AC-6 red: `target="", want ... user-42`.
  GREEN: all 3 tests `--- PASS`.
- Verification: the `-run TestCheckRiskLimits` tests pass. The full race suite passes with coverage `total: 68.6%`
  (threshold 40%). golangci-lint (go1.27 rebuild of v2.14.0) reports `0 issues.` All 3 `"user-42"` hits in this file
  are inside the new test (C-13 inline sentinel).
- Files modified: `services/xstockstrat-portfolio/internal/service/portfolio_quote_deadline_test.go`.
- Out of scope: none.

## Session 2026-10-29 — sdd-execute sequential, Step 11 (analysis live-loop alerts target the owner)

- Step 11 done. In `services/xstockstrat-analysis/app/engine/live_loop.py`, both `EmitAlertRequest` builders
  (`_emit_alert`, `_emit_fundamentals_unavailable_alert`) now set `target_user_id=definition.user_id` (`:844`, `:861`).
  Titles, bodies, tags and dedup are unchanged. `fundsignal_loop._emit_warning` is untouched and stays a broadcast.
- TDD (P-06), on an uncommitted scratch test that Step 12 replaces. RED: `assert '' == 'user-42'` (trigger) and
  `assert '' == 'u1'` (fundamentals-unavailable). GREEN: both pass; `tests/test_live_loop.py` still passes.
- Verification: `ruff check .` all passed; `ruff format --check .` 113 files already formatted; the grep finds 2
  `target_user_id=definition.user_id` hits; `fundsignal_loop.py` has no `target_user_id`.
- Files modified: `services/xstockstrat-analysis/app/engine/live_loop.py`.
- Out of scope: none.

## Session 2026-10-29 — sdd-execute sequential, Step 12 (analysis owner-targeting tests)

- Step 12 done. `services/xstockstrat-analysis/tests/test_live_loop.py` gains
  `test_242_ac4_trigger_alert_targets_owner` (`@AC-4`, owner `user-42`, title `Strategy strat-1 entry on AAPL`) and
  `test_242_ac7_fundamentals_alert_targets_owner` (`@AC-7`, owner `user-42`, title
  `Strategy strat-2: fundamentals unavailable for MSFT`); `test_ac6_ac5_denied_three_cycles_one_warn_one_alert` now
  also asserts `target_user_id == "u1"` (still exactly one alert). Ids are inline scenario sentinels (C-13).
- TDD (P-06). RED against the pre-Step-11 `live_loop.py` (`330afc77~1`, swapped in and restored): 3 failed,
  `assert '' == 'user-42'` ×2 and `assert '' == 'u1'`. GREEN: `-k "242 or ac6_ac5"` 3 passed.
- Verification: full suite 1302 passed, coverage 88.60% (≥ 40%); `ruff check .` all passed; `ruff format --check .`
  113 files already formatted; the conftest grep shows only the pre-existing `from tests.conftest` imports.
- Files modified: `services/xstockstrat-analysis/tests/test_live_loop.py`.
- Out of scope: none.

## Session 2026-10-29 — sdd-execute sequential, Step 13 (agent emit_alert broadcast wording)

- Step 13 done. The `emit_alert` docstring `broadcast` param (`services/xstockstrat-agent/app/tools.py`) and
  `docs/runbooks/mcp-tools.md` (intro `:246`, `broadcast` row `:256`) now say a broadcast's in-app stream/history
  reaches every user while its Web Push device notification reaches admin-role users only (feature 242). The code
  line `target_user_id = "" if broadcast else ...` is unchanged.
- TDD: N/A (docstring/docs wording only, `design.md:218`).
- Verification: agent `ruff check .` all passed; `ruff format --check .` 58 files formatted; `tests/test_tools.py
  tests/test_tools_endpoint.py` 121 passed (after `uv sync --extra dev --frozen`); the admin+push grep hits
  `tools.py:694`, `mcp-tools.md:246`, `:256`.
- Files modified: `services/xstockstrat-agent/app/tools.py`, `docs/runbooks/mcp-tools.md`.
- Out of scope: none.

## Session 2026-10-29 — sdd-execute sequential, Step 14 (platform docs)

- Step 14 done. Edits:
  - Root `CLAUDE.md` § Header Propagation now names identity (ledgerAudit) and notify (notify → identity
    `ListAdminUserIds`, `adminDirectory.ts`) as the Node outbound per-request callers. Each forwards the trio through
    an inline `PROPAGATED_HEADERS` const. No "recorded exception" was added, and the feature-224 exception text is
    unchanged.
  - The dependency diagram gains `xstockstrat-notify → xstockstrat-identity (ListAdminUserIds, untargeted push
    audience)`.
  - PLAT-4 (`docs/context-constitution.md:38`) gets the same correction plus the evidence
    `adminDirectory.ts#PROPAGATED_HEADERS` (~L11, loop ~L43).
  - `docs/patterns/header-propagation.md`: the false "none currently does" is replaced by explicit inbound-metadata
    threading as an accepted Node form, with identity and notify as references. A notify → identity bullet
    (header-blind, SAN-gated) is added under "Request-scoped outbound edges".
  - `docs/patterns/inter-service-mtls.md` gains a "Peer-SAN authorization" section. It lists config `GetSecret` ←
    ingest, identity `ListAdminUserIds` ← notify, and the feature-224 ingest/indicators `system` grants ← analysis.
    That last one is a deviation, recorded in the spec Deviation Log.
- TDD: N/A (docs). Pre-edit: greps 2 and 3 showed no `ListAdminUserIds` hits and `none currently does` at `:124`.
  Post-edit: grep 1 hits `CLAUDE.md:327` (new edge), grep 2 hits all three docs, grep 3 finds nothing.
- Files modified: `CLAUDE.md`, `docs/context-constitution.md`, `docs/patterns/header-propagation.md`,
  `docs/patterns/inter-service-mtls.md`.
- Out of scope: none. Teardown (`/context-forge:context-constitution refresh`) for these files is owned by Step 15
  instruction 6.

## Session 2026-10-29 — sdd-execute sequential, Step 15 (service docs + Teardown)

- Step 15 done. Steps 3, 5 and 7 were confirmed on `origin/feature/fix-push-untargeted-broadcast` (`345195fe`,
  `918eb5e7`, `ea99d6e0`) before any docs were edited. The discovery digest's "not found" items came from a stale
  main-worktree checkout.
- Edits:
  - Notify `CLAUDE.md` gains a Dependencies row for `xstockstrat-identity` (`ListAdminUserIds`). The Web Push
    paragraph now says untargeted pushes reach admin-role users only, through a live, uncached lookup
    (single-flight, 2s deadline, trio relayed); on lookup failure the push is skipped, with an ERROR at most once
    per 60s. It also adds `IDENTITY_ENDPOINT` to the env block.
  - Notify constitution: new NOTIFY-8. The untargeted audience is admins only, the lookup is live and uncached,
    and on failure the push is skipped, never widened. A TTL cache or an all-subscriptions fallback reopens
    defect 242. The Pointers mTLS row now lists the `targetOverride('xstockstrat-identity')` dial and
    `adminDirectory.ts#PROPAGATED_HEADERS`. The drifted `webPush.ts` hints are re-stamped.
  - Notify findings: the ⚠ broadcast bullet moves to `## Resolved` as "resolved by feature 242 (admin-only
    untargeted audience)".
  - Identity `CLAUDE.md`: "all eleven methods" becomes "every `IdentityService` method, including:" (no count).
    A new sentence names `ListAdminUserIds` (SAN `xstockstrat-notify` only, header-blind, IDENTITY-12).
    Dependencies are unchanged.
  - Identity constitution: new IDENTITY-12. `ListAdminUserIds` checks only the exact SAN, ignores headers and is
    not `adminGate`d; adding `adminGate` or a header read breaks notify. IDENTITY-3 now names `adminDirectory.ts`
    as a second `status`-enum site beside `authz.ts`.
- Teardown (Steps 14 and 15): `/context-forge:context-constitution` is **unavailable** in this session, so it was
  done by hand.
  - Re-read every touched context file against the code:
    - root `CLAUDE.md` § Header Propagation and the diagram;
    - PLAT-4;
    - `header-propagation.md` (`ledgerAudit.ts:14,40-44`, `adminDirectory.ts:11,42-46` both resolve);
    - `inter-service-mtls.md` Peer-SAN section (config `authz.ts:124` ingest `peerSan` +
      `mcp_credential.` prefix; ingest `_SYSTEM_GRANT_SAN`, indicators `_ANALYSIS_SAN` resolve);
    - the five Step 15 files.
  - Grounded drift fixed: the notify `webPush.ts` line hints (see spec Deviation Log Step 15 (b)). No other
    grounded drift was found in the touched lines.
  - **Open item:** the integration PR body must record "context-forge plugin unavailable" plus this manual
    reconciliation.
- TDD: N/A (docs). Before the edits: grep 1 found no `ListAdminUserIds` hit, grep 2 hit notify `CLAUDE.md:90`,
  grep 3 hit identity `CLAUDE.md:26`, and grep 4 found nothing. After the edits: grep 1 hits all four files,
  greps 2 and 3 find nothing, and grep 4 hits findings `:41`. Prettier: lint-staged scopes formatting to
  `xstockstrat-ui` only, so the `.md` files are not prettier-gated (the constitution tables were already non-prettier
  at HEAD).
- Files modified: `services/xstockstrat-notify/CLAUDE.md`, `services/xstockstrat-notify/docs/context-constitution.md`,
  `services/xstockstrat-notify/docs/context-constitution-findings.md`, `services/xstockstrat-identity/CLAUDE.md`,
  `services/xstockstrat-identity/docs/context-constitution.md`.
- Out of scope: the notify `CLAUDE.md` banner drift ("config-as-startup-gate-only", "fictional ledger dep") and the
  rest of the stale identity method list stay with the open defects `2026-10-19-notify-claude-md-drift-defect` and
  `2026-10-19-identity-claude-md-drift-defect`.

## Session 2026-10-29 — sdd-execute sequential, Step 16 (C-14 follow-up for trading per-account alerts)

- Step 16 done. Filed `docs/reports/2026-10-21-trading-untargeted-per-account-alerts-defect.md` (SEV-2,
  `xstockstrat-trading`) and its sidecar `.status` (`open`). The report covers the two per-account CRITICAL
  alerts without `TargetUserId`: the reconciliation mismatch alert in `emitReconciliationFinding`
  (`trading.go:1938-1944`) and the halt alert in `haltAccount` (`trading.go:2751-2757`). The owner is resolvable
  from `accountID` through `trading.broker_accounts.user_id` (`BrokerAccountRecord.UserID`). The systemic
  escalation alert (`trading.go:2183-2189`) is explicitly out of scope: it is system-wide, so admin-only delivery
  is intended.
- **C-14 follow-up (required before the integration PR merges, `design.md:207-212`):** provisional slug
  `fix-trading-account-alert-targeting`. Its `NNN` is assigned by `/sdd-triage`; route it with
  `/sdd-triage --from-report docs/reports/2026-10-21-trading-untargeted-per-account-alerts-defect.md`. An operator
  sign-off recorded here is the alternative. FR-3 is not extended to trading in this feature.
- TDD: N/A (docs). Before: the Verification `ls` exited 2 (both files missing). After: both files exist, the
  sidecar reads `open`, the defect-filing greps print exactly one `SEV-2` token and the `**Severity**` line.
- Files modified: `docs/reports/2026-10-21-trading-untargeted-per-account-alerts-defect.md`,
  `docs/reports/2026-10-21-trading-untargeted-per-account-alerts-defect.status`, this `context.md`.
- Out of scope: the trading code change itself (owned by the follow-up).
