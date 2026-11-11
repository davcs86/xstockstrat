# Context Log: fix-read-path-owner-trust

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-10 (/sdd-triage)

- Bug reported via defect reports (Issues disabled; clustered triage):
  - `docs/reports/2026-10-19-trading-listorders-body-user-id-filter-defect.md` — trading ListOrders/StreamOrderUpdates trust a body user_id filter where empty = all users (SEV-3)
  - `docs/reports/2026-10-19-portfolio-default-identity-fallback-defect.md` — portfolio consumers substitute "default" / "alpaca-default" for missing user/account id (SEV-3)
  - `docs/reports/2026-10-19-notify-listalerts-owner-fallback-unscoped-defect.md` — notify ListAlerts trusts the body userId and is unscoped with no identity (SEV-3)
- Cluster rationale: all three violate PLAT-11 the same way — ownership taken from a body field, a null fallback, or a placeholder instead of the trusted x-user-id header — and share one security-posture decision.
- Severity: SEV-3 (all three)
- Routed to SDD path (Track C)
- Created: status.md, feature.md, product-spec.md, acceptance.feature (3 regression scenarios), context.md; report sidecars stamped `triaged`
- Affected services (from reports): xstockstrat-trading, xstockstrat-portfolio, xstockstrat-notify (consumer surfaces: xstockstrat-ui, xstockstrat-agent)
- Root cause hypothesis: pre-PLAT-11 body filters and test-caller fallbacks left in place; missing empty-caller guard in RegisterBrokerAccount
- Recommended design depth: full → `/sdd-design fix-read-path-owner-trust` (rationale: security/authz posture, ≥3 services, proto documentation change)
- Development branch: feature/fix-read-path-owner-trust

## Session 2026-11-10 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings: bug-template conventions (no FR-N/@FR tags); AC-3 allows two rejection codes pending OQ2; AC-2 compound; five open questions deferred; first review FAILed crit 5 + trading C-2 (fixed)
- Overlap findings: WARN: trading.proto shared with 322 (different messages); notify ListAlerts coupling with 315
- Recommended design depth: full (proto (additive); 5 services)
- Tree: ccr-500a9eb9-nvk45x (origin/main-dev 0fecb24d + triage/docs commits; no feature branch yet)

## Session 2026-11-11 — sdd-batch design gate (round 2)

- `/sdd-design fix-read-path-owner-trust` (full) halted at the approval gate after round 2 (gate policy: halt). Per the grilling protocol, design.md is not written and status.md is unchanged. The register is `debate.md` (State in-debate, Rounds run 2).

### Open Threads

- **Approach (round-2 synthesis):** D-1..D-6 stand; R-1..R-3 honoured.
  - Trading order reads become header-only through one `ResolveOrderOwner(ctx)` (`FromContext(ctx).UserID`; empty → `PermissionDenied`, stated explicitly so fix-grpc-status-mapping does not normalise it). Body `user_id` is never read for any scope, at the six D-3 sites. The stream path takes identity from the D-1 interceptor with RED-first production-chain evidence (D-2).
  - The `broadcastOrder` "empty = all users" arm (`trading.go:439`) and its docs (`:389-399`) are deleted (D-8).
  - Proto changes are additive `[deprecated = true]` on `trading.proto:169/:190` and `notify.proto:99` (D-10).
  - `LoadBrokerPool` skips owner-less rows with a startup WARN; cleanup is a filed follow-up (D-9).
  - `UpdateBrokerAccountCredentials` (`trading.go:2672`) must fail closed on an empty caller (O-7).
  - Notify StreamAlerts/AcknowledgeAlert body `user_id` are out of scope; a new defect report is a deliverable (D-11).
  - Merge order: 315 before 312; 322 either way with rebase and buf-gen; `handler/trading.go:112` stays in 312 (D-12).
  - `scripts/integration-test.sh:446-448` is a known-dead header-less `ListOrders` caller (Connect `:8051`, outside CI).
  - Comment-only touchpoints: `traderBff.ts:35-36`, `entry_backfill.py:73`, agent `CLAUDE.md:29`. xstockstrat-analysis is added as a preserved caller.
- **Strongest open objection:** O-2 (blocking). The C-16 CHANGE needs an operator-signed D-7: "trading ListOrders/StreamOrderUpdates always scope to x-user-id; body user_id is ignored for every scope including ADMIN; headerless → PermissionDenied; no cross-user order read over RPC". It overrides trading `CLAUDE.md:45-51` and the product-spec Expected "admin selector" line. Approval cannot proceed until that sign-off is recorded here.
  - Also blocking: O-6 (no D-7 regression scenario yet) and O-7 (the `:2672` headerless credential rewrite re-enters the pool at `:2706`).
  - Non-blocking but open: O-3 (follow-up filing and `LoadBrokerPool` side effects under Assumptions).
- **Floor status:** no Floor breaches.
- **Uncovered @AC changes (none covered by an operator decision yet):**
  - CHANGE: trading `CLAUDE.md` "admin empty user_id = all users" (no durable @AC).
  - CHANGE: 312 product-spec Expected "body user_id honoured only as an admin selector" (PROTO-10).
  - EXTEND: @AC-1, @AC-2, @AC-3 (312), plus a new D-7 ADMIN header-only regression scenario, to be promoted as a durable trading @AC.
  - PRESERVE: xstockstrat-ui @AC-2 @feature-270; xstockstrat-notify @AC-1..@AC-5 @feature-203.
- **Next:** operator signs or declines D-7 (O-2). Then re-run `/sdd-batch` to resume at round 3 from the state below.

```sdd-batch-design-state
{
  "round": 2,
  "synth": {
    "approach": "Round-2 synthesis. D-1..D-6 stand unchanged, and R-1..R-3 are honoured. The proposer's header-only choice is adopted. Two corrections from the adversary are folded in; I confirmed the first one in the code.\n\n1. **Trading order reads are header-only.**\n   - `(*TradingService).ResolveOrderOwner(ctx) (string, error)` in `internal/service/trading.go` returns `middleware.FromContext(ctx).UserID`. An empty value returns `codes.PermissionDenied`.\n   - It never reads body `user_id`, for admins or anyone else, and there is no `RequireAdminScope` branch.\n   - It is called at the six D-3 sites: `trading.go:1646`, `:1652`, `:1730`, and `handler/trading.go:117-119`, `:204-206`. The resolved value also feeds `subID`.\n   - The stream path is unchanged: identity comes from the D-1 interceptor, with RED-first evidence through the production chain (D-2).\n   - The missing-identity code is stated explicitly as `PermissionDenied` (trading convention), so that fix-grpc-status-mapping does not normalise it. Notify keeps code 3 (D-4).\n   - Naming (C-18): `ResolveOrderOwner` is the one resolver for order reads. The four existing inline fail-closed checks (`trading.go:482,967,1317,1490`) are not refactored onto it. The spec must either justify the order-specific name or rename it `requireCaller`; this is a non-blocking choice.\n\n2. **The \"empty = all users\" subscriber branch is removed entirely.**\n   - The upstream resolver guarantees a non-empty selector.\n   - Delete the `sub.userID != \"\" &&` arm in `broadcastOrder` (`trading.go:439`) so the filter becomes `order.UserId != sub.userID → continue`.\n   - Rewrite the \"empty = all users\" docs on `orderSubscriber` and `SubscribeOrderUpdates` (`trading.go:389-399`).\n   - `SubscribeOrderUpdates(id, userID)` keeps its signature (no error return). Do not keep both a reject path and a dead `\"\"` branch.\n\n3. **Proto changes are additive.**\n   - `ListOrdersRequest.user_id` (`trading.proto:169`) and the StreamOrderUpdates request `user_id` (`:190`) get `[deprecated = true]` and a comment: \"ignored; owner is x-user-id\".\n   - `ListAlertsRequest.user_id` (`notify.proto:99`) gets `[deprecated = true]`.\n   - Run `./scripts/buf-gen.sh`. The changes are buf-breaking-clean.\n   - In `packages/proto/docs/context-constitution.md`, add `trading.proto:169/:190` to the deprecated request-body `user_id` gotcha set, not to PROTO-10's admin-selector evidence.\n\n4. **C-16 CHANGE, blocking on the operator.**\n   - Proposed D-7 for operator sign-off: \"trading ListOrders/StreamOrderUpdates always scope to x-user-id; body user_id is ignored for every scope including ADMIN; headerless → PermissionDenied; no cross-user order read over RPC\".\n   - D-7 explicitly overrides both the trading `CLAUDE.md:45-51` \"empty = all users\" contract and the product-spec Expected line \"body user_id honoured only as an admin selector\" (PROTO-10 framing).\n   - Both texts are rewritten in the same PR.\n   - Add a D-7 regression scenario to `acceptance.feature`:\n     - `x-access-scope \"4\"` (ADMIN), `x-user-id user-a`, with body `user_id user-b` and also with an empty body. Both return only user-a's orders, on `ListOrders` and on `StreamOrderUpdates` via the production chain.\n     - A headerless call returns PermissionDenied.\n   - Promote that scenario as the durable trading @AC at launch.\n\n5. **Phantom owner-less broker accounts.**\n   - `LoadBrokerPool` (`trading.go:302-320`): the loop's first statement is `if rec.UserID == \"\" { slog.WarnContext(..., \"account_id\", ...); continue }`.\n   - `UpdateBrokerAccountCredentials` (`trading.go:2672`) changes from `rec.UserID != callerUserID` to `callerUserID == \"\" || rec.UserID != callerUserID → PermissionDenied`, the idiom at `:482`.\n     - Confirmed: today a headerless caller (`extractUserID` returns \"\") passes the check on a `user_id=''` row, rotates its credentials, and re-inserts it into the pool at `:2706`. That re-feeds `syncPositions` and is an unauthenticated credential write.\n     - With this guard, every pool-insert site (`:2614`, `:2652`, `:2706`) and `LoadBrokerPool` is owner-gated.\n   - Tests:\n     - headerless update on a `user_id=''` account → PermissionDenied, and the account is not in the pool\n     - `LoadBrokerPool` skips an empty-owner row\n   - Re-grep every `rec.UserID != caller*` comparison. `:1196` is safe only because of `:1178`.\n   - Portfolio D-5 skips remain as defence in depth for events already in the ledger.\n   - Row cleanup is out of scope. A follow-up is filed, triggered by the startup WARN appearing in dev or prod logs.\n   - Assumptions to record:\n     - A skipped account drops out of the `resolveAccount` sole-account count (`trading.go:368-386`). One real account plus one phantom flips from InvalidArgument to auto-selecting the real account.\n     - The skipped account leaves credential-health, reconciliation and halt hydration (`:321-329`).\n     - In-flight NEW/PARTIALLY_FILLED orders on a phantom account can no longer be reconciled by `pollFills`.\n\n6. **Notify siblings are explicitly out of scope for 312.**\n   - These are `StreamAlertsRequest.user_id` (\"empty = all\", `notify.proto:83`) and the `AcknowledgeAlert` body `user_id` (`notify.proto:91`).\n   - No peer owns them: 316 covers only severities and backpressure, and 315 leaves delivery unchanged.\n   - 312 files a new defect report under `docs/reports/` (NOTIFY-5 model) as a deliverable of this design.\n   - Notify `ListAlerts` and `MarkAlertRead` follow D-4.\n\n7. **Merge order.**\n   - 315 merges before 312; 312 rebases `notifyServiceImpl.ts` and its tests.\n   - 322 and 312 can merge in either order; the second rebases and re-runs `buf-gen`.\n   - 326 is marketdata-scoped (`marketdata_handler.go:513`), so `handler/trading.go:112` (`CodeInternal` → `connectCodeFromErr`) stays in 312. If 326's spec turns out to touch the trading handler, 312 merges after it.\n\n8. **Known header-less `ListOrders` caller.**\n   - `scripts/integration-test.sh:446-448` sends `ListOrders{trading_mode, limit}` with no `user_id`.\n   - It targets the removed Connect `:8051` and is outside CI, so it is dead. Record it as known-dead in `context.md`, or add an `x-user-id`. Either way the pre-merge caller grep, including `scripts/`, is not a no-op.\n\n9. **Comment-only touchpoints and order.**\n   - Comment-only changes: `traderBff.ts:35-36`, `entry_backfill.py:73`, agent `CLAUDE.md:29`. xstockstrat-analysis is added to Affected Services as a preserved caller.\n   - Build order: proto → trading (middleware → main.go:155 → service incl. LoadBrokerPool and the :2672 guard → handler) → portfolio → notify → docs, acceptance and the defect report.",
    "open_objections": [
      {
        "text": "O-2 / proposed D-7 needs operator sign-off. Header-only removes cross-user order reads for ADMIN and ignores body user_id. This overrides both the trading CLAUDE.md:45-51 'empty = all users' contract and the product-spec Expected 'admin selector' line (PROTO-10 framing). Design approval is blocked until an operator signs D-7 and it is recorded in context.md.",
        "blocking": true
      },
      {
        "text": "D-7 has no regression scenario. @AC-1 tests only scope '3'. Add a scenario: ADMIN (scope '4') + x-user-id user-a + body user_id user-b (and empty body) returns only user-a on ListOrders and StreamOrderUpdates (through the production chain); headerless → PermissionDenied. Promote it as the durable trading @AC. Otherwise an admin body selector (R-4) could return with every AC still green.",
        "blocking": true
      },
      {
        "text": "UpdateBrokerAccountCredentials (trading.go:2672) compares rec.UserID != callerUserID with no empty-caller guard. A headerless caller can rewrite credentials on a user_id='' account and re-insert it into the broker pool at :2706, which re-feeds syncPositions with owner-less positions.synced/balance.synced and defeats the LoadBrokerPool guard. The proposal claimed all live-insert sites were behind D-6; that claim is false. The synthesis folds the fix into the approach; the proposer must adopt it with a headerless test on a user_id='' row and a re-grep of all rec.UserID != caller* sites.",
        "blocking": true
      },
      {
        "text": "O-3 remains open until the :2672 fail-closed guard is adopted. The LoadBrokerPool skip alone does not stop phantom re-entry mid-process. The cleanup follow-up must actually be filed with its startup-WARN trigger, and the LoadBrokerPool side effects must be recorded under Assumptions: resolveAccount sole-account flip, loss of credential-health/reconciliation/halt hydration, and pollFills unable to reconcile in-flight orders on phantom accounts.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "@AC-1 (312)",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-2 (312)",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-3 (312)",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "new D-7 regression scenario (312, ADMIN header-only order scoping) — to be promoted as durable trading @AC",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "trading CLAUDE.md contract 'admin empty user_id = all users' (no durable @AC)",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "312 product-spec Expected 'body user_id honoured only as an admin selector' (PROTO-10)",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "xstockstrat-ui @AC-2 @feature-270 (dropped order stream reconnects)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "xstockstrat-notify @AC-1..@AC-5 @feature-203 (alert read/unread persistence, untargeted alerts visible)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Keep the admin body selector on ListOrders/StreamOrderUpdates, with an empty body meaning own orders (proposer's runner-up). Lost: no named consumer (C-18 YAGNI). Every live caller sends body = header (traderBff.ts:35-46, client.py:2560-2562, entry_backfill.py:79-84, servicer.py:6478-6480). The ADMIN bit over mTLS would become a cross-tenant order read, and it needs RequireAdminScope plumbed into the stream path.",
      "Make SubscribeOrderUpdates reject an empty selector while keeping the `sub.userID != \"\"` all-users branch in broadcastOrder (trading.go:439). Lost: the function has no error return, so this leaves half-removed dead semantics (C-18). Rely on the upstream resolver and delete the branch.",
      "Producer-side skip with a throttled WARN in syncPositions per sync cycle. Lost: the broker pool is the only feed into the poller, so a load-time skip (plus owner-gated pool inserts) logs once per boot and needs no throttle map.",
      "One-off cleanup migration deactivating user_id='' broker accounts inside 312. Lost for now: it needs DBA approval, the product-spec says no migration, and it is irreversible on prod data. It is kept as a filed follow-up triggered by the startup WARN.",
      "Assign the notify StreamAlerts/AcknowledgeAlert body user_id siblings to 315 or 316. Lost: neither peer's product-spec covers them (316 lines 12 and 22; 315 line 17). Treat them as out of scope and file a new defect report instead."
    ],
    "open_risks": [
      "Header-only removes every RPC path for reading orders across users. An unseen internal job or ops script that relied on ListOrders{} returning all users would silently return one user's orders, or PermissionDenied when it sends no header. scripts/integration-test.sh:446-448 is one such caller (already dead: Connect :8051, outside CI). Run a pre-merge grep across services/ and scripts/.",
      "The LoadBrokerPool skip changes resolveAccount's sole-account behaviour (trading.go:368-386) and drops phantom accounts from credential-health, reconciliation and halt hydration (:321-329). In-flight orders on those accounts become unreconcilable by pollFills.",
      "The new StreamServerInterceptor (D-1) applies to every trading stream RPC. Audit the other stream handlers for behaviour change.",
      "Legacy pre-user_id events are dropped on replay (D-5), including the DeleteOfflineRealized purge on deregister (portfolio_service.go:1569).",
      "ListBrokerAccountsSvc (handler:286) still has no empty-caller guard and can list empty-owner rows until the cleanup lands.",
      "Broker-account handlers mask PermissionDenied as Internal via toGRPCError (handler/trading.go:277,300). That depends on fix-grpc-status-mapping, and that peer must not normalise trading's missing-caller PermissionDenied.",
      "Converting notify tests from body userId to metadata may expose other tests that depend on the unscoped fallback; 312 must rebase on 315."
    ],
    "constitution_rules_touched": [
      "C-01",
      "C-08",
      "C-11",
      "C-13",
      "C-15",
      "C-16",
      "C-18",
      "P-02",
      "P-03",
      "P-06",
      "PROTO-10",
      "NOTIFY-5",
      "PLAT-4",
      "PLAT-5",
      "PLAT-13"
    ],
    "rationale": "Header-only answers O-1 concretely. No live caller sends a body that differs from the header, so the admin selector fails C-18 YAGNI, and dropping it also removes the cross-tenant ADMIN-over-mTLS read. The operator-choice part of O-1 moves into O-2's D-7 sign-off. O-2 therefore stays blocking, and it now also covers the product-spec Expected override, not only the trading CLAUDE.md text.\n\nI verified the adversary's main blocking finding in the code.\n- `trading.go:2672` checks only `rec.UserID != callerUserID`, and `:2706` re-inserts `rec` into `s.brokers`. A headerless caller can therefore rotate credentials on a phantom `user_id=''` row and re-feed `syncPositions`.\n- So the proposal's O-3 premise, that all pool inserts sit behind D-6, is false. O-3 stays open, and the fail-closed fix is carried as a new blocking objection, because the proposal did not answer it.\n- The fix is folded into the approach using the existing `:482` idiom.\n\nThe D-7 regression scenario is required under C-15/C-16. Without it, the R-4-locked admin selector could come back with every AC green.\n\nI also confirmed the `broadcastOrder` dead `\"\"` branch (`:439`) and the subscriber docs (`:389-399`). The approach deletes the branch rather than keeping a reject path beside it.\n\nO-4 is closed by an explicit out-of-scope statement plus a defect-report deliverable. O-5 is closed by the recorded merge order.\n\nNo settled D-n, locked R-n, or closed O-n was contradicted, and there are no reopen petitions.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "Trading order reads take the owner from the header only. ResolveOrderOwner(ctx) returns FromContext(ctx).UserID, or PermissionDenied when it is empty; body user_id is never read for any scope. The missing-identity code for trading is PermissionDenied and is stated explicitly so peers do not normalise it. Final sanction of the contract change rests on the operator-signed D-7 (O-2).",
          "evidence": "traderBff.ts:35-46; client.py:2560-2562; entry_backfill.py:79-84; servicer.py:6478-6480 (body = header at every live caller)"
        },
        {
          "text": "The 'empty = all users' subscriber semantics are deleted. The `sub.userID != \"\"` arm in broadcastOrder (trading.go:439) and the docs at :389-399 are removed; the upstream resolver guarantees a non-empty selector, and the SubscribeOrderUpdates signature is unchanged.",
          "evidence": "trading.go:389-400,436-442 (verified)"
        },
        {
          "text": "LoadBrokerPool skips rec.UserID == \"\" rows with slog.WarnContext(account_id) and continue, as the loop's first statement. Row cleanup is a filed follow-up triggered by the startup WARN appearing in dev or prod logs.",
          "evidence": "trading.go:302-320,2436-2446; trading.go:317-318 skip idiom"
        },
        {
          "text": "Proto changes are additive only. trading.proto:169 and :190 and notify.proto:99 get [deprecated = true] with an 'ignored; owner is x-user-id' comment. trading.proto:169/:190 are added to the proto constitution's deprecated request-body user_id gotcha set, not to PROTO-10's admin-selector evidence.",
          "evidence": "CLAUDE.md § Approval Flow; packages/proto/docs/context-constitution.md:28"
        },
        {
          "text": "Notify StreamAlertsRequest.user_id (notify.proto:83) and AcknowledgeAlert body user_id (notify.proto:91) are out of scope for 312. 312 files a new defect report for them on the NOTIFY-5 model.",
          "evidence": "316 product-spec lines 12 and 22; 315 product-spec line 17"
        },
        {
          "text": "Merge order: 315 before 312 (312 rebases notifyServiceImpl.ts and its tests). 322 and 312 in either order; the second rebases and re-runs buf-gen. handler/trading.go:112 connectCodeFromErr stays in 312 unless 326 turns out to touch the trading handler, in which case 312 merges after 326.",
          "evidence": "326 scope marketdata_handler.go:513; 322 edits trading.proto:336"
        }
      ],
      "new_rejected": [
        {
          "text": "Admin body user_id selector on trading ListOrders/StreamOrderUpdates (any variant, including 'empty = own, body = other user for ADMIN')",
          "why": "No named consumer (C-18 YAGNI); the ADMIN bit over mTLS becomes a cross-tenant order read; it needs RequireAdminScope in the stream path."
        },
        {
          "text": "Keeping both a SubscribeOrderUpdates empty-selector reject and the broadcastOrder `sub.userID != \"\"` all-users branch",
          "why": "Half-removed dead semantics with no error return (C-18); the branch is deleted instead."
        },
        {
          "text": "Per-sync-cycle owner-less skip with a throttled WARN in syncPositions",
          "why": "The pool is the only feed into the poller; a load-time skip plus owner-gated pool inserts suffices and needs no throttle map."
        }
      ],
      "new_objections": [
        {
          "text": "D-7 has no regression scenario. Add ADMIN (scope '4') + x-user-id user-a + body user_id user-b (and empty body) → only user-a on ListOrders and StreamOrderUpdates through the production chain; headerless → PermissionDenied. Promote it as the durable trading @AC.",
          "blocking": true
        },
        {
          "text": "UpdateBrokerAccountCredentials (trading.go:2672) lets a headerless caller pass the ownership check on a user_id='' row, rewrite its credentials, and re-insert it into the broker pool at :2706. Make it fail closed (callerUserID == \"\" || rec.UserID != callerUserID → PermissionDenied), add it to the D-6 scope with a headerless test, and re-grep all rec.UserID != caller* sites.",
          "blocking": true
        }
      ],
      "closed_objections": [
        {
          "id": "O-1",
          "how": "Header-only was chosen: body user_id is ignored for all scopes and the trading fields are deprecated. The operator-choice component is folded into O-2's D-7 sign-off."
        },
        {
          "id": "O-4",
          "how": "Explicitly out of scope for 312, since neither 315 nor 316 owns these RPCs. 312 files a new defect report for StreamAlerts and AcknowledgeAlert body user_id as a design deliverable."
        },
        {
          "id": "O-5",
          "how": "Merge order recorded: 315 before 312; 322 and 312 in either order with rebase and buf-gen; 326 is marketdata-scoped, so handler/trading.go:112 stays in 312."
        }
      ],
      "reopen_petitions": [],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```
