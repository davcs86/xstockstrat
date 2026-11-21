# Context Log: fix-read-path-owner-trust

> Distilled 2026-11-21 by /sdd-distill. Full pre-distill session prose is in git history (before this commit).

Append-only from here on. Each session appends a new ## Session entry.

## Decisions

Design is approved and the spec is implementation-ready (`design.md`, `debate.md` D-1..D-18 / R-1..R-9 / O-1..O-11 hold the register). Why-level history that lives only in this log:

- **Triage**: three SEV-3 reports (trading ListOrders/StreamOrderUpdates body `user_id` filter where empty = all users; portfolio "default"/"alpaca-default" fallbacks; notify ListAlerts body `userId` unscoped with no identity) share one PLAT-11 violation — ownership from a body field, null fallback or placeholder instead of the trusted `x-user-id`. Root cause: pre-PLAT-11 body filters and test-caller fallbacks left in place, plus a missing empty-caller guard in `RegisterBrokerAccount`. Track C, design depth `full` (security posture, ≥3 services, proto doc change). Services: trading, portfolio, notify (surfaces ui, agent; analysis a preserved `ListOrders` caller).
- **Order reads header-only (D-3/D-7/D-8; operator-signed, record below)**: one `(*TradingService).ResolveOrderOwner(ctx) (string, error)` returns `FromContext(ctx).UserID`, empty → `PermissionDenied` (stated explicitly so fix-grpc-status-mapping does not normalise it; notify keeps code 3, D-4). Body `user_id` is never read for any scope, at the six D-3 sites. The stream path takes identity from the D-1 stream interceptor with RED-first production-chain evidence (D-2). The `broadcastOrder` "empty = all users" arm (`sub.userID != "" &&`, `trading.go:439`) and its docs (`:389-399`) are deleted; `SubscribeOrderUpdates` keeps its signature. Naming (C-18): the spec either justifies the order-specific name or renames it `requireCaller`; the four existing inline checks (`:482,967,1317,1490`) are not refactored onto it.
- **Broker-account fail-closed (D-6/D-13)**: `callerUserID == ""` → `PermissionDenied "caller identity (x-user-id) required"` as first statement in Register (before OFFLINE), UpdateCredentials, List, Deregister (inline house idiom, no helper); `ResumeAccountSvc` stays admin-gated. Motive: `UpdateBrokerAccountCredentials` checked only `rec.UserID != callerUserID`, so a headerless caller could rotate credentials on a `user_id=''` row and re-insert it into the pool (`:2706`). Every pool insert (`:306/:320/:2614/:2652/:2706`) is therefore owner-gated. Handler sites (`handler/trading.go:104,112,277,289,300,315`) map via `connect.NewError(connectCodeFromErr(err), err)` (D-14) because `toGRPCError` masks every service status as Internal; the spec lists each RPC's refusal-code set.
- **`GetOrder` in scope (D-15)**: `ResolveOrderOwner` first (headerless → `PermissionDenied`), non-owner → `NotFound` identical to absent (no existence probing); a per-RPC audit of all 14 `grpcTradingAdapter` RPCs found it the only other unscoped read (reachable via `traderBff.ts:47` and agent `client.py:2545-2552`).
- **Harness (D-2/D-16)**: `internal/service/export_test.go` (`package service`: test constructor + `broadcastOrder` shim, kept minimal) plus `trading_owner_scope_test.go` (`package service_test`) on a bufconn server with the production unary + stream interceptors and `GRPCHandler()`, pgxmock via `NewTradingRepoWithDB` + `testdata/order_rows.go`, RED on the pre-fix tree. Chain hand-mirrored from `main.go:155` can drift (accepted, C-18).
- **Acceptance (D-17)**: `@AC-4` Outline (ListOrders/StreamOrderUpdates × scope 3/4 × body user-b/empty → only user-a), `@AC-5` headerless → `PERMISSION_DENIED`, `@AC-6` cross-user `GetOrder` → `NOT_FOUND`; promoted as durable trading @ACs; appended at spec time.
- **Phantom owner-less broker accounts (D-9)**: `LoadBrokerPool` first loop statement skips `rec.UserID == ""` with `slog.WarnContext(account_id)`; cleanup is a filed follow-up defect report (trigger: the WARN; candidate trading `012` deactivation migration, DBA approval). Side effects recorded: the `resolveAccount` sole-account count flips (`:368-386`), hydration loses the account (`:321-329`), in-flight orders on it become unreconcilable by `pollFills`. Portfolio D-5 ack-and-skip of owner-less events stays as defence in depth.
- **Runbook (D-18)**: under D-7 the mTLS rollout flat-book check (`inter-service-mtls-rollout.md:99-101`) becomes a read-only `operator-db-access.md` query copying the `ListSubmittedOrders` predicate verbatim (`status IN ('new','partially_filled') AND broker_order_id IS NOT NULL AND broker_order_id != ''`, lowercase, `trading_repo.go:307-313`); the "trader surface / ListOrders" option is removed (never cross-account; BFF pins the session).
- **Proto (D-10)**: additive `[deprecated = true]` + "ignored; owner is x-user-id" on `trading.proto:169/:190` and `notify.proto:99`; buf-safe; `trading.proto:169/:190` join the proto constitution's deprecated request-body `user_id` gotcha set, not PROTO-10's admin-selector evidence.
- **Out of scope (D-11)**: notify `StreamAlertsRequest.user_id` (`notify.proto:83`, empty = all) and `AcknowledgeAlert` body `user_id` (`:91`) — no peer owns them (316 covers severities/backpressure, 315 leaves delivery unchanged); 312 files a new defect report (NOTIFY-5 model). Notify `ListAlerts`/`MarkAlertRead` follow D-4.
- **Merge order (D-12)**: 315 before 312 (312 rebases `notifyServiceImpl.ts` and tests); 322 either order with rebase + `buf-gen`; `handler/trading.go:112` stays in 312 unless 326 touches the trading handler (then 312 merges after it; the rule also covers the D-14 handler lines). Comment-only touchpoints: `traderBff.ts:35-36`, `entry_backfill.py:73`, agent `CLAUDE.md:29`. Known-dead header-less `ListOrders` caller `scripts/integration-test.sh:446-448` (Connect `:8051`, outside CI).
- **Rejected alternatives (why)**: any admin body `user_id` selector on order reads, incl. "empty = own, body = other for ADMIN" (R-3/R-4; no named consumer, every live caller sends body = header: `traderBff.ts:35-46`, `client.py:2560-2562`, `entry_backfill.py:79-84`, `servicer.py:6478-6480`; ADMIN bit over mTLS becomes a cross-tenant read); a `SubscribeOrderUpdates` empty-selector reject beside the all-users branch (half-removed dead semantics); a per-sync-cycle throttled-WARN skip in `syncPositions` (the pool is the only feed; load-time skip plus owner-gated inserts suffices); a one-off cleanup migration inside 312 (needs DBA approval, product-spec says no migration, irreversible on prod); assigning the notify siblings to 315/316; harness in `package handler` with fake repo (unexported fields, mTLS `NewTradingService`, no fake-repo seam — F-04 near-miss) or a no-bufconn adapter harness (skips the D-1 interceptor; vacuous-GREEN, R-2); `GetOrder` gate folding headerless and non-owner into one `NotFound` (contradicts D-7); deferring `GetOrder` to a separate report (same bug class, larger exposure than `ListOrders`); a shared `requireCaller` helper for broker-account guards (they take an explicit `callerUserID`; inline is house style).
- **Spec (2026-11-20)**: 20 steps; anchors verified at `origin/feature/fix-read-path-owner-trust@6474bdb6`; Steps 12+13 (proto + proto-gen) are the only atomic unit and the proto unit was deliberately moved AFTER the code steps (SA1019 on generated Go `UserId` at seven read sites would break the trading lint in a proto-first tree; `.golangci.yml:7`) — recorded in the spec Deviation Log, not design.md; the `export_test.go` constructor takes `accounts repository.AccountRepository` (agent `@AC-7` wire proof reaches `accountRepo`). Verbatim spec and review sessions below carry the rest.

## Open Threads

Authoritative list: the two `### Open Threads` sections inside the last two verbatim sessions below. Carried forward from the design-approved section and not repeated there:

- [ ] `debate.md` still shows O-2, O-6, O-8 as `open` although the 2026-11-20 operator decisions resolve them — reconcile at the next register update.
- [ ] Keep `export_test.go` to the constructor plus the broadcast shim so later tests cannot bypass the production chain (harness step); audit every trading stream RPC for behaviour change under the new `StreamServerInterceptor` (middleware step).
- [ ] The handler status remap changes wire codes UI/agent mappers may assume; list each broker-account RPC's refusal codes and prove agent `@AC-7` on the wire (O-10); D-12 governs overlap with 326 — trading handler step.
- [ ] Legacy pre-`user_id` events are dropped on replay incl. the `DeleteOfflineRealized` purge on deregister (accepted, D-5) — portfolio step. Notify test conversion to metadata callers may expose tests relying on the unscoped fallback; rebase on 315 first — notify step.
- [ ] Two defect reports to file: notify `StreamAlerts`/`AcknowledgeAlert` body `user_id` (D-11) and trading `broker_accounts` `user_id=''` cleanup (D-9); record the pre-merge read-only count of active `user_id=''` rows per environment (O-11) — final docs step (spec Step 20 operator gate). Runbook DB-query substitute must land in the same PR as D-7 (O-9).

## Files Modified

None yet (no code written). Artifacts only: `implementation-spec.md` (20 steps), `acceptance.feature` (`@AC-4`..`@AC-6` appended at spec time), `design.md`, `recon.md`, `debate.md`, `product-spec.md`.

## Superseded Sessions

- 2026-11-10 — /sdd-triage: three SEV-3 reports clustered as PLAT-11 violations and routed to Track C, depth `full`; branch `feature/fix-read-path-owner-trust`; details in Decisions.
- 2026-11-10 — sdd-review product-spec: approved, draft → spec-ready after a first review FAILed criterion 5 + trading C-2 (fixed). Warnings: bug-template conventions (no FR-N/@FR tags); AC-3 allows two rejection codes pending OQ2; AC-2 compound; five open questions deferred. Overlap WARN: `trading.proto` shared with 322 (different messages); notify ListAlerts coupling with 315.
- 2026-11-11 — sdd-batch design gate (round 2): halted at the gate; design.md unwritten. Adopted header-only over the admin selector (the proposer's runner-up), folded in the `:2672` headerless-credential-rewrite finding (O-7, confirmed in code) and the `broadcastOrder` dead branch; closed O-1 (operator-choice part moved into the D-7 sign-off), O-4 (notify siblings out of scope), O-5 (merge order); O-2 (D-7 sign-off) and O-6 (no D-7 scenario) blocking. Its `sdd-batch-design-state` fence is superseded by the round-3 fence below.
- 2026-11-13 — sdd-batch design gate (round 3): halted at the gate; closed O-7 and O-3; added D-13..D-18, R-7..R-9; O-2, O-6, O-8 blocking; opened O-9..O-11. Last design-state fence follows verbatim.
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

- 2026-11-20 — sdd-design: Recon (recon.md; services trading, portfolio, notify, ui, agent + analysis as preserved `ListOrders` caller; reuse: inline fail-closed caller check at `trading.go:482,967,1317,1490`, notify header-only code-3 rejection at `notifyServiceImpl.ts:240-243`). 3 rounds (full), approved at the gate; rejected any admin selector / "empty = all users" (R-3, R-4) and the unbuildable or vacuous harness layouts (R-2, R-7). Constitution rules touched C-01, C-08, C-10, C-11, C-13, C-15, C-16, C-18, F-04, P-02, P-03, P-06, PROTO-10, NOTIFY-5, PLAT-4, PLAT-5, PLAT-13; no Floor breaches; no reopen petitions on the register; no ledger line (per-RPC audit trap already in `fails.md`). Status spec-ready → design-approved; debate.md State → approved (Rounds run 3). Operator decisions follow verbatim.

## Session 2026-11-20 — sdd-design (operator decisions, verbatim)

### Operator decisions (2026-11-20, binding)

- **D-7 signed (design gate, option A).** Order reads resolve the owner from the header only. ADMIN loses cross-user order RPCs, and the runbook consumer (`docs/runbooks/inter-service-mtls-rollout.md`) gets the DB-query substitute (D-18). This overrides the trading `CLAUDE.md` "admin empty user_id = all users" contract and the product-spec "admin selector" Expected line. It is the C-16 sign-off for both CHANGE lines in design.md. Resolves O-2.
- **Round-3 synthesis items are binding.** `GetOrder` is in scope (`ResolveOrderOwner` first; headerless → `PermissionDenied`; non-owner → `NotFound` identical to absent). The test harness is `internal/service/export_test.go` plus `trading_owner_scope_test.go` on the bufconn chain with pgxmock. The acceptance edits (scope `3` + body user-b rows, headerless scenario tagged `@AC-5`, multi-line Examples) are adopted. Resolves O-6 and O-8.

## Session 2026-11-20 — sdd-spec

- Generated implementation-spec.md with 20 steps. Status → implementation-ready.
- Appended `@AC-4`, `@AC-5`, `@AC-6` to `acceptance.feature` (D-17, operator decision 2026-11-20). Every scenario `@AC-1`..`@AC-6` is covered by a test step (spec § Scenario Coverage).
- Tree: `origin/feature/fix-read-path-owner-trust` @ `6474bdb6`. All recon and debate.md D-7..D-18 anchors were re-grepped and hold, with the corrections below.
- Key codebase findings:
  - `ResolveOrderOwner` is specced as `(*TradingService).ResolveOrderOwner(ctx) (string, error)` above `GetOrder` (`trading.go:1626`). `GetOrder`'s absent case returns a plain `fmt.Errorf` today (`:1638`), so the fix must return a gRPC `NotFound` status for the absent and non-owner cases alike.
  - The header-only read breaks three existing tests, edited in the same step: `trading_ownership_test.go:120` (the `""` all-users subscriber), `trading_offline_test.go:1860` and `trading_order_race_test.go:34` (`GetOrder` with `context.Background()`).
  - Broker-account handlers return `toGRPCError(err)` on a gRPC status error (`handler/trading.go:277,289,300,315`), which falls through to `Internal`; five `connectCodeFromErr` returns already exist (`:40,53,66,80,93`).
  - No trading migration, config key, env var or port is needed. Last trading migration is `011`; a cleanup `012` is only the candidate in the Step 19 follow-up report.
  - Local `golangci-lint` is built with go1.25 and refuses the go1.27 module, so the SA1019 behaviour below was reasoned, not run.

### Decisions

- **Proto unit moved after the code steps (deviation from design.md's build order).** `[deprecated = true]` makes generated Go `UserId` trip staticcheck SA1019 (`.golangci.yml:7`) at the seven read sites; a proto-first tree could not pass the trading lint in the next step's verification. Steps 12+13 (proto + proto-gen) are the only atomic unit. No D-n depends on the order.
- **`export_test.go` constructor takes `accounts repository.AccountRepository`.** design.md §8 limits it to `repo`/`orders`/`subs` but also puts the agent `@AC-7` wire proof in the same test, and that proof reaches the unexported `accountRepo`. Flagged in the spec for impl-spec review.
- **Design claims corrected by the re-grep.** The two `RegisterBrokerAccount` tests (`trading_offline_test.go:320`, `trading_ibkr_auth_test.go:290`) already pass `"user-1"`, so no step edits them. All existing `listAlerts` tests already use `metaCall`, so the notify test step only adds cases.
- **Consumer surfaces.** ui, agent and analysis each get a comment or wording step only; behaviour is unchanged for an identified caller (design § Consumer surfaces).
- **Portfolio `order.filled` without `account_id`** is skipped with a WARN (D-5) and the dead `"alpaca-default"` block is deleted.

### Open Threads

- Impl-spec review should confirm the two flagged items above (proto order, `accounts` parameter).
- Step 10 needs feature 315 merged into the base first; Step 5 re-greps if 326 touches `handler/trading.go` (D-12).
- Step 20 is an operator gate: the `user_id = ''` active `trading.broker_accounts` count per environment (O-11).
- `debate.md` still shows O-2, O-6 and O-8 as `open`; not changed by this run.
- `scripts/integration-test.sh:446-448` still sends a headerless `ListOrders` on the retired Connect port; out of scope, already dead.

## Session 2026-11-20 — sdd-review impl-spec (advisory)

- Result: 0 failures, 7 criteria warnings, overlap WARN (file-level only; no migration NNN, proto field-number or config-key collision). Advisory — did not block; lifecycle unchanged. Floor breaches: none.

### Addressed (implementation-spec.md edited)

- [x] Step 20: Instruction 2 now asks for a bullet line starting `- O-11 row count:`, matching the Verification grep.
- [x] Step 17: the portfolio Verification counts the literal phrase `acked, WARN-logged and skipped` (4 rows) instead of a bare `skipped`, which already matches `services/xstockstrat-portfolio/CLAUDE.md:32,199`. Instruction 5 requires the phrase.
- [x] Step 6 `accounts` parameter and the Steps 12+13 proto reorder are recorded as spec-time rows in the spec's Deviation Log (design.md is not edited). The reviewer confirmed `staticcheck` at `services/xstockstrat-trading/.golangci.yml:7` and that `nolintlint` is not enabled.
- [x] Step Dependencies gained the peer overlaps that were re-verified: 326 (`origin/main-dev`, `code-completed`) modifies no trading file but does modify `portfolio_service.go` and the portfolio `export_test.go`; 357 (`in-progress`) records its regions as disjoint from 312's; 321 (`origin/feature/fix-trading-config-plumbing`) edits `trading.go` and a comment in `trading.proto` `RegisterBrokerAccountRequest`.

### Open Threads

- [ ] unaddressed — Steps 12+13 reorder and the Step 6 `accounts` parameter need an ack from the proto reviewer and the trading owner (C-18, P-03). Target: `/sdd-execute` mode-entry checkpoint.
- [ ] unaddressed — `docs/roadmap/features/merge-order.md` (`origin/main-dev`) has no table row for "312 after 315" (Step 10, D-12). It names 312 only in prose overlap notes (`notifyServiceImpl.ts` with 316 and 334; `trading.go` with 311, 321 and 347). This run may not edit that file. Target: add the row before `/sdd-execute` reaches Step 10.
- [ ] unaddressed — Step 17 lists 7 files and Step 13 lists 16 generated files, over the 5-file advisory threshold. Not split: Step 13's list is generated output and Step 17 is docs-only; splitting would renumber the spec. Operator call.
- [ ] unaddressed — Steps 3, 4, 5 and 10 cannot go red on their own Verification; the behaviour proof is in the paired test steps 6, 7 and 11. Compliant with the pairing rule; the executor runs the paired test step before reporting the service step verified.
- [ ] unaddressed — Step 20 cannot pass until the operator supplies the two O-11 counts (P-03).
- [ ] unaddressed — Overlap scan scope: the overlap pass read only a trunk checkout, so the impl-specs of peers that exist only on their feature branches (308–311, 313–316, 318–319, 322–325, 327–328, 331) were not scanned. Re-check them on `origin/feature/<slug>` before execute, in particular 315 and 316 (`notifyServiceImpl.ts`) and 322 (`trading.proto`, other messages per D-12).
- [ ] unaddressed — `packages/proto/gen/**` conflicts with 321 and 322: the second merger re-runs `./scripts/buf-gen.sh` (Step 13).
- [ ] unaddressed — Steps 14–17 doc and comment edits: 360 (`code-completed`) references `services/xstockstrat-ui/src/lib/connectClients.ts`, adjacent to Step 14's `traderBff.ts`; not verified to collide. Re-grep at Step 14.

## Session 2026-11-21 — /sdd-distill
- Distilled 7 sessions → header + Superseded Sessions; kept 2 verbatim (sdd-spec, sdd-review impl-spec) plus the sdd-design operator decisions (verbatim operator ruling).
- Dropped the superseded round-2 `sdd-batch-design-state` fence (the round-3 fence is the last and only one; register in debate.md); its content is hoisted into Decisions.
- context.md 535 → 310 lines / 66392 → 45274 bytes. Original prose preserved in git history.
