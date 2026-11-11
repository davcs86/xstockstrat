# Debate Register: fix-read-path-owner-trust

**State**: in-debate
**Mode**: full
**Rounds run**: 2 (round numbers continue across runs; the mode's 2–5 / 1 bounds count this run only)

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-11 | /sdd-batch | 6 | 3 | 0 | 5 | 0 | yes |
| 2 | 2026-11-11 | /sdd-batch | 6 | 3 | 3 | 2 | 0 | yes |

## Settled Decisions

<!-- Status: settled → superseded by D-m (only after a user-approved REOPEN) -->
| ID | Round | Decision | Evidence | Status |
|---|---|---|---|---|
| D-1 | 1 | Trading propagation identity is carried on stream RPCs by a new middleware.StreamServerInterceptor (shared extraction helper with UnaryServerInterceptor, propagation.go) registered via grpc.ChainStreamInterceptor in cmd/server/main.go. The stream adapter does not read metadata ad hoc. | cmd/server/main.go:155 registers only ChainUnaryInterceptor; no StreamServerInterceptor in services/xstockstrat-trading (grep); PropagationData populated only at internal/middleware/propagation.go:19-41 | settled |
| D-2 | 1 | AC-1's stream clause is proven through the production interceptor chain (bufconn or adapter behind StreamServerInterceptor with NewIncomingContext). A two-user seed asserts the other user's order is absent on the wire, and the test is RED on the pre-fix tree. Scoping of the dead service method TradingService.StreamOrderUpdates is not AC evidence. | fails.md fix-analysis-owner-scope :3350-3353; fails.md fix-edge-owner-scope :3618-3621; trading.go:1726-1745 has no non-test caller | settled |
| D-3 | 1 | A single exported ResolveOrderOwner is called from all six order body-read sites (trading.go:1646,1652,1730; handler/trading.go:117-119,204-206). | C-18 DRY; adversary r1 | settled |
| D-4 | 1 | Notify ListAlerts rejects a missing x-user-id with code 3 (INVALID_ARGUMENT), ignores body userId, and keeps untargeted alerts (target_user_id IS NULL) visible. Existing body-only tests are converted to metadata callers. | notifyServiceImpl.ts:175,240-243; NOTIFY-5; notify acceptance alert-read-unread-persistence.feature (feature-203) | settled |
| D-5 | 1 | Portfolio owner-less events (positions.synced, balance.synced, deregistered, and order.filled without account_id) are acked, WARN-logged and skipped, never filed under 'default'/'alpaca-default'. Legacy replay drops are accepted. | portfolio_service.go:433-436,1553-1559,1602-1615,1762; 312 acceptance.feature @AC-2 | settled |
| D-6 | 1 | RegisterBrokerAccount rejects an empty caller before the OFFLINE branch, and DeregisterBrokerAccountSvc rejects an empty caller. | trading.go:2595-2606,3149 | settled |
| D-7 | 2 | Trading order reads take the owner from the header only. ResolveOrderOwner(ctx) returns FromContext(ctx).UserID, or PermissionDenied when it is empty; body user_id is never read for any scope. The missing-identity code for trading is PermissionDenied and is stated explicitly so peers do not normalise it. Final sanction of the contract change rests on the operator-signed D-7 (O-2). | traderBff.ts:35-46; client.py:2560-2562; entry_backfill.py:79-84; servicer.py:6478-6480 (body = header at every live caller) | settled |
| D-8 | 2 | The 'empty = all users' subscriber semantics are deleted. The `sub.userID != ""` arm in broadcastOrder (trading.go:439) and the docs at :389-399 are removed; the upstream resolver guarantees a non-empty selector, and the SubscribeOrderUpdates signature is unchanged. | trading.go:389-400,436-442 (verified) | settled |
| D-9 | 2 | LoadBrokerPool skips rec.UserID == "" rows with slog.WarnContext(account_id) and continue, as the loop's first statement. Row cleanup is a filed follow-up triggered by the startup WARN appearing in dev or prod logs. | trading.go:302-320,2436-2446; trading.go:317-318 skip idiom | settled |
| D-10 | 2 | Proto changes are additive only. trading.proto:169 and :190 and notify.proto:99 get [deprecated = true] with an 'ignored; owner is x-user-id' comment. trading.proto:169/:190 are added to the proto constitution's deprecated request-body user_id gotcha set, not to PROTO-10's admin-selector evidence. | CLAUDE.md § Approval Flow; packages/proto/docs/context-constitution.md:28 | settled |
| D-11 | 2 | Notify StreamAlertsRequest.user_id (notify.proto:83) and AcknowledgeAlert body user_id (notify.proto:91) are out of scope for 312. 312 files a new defect report for them on the NOTIFY-5 model. | 316 product-spec lines 12 and 22; 315 product-spec line 17 | settled |
| D-12 | 2 | Merge order: 315 before 312 (312 rebases notifyServiceImpl.ts and its tests). 322 and 312 in either order; the second rebases and re-runs buf-gen. handler/trading.go:112 connectCodeFromErr stays in 312 unless 326 turns out to touch the trading handler, in which case 312 merges after 326. | 326 scope marketdata_handler.go:513; 322 edits trading.proto:336 | settled |

## Rejected Alternatives (locked)

<!-- Status: locked → reopened @ round N (user, context.md <ISO>) -->
| ID | Round | Alternative | Why rejected | Status |
|---|---|---|---|---|
| R-1 | 1 | Reading incoming metadata directly in the trading gRPC stream adapter as the identity source | Creates a second identity-extraction idiom beside FromContext (C-18), and later stream RPCs would repeat the bug. | locked |
| R-2 | 1 | Proving AC-1's stream clause via TradingService.StreamOrderUpdates seeded with WithPropagationData | Vacuously GREEN; it hides the missing stream interceptor (fails.md fix-analysis-owner-scope). | locked |
| R-3 | 1 | Admin with an empty body user_id = all users on ListOrders/StreamOrderUpdates | No live caller needs cross-user enumeration, and it is the only unscoped RPC path. | locked |
| R-4 | 2 | Admin body user_id selector on trading ListOrders/StreamOrderUpdates (any variant, including 'empty = own, body = other user for ADMIN') | No named consumer (C-18 YAGNI); the ADMIN bit over mTLS becomes a cross-tenant order read; it needs RequireAdminScope in the stream path. | locked |
| R-5 | 2 | Keeping both a SubscribeOrderUpdates empty-selector reject and the broadcastOrder `sub.userID != ""` all-users branch | Half-removed dead semantics with no error return (C-18); the branch is deleted instead. | locked |
| R-6 | 2 | Per-sync-cycle owner-less skip with a throttled WARN in syncPositions | The pool is the only feed into the poller; a load-time skip plus owner-gated pool inserts suffices and needs no throttle map. | locked |

## Objections

<!-- Status: open → closed @ round N (<how>) | waived @ round N (user) | reopened @ round N (user) -->
| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|
| O-1 | 1 | Admin selector branch has no named consumer (C-18 YAGNI). Either name one, or go header-only with the trading fields deprecated. Needs operator choice. | no | closed @ round 2 (Header-only was chosen: body user_id is ignored for all scopes and the trading fields are deprecated. The operator-choice component is folded into O-2's D-7 sign-off.) |
| O-2 | 1 | C-16 CHANGE: the trading contract 'admin empty user_id = all users' (CLAUDE.md:45-49) becomes 'own orders' and must be recorded as an operator-signed D-n. | yes | open |
| O-3 | 1 | Phantom user_id='' broker accounts will emit owner-less events forever under OQ3. Add a producer-side skip in syncPositions, or record the cleanup migration as a follow-up with a trigger. | no | open |
| O-4 | 1 | Notify siblings StreamAlertsRequest.user_id (notify.proto:83, 'empty = all') and AcknowledgeAlert body user_id (notify.proto:91) need a recorded owner (315 / fix-notify-stream-contract) or an explicit out-of-scope statement. | no | closed @ round 2 (Explicitly out of scope for 312, since neither 315 nor 316 owns these RPCs. 312 files a new defect report for StreamAlerts and AcknowledgeAlert body user_id as a design deliverable.) |
| O-5 | 1 | Record a merge order with 315 (notify ListAlerts), 322 (trading.proto) and fix-grpc-status-mapping (handler/trading.go:112, toGRPCError). | no | closed @ round 2 (Merge order recorded: 315 before 312; 322 and 312 in either order with rebase and buf-gen; 326 is marketdata-scoped, so handler/trading.go:112 stays in 312.) |
| O-6 | 2 | D-7 has no regression scenario. Add ADMIN (scope '4') + x-user-id user-a + body user_id user-b (and empty body) → only user-a on ListOrders and StreamOrderUpdates through the production chain; headerless → PermissionDenied. Promote it as the durable trading @AC. | yes | open |
| O-7 | 2 | UpdateBrokerAccountCredentials (trading.go:2672) lets a headerless caller pass the ownership check on a user_id='' row, rewrite its credentials, and re-insert it into the broker pool at :2706. Make it fail closed (callerUserID == "" // rec.UserID != callerUserID → PermissionDenied), add it to the D-6 scope with a headerless test, and re-grep all rec.UserID != caller* sites. | yes | open |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|
