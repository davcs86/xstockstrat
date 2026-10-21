# Design: fix-push-untargeted-broadcast

**Created**: 2026-10-21
**Rounds**: 5 (full; termination: approved — auto-approved under operator standing authorization 2026-10-21)
**Approved by**: orchestrator under operator standing authorization @ 2026-10-21 (context.md § Operator decisions, `:72-77`, `:126-131`; gate: rounds 5 ≥ 2, no Floor breach, no blocking objection, the only CHANGE operator-covered)
**Grounded in**: recon.md

> Persistence note (P-04/P-05): rounds r1-r4 were carried in-band between rounds only. No on-disk
> checkpoint existed before r5. An r4 claim of a `seeds/242/state-r3.json` checkpoint was false (it
> never existed) and must not be cited. This file and the context.md 2026-10-21 entry are the first
> durable record.

---

## Chosen Approach

Every untargeted Web Push resolves its audience through a **live, uncached** lookup to a new
identity RPC, `ListAdminUserIds`. The RPC is gated on the **mTLS peer SAN only** and ignores every
request header. It selects the notify admin-source fork (b) (recon.md:397-403) over (a), (c) and (d)
(recon.md:380-411). Producers that own per-user content set `target_user_id` (FR-3).

Build order: proto → identity → notify → portfolio → analysis → env → tests → acceptance → docs →
C-14 follow-up.

1. **Proto (C-09, its own gated step).** Add an additive RPC to
   `packages/proto/identity/v1/identity.proto`, next to `ListUsers` (`:41`; recon.md:347-350):
   - `rpc ListAdminUserIds(ListAdminUserIdsRequest) returns (ListAdminUserIdsResponse);`
   - `message ListAdminUserIdsRequest {}`
   - `message ListAdminUserIdsResponse { repeated string user_ids = 1; }`
   - Gates: `buf lint`, `buf breaking`, `./scripts/buf-gen.sh`, an empty `git diff packages/proto/gen/`,
     and identity-owner approval.
   - This supersedes product-spec "No proto changes anticipated" (amended as FR-4).

2. **Identity.** New `services/xstockstrat-identity/src/grpc/adminDirectory.ts`.
   - Imports: only `import * as grpc from '@grpc/grpc-js'` and `import type { Pool } from 'pg'`.
     No relative imports, no logger.
   - Exports `listAdminUserIds(pool, call, callback)`. Module-private:
     - `ADMIN_DIRECTORY_PEER_SANS = ['xstockstrat-notify'] as const`
     - `peerDnsSans`, copied verbatim from `services/xstockstrat-config/src/grpc/authz.ts:135-142`
       (Node runtime copy #2)
     - `hasAdminDirectoryPeer`, an exact `.includes()` match
     - `PEER_SAN_ERROR`
   - Top-of-file constraint comment, 2 lines max: (a) no relative imports; (b) the handler ignores
     every request header by design, so scope logic must never be added here.
   - Order of operations:
     1. Check the SAN first. On deny, return `PERMISSION_DENIED` before any pool access.
     2. Otherwise run
        `SELECT user_id::text FROM identity.users WHERE is_active = true AND 'admin' = ANY(roles)`.
        This is the admin predicate at `identityServiceImpl.ts:851`, without its last-admin
        `user_id <> $1`. Return the IDs only.
     3. If the pool throws, return code 13 with a **generic** message. Never echo `err.message` the
        way `identityServiceImpl.ts:784` does.
   - `IdentityServiceImpl` gets a one-line delegate. `adminGate` (recon.md:397-399), `authz.ts` and
     every existing RPC stay byte-identical, so `@AC-7 @feature-043` holds.

3. **Notify.**
   - **AdminDirectory.** New `services/xstockstrat-notify/src/services/adminDirectory.ts`. It exports
     `AdminDirectory { listAdminUserIds(md: grpc.Metadata | undefined): Promise<string[]> }`, built
     from:
     - one long-lived `IdentityServiceClient(IDENTITY_ENDPOINT, mtls.clientCredentials(),
       mtls.targetOverride('xstockstrat-identity'))`, the construction at
       `services/xstockstrat-identity/src/grpc/ledgerAudit.ts:35`;
     - `ADMIN_LOOKUP_DEADLINE_MS = 2000` and no `waitForReady`;
     - single-flight: one in-flight promise, cleared in `finally`, with no TTL cache.
   - **Trio forwarding (C-03 as written).**
     - An inline `PROPAGATED_HEADERS = ['x-user-id','x-access-scope','x-trace-id'] as const` with a
       copy loop, the shape of `ledgerAudit.ts:14,40-44`.
     - Header reads use notify's own idiom `md?.get?.(h)?.[0]` (`notifyServiceImpl.ts:232`;
       recon.md:140-141). They do **not** use `md?.get(h)[0]`, which throws on get-less metadata,
       and the throw would be swallowed by the catch-all.
     - `notifyServiceImpl.ts:109` changes from `dispatch(alert)` to `dispatch(alert, call.metadata)`.
     - No `src/middleware/propagation.ts` is revived (`@AC-2 @feature-175`).
   - **Missing `IDENTITY_ENDPOINT`.** There is no `??` default. Notify logs ERROR once at startup,
     and untargeted pushes send nothing.
   - **WebPushDispatcher** (`src/fanout/webPush.ts`) takes `AdminDirectory` as its third constructor
     argument.
     - Only the untargeted branch (`:97-101`; recon.md:26-28) changes. It stays
       after the VAPID gate (`:80`) and the severity gate (`:84-86`) (recon.md:33-35, :123-126), and
       inside the catch-all (`:116-118`; recon.md:127-130).
     - The new flow is admin lookup → `SELECT … FROM notify.push_subscriptions WHERE user_id =
       ANY($1::text[])`. An empty list sends nothing.
     - The targeted branch (`:91-96`), `sendOne`, prune-by-endpoint (`:139`, NOTIFY-6) and `deliver`
       are unchanged (recon.md:131-132). The injected pool is reused with no new pool (F-06;
       recon.md:120).
   - **Escalation.** ANY AdminDirectory lookup failure, of any gRPC code (incl. 14, 4, 7, 12, 13),
     logs ERROR rate-limited to once per 60s. It uses an instance-field timestamp and an injectable
     clock. Other push errors stay WARN.
   - No migration and no config key.

   **Why relaying the trio is safe.** This is the binding rationale; the spec carries it verbatim.
   - Notify's inbound trio is **not authenticated**. `EmitAlert` is pinned as an
     internal/unauthenticated contract (`notifyServiceImpl.test.ts:219-224`, feature 092;
     recon.md:69-70).
   - mTLS proves which service is calling, not the user or the scope. So notify relays whatever
     scope a peer asserts.
   - The `fails.md:531-534` rule ("verify the upstream authenticates the elevated privilege before
     forwarding it") is honoured **only** because `ListAdminUserIds` ignores all headers, so a
     forwarded scope confers nothing. The guards are test cases (vi)/(vi-b) and the header-free
     module shape.
   - The r4/r5 wording "mTLS-authenticated producers whose values root CLAUDE.md trusts" is
     withdrawn as a reason.
   - Single-flight joiners carry the first caller's trio, so their trace correlation is lost.
     Accepted.

4. **Portfolio.** `emitRiskAlert` takes the owner and sets `TargetUserId: userID` on both paths,
   concentration `:991` and drawdown `:999`. The owner comes from `checkRiskLimits(ctx, userID, mode)`
   `:964` (recon.md:176-185). It is a body field, not a header (`propagation.go:20-49`).

5. **Analysis.** Add `target_user_id=definition.user_id` to both `EmitAlertRequest` builders,
   `live_loop.py:835-844` and `:850-860`. The owner is validated upstream by `owner_metadata`
   (recon.md:103-109, :198-200).
   - `fundsignal_loop._emit_warning` stays untargeted (recon.md:110-111, :288-291). Its relayed
     `x-user-id: system` is harmless, per case (vi-b).

6. **Env** (recon.md:368-372).
   - `docker-compose.yml` notify block: `IDENTITY_ENDPOINT: xstockstrat-identity:50058`.
   - `.do/app.yaml` and `.do/app.dev.yaml` notify blocks:
     `${xstockstrat-identity.PRIVATE_DOMAIN}:50058`.
   - No `WAIT_FOR` or `depends_on` on identity.

7. **Tests (C-08, P-06).**
   - **Identity `src/__tests__/adminDirectory.test.ts`.**
     - Static import of `../grpc/adminDirectory.ts` with **no** `before()` skip guard (the
       `mtls.test.ts:13` pattern), so an import failure fails the suite (`fails.md:2224-2226`,
       `:116-125`).
     - Fixtures: a fake pool that records queries, and a fake `getAuthContext` in the shape of
       config `authz.ts:129-132`.
     - Cases:
       - (i) the notify SAN gets exactly `["user-99"]`, and the recorded SQL contains the `:851`
         predicate;
       - (ii)-(vi) each gets `PERMISSION_DENIED` with ZERO queries: (ii) the ui SAN; (iii) the
         look-alikes `xstockstrat-notify.evil` and `xstockstrat-notifyx`; (iv) an absent
         `subjectaltname`; (v) an absent `getAuthContext`; (vi) `x-access-scope: 4` + `x-user-id:
         system` on the ui SAN;
       - (vi-b) `x-access-scope: 4` + `x-user-id: system` on the notify SAN gives the same response
         and the same single query as (i);
       - (vii) the pool throws, giving code 13 with a generic message that excludes the thrown text.
   - **Identity `mtls.test.ts` real-socket case.**
     - Register the **generated** `IdentityServiceService.listAdminUserIds`, not the passthrough
       descriptor at `:73-81`, which fails with INTERNAL.
     - Add a notify leaf to `mintPki` (`:23-53`).
     - Build each leaf's creds before `call()`, which overwrites the env at `:100`; follow the
       pattern at `:136-138`.
     - Expected: the `xstockstrat-client` leaf (`:47`) is denied with zero queries, and the notify
       leaf gets the IDs.
     - The SAN format is already proven by config `peerSanSpike.test.ts:76-110`, cited and not
       duplicated.
   - **P-06 evidence.**
     - RED on Node 24: the import fails before the module exists.
     - GREEN: a pass-count delta.
     - Separate load evidence for the guarded `identityServiceImpl.test.ts`.
     - Run both the strip-types suite and identity's `tsc` build. `tsconfig.json:19-23` excludes tests.
     - Correct `fails.md:2224` only if the guarded suite skips vacuously on Node 24.
       `fails.md:122-123` is the version-independent rationale.
   - **Notify `webPush.test.ts`.**
     - Deliberately rewrite the `:147-155` "AC-4" broadcast case under the operator sanction
       (recon.md:312-318), with a stub `AdminDirectory` and an SQL-aware fake pool (recon.md:412-414).
     - Cases:
       - the admin list changes between dispatches;
       - a non-admin subscriber gets nothing;
       - an empty list sends nothing;
       - any lookup failure (one case for code 14, one for code 13) logs ERROR once, then is
         suppressed within 60s by the injected clock;
       - two concurrent dispatches make one lookup;
       - get-less metadata does not throw.
     - Keep the targeted guard at `:129-145` and add the @AC-2 exclusivity negatives
       (recon.md:169-170).
   - **Notify adminDirectory test.** A fake identity server captures the inbound metadata **on the
     wire**, using the capture pattern at notify `mtls.test.ts:119-128`. All three headers must
     arrive.
   - **Portfolio** extends `recordingNotify` (`portfolio_quote_deadline_test.go:346-357`) to record
     `TargetUserId`, `Category` and `Severity`. **Analysis** reuses `_make_loop`
     (`tests/test_live_loop.py:36-58`) (recon.md:186-209).

8. **Acceptance (C-15).** Append @AC-8..@AC-11 to this feature's `acceptance.feature`, which already
   holds @AC-1..7. Mint them only from the worktree or `origin/feature/fix-push-untargeted-broadcast`,
   never from a stale primary checkout.
   - @AC-8: freshness after demotion and deactivation
   - @AC-9: `ListAdminUserIds` positive case, IDs only
   - @AC-10: SAN deny matrix, denied before touching `identity.users`
   - @AC-11: identity-failure containment

   At launch, @AC-9 and @AC-10 are promoted to identity's suite and the rest to notify, portfolio and
   analysis (C-16).

9. **Docs (C-10 + Teardown, same PR).**
   - Root `CLAUDE.md:336` and `docs/context-constitution.md:38` (PLAT-4): name notify→identity
     `ListAdminUserIds` as a trio-forwarding, inline-const caller, next to identity's ledgerAudit.
     No "recorded exception" is added.
   - `docs/patterns/header-propagation.md`:
     - correct `:123-125` ("none currently does"), which is already false because of identity's
       ledgerAudit;
     - add a notify→identity entry to "Request-scoped outbound edges" (`:160-169`);
     - name explicit inbound-metadata threading (`ledgerAudit.ts:14,40-44`, notify adminDirectory)
       as an accepted Node form, next to the AsyncLocalStorage template (`:120-154`). This follows
       `fails.md:521-524`.
   - The rest (recon.md:446-452):
     - `webPush.ts` comments (`:29`, `:88-89`);
     - notify `CLAUDE.md`: the Web Push paragraph, Dependencies and Env Vars;
     - identity `CLAUDE.md`: Ports, the method count and Dependencies;
     - the root dependency diagram (notify → identity);
     - `docs/patterns/inter-service-mtls.md`;
     - `services/xstockstrat-notify/docs/context-constitution-findings.md:38`;
     - agent `services/xstockstrat-agent/app/tools.py:690-699` and `docs/runbooks/mcp-tools.md:256`,
       to say that `broadcast=true` reaches admin devices only for push (recon.md:434-437).

10. **C-14.** Before merge:
    - file a defect report with a `.status` sidecar for trading's untargeted per-account CRITICAL
      alerts (reconciliation `trading.go:1938-1944`, halt `:2751-2757`; recon.md:428-433);
    - record a named follow-up slug or an operator sign-off in context.md.

    FR-3 is not extended to trading in this feature.

**Consumer surfaces (C-14).**
- PWA device notifications on `/trader`, `/insights` and `/config-ui` installs: untargeted alerts
  reach admin-role devices only; FR-3 alerts reach their owner's devices.
- The in-app `StreamAlerts`/`ListAlerts` broadcast is unchanged (recon.md:50-52, :240-246).
- Agent `emit_alert`: wording only, no behaviour change in the agent.

## Rejected Alternatives

- Store the admin bit at register time (notify `004` migration) — rejected because it goes stale on demotion or deactivation, breaking freshness in `@AC-4/5/11 @feature-043` (recon.md:383-389, :308-311).
- Live lookup with a 30-60s TTL cache — rejected because a demoted admin keeps receiving pushes for the whole TTL. Single-flight gives the burst relief without the staleness.
- A local admin set built from identity role-change ledger events — rejected because the events are best-effort (auditSafe), the set is only eventually consistent, and it needs a new consumer (YAGNI).
- `FilterAdminUserIds(candidate_ids)` — rejected because it adds a query and a larger payload with no meaningful reduction in exposure.
- Notify reads `identity.users` directly — rejected because it breaks schema ownership, has a UUID/TEXT mismatch, and the grants are unknown (recon.md:404-409).
- A config-held admin list — rejected because it is a second source of truth that drifts from identity roles (recon.md:410-411).
- Loosen `adminGate`, or have notify mint an admin `x-access-scope` — rejected because the first is a CHANGE to `@AC-7 @feature-043` and the second is the `fails.md:531-534` trap.
- Reuse `ListUsers` with a header+SAN grant — rejected because it over-discloses (emails, every user) and changes `@AC-7 @feature-043`.
- Gate on SAN plus an `x-internal-caller` header (config `authz.ts:149-162` shape) — rejected because any mTLS peer can forge the header, so it adds nothing over a verified SAN.
- Forward only the trace header and record a C-03 exception — rejected because it needs a Commandment override, while relaying the trio to a header-blind RPC honours `constitution.md:34` as written.
- Forward the trio but strip `x-access-scope` — rejected because it violates C-03 as written and is unnecessary, since the RPC ignores headers (case vi-b).
- Justify the relay as "trusted mTLS-authenticated producer values" — rejected as rationale because `EmitAlert` is pinned unauthenticated (`notifyServiceImpl.test.ts:219-224`).
- Drop single-flight (YAGNI) — rejected because a burst of untargeted alerts would mean N lookups against identity's 2-connection direct pool, which competes with login.
- ERROR only on codes 7/12/13 — rejected because the likeliest drift modes (14, 4) would stay silent.
- An N-consecutive-failure counter — rejected because it is more state than "every failure, rate-limited to 60s", which already surfaces an outage.
- Read headers with `md?.get(h)[0]` — rejected because it throws on get-less metadata, and the throw is silently swallowed.
- Revive `src/middleware/propagation.ts` or AsyncLocalStorage in notify — rejected because it reverses `@AC-2 @feature-175`.
- Put the handler in `authz.ts`, or keep it as an `IdentityServiceImpl` method behind the guarded lazy import — rejected because `authz.ts` stays pure header authz, and the `before()` guard can pass with zero assertions (`fails.md:2224-2226`).
- An existence-only (`typeof`) identity test — rejected because it is a vacuous green for a security boundary.
- A real-socket case on the passthrough descriptor (`mtls.test.ts:73-81`), or no real-socket case — rejected because the passthrough fails with INTERNAL, and dropping the case leaves the `addService` wiring untested.
- Seed a config key for the lookup deadline now — deferred because it is a mechanism constant, as `webPush.ts:16` and `fanout.ts:13` are.
- A shared Node `peerDnsSans` package now — rejected on YAGNI at runtime copy #2.
- Send a second untargeted copy alongside the targeted one — rejected because it breaks "exactly"/"only" in `@AC-3/@AC-9 @feature-231`, `@AC-6 @feature-215` and `@AC-2 @feature-203` (recon.md:419-420).
- Extend FR-3 to trading per-account alerts here — deferred to the named C-14 follow-up.
- A bare `xstockstrat-identity:50058` in the DO specs — rejected because it causes a silent fail-closed outage. Use `PRIVATE_DOMAIN`.
- Mint the new scenarios as @AC-5..8 — rejected because the worktree already holds @AC-5..7.
- Keep the persistence objection BLOCKING at r5 — rejected because it would deadlock the gate whose own output resolves it. It is enforced instead as a hard precondition on the status flip, met by this file and the context.md entry.

## Open Risks

- [ ] **Silent fail-closed outage of admin push.** If the SAN, `IDENTITY_ENDPOINT` or identity's availability drifts, admin pushes stop while unit tests and compose stay green.
  - Mitigations: a rate-limited ERROR on any lookup failure, a startup ERROR when `IDENTITY_ENDPOINT` is absent, the identity real-socket test, and `PRIVATE_DOMAIN` values in the DO specs.
  - **Named, non-waivable dev launch gate:** an admin device receives an untargeted WARNING push, and a non-admin device does not.
  - To be addressed at: the notify step, the env step, and the launch smoke test.
- [ ] **Header-blindness is the only guard on the relayed, unauthenticated trio.** Guarded by cases (vi)/(vi-b), the 2-line constraint comment and this file. To be addressed at: the identity step and its tests.
- [ ] **Load on identity's direct pool** (max 2, shared with login and refresh). Single-flight merges only overlapping lookups. To be addressed at: the notify step; watch in dev.
- [ ] **Single-flight joiners lose trace correlation.** Accepted, and recorded in the notify adminDirectory doc comment and the PR description.
- [ ] **Acceptance-ID collision** if @AC-8..11 are minted from a stale checkout. Mint only from the worktree or origin branch. To be addressed at: /sdd-spec.
- [ ] **Strip-types load uncertainty** for the guarded `identityServiceImpl.test.ts` on Node 24. Needs separate P-06 load evidence. To be addressed at: the identity test step.
- [ ] **Canonical-form match.** `push_subscriptions.user_id` must equal identity's `user_id::text`; non-canonical legacy rows silently miss. To be addressed at: the notify step (spec checks register-side ID form).
- [ ] **Empty-owner producers degrade to an admin-only push.** The owner gets nothing and nothing logs it (recon.md:421-427). To be addressed at: the portfolio/analysis steps (note only).
- [ ] **Merge-order coupling** with 215 (`_emit_fundamentals_unavailable_alert`) and the open `emitRiskAlert` concentration defect (recon.md:438-445). Whichever merges second rebases and carries `target_user_id`. To be addressed at: /sdd-spec overlap re-scan.
- [ ] **Trading CRITICAL halt and reconciliation alerts reach only admins** until the C-14 follow-up ships. To be addressed at: before merge (C-14 report + follow-up slug or sign-off).
- [ ] **Scope growth:** 5 services plus agent wording, a proto RPC, a new edge, 3 env-spec edits and 4+ shared docs. Depends on the product-spec amendment (FR-4, now applied) and identity-owner proto approval. To be addressed at: /sdd-spec step sizing.
- [ ] **Two Node test runners** (`fails.md:2239-2241`). Run both suites and both `tsc` builds. To be addressed at: the identity and notify test steps.

## Constitution Rules Touched

- `C-03` — honored by: inline `PROPAGATED_HEADERS` + copy loop (`ledgerAudit.ts:14,40-44` shape), the `notifyServiceImpl.ts:232` read idiom, `dispatch(alert, call.metadata)`, and an on-the-wire capture test. No Commandment override. Safety rationale: the receiving RPC is header-blind.
- `C-16` — honored by: the only CHANGE is the never-promoted feature-165 FR-3 broadcast, covered by an operator decision. The EXTEND rows are covered by the targeting decision. Everything else is PRESERVE (see below).
- `C-15` — honored by: new @AC-8..@AC-11 minted from the worktree; @AC-9/@AC-10 promote to identity at launch.
- `C-09` / approval flow — honored by: the additive `identity.proto` RPC is its own gated step with identity-owner approval.
- `C-08` — honored by: identity matrix (i)-(vii) + (vi-b); the real-socket case on the generated descriptor; notify cases for any-code ERROR escalation, get-less metadata, single-flight and on-the-wire trio capture.
- `P-06` — honored by: RED on Node 24, a GREEN pass-count delta, separate load evidence for the guarded suite, and both strip-types and `tsc`.
- `P-02` / `P-04` / `P-05` — honored by: this file and the context.md 2026-10-21 entry are the first durable record. They state truthfully that r1-r4 were in-band, and they cite no non-existent checkpoint.
- `C-10` + Teardown — honored by: the same-PR doc list in Chosen Approach item 9, including `header-propagation.md`.
- `C-01` / `P-03` — honored by: citations re-verified 2026-10-21 (`identity.proto:41`, `ledgerAudit.ts:14,35,40-44`, `notifyServiceImpl.ts:109,232`, `notifyServiceImpl.test.ts:219-224`, `webPush.ts:16,88-100,116-118`, `fanout.ts:13`, `identityServiceImpl.ts:784,851`, config `authz.ts:135-142`, `CLAUDE.md:336`, `context-constitution.md:38`, `header-propagation.md:123-125,160-169`, `constitution.md:34`, `fails.md:531-534,2224-2226`). The product-spec is amended with FR-4, and identity and agent are added to Affected Services.
- `C-11` — honored by: full mode, 5 rounds, auto-approved under the operator standing authorization.
- `C-14` — honored by: the trading per-account gap needs a filed report plus a follow-up slug or sign-off before merge. The agent wording is updated in-feature.
- `C-18` — honored by: one `AdminDirectory` seam with single-flight; reuse of notify's header idiom; `peerDnsSans` as runtime copy #2. Test-only twins (`peerSanSpike.test.ts:35-41`) do not count toward the copy-#3 extraction trigger.
- `F-04` — honored by: grounding verified by the adversary and the mediator; this session re-verified the load-bearing lines.
- `F-06` — honored by: no new pool. Notify reuses the injected pool, and identity uses its existing pool.
- `F-07` — honored by: `ADMIN_LOOKUP_DEADLINE_MS = 2000` is a mechanism constant like `webPush.ts:16` `WEBPUSH_SEND_TIMEOUT_MS` and `fanout.ts:13` `FANOUT_HTTP_TIMEOUT_MS`. The fallback is `notify.push.admin_lookup_timeout_ms` (C-05), only if /sdd-review flags it.

Floor breaches: none.

## Business Rules Touched (C-16)

- CHANGE feature-165 FR-3 "untargeted Web Push goes to every subscription" — no durable `@AC`; pinned only by `services/xstockstrat-notify/src/__tests__/webPush.test.ts:147-155` ("AC-4"). Altered guarantee: untargeted alerts Web-Push to admin-role users only. Signed off by the operator @ 2026-10-20, re-recorded 2026-10-21 (context.md § Operator decisions, `:76`, `:130`). recon.md:312-318.
- EXTEND `@AC-3 @FR-5 @feature-231` "Concentration sums a symbol across accounts and alerts on the true weights" (`services/xstockstrat-portfolio/acceptance/fix-after-hours-positions-priced.feature:35-36`) — adds `target_user_id` = owner; bodies and the exact alert set are unchanged. Covered by the operator targeting decision (context.md `:77`, `:131`).
- EXTEND `@AC-9 @FR-5 @feature-231` "Any unpriced position skips concentration but drawdown still alerts" (`:61-62`) — the drawdown alert gains `target_user_id`; still "the only alert". Covered by the targeting decision.
- EXTEND `@AC-1 @FR-1 @feature-172` "An account whose equity falls below its peak … alerts" (`services/xstockstrat-portfolio/acceptance/drawdown-enforcement.feature:12-13`) — gains `target_user_id` (242 @AC-6). Covered by the targeting decision.
- EXTEND `@AC-6 @FR-4 @feature-215` "A live-enabled fundamentals-gated strategy is denied entry on an ETF, auditably" (`services/xstockstrat-analysis/acceptance/block-fundamentals-strategy-on-etf.feature:48-49`) — the single alert gains `target_user_id = definition.user_id` (242 @AC-7). Covered by the targeting decision.
- EXTEND (new, 242) @AC-8 freshness after demotion/deactivation; @AC-9 `ListAdminUserIds` returns IDs only; @AC-10 SAN deny matrix, denied before touching `identity.users`; @AC-11 identity-failure containment.
- PRESERVE `@AC-4 @FR-3 @feature-165` "An emitted alert is pushed to the target user's devices" (`services/xstockstrat-notify/acceptance/pwa-notifications.feature:24-29`) — the targeted branch is byte-identical.
- PRESERVE `@AC-2`, `@AC-3`, `@AC-5`, `@AC-6`, `@AC-7`, `@AC-8 @feature-165` (`pwa-notifications.feature`) — no schema or lifecycle change. The lookup stays inside the best-effort microtask, after the VAPID and severity gates. Prune-by-endpoint is unchanged.
- PRESERVE `@AC-1`, `@AC-2 @feature-203` (`alert-read-unread-persistence.feature:6-7`, `:13-14`) — the in-app path and the persisted `target_user_id` of untargeted alerts are untouched; no per-admin copies.
- PRESERVE `@AC-1`, `@AC-3`, `@AC-4`, `@AC-7`, `@AC-9 @feature-020` (`notify-external-fanout.feature`) — the fanout microtask and `fanout.ts` are untouched.
- PRESERVE `@AC-9 @FR-8 @feature-215` — targeting adds no emit.
- PRESERVE `@AC-37`, `@AC-36`, `@AC-6 @feature-224` — the fundsignal ERROR/WARN alerts stay untargeted; `system` is never set as a target.
- PRESERVE `@AC-4`, `@AC-5 @feature-210` (`docs/sdd/business-rules/platform.feature:229`, `:238`) — the new dial uses `clientCredentials()` and fails closed; header semantics are unchanged.
- PRESERVE `@AC-2 @feature-175` (`platform.feature:165-166`) — no `src/middleware/propagation.ts`.
- PRESERVE `@AC-3 @FR-4 @feature-169` — trading is untouched.
- PRESERVE `@AC-1`..`@AC-8`, `@AC-10`, `@AC-11 @feature-043` (`services/xstockstrat-identity/acceptance/user-management-ui.feature`) — `adminGate` and the six named RPCs are unchanged (`@AC-7` lists only those six, `:54-57`). The live, uncached lookup on `is_active = true` keeps `@AC-4/5/11` freshness.
- PRESERVE `@AC-10 @FR-10 @feature-183` "Admin profile RPCs enforce admin gating at the identity service" (`services/xstockstrat-identity/acceptance/mcp-user-profile-roles.feature:10-14`) — the admin metadata RPCs are untouched. The new RPC likewise denies before touching the users table (242 @AC-10).

## Rounds

5 rounds, full mode. Termination: auto-approved under operator standing authorization 2026-10-21.

- **r1-r2:** fork (b) was chosen, a live identity lookup through a new narrow SAN-gated RPC. The core design has been stable since r2.
- **r3-r4:** the identity module shape was settled (no relative imports, no guarded lazy import). The test matrix (i)-(vii) was added, the real-socket case was corrected to the generated descriptor, the env used the `PRIVATE_DOMAIN` form, and @AC-8..11 were numbered.
- **r5:**
  - C-03 closed by explicit trio forwarding.
  - The trio-safety rationale was corrected to "the receiving RPC is header-blind", and case (vi-b) was added.
  - Escalation was widened to every lookup failure, rate-limited.
  - The `md?.get?.(h)?.[0]` idiom was adopted.
  - `header-propagation.md` was added to the doc list.
  - The persistence objection was reclassified as a precondition on the status flip, which this file meets.
