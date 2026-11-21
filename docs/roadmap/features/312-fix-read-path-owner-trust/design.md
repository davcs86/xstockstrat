# Design: fix-read-path-owner-trust

**Created**: 2026-11-20
**Rounds**: 3 (full; termination: approved)
**Approved by**: user @ 2026-11-20 (design gate, option A — context.md `## Session 2026-11-20 — sdd-design`)
**Grounded in**: recon.md
**Debate register**: debate.md

---

## Chosen Approach

Ownership on every read and consume path comes from the trusted `x-user-id` header (PLAT-11). A body
`user_id` is never read, and a missing identity is rejected or skipped, never replaced by a
placeholder. Decisions D-1..D-18 in `debate.md` are the binding register; this section is their
design-level summary.

Citation convention: `recon.md § <section>` cites the dossier. Round 2–3 findings that post-date the
dossier are cited as `debate.md D-n` (the Evidence cell holds the `path:line`). `/sdd-spec` must
re-grep every one of them on the feature tree before a step cites it (C-01, F-04).

### 1. Trading order reads are header-only (D-3, D-7, D-8, D-15)

- One exported `ResolveOrderOwner(ctx)` returns `middleware.FromContext(ctx).UserID`
  (`internal/middleware/propagation.go:15,37`, recon.md § Codebase Map), or `PermissionDenied` when
  it is empty. The body `user_id` is not read for any scope, ADMIN included.
- It replaces the body read at the six sites recon lists (recon.md § Codebase Map and § Risks
  "Two subscription sites"):
  - service `ListOrders` repo call, `trading.go:1645-1646`
  - service `ListOrders` in-memory fallback, `trading.go:1652`
  - service `StreamOrderUpdates` snapshot, `trading.go:1730`
  - Connect handler subscription, `handler/trading.go:117-119`
  - gRPC adapter subscription, `handler/trading.go:204-206`
- The owner is resolved before the repo or the fallback is reached, because both treat `""` as all
  users (`trading_repo.go:229-231`, `trading.go:1652`; recon.md § Risks).
- `GetOrder` is in scope (operator decision, 2026-11-20). Its first statement is
  `ResolveOrderOwner(ctx)`, so a headerless call gets `PermissionDenied` before any lookup. A
  non-owner gets `NotFound`, identical to an absent order (debate.md D-15: `trading.go:1626-1643`).
- The `broadcastOrder` "empty = all users" arm and its doc comment are deleted (`orderSubscriber`
  `trading.go:393`, `SubscribeOrderUpdates` `:400`, `broadcastOrder` `:435`, recon.md § Codebase
  Map; arm at `:439` per debate.md D-8). The `SubscribeOrderUpdates` signature is unchanged.
- The per-RPC audit covers all 14 `grpcTradingAdapter` RPCs; `GetOrder` was the only other unscoped
  read (debate.md D-15).

### 2. Stream identity comes from a stream interceptor (D-1)

- A new `middleware.StreamServerInterceptor` shares its extraction helper with
  `UnaryServerInterceptor` and is registered with `grpc.ChainStreamInterceptor` in
  `cmd/server/main.go` (debate.md D-1: `main.go:155` registers only the unary chain today).
- The stream adapter does not read metadata itself (R-1).

### 3. Broker-account owner gate, fail-closed (D-6, D-9, D-13)

- `callerUserID == ""` returns `PermissionDenied` as the first statement of:
  - `RegisterBrokerAccount`, `trading.go:2595`, before the OFFLINE branch (recon.md § Codebase Map)
  - `UpdateBrokerAccountCredentials`, `trading.go:2664` (recon.md § Codebase Map)
  - `ListBrokerAccountsSvc` (debate.md D-13: `trading.go:3069`)
  - `DeregisterBrokerAccountSvc`, `trading.go:3144` (recon.md § Codebase Map)
- It uses the inline house idiom (`trading.go:482, 967, 1317, 1490`, recon.md § Patterns to REUSE).
  No helper is added. `ResumeAccountSvc` stays gated by `RequireAdminScope` (`authz.go:17`).
- `LoadBrokerPool` skips `rec.UserID == ""` rows with a WARN as the loop's first statement
  (debate.md D-9). Every pool-insert site is then owner-gated (debate.md D-13).
- The two caller-less Register tests gain a caller (`trading_offline_test.go:320`,
  `trading_ibkr_auth_test.go:290`; recon.md § Risks).

### 4. Trading handler status mapping (D-14)

- `handler/trading.go:104` (`GetOrder`), `:112` (`ListOrders`) and `:277,289,300,315` (broker
  accounts) map service errors with `connect.NewError(connectCodeFromErr(err), err)`, so
  `PermissionDenied`, `NotFound` and `FailedPrecondition` reach the wire (debate.md D-14; recon.md
  § Risks "Connect `ListOrders` maps every error to `CodeInternal`").
- Refusal codes per broker-account RPC, to be restated in the spec:

| RPC | Refusal codes |
|---|---|
| RegisterBrokerAccount | PermissionDenied (headerless), InvalidArgument |
| UpdateBrokerAccountCredentials | PermissionDenied (headerless or non-owner), NotFound, FailedPrecondition (offline) |
| ListBrokerAccounts | PermissionDenied (headerless) |
| DeregisterBrokerAccount | PermissionDenied (headerless or non-owner), NotFound |

### 5. Portfolio owner-less events are skipped (D-5)

- `processPositionSync` (`portfolio_service.go:1589`, `"default"` at `:1614`),
  `processBalanceSync` (`:1744`, `"default"` at `:1762`) and `processAccountDeregistered` (`:1540`,
  `"default"` at `:1558`) ack, WARN-log and skip an event with no `user_id`. The dead
  `"alpaca-default"` fallback in `processOrderFill` (`:433-436`) is deleted (recon.md § Codebase
  Map).
- The skip is a pre-write `return nil`, as at `:1553` and `:1602`, so it never enters
  `boundedRetry` or parking (recon.md § Patterns to REUSE and § Risks). It is counted as `acked`;
  no new telemetry label value is added.
- Legacy pre-`user_id` replay events are dropped. This is accepted (D-5).

### 6. Notify `ListAlerts` is header-only (D-4, D-11)

- The owner chain `x-user-id || req.userId || null` at `notifyServiceImpl.ts:200` becomes the
  header alone. A missing header is rejected with code 3, following `registerPushSubscription`
  (`:240-243`, NOTIFY-5; recon.md § Patterns to REUSE).
- The `$1::text IS NULL` branch is dropped from the main and count queries (`:210`, `:218`).
  Untargeted alerts (`target_user_id IS NULL`) stay visible.
- Existing body-only tests are converted to metadata callers (`metaCall`,
  `src/__tests__/notifyServiceImpl.test.ts:469`).
- `StreamAlertsRequest.user_id` and the `AcknowledgeAlert` body `user_id` are out of scope. 312
  files a new defect report for them (D-11).

### 7. Proto, additive only (D-10)

- `trading.proto:169` and `:190` and `notify.proto:99` get `[deprecated = true]` with an "ignored;
  owner is x-user-id" comment, following `trading.proto:201` (recon.md § Patterns to REUSE and
  § Dependencies). Then `buf lint`, `buf breaking`, `./scripts/buf-gen.sh`.
- The two trading fields join the proto constitution's deprecated request-body `user_id` gotcha
  set. They are not PROTO-10 admin selectors.

### 8. AC evidence harness (D-2, D-16)

- `internal/service/export_test.go` (`package service`) exports a test constructor that sets
  `repo`, `orders` and `subs`, plus a `broadcastOrder` shim. Nothing else.
- `internal/service/trading_owner_scope_test.go` (external `package service_test`) builds a bufconn
  server with the production unary and stream interceptors and `GRPCHandler()`.
- The repo is seeded with pgxmock through `repository.NewTradingRepoWithDB`, with rows from
  `internal/testdata/order_rows.go` (C-13). A repo error exercises the in-memory fallback, and the
  broadcast shim exercises the live stream.
- The test is RED on the pre-fix tree (P-06). It also carries the wire-level proof of agent
  `@AC-7`: non-owner `PermissionDenied`, headerless `PermissionDenied`, offline `FailedPrecondition`.
- All symbols and lines in this subsection are debate.md D-16 evidence, not recon.

### 9. Acceptance scenarios (D-17)

312 `acceptance.feature` gains three scenarios, promoted as durable trading `@AC`s at launch. The
file does not contain them yet; writing them is a spec step.

- `@AC-4 @regression`: Scenario Outline over `rpc | scope | body`. For each of `ListOrders` and
  `StreamOrderUpdates` the rows are `3 | user-b`, `4 | user-b`, `4 | (empty)`. Only user-a's orders
  are delivered. Examples are a multi-line table.
- `@AC-5 @regression`: `ListOrders`, `StreamOrderUpdates` or `GetOrder` with no `x-user-id` fails
  with `PERMISSION_DENIED` and delivers no order.
- `@AC-6 @regression`: `GetOrder` with `x-user-id` user-a for user-b's `order_id` fails with
  `NOT_FOUND`, indistinguishable from an absent id, for scopes 3 and 4.

### 10. Runbook and follow-ups (D-9, D-11, D-18)

- `docs/runbooks/inter-service-mtls-rollout.md:99-101`: the flat-book check becomes a read-only
  query through `docs/runbooks/operator-db-access.md` that copies the `ListSubmittedOrders`
  predicate verbatim: `status IN ('new','partially_filled') AND broker_order_id IS NOT NULL AND
  broker_order_id != ''`. The "trader surface / ListOrders" option is removed (debate.md D-18).
- Two new `docs/reports/` defects: notify `StreamAlerts`/`AcknowledgeAlert` body `user_id` (D-11),
  and "trading broker_accounts rows with user_id='' need cleanup" (D-9; trigger is the startup
  WARN; candidate fix is a trading `012` deactivation migration with DBA approval).
- Before merge, a read-only `SELECT count(*) FROM trading.broker_accounts WHERE user_id = '' AND
  is_active` runs per environment and the count is recorded in `context.md` (O-11).

### Consumer surfaces (C-14)

- **xstockstrat-ui**: the BFF already pins the session user on `listOrders` and
  `streamOrderUpdates` (`traderBff.ts:40-46`, `:58-64`) and forwards `listAlerts` header-only
  (`:104`). Behaviour is unchanged for an end user; the stale comment at `:35-36` is updated
  (recon.md § Codebase Map).
- **xstockstrat-agent**: `list_account_orders` sends body and header for the same caller
  (`client.py:2561`), so results are unchanged. `CLAUDE.md:29` wording is updated. Broker-account
  refusals now surface their real codes (section 4).
- **xstockstrat-analysis** (preserved caller, not on the affected list): the entry backfill
  (`entry_backfill.py:79-84`) and `GetStrategyAnalytics` (`servicer.py:6478-6481`) send body equal
  to header. Only the comment at `entry_backfill.py:73` changes.
- **Docs**: trading `CLAUDE.md:45-49`, notify `CLAUDE.md:39` and NOTIFY-5/NOTIFY-7, portfolio
  `CLAUDE.md` § Ledger Events Consumed (recon.md § Dependencies).

### Merge order (D-12) and build order

- 315 merges before 312; 312 rebases `notifyServiceImpl.ts` and its tests. 322 and 312 go in either
  order; the second rebases and re-runs buf-gen. If 326 touches `handler/trading.go`
  (`:104,112,277,289,300,315`), 312 merges after 326.
- Build order: proto and buf-gen → trading stream interceptor and `main.go` → trading service →
  trading handler → `export_test.go` and the bufconn test → portfolio → notify (after rebasing on
  315) → docs, runbook, acceptance, the two defect reports, the `context.md` row count.

## Rejected Alternatives

- `R-1` Reading incoming metadata directly in the trading gRPC stream adapter as the identity source — rejected because it creates a second identity-extraction idiom beside `FromContext` (C-18), and later stream RPCs would repeat the bug.
- `R-2` Proving AC-1's stream clause via `TradingService.StreamOrderUpdates` seeded with `WithPropagationData` — rejected because it is vacuously GREEN and hides the missing stream interceptor.
- `R-3` Admin with an empty body `user_id` = all users on `ListOrders`/`StreamOrderUpdates` — rejected because no live caller needs cross-user enumeration, and it is the only unscoped RPC path.
- `R-4` Admin body `user_id` selector on trading `ListOrders`/`StreamOrderUpdates` (any variant, including "empty = own, body = other user for ADMIN") — rejected because it has no named consumer (C-18 YAGNI), turns the ADMIN bit over mTLS into a cross-tenant order read, and needs `RequireAdminScope` in the stream path.
- `R-5` Keeping both a `SubscribeOrderUpdates` empty-selector reject and the `broadcastOrder` `sub.userID != ""` all-users branch — rejected because it leaves half-removed dead semantics with no error return (C-18); the branch is deleted instead.
- `R-6` Per-sync-cycle owner-less skip with a throttled WARN in `syncPositions` — rejected because the pool is the only feed into the poller; a load-time skip plus owner-gated pool inserts suffices and needs no throttle map.
- `R-7` AC-4 harness in `package handler` using an "exported constructor with fakes" or a "fake repo" that records `userID` — rejected because the service fields and `broadcastOrder` are unexported, `NewTradingService` dials mTLS peers, and no fake-repo seam exists; the spec would cite invented symbols (F-04).
- `R-8` `GetOrder` gate that collapses headerless and non-owner into a single `NotFound` (inline `:967` idiom) — rejected because it contradicts D-7's explicit `PermissionDenied` for missing identity on trading order reads; `ResolveOrderOwner`-first already prevents probing.
- `R-9` Defer `GetOrder` to a separate defect report (D-11 style) — rejected because it is the same bug class in a service 312 already edits, with a small fix; deferring it leaves an exposure larger than `ListOrders`.

## Open Risks

- [ ] No RPC returns cross-user orders any more, so the operator flat-book check depends on the DB-query substitute landing in the same PR as D-7. Without it the mTLS rollout gate could be cleared on one operator's own orders — to be addressed at the runbook docs step (O-9).
- [ ] The bufconn interceptor chain is hand-mirrored from `main.go:155` and can drift without a failing test. Accepted instead of an exported `ServerOptions()` helper (C-18) — to be addressed at the harness test step (comment naming the mirror).
- [ ] `export_test.go` exposes internals to the external test package. A broad shim would let later tests bypass the production chain (R-2 regression) — to be addressed at the harness step: constructor plus broadcast shim only.
- [ ] The handler status remap changes wire codes that UI and agent mappers may assume today (`NotFound`/`InvalidArgument` formerly surfaced as `Internal`), and overlaps 326 if it touches `handler/trading.go` — to be addressed at the trading handler step (mapper audit; D-12 merge order; O-10 refusal-code list).
- [ ] The `LoadBrokerPool` skip changes `resolveAccount`'s sole-account behaviour (`trading.go:368-386`) and drops phantom accounts from hydration (`:321-329`); their in-flight orders become unreconcilable by `pollFills` — to be addressed at the trading service step and the cleanup follow-up report (O-11 row count before merge).
- [ ] The new `StreamServerInterceptor` applies to every trading stream RPC — to be addressed at the middleware step (audit each stream RPC for behaviour change).
- [ ] Legacy pre-`user_id` events are dropped on replay, including the `DeleteOfflineRealized` purge on deregister (`portfolio_service.go:1569`) — accepted under D-5; to be re-checked at the portfolio step.
- [ ] Converting notify tests from body `userId` to metadata may expose tests that depend on the unscoped fallback; 312 rebases on 315 — to be addressed at the notify step.
- [ ] `debate.md` still lists O-2, O-6 and O-8 as `open`. The 2026-11-20 operator decisions resolve all three (D-7 signed; harness, acceptance edits and `GetOrder` scope made binding), but no status change was supplied for the register — to be reconciled by the operator or the next `/sdd-batch` register update.

## Constitution Rules Touched

- `C-01` — honored by: every claim cites recon.md or a `debate.md D-n` evidence cell; post-recon lines are flagged for re-grep at `/sdd-spec`.
- `C-08` — honored by: each trading, portfolio and notify service change has a paired test (bufconn owner-scope test, headerless broker-account tests, portfolio skip tests, notify metadata tests).
- `C-10` — honored by: the body read is replaced at every site (six order sites plus `GetOrder`), on both transports, in the repo path and the in-memory fallback; all 14 adapter RPCs are audited.
- `C-11` — honored by: Track C bug routed through `/sdd-triage`, `/sdd-review` and a full `/sdd-design` (3 rounds).
- `C-13` — honored by: order rows come from `internal/testdata/order_rows.go`.
- `C-15` — honored by: `@AC-4`, `@AC-5`, `@AC-6` are added with stable tags and multi-line Examples, each traced to the bufconn test.
- `C-16` — honored by: the two CHANGE lines below carry the operator sign-off of 2026-11-20; every other touched rule is PRESERVE or EXTEND.
- `C-18` — honored by: one `ResolveOrderOwner`, one shared extraction helper for the interceptors, no admin selector without a consumer, no `requireCaller` helper, dead all-users branch deleted.
- `F-04` — honored by: the harness uses only seams that exist (`export_test.go`, `NewTradingRepoWithDB`); the invented-symbol layout is locked out as R-7.
- `P-02` — honored by: proposer and adversary exchanged only orchestrator-synthesized state in all three rounds.
- `P-03` — honored by: the contract change was escalated to the operator (O-2) and not decided in the debate.
- `P-06` — honored by: the owner-scope test is required to be RED on the pre-fix tree.
- `PROTO-10` — honored by: the trading fields are deprecated and ignored, and are recorded in the deprecated-body-`user_id` gotcha set, not as admin selectors.
- `NOTIFY-5` — honored by: `ListAlerts` adopts the header-only, code-3 pattern; NOTIFY-7's body-fallback wording is updated for `ListAlerts`.
- `PLAT-4` — honored by: no outbound propagation changes; live callers already send `x-user-id` equal to the body value.
- `PLAT-5` — honored by: the ADMIN bit no longer widens order reads; `ResumeAccountSvc` keeps its `scope & 0x04` gate.
- `PLAT-13` — honored by: no timeout or deadline is added or changed on any read path.

## Business Rules Touched (C-16)

- CHANGE trading `CLAUDE.md` contract "admin empty user_id = all users" (`services/xstockstrat-trading/CLAUDE.md:45-49`; no durable `@AC`) — order reads resolve the owner from the header only, and ADMIN loses cross-user order RPCs; signed off by user @ 2026-11-20 (design gate, option A — D-7; context.md `## Session 2026-11-20 — sdd-design`).
- CHANGE 312 product-spec Expected "body `user_id` honoured only as an admin selector" (`product-spec.md:18-19`, PROTO-10) — the body is ignored for every scope; signed off by user @ 2026-11-20 (same decision; context.md `## Session 2026-11-20 — sdd-design`).
- EXTEND `@AC-1` (312) "A non-admin ListOrders with an empty body user_id returns only the caller's orders" — new case added: proven through the production interceptor chain on both RPCs.
- EXTEND `@AC-2` (312) "Broker-account identity is never filed under a placeholder owner" — new case added: headerless Update, List and Deregister are rejected too.
- EXTEND `@AC-3` (312) "ListAlerts without x-user-id is rejected and a body userId is ignored" — new case added: the rejection code is fixed at INVALID_ARGUMENT (D-4).
- EXTEND `@AC-4` (312, new) — order reads scoped to `x-user-id` for scopes 3 and 4, body `user_id` ignored; promoted as a durable trading `@AC`.
- EXTEND `@AC-5` (312, new) — headerless `ListOrders`/`StreamOrderUpdates`/`GetOrder` → `PERMISSION_DENIED`.
- EXTEND `@AC-6` (312, new) — `GetOrder` for another user's order → `NOT_FOUND`.
- EXTEND `@AC-7` "A caller cannot act on an account they do not own" (`services/xstockstrat-agent/acceptance/agent-broker-account-tools.feature`) — new case added: non-owner `PERMISSION_DENIED` is now true on the wire via the handler status remap, and an empty caller is rejected.
- PRESERVE `@AC-2` @feature-270 "A dropped order stream is shown to the user and reconnects" (`services/xstockstrat-ui/acceptance/fix-ui-trader-feedback.feature`) — not regressed by: the BFF already sends the session user; the stream contract for an identified caller is unchanged.
- PRESERVE `@AC-1`..`@AC-5` @feature-203 (`services/xstockstrat-notify/acceptance/alert-read-unread-persistence.feature`) — not regressed by: untargeted alerts stay visible and read state is untouched; only the unscoped no-identity branch is removed.
- PRESERVE `@AC-1` @feature-262 "The entry-backfill asks trading only for the strategy owner's orders" (`services/xstockstrat-analysis/acceptance/fix-analysis-owner-scope.feature`) — not regressed by: the call sends body equal to header, so header scoping returns the same orders and the call shape is unaltered.
