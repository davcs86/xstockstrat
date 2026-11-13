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

## Session 2026-11-13 — sdd-batch design gate (round 3)

- `/sdd-design fix-read-path-owner-trust` (full) halted at the approval gate after round 3 (gate policy: halt). Per the grilling protocol, design.md is not written and status.md is unchanged. The register is `debate.md` (State in-debate, Rounds run 3).

### Open Threads

- **Approach (round-3 synthesis):** D-1..D-12 stand; R-1..R-6 honoured. Round 3 adds D-13..D-18 and locks R-7..R-9.
  - Broker-account methods Register (`trading.go:2595`, before OFFLINE), UpdateCredentials (`:2664`), List (`:3069`) and Deregister (`:3144`) reject `callerUserID == ""` with `PermissionDenied` as their first statement (inline idiom, no helper); `ResumeAccountSvc` stays admin-gated. Every pool insert (`:306/:320/:2614/:2652/:2706`) is therefore owner-gated (D-13; closes O-7).
  - `GetOrder` (`trading.go:1626-1643`) is in scope: `ResolveOrderOwner(ctx)` first (headerless → `PermissionDenied`), non-owner → `NotFound` identical to absent. A per-RPC audit of all 14 `grpcTradingAdapter` RPCs found it the only other unscoped read (D-15).
  - Handler sites `handler/trading.go:104,112,277,289,300,315` map via `connect.NewError(connectCodeFromErr(err), err)` so `PermissionDenied`/`NotFound`/`FailedPrecondition` reach the wire; the spec lists each broker-account RPC's refusal-code set (D-14).
  - AC evidence harness: `internal/service/export_test.go` (`package service`: test constructor + `broadcastOrder` shim) plus `internal/service/trading_owner_scope_test.go` (`package service_test`) on a bufconn server with the production unary + stream interceptors and `GRPCHandler()`, pgxmock seeding via `NewTradingRepoWithDB` with `testdata/order_rows.go`, RED on the pre-fix tree (D-16).
  - 312 `acceptance.feature` gains `@AC-4` (Outline: ListOrders/StreamOrderUpdates × scope 3/4 × body user-b/empty → only user-a), `@AC-5` (headerless → `PERMISSION_DENIED`), `@AC-6` (cross-user `GetOrder` → `NOT_FOUND`), promoted as durable trading @ACs (D-17).
  - Phantom `user_id=''` broker accounts: `LoadBrokerPool` skip (D-9) plus a named follow-up defect report with a WARN trigger and a candidate trading `012` deactivation migration; side effects recorded under Assumptions (closes O-3).
  - Under D-7 only, the mTLS rollout runbook flat-book check (`inter-service-mtls-rollout.md:99-101`) becomes a read-only `operator-db-access.md` query copying the `ListSubmittedOrders` predicate verbatim; the trader-surface/ListOrders option is removed (D-18).
  - Portfolio D-5, notify D-4/D-11, proto D-10 and merge order D-12 unchanged; D-12's 326 rule now also covers the D-14 handler lines.
- **Strongest open objection:** O-2 (blocking). The operator must sign D-7 verbatim (header-only trading order reads; no cross-user order RPC for any scope; headerless → `PermissionDenied`), overriding trading `CLAUDE.md:45-51` "empty = all users" and the product-spec "admin selector" line. New input for that decision: the runbook consumer at `inter-service-mtls-rollout.md:99-101` and its DB-query substitute (D-18).
  - Also blocking: O-6 (proposer must adopt the D-16 harness layout and the `@AC-4/5` acceptance fixes) and O-8 (proposer must adopt the D-15 `GetOrder` gate and confirm the 14-RPC audit).
  - Non-blocking, open: O-9 (runbook predicate verbatim), O-10 (agent `@AC-7` on the wire + refusal-code list), O-11 (pre-merge read-only count of active `user_id=''` broker_accounts per environment, recorded here).
- **Floor status:** no Floor breaches.
- **Uncovered @AC changes (none covered by an operator decision yet):**
  - CHANGE: trading `CLAUDE.md` "admin empty user_id = all users" (no durable @AC).
  - CHANGE: 312 product-spec Expected "body user_id honoured only as an admin selector" (PROTO-10).
  - EXTEND: @AC-1, @AC-2, @AC-3 (312); new @AC-4, @AC-5, @AC-6 (312); xstockstrat-agent @AC-7 `agent-broker-account-tools.feature`.
  - PRESERVE: xstockstrat-ui @AC-2 @feature-270; xstockstrat-notify @AC-1..@AC-5 @feature-203.
- **Next:** operator signs or declines D-7 (O-2). Then re-run `/sdd-batch` to resume at round 4 from the state below.

```sdd-batch-design-state
{
  "round": 3,
  "synth": {
    "approach": "Round-3 synthesis. D-1..D-12 stand and R-1..R-6 are honoured. This round adopts the proposer's O-7 and O-3 fixes. Three corrections from the adversary are folded in, and I verified each against the code (trading.go, handler/trading.go, trading_repo.go, internal/service test layout).\n\n**1. Broker-account owner gate, fail-closed (extends D-6; closes O-7).**\n- `callerUserID == \"\"` is the first statement in each of:\n  - `RegisterBrokerAccount` (trading.go:2595, before the OFFLINE branch)\n  - `UpdateBrokerAccountCredentials` (:2664; :2672 today checks only `rec.UserID != callerUserID`, and :2706 re-inserts into the pool)\n  - `ListBrokerAccountsSvc` (:3069; `account_repo.go:84-92` would otherwise list `user_id=''` rows)\n  - `DeregisterBrokerAccountSvc` (:3144)\n- It returns `PermissionDenied \"caller identity (x-user-id) required\"`, using the inline house idiom (:482,967,1317,1490). No new helper.\n- `ResumeAccountSvc` (:3180) is already gated by `RequireAdminScope` and is left alone.\n- The broker-account handlers (`handler/trading.go:277,289,300,315`) change from `toGRPCError(svcErr)` to `connect.NewError(connectCodeFromErr(err), err)`. Today `toGRPCError` (:223-238) masks every service status as Internal.\n- The PR or spec lists the full refusal-code set per broker-account RPC (fails.md:3084):\n  - Register: PermissionDenied (headerless), InvalidArgument\n  - Update: PermissionDenied (headerless or non-owner), NotFound, FailedPrecondition (offline)\n  - List: PermissionDenied (headerless)\n  - Deregister: PermissionDenied (headerless or non-owner), NotFound\n- Tests (service level, following the `trading_offline_test.go` / `trading_ibkr_auth_test.go` patterns):\n  - headerless Update on a `user_id=''` row: PermissionDenied, credentials unchanged, no `s.brokers` entry\n  - headerless Register (ALPACA, IBKR, OFFLINE): PermissionDenied, nothing persisted\n  - headerless Deregister and List: PermissionDenied\n  - the caller-less Register tests at `trading_offline_test.go:320` and `trading_ibkr_auth_test.go:290` gain a caller\n- Wire-level proof of agent `@AC-7` (non-owner PermissionDenied, headerless PermissionDenied, offline FailedPrecondition) runs through the bufconn chain in item 4.\n\n**2. `GetOrder` owner scope (new; the RPC-surface audit gap).**\n- `TradingService.GetOrder` (trading.go:1626-1643) returns any order by `order_id` from `s.orders` or `s.repo.GetOrder` without consulting the caller. The UI BFF reaches it (`traderBff.ts:47`) and so does the agent (`client.py:2545-2552`).\n- Fix:\n  - First statement: `owner, err := s.ResolveOrderOwner(ctx)`. A headerless call returns PermissionDenied before any lookup, which matches D-7.\n  - After the lookup, `order.UserId != owner` returns `status.Error(codes.NotFound, ...)`, identical to an absent order, so existence cannot be probed.\n  - `handler/trading.go:104` changes from a blanket `CodeNotFound` to `connectCodeFromErr(err)`, so PermissionDenied reaches the wire.\n- The audit is now done per RPC, not per comparison. I enumerated all 14 `grpcTradingAdapter` RPCs:\n  - PlaceOrder: :482\n  - ConfirmOrder: :967\n  - CancelOrder: :1317\n  - ReplaceOrder: :1490\n  - SnapshotOfflinePositions: :1178 / :1196\n  - GetOrder: fixed here\n  - ListOrders and StreamOrderUpdates: D-3 / D-7\n  - Register, List, Update and Deregister broker accounts: item 1\n  - ResumeAccount: admin-gated\n  - GetTradingEnvironment: no per-user data\n- No other unscoped read path exists in trading.\n\n**3. Order reads are header-only (D-3/D-7/D-8 unchanged).**\n- `ResolveOrderOwner` is called at the six D-3 sites, plus `GetOrder` as above.\n- The `broadcastOrder` `sub.userID != \"\"` arm (:439) and the docs at :389-399 are deleted.\n\n**4. AC evidence harness (D-2; corrects the proposal's unbuildable layout).**\n- All 25 test files in `internal/service` are `package service`. `repo`, `orders`, `subs` and `broadcastOrder` are unexported. `NewTradingService` (:215-260) dials peers over mTLS. A test in `package service` cannot import `handler`, because that is an import cycle.\n- The stated design is therefore:\n  - (a) A new `internal/service/export_test.go` (`package service`) exports a test constructor that sets `repo`, `orders` and `subs`, plus a `BroadcastOrderForTest` shim.\n  - (b) A new `internal/service/trading_owner_scope_test.go` in external `package service_test` imports `handler` and `middleware` and builds a bufconn server with `ChainUnaryInterceptor(middleware.UnaryServerInterceptor)` and `ChainStreamInterceptor(middleware.StreamServerInterceptor)`, mirroring `main.go:155`. It registers `GRPCHandler()` (`main.go:163`). The bufconn plumbing follows `telemetry_allowlist_test.go:127-140`.\n- Seeding:\n  - repo via pgxmock through `repository.NewTradingRepoWithDB` (`trading_repo.go:41`), with rows from `internal/testdata/order_rows.go` (C-13), as in `trading_offline_test.go:1624-1631`\n  - a repo error to exercise the in-memory fallback at :1652\n  - the broadcast shim, after subscribe, to exercise the live stream path\n- The test must be RED on the pre-fix tree.\n\n**5. Acceptance scenarios (312 `acceptance.feature`, promoted as durable trading @ACs under C-16).**\n- `@AC-4 @regression` Scenario Outline with a multi-line Examples table:\n  - columns: `rpc | scope | body`\n  - rows, for each of ListOrders and StreamOrderUpdates: `3 | user-b`, `4 | user-b`, `4 | (empty)`\n  - Then: only user-a's orders are delivered. The scope-3 rows cover report 1's real exploit.\n- `@AC-5 @regression`: ListOrders, StreamOrderUpdates or GetOrder with no x-user-id fails with PERMISSION_DENIED and delivers no order.\n- `@AC-6 @regression`: GetOrder with x-user-id user-a for user-b's order_id fails with NOT_FOUND, indistinguishable from an absent id, for scopes 3 and 4.\n\n**6. Phantom broker accounts (D-9; closes O-3).**\n- The `LoadBrokerPool` skip is the first statement of the loop (:302, before :305). Every pool-insert site is owner-gated: :306/:320 by the skip, :2614/:2652 by Register, :2706 by Update.\n- Deliverable: a follow-up `docs/reports/` defect, \"trading broker_accounts rows with user_id='' need cleanup\".\n  - Its trigger is the WARN.\n  - Before merge, run a read-only `SELECT count(*) FROM trading.broker_accounts WHERE user_id = '' AND is_active` per environment via `docs/runbooks/operator-db-access.md` and record the count in `context.md`.\n  - Candidate fix: a trading `012` deactivation migration (DBA approval).\n- The side effects stay recorded under Assumptions: the `resolveAccount` flip at :368-386, lost hydration at :321-329, and in-flight orders that `pollFills` cannot reconcile.\n\n**7. O-2 package for the operator (unchanged, blocking).**\n- The operator signs D-7 verbatim, including its two CHANGE targets: trading `CLAUDE.md` \"empty = all users\", and the product-spec \"admin selector\" line.\n- New input for the operator: `docs/runbooks/inter-service-mtls-rollout.md:99-101` checks a flat book \"across all accounts\" via the trader surface or `ListOrders`. Neither path was ever cross-account for an end user (the BFF pins the session at `traderBff.ts:40-46`), and D-7 removes the RPC path entirely.\n- Proposed handling under D-7, in the same PR:\n  - Rewrite that step as a read-only query through `operator-db-access.md` that copies the `ListSubmittedOrders` predicate verbatim (`trading_repo.go:310-312`): `status IN ('new','partially_filled') AND broker_order_id IS NOT NULL AND broker_order_id != ''`. Values are lowercase.\n  - Remove the \"trader surface / ListOrders\" option.\n\n**8. Everything else as settled.** Portfolio D-5, notify D-4/D-11, proto D-10 and merge order D-12 are unchanged. D-12's 326 rule now also covers `handler/trading.go:104,277,289,300,315`. The comment-only touchpoints and the analysis preserved caller are unchanged.\n\n**Build order:**\n1. proto, then buf-gen\n2. trading middleware stream interceptor, then `main.go:155`\n3. trading service: `ResolveOrderOwner`, `GetOrder`, the `broadcastOrder` arm, the four broker-account guards, the `LoadBrokerPool` skip\n4. trading handler: the six D-3 sites, plus status mapping at :104,112,277,289,300,315\n5. `export_test.go` and the bufconn owner-scope test\n6. portfolio\n7. notify (after rebasing on 315)\n8. docs: runbook, trading `CLAUDE.md`, acceptance, the two defect reports, and the `context.md` row count",
    "open_objections": [
      {
        "text": "O-2 / D-7 still needs operator sign-off. Header-only order reads remove every cross-user order RPC for ADMIN and override both the trading CLAUDE.md:45-51 'empty = all users' contract and the product-spec 'admin selector' Expected line. The runbook consumer at inter-service-mtls-rollout.md:99-101 now has a proposed DB-query substitute. Design approval is blocked until the operator signs D-7 in context.md.",
        "blocking": true
      },
      {
        "text": "O-6 stays open because the round-3 harness cannot be built where it was placed. A package handler test cannot reach the unexported repo/orders/subs fields or the broadcastOrder method, NewTradingService dials peers over mTLS, and no fake-repo seam exists. The proposer must adopt the synthesis layout: internal/service/export_test.go (package service) plus internal/service/trading_owner_scope_test.go (package service_test), using the bufconn production chain and pgxmock via NewTradingRepoWithDB with testdata/order_rows.go. It must also fix the acceptance edits: add the non-admin scope '3' + body user-b rows, tag the headerless scenario @AC-5, and write Examples as a multi-line table.",
        "blocking": true
      },
      {
        "text": "GetOrder (trading.go:1626-1643) is an unscoped cross-tenant order read, reachable via traderBff.ts:47 and agent client.py:2545-2552. The proposal's 'no other site exists' came from an owner-comparison grep, which cannot find a path with no comparison (fails.md:3159). The synthesis puts it in scope: ResolveOrderOwner first (headerless → PermissionDenied), non-owner → NotFound identical to absent, handler :104 → connectCodeFromErr, plus @AC-5/@AC-6 evidence through the bufconn chain. The proposer must adopt this and confirm the 14-RPC audit.",
        "blocking": true
      },
      {
        "text": "The runbook replacement must copy the ListSubmittedOrders predicate verbatim (lowercase 'new'/'partially_filled' and a non-empty broker_order_id, trading_repo.go:310-312) and route it through operator-db-access.md. It must also drop the 'trader surface / ListOrders' option, which was never cross-account (traderBff.ts:40-46).",
        "blocking": false
      },
      {
        "text": "Prove agent @AC-7 (agent-broker-account-tools.feature) on the wire through the bufconn chain: non-owner PermissionDenied, headerless PermissionDenied, and offline FailedPrecondition. List every refusal code per broker-account RPC so the UI and agent mappers stay consistent (fails.md:3084).",
        "blocking": false
      },
      {
        "text": "Before merge, run a one-time read-only count of active user_id='' broker_accounts rows per environment via operator-db-access.md and record it in context.md, so the cleanup follow-up starts from a known count instead of waiting for the startup WARN after a redeploy.",
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
        "ac_id": "@AC-4 (312, new) — order reads scoped to x-user-id for scopes 3 and 4, body user_id ignored; promoted as durable trading @AC",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-5 (312, new) — headerless ListOrders/StreamOrderUpdates/GetOrder → PERMISSION_DENIED",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-6 (312, new) — GetOrder for another user's order → NOT_FOUND",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "xstockstrat-agent @AC-7 agent-broker-account-tools.feature (non-owner → PERMISSION_DENIED; now true on the wire via the handler status remap)",
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
      "Put the AC-4 harness in package handler (internal/handler/trading_owner_scope_test.go) with an 'exported constructor with fakes' and a 'fake repo'. Lost: repo/orders/subs and broadcastOrder are unexported, NewTradingService dials mTLS peers, and no fake-repo seam exists (F-04 near-miss). Use export_test.go plus an external package service_test instead.",
      "Harness in package service that calls the gRPC adapter directly, without bufconn. Lost: it skips the D-1 StreamServerInterceptor, the same vacuous-GREEN trap as R-2.",
      "GetOrder gate with the inline :967 idiom that folds headerless and non-owner into a single NotFound. Lost: D-7 states PermissionDenied for missing identity on trading order reads. ResolveOrderOwner as the first statement keeps headerless → PermissionDenied before any lookup (no probe), while non-owner stays NotFound.",
      "Declare GetOrder out of scope and file a separate defect, as with D-11. Lost: it is the same bug class (an unscoped trading order read) in a service 312 already edits, the fix is a few lines plus a test, and deferring it would leave an exposure larger than ListOrders, which the BFF at least pins.",
      "A shared requireCaller helper for the broker-account guards. Lost: those methods take an explicit callerUserID param rather than ctx, and the inline == \"\" idiom is the house style (trading.go:482,967,1317,1490)."
    ],
    "open_risks": [
      "Removing every cross-user order RPC leaves the operator flat-book check dependent on the DB-query substitute. If the operator signs D-7 without it, the mTLS rollout gate could be cleared on an operator's own orders only, while the real book is not flat.",
      "The bufconn interceptor chain is hand-mirrored from main.go:155. It can drift without a failing test; this is accepted instead of adding an exported ServerOptions() helper (C-18).",
      "export_test.go exposes internals to the external test package only. A careless shim could let later tests bypass the production chain (R-2 regression); the spec should keep the shim minimal: constructor plus broadcast.",
      "The handler status remap at :104,277,289,300,315 changes wire codes that UI and agent mappers may assume today (e.g. NotFound/InvalidArgument formerly surfaced as Internal). It overlaps with 326 / fix-grpc-status-mapping if either touches handler/trading.go; D-12 governs.",
      "The LoadBrokerPool skip changes resolveAccount's sole-account behaviour (trading.go:368-386) and drops phantoms from hydration (:321-329). In-flight orders on phantom accounts become unreconcilable by pollFills.",
      "The new StreamServerInterceptor (D-1) applies to every trading stream RPC; audit for behaviour change.",
      "Legacy pre-user_id events are dropped on replay (D-5), including the DeleteOfflineRealized purge on deregister (portfolio_service.go:1569).",
      "Notify test conversion from body userId to metadata may expose tests that depend on the unscoped fallback; 312 rebases on 315."
    ],
    "constitution_rules_touched": [
      "C-01",
      "C-08",
      "C-10",
      "C-11",
      "C-13",
      "C-15",
      "C-16",
      "C-18",
      "F-04",
      "P-02",
      "P-03",
      "P-06",
      "PROTO-10",
      "NOTIFY-5",
      "PLAT-4",
      "PLAT-5",
      "PLAT-13"
    ],
    "rationale": "**O-7 closes.** The proposer answered it concretely:\n- the empty-caller guard is the first statement in all four broker-account methods\n- headerless tests, including Update on a `user_id=''` row with a no-pool-entry assertion\n- the re-grep table\n- the handler status remap that makes PermissionDenied observable\n\nI confirmed the code facts: `:2672` and `:3149` compare without an empty check; `ResumeAccountSvc` `:3180` is admin-gated.\n\n**O-3 closes.** Every pool-insert site is now owner-gated, the follow-up report and its trigger are named deliverables, and the side effects are recorded. The adversary's count-query suggestion is carried as a new non-blocking objection, not as a condition on closing O-3.\n\n**O-6 stays open and blocking.** The proposal's harness cannot be built:\n- all 25 `internal/service` tests are `package service`\n- the fields it needs are unexported\n- `NewTradingService` dials over mTLS\n- `package service` cannot import `handler` (import cycle)\n\nThe synthesis folds in the only layout that needs no new production surface (`export_test.go` plus an external `service_test` package), together with the scope-3 exploit rows and the C-15 tag and table fixes. The objection stays open until the proposer adopts them.\n\n**`GetOrder` is a new blocking objection.**\n- Verified: `trading.go:1626-1643` has no caller check, and the handler at `:104` maps every error to NotFound.\n- I did the RPC-level audit myself across all 14 adapter RPCs; `GetOrder` is the only unscoped one.\n- It is brought into scope via `ResolveOrderOwner`. That keeps D-7's PermissionDenied for missing identity and uses NotFound for non-owners, so existence cannot be probed. This is an EXTEND, not a CHANGE: no documented contract grants cross-user `GetOrder`.\n\n**Runbook facts verified.** Status values are stored lowercase, and the `ListSubmittedOrders` predicate is at `trading_repo.go:307-313`.\n\n**O-2 remains operator-only.** The runbook consumer at `inter-service-mtls-rollout.md:99-101` is new evidence, not yet on record. It is surfaced as input to D-7, not as a REOPEN of R-3/R-4.\n\n**Register check.** No settled D-n is contradicted and no locked R-n is reintroduced. The `GetOrder` gate reuses D-3/D-7's resolver. The harness honours D-2/R-2. There are no reopen petitions.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "Broker-account methods RegisterBrokerAccount (:2595, before OFFLINE), UpdateBrokerAccountCredentials (:2664), ListBrokerAccountsSvc (:3069) and DeregisterBrokerAccountSvc (:3144) reject callerUserID == \"\" with PermissionDenied as their first statement (inline idiom, no helper). ResumeAccountSvc stays admin-gated. Every LoadBrokerPool/Register/Update pool insert is therefore owner-gated.",
          "evidence": "trading.go:2595,2664-2674,2701-2707,3069-3070,3144-3151,3180-3183; account_repo.go:84-92; handler/trading.go:258-268"
        },
        {
          "text": "Trading handler sites handler/trading.go:104 (GetOrder), :112 (ListOrders), and :277,289,300,315 (broker accounts) map service errors via connect.NewError(connectCodeFromErr(err), err) instead of a blanket code or toGRPCError, so PermissionDenied, NotFound and FailedPrecondition reach the wire. Each broker-account RPC's refusal-code set is listed in the spec.",
          "evidence": "handler/trading.go:104,223-238,242-256,277,289,300,315; fails.md:3084"
        },
        {
          "text": "GetOrder is in 312 scope. Its first statement is ResolveOrderOwner(ctx) (headerless → PermissionDenied before any lookup). A non-owner gets status NotFound, identical to an absent order. The audit is per RPC: all 14 grpcTradingAdapter RPCs are accounted for, and GetOrder was the only unscoped read.",
          "evidence": "trading.go:1626-1643 (no caller check); traderBff.ts:47; client.py:2545-2552; handler/trading.go:97-107; adapter RPC list in handler/trading.go"
        },
        {
          "text": "The AC evidence harness is internal/service/export_test.go (package service: test constructor setting repo/orders/subs, plus a broadcastOrder shim) with internal/service/trading_owner_scope_test.go in external package service_test. It uses a bufconn server with the production unary and stream interceptors and GRPCHandler(), repo seeding via pgxmock through repository.NewTradingRepoWithDB with internal/testdata/order_rows.go, and is RED on the pre-fix tree.",
          "evidence": "trading.go:149,165,168,215-260,435 (unexported/mTLS); all internal/service tests are package service; trading_repo.go:41; trading_offline_test.go:1624-1631; telemetry_allowlist_test.go:127-140; main.go:155,163"
        },
        {
          "text": "The 312 acceptance.feature gains @AC-4 (Outline over ListOrders/StreamOrderUpdates × scope 3/4 × body user-b/empty → only user-a), @AC-5 (headerless ListOrders/StreamOrderUpdates/GetOrder → PERMISSION_DENIED) and @AC-6 (GetOrder of another user's order → NOT_FOUND), with multi-line Examples tables. All three are promoted as durable trading @ACs at launch.",
          "evidence": "C-15/C-16; report 1 exploit (non-admin + body user-b); adversary r3 objections 3-4"
        },
        {
          "text": "Under D-7, the mTLS rollout runbook's cross-account flat-book check (inter-service-mtls-rollout.md:99-101) becomes a read-only query via operator-db-access.md that copies the ListSubmittedOrders predicate verbatim (status IN ('new','partially_filled') AND broker_order_id IS NOT NULL AND broker_order_id != ''). The trader-surface/ListOrders option is removed. This takes effect only if the operator signs D-7.",
          "evidence": "inter-service-mtls-rollout.md:99-101; trading_repo.go:307-313; traderBff.ts:40-46"
        }
      ],
      "new_rejected": [
        {
          "text": "AC-4 harness in package handler using an 'exported constructor with fakes' or a 'fake repo' that records userID",
          "why": "The service fields and broadcastOrder are unexported, NewTradingService dials mTLS peers, and no fake-repo seam exists; the spec would cite invented symbols (F-04)."
        },
        {
          "text": "GetOrder gate that collapses headerless and non-owner into a single NotFound (inline :967 idiom)",
          "why": "It contradicts D-7's explicit PermissionDenied for missing identity on trading order reads. ResolveOrderOwner-first already prevents probing."
        },
        {
          "text": "Defer GetOrder to a separate defect report (D-11 style)",
          "why": "It is the same bug class in a service 312 already edits, with a small fix. Deferring it leaves an exposure larger than ListOrders."
        }
      ],
      "new_objections": [
        {
          "text": "GetOrder (trading.go:1626-1643) is an unscoped cross-tenant order read, reachable via traderBff.ts:47 and the agent's client.py:2545-2552. The proposer's 'no other site exists' came from an owner-comparison grep. The proposer must adopt the ResolveOrderOwner-first gate (non-owner → NotFound), the handler :104 remap, @AC-5/@AC-6 evidence through bufconn, and the 14-RPC audit.",
          "blocking": true
        },
        {
          "text": "The runbook replacement query must copy the ListSubmittedOrders predicate verbatim (lowercase statuses and a non-empty broker_order_id) via operator-db-access.md, and must drop the 'trader surface / ListOrders' option, which was never cross-account.",
          "blocking": false
        },
        {
          "text": "Prove agent @AC-7 on the wire through the bufconn chain (non-owner PermissionDenied, headerless PermissionDenied, offline FailedPrecondition), and list every refusal code per broker-account RPC.",
          "blocking": false
        },
        {
          "text": "Before merge, run a one-time read-only count of active user_id='' broker_accounts per environment via operator-db-access.md and record it in context.md for the cleanup follow-up.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-7",
          "how": "Adopted: the empty-caller guard is the first statement of Register/Update/List/Deregister; headerless tests include Update on a user_id='' row with no pool entry; the re-grep plus the per-RPC audit found no other site; handler status remap at :277,289,300,315 surfaces PermissionDenied."
        },
        {
          "id": "O-3",
          "how": "Every pool-insert site (:306/:320/:2614/:2652/:2706) is owner-gated. The cleanup follow-up report with its WARN trigger and candidate 012 migration is a named deliverable, and the LoadBrokerPool side effects are recorded under Assumptions."
        }
      ],
      "reopen_petitions": [],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```
