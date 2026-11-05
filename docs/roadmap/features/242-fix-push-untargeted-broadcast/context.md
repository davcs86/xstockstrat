# Context: fix-push-untargeted-broadcast  (archived 2026-11-04)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-11-04 — /sdd-archiver

**What**: SEV-2 bug fix. An alert with empty `target_user_id` was Web-Pushed to every row of `notify.push_subscriptions`
(feature 165 FR-3 copied StreamAlerts' "empty = everyone" rule into the per-device channel), so per-user content
(portfolio risk breaches, owner-scoped live-loop alerts) reached every user's devices. Shipped: untargeted pushes go only
to admin-role users, resolved per alert through a new identity RPC `ListAdminUserIds` (live, uncached, gated on the
mTLS peer SAN `xstockstrat-notify` only, header-blind); portfolio `emitRiskAlert` and the analysis live-loop strategy and
fundamentals-unavailable alerts now set `target_user_id` to the owner. 16 steps, 5 services touched (identity, notify,
portfolio, analysis, agent wording). Launched 2026-10-30 via PR #1368 (`df521ff5`).

**Why (irrecoverable rationale)**:
- "Admin-only" audience is an operator decision (context.md 2026-10-20, "Operator decisions"); no reason for choosing admins
  over skip-entirely is written in any source. The decision also carried the C-16 sign-off reversing 165 FR-3, whose
  broadcast was pinned only by the unit test `webPush.test.ts:147` ("AC-4 ... queries all subscriptions"), never by a
  durable `@AC` — so it was rewritten deliberately, not "fixed to pass".
- Live identity lookup (fork b) beat a register-time admin bit (fork a) because the bit goes stale on demotion or
  deactivation and would break the freshness rules of `@AC-4/5/11 @feature-043` (design.md Rejected Alternatives;
  recon.md Risks (a): the bit is captured only on the explicit Enable click, `enable` handler `PushToggle.tsx:64`, register call `:80`).
- Option (a) also lost on secondary grounds: pre-004 rows would need a fail-closed non-admin default, forcing admins to re-enable push; the role is per user not per device, so a column copies it onto every device row (recon.md:394-400; insights.md:3536-3539).- Config-only fix rejected: raising `notify.push.min_severity` reduces frequency, not scoping (product-spec.md:25; triage "Config-only fix: no", context.md:11).
- No `user_id` normalization was needed: design.md:261 left the canonical-form risk open; /sdd-spec closed it by tracing JWT `user_id` (`identityServiceImpl.ts:164` at HEAD; spec-time cite was `:167`) -> `x-user-id` (`bffShared.ts:39`) -> register (`notifyServiceImpl.ts:232`), which matches identity's `user_id::text` (`adminDirectory.ts:43`).
- The r5 persistence objection was rejected as BLOCKING (it would deadlock the gate whose output resolves it) and made a hard precondition on the status flip (design.md:248); see fails.md:2967-2968.
- No TTL cache, but single-flight: a cache keeps pushing to a demoted admin for the whole TTL; dropping single-flight would
  mean N lookups per untargeted burst against identity's 2-connection direct pool, shared with login/refresh.
- Failure mode is fail-closed by design: any lookup failure of any gRPC code skips the push (never widens to all rows) and
  logs ERROR rate-limited to once per 60 s. Codes 14/4 were deliberately included because they are the likeliest drift
  modes (design.md rejected "ERROR only on 7/12/13"). Codified as NOTIFY-8 / IDENTITY-12 (below).
- The RPC is SAN-only and header-blind because notify relays the inbound header trio (C-03 as written) and `EmitAlert` is an
  unauthenticated contract (`notifyServiceImpl.test.ts:219-224`): a relayed `x-access-scope` is safe only because the
  receiver ignores it. Pinned by test cases (vi)/(vi-b) (elevated scope on notify SAN gives an identical response).
- Producers that own per-user content were fixed at the source (FR-3) rather than offsetting with a second untargeted copy,
  which would break "exactly"/"only" in `@AC-3/@AC-9 @feature-231`, `@AC-6 @feature-215`, `@AC-2 @feature-203`.

**Rejected alternatives** (full list was design.md § Rejected Alternatives):
- Register-time admin bit / `notify 004` migration — stale on demotion or deactivation.
- 30-60 s TTL cache — demoted admin keeps receiving pushes for the TTL; single-flight gives burst relief without staleness.
- Admin set built from identity role-change ledger events — events are best-effort (auditSafe), eventually consistent, new consumer (YAGNI).
- `FilterAdminUserIds(candidate_ids)` — extra query and larger payload, no real exposure reduction.
- Notify reading `identity.users` directly — breaks schema ownership; `user_id` is UUID there vs TEXT in notify; grants unknown.
- Config-held admin list — second source of truth that drifts from identity roles.
- Loosen `adminGate`, or notify mints an admin `x-access-scope` — first is a CHANGE to `@AC-7 @feature-043`; second is the fails.md:531-534 trap.
- Reuse `ListUsers` with a header+SAN grant — over-discloses (emails, every user) and changes `@AC-7 @feature-043`.
- SAN plus `x-internal-caller` gate (config `authz.ts:149-162` shape) — any mTLS peer can forge the header, adds nothing over a verified SAN.
- Forward only the trace header with a C-03 exception, or forward the trio minus `x-access-scope` — both violate C-03 as written; unnecessary because the RPC ignores headers.
- Justify the relay as "trusted mTLS-authenticated producer values" — withdrawn as a reason (see Ledger fails entry, header).
- Drop single-flight; ERROR only on codes 7/12/13; N-consecutive-failure counter; `md?.get(h)[0]` read (throws on get-less metadata, swallowed by the catch-all).
- Revive `src/middleware/propagation.ts` / AsyncLocalStorage in notify — reverses `@AC-2 @feature-175`.
- Handler in `authz.ts`, or as an `IdentityServiceImpl` method behind the guarded lazy import — `before()` guard can pass with zero assertions.
- `typeof`-only identity test; real-socket case on the passthrough descriptor (`mtls.test.ts:73-81`, fails with INTERNAL) or none.
- Seed a config key for the lookup deadline (`ADMIN_LOOKUP_DEADLINE_MS = 2000` kept a mechanism constant, F-07); shared Node `peerDnsSans` package at runtime copy #2 (YAGNI).
- Bare `xstockstrat-identity:50058` in `.do/app*.yaml` — silent fail-closed outage; `${xstockstrat-identity.PRIVATE_DOMAIN}:50058` used.
- Extend FR-3 to trading per-account alerts in this feature — deferred (C-14 follow-up, below).
- Mint new scenarios as @AC-5..8 — the feature branch already held @AC-5..7; minted @AC-8..11 from the branch only.

**Scars & gotchas**:
- Design rounds r1-r4 were carried in-band only; an r4 claim of a checkpoint `seeds/242/state-r3.json` was false (never existed). No decision lost, but nothing durable until r5 (context.md 2026-10-21). Ledger: DUP (fails.md:2963).
- Two design rounds justified relaying `x-access-scope` as "mTLS-authenticated producers"; wrong (EmitAlert is unauthenticated). Corrected in r5. Ledger: DUP (fails.md:2952).
- Step 4 P-06 load check: on Node 24.20.0 the guarded `identityServiceImpl.test.ts` is vacuous (`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` on the parameter property; `.js` specifier gives `ERR_MODULE_NOT_FOUND`; `before()` try/catch swallows it; "70 pass" with none of the impl/authz cases executing). Consequence: the Step 3 `listAdminUserIds` delegate in `identityServiceImpl.ts` has no executing test; the handler itself is covered directly via `adminDirectory.test.ts` (static `.ts` import, no skip guard) and a real-socket `mtls.test.ts` case. Corrects fails.md 2026-09-06 claim. Ledger: DUP (fails.md:3099).
- Steps 7 and 8 could not land separately: the required 3rd `AdminDirectory` constructor arg breaks `tsc` (notify `tsconfig.json` includes tests) on every `new StubbedDispatcher(...)`/`ExposedDispatcher` site until Step 8. The /sdd-spec session had already noted this (context.md 2026-10-21 sdd-spec) yet kept two steps; operator chose Option B (one commit, one red->green on Step 8's tests). RED was `TS2554` x17, then `tests 61, pass 53, fail 8`; GREEN `88 pass`. Ledger: NEW.
- `buf breaking` form `--against "<git-common-dir>#branch=main-dev,subdir=packages/proto"` is refused by the worktree-isolation guard; used `git archive main-dev packages/proto` extracts (local main-dev 0fc13c41 and origin fa40c8a4, both exit 0).
- Codegen toolchain parity: provisioned Go plugins built with go1.24.7 reflowed an unrelated comment in `analysis.pb.go`; rebuilt all three at CI pins with `GOTOOLCHAIN=go1.27.0`. A global TypeScript 6.0.2 (TS5107) shadowed the lockfile's 5.9.3 until `pnpm install --frozen-lockfile`. Provisioned golangci-lint v2.14.0 was go1.26-built and refused the module's `go 1.27.0`; rebuilt with `GOTOOLCHAIN=go1.27.0`. Result: identity-only gen drift, second `buf-gen.sh` empty diff.
- Step 15: the discovery digest's "not found" items for Steps 3/5/7 came from a stale main-worktree checkout; they were on `origin/feature/...` (`345195fe`, `918eb5e7`, `ea99d6e0`). Same class as fails.md:3037 (stale read-only checkout in debate rounds).
- Step 14: spec said "two SAN-gated grants"; the tree has a third (feature 224 ingest/indicators `system` grants, peer SAN `xstockstrat-analysis`). `inter-service-mtls.md` "Peer-SAN authorization" lists all three. A discovery note claiming a second marketdata `peerSan` was wrong (config has exactly one `peerSan` grant, `authz.ts:124`, ingest).
- Step 15: after this feature changed `webPush.ts`, the notify constitution's `~L` hints had drifted 7-185 lines and were re-stamped; Teardown was done by hand because the context-forge `context-constitution` skill was unavailable (plugin-unavailable plus manual reconciliation had to go in the PR body).
- Branch setup used `git merge -X ours origin/main-dev` (merge commit `90ad4051`, 2026-10-28). Later found unsafe for shared append-only ledger docs; Ledger: DUP (fails.md:3086, sdd-batch-execute).
- Portfolio test: `expectDrawdowns` hard-codes `"u1"` (`portfolio_quote_deadline_test.go:367-373`); the `@AC-6` test inlines its own `account_balances` expectation for `user-42` rather than changing the shared helper.

**Permanent deviations**:
- Not a deviation but a design-accepted consequence a reader may take for a bug: trading's per-account CRITICAL halt/reconciliation alerts (`trading.go:1938-1944`, `:2751-2757`) reach admins only, so the owner loses them, because FR-3 was deliberately not extended to trading (design.md:212; C-14 follow-up below). The systemic escalation alert (`trading.go:2183-2189`) is system-wide, so admin-only is intended.
- impl-spec said Step 7 and Step 8 separate -> shipped as one commit -> because of the `tsc`-includes-tests compile break (see Scars). Deviation Log row "Steps 7 + 8" (implementation-spec.md:828-840).
- impl-spec said a `buf breaking` against `<git-common-dir>#branch=main-dev` -> shipped via `git archive` extracts -> guard refusal (Scars).
- Behavioural design vs shipped otherwise: none; every other Deviation Log row (Steps 1-6, 9-16) is mechanics/tooling/line-cite only.

**Cross-feature signal**:
- In-app change accepted: targeted FR-3 alerts leave every non-owner's `ListAlerts` (`notifyServiceImpl.ts:202`,`:210`) and `StreamAlerts` (`matchesSubscriber` `:273-276`), admins included.
- Narrowing the empty-target default silently reassigns every other untargeted producer to admin-only (trading systemic/per-account, marketdata `marketdata_service.go:1567`, ingest `servicer.py:473`, fundsignal `fundsignal_loop.py:618`, agent `emit_alert broadcast=true`). Surfaced only by review warnings, not by the original triage. Ledger: NEW (insight).
- Merge-order coupling named at review: 215 (`_emit_fundamentals_unavailable_alert`, same function), 252 (identity runner / `mtls.test.ts`), 251/240 (`portfolio_service.go`, disjoint). Soft `merge-order.md` rows were recommended but not written (outside session write scope); the operator's decision is not recorded.
- Same-helper collision: open defect `docs/reports/2026-10-19-portfolio-concentration-logged-as-drawdown-defect.md` (sidecar `open` as of 2026-11-04) touches `emitRiskAlert`'s ledger event, the helper FR-3 changed (recon.md:443-445); whichever merges second rebases and carries `target_user_id` (design.md:263).
- "Marketdata/ingest/fundsignal/agent are admin-only" above is an assumption that their content is system-wide, not an audit result: producers other than FR-3's were not audited for per-user content (product-spec.md:86, out of scope).
- Header-propagation: this feature made notify a second Node outbound per-request caller (after identity `ledgerAudit.ts`); PLAT-4, `header-propagation.md` and root CLAUDE.md corrected ("none currently does" was already false). Drift family of the 224 recorded exception.

**Deferred follow-ons**:
- C-14 follow-up: defect report `docs/reports/2026-10-21-trading-untargeted-per-account-alerts-defect.md`, sidecar `open` as of 2026-11-04; provisional slug `fix-trading-account-alert-targeting` (NNN not yet assigned; no such feature dir exists). feature.md Next Action required `/sdd-triage --from-report ...` before merge; no triage is recorded in context.md.
- Vacuous `identityServiceImpl.test.ts` on Node 24 (pre-existing): context.md Step 4 said "hand this to /sdd-qa defect"; no matching report found in `docs/reports/` by filename. Unrecorded whether filed.
- Empty-owner producers degrade silently to an admin-only push (no empty-owner guard in portfolio, design.md:262 / Step 9; analysis guard holds only when `portfolio_stub` is wired, `live_loop.py:520-522`, `:549-551`).
- Non-waivable dev launch gate (admin device receives an untargeted WARNING push; non-admin device does not): no execution evidence recorded in context.md.
- Watch identity's direct pool (max 2) under untargeted bursts; single-flight joiners lose trace correlation (accepted). No post-launch result recorded.
- Feature-020 Slack/SendGrid fanout still posts qualifying alerts to one shared operator channel regardless of `target_user_id` (product-spec.md:87); deliberately unchanged (design.md:299 PRESERVEs @feature-020, `fanout.ts` untouched), so now-targeted per-owner content still reaches that shared channel. Flagged for /sdd-design, no follow-up recorded.
- Remaining doc drift left to open defects: `2026-10-19-notify-claude-md-drift-defect`, `2026-10-19-identity-claude-md-drift-defect` (banner drift, stale identity method list); the notify findings row for the broadcast defect stays until its sidecar (`triaged`) is `resolved`.

**Ledger entries written**: insights.md (1), fails.md (1) — see the 2026-11-04 entries. Three further 242 lessons already existed (fails.md:2952, :2963, :3099) and were not duplicated.
**Runtime-invariant recommendations (→ /context-constitution)**: NOTIFY-8 and IDENTITY-12 already written (Step 15); PLAT-4 already updated. Candidate not yet captured: in `.do/app.yaml` / `.do/app.dev.yaml` the notify `IDENTITY_ENDPOINT` must be `${xstockstrat-identity.PRIVATE_DOMAIN}:50058`; a bare `xstockstrat-identity:50058` causes a silent fail-closed admin-push outage (design.md:246; not found in notify `CLAUDE.md` or `context-constitution.md`).
**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 1ed63958.
