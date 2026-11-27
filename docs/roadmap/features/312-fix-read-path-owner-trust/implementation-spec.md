# Implementation Spec: fix-read-path-owner-trust

**Status**: `pending`
**Created**: 2026-11-20
**Feature**: `docs/roadmap/features/312-fix-read-path-owner-trust/feature.md`
**Total Steps**: 20
**Feature Branch**: `feature/fix-read-path-owner-trust`

---

## Execution Summary

Every read and consume path takes the owner from the trusted `x-user-id` header (PLAT-11), following
design.md § Chosen Approach and decisions D-1..D-18 in `debate.md`. Trading goes first: the stream
interceptor (Steps 1–2), then the service and handler changes with the bufconn evidence harness
(Steps 3–7). Portfolio (Steps 8–9) and notify (Steps 10–11) follow. The additive proto deprecation
lands after the code that stops reading the fields (Steps 12–13), then the consumer comments, docs,
runbook, follow-up defect reports and the operator row count (Steps 14–20).

Evidence was re-grepped on `origin/feature/fix-read-path-owner-trust` @ `6474bdb6`. Every `path:line`
below is from that tree, including the debate.md D-7..D-18 lines that post-date recon.md.

**Consumer surfaces (C-14).** The product spec is a bug template with no `## Consumer Surface(s)`
section; it names `xstockstrat-ui` and `xstockstrat-agent` as callers of the changed RPCs. Behaviour
is unchanged for an identified end user on both (design.md § Consumer surfaces): the BFF and the
agent already send the caller in `x-user-id`. This is a decision, not an omission. Each surface
still gets its own step (Step 14 ui, Step 15 agent), and `xstockstrat-analysis`, a preserved
`ListOrders` caller, gets Step 16.

## Scenario Coverage (C-15)

| Scenario | Covered by |
|---|---|
| `@AC-1` non-admin `ListOrders` / `StreamOrderUpdates` with an empty body returns only the caller's orders | Step 6 (Step 2 for the stream identity precondition) |
| `@AC-2` broker-account identity is never filed under a placeholder owner | Step 7 (trading rejection, nothing persisted), Step 6 (rejection on the wire), Step 9 (portfolio skip) |
| `@AC-3` `ListAlerts` without `x-user-id` is rejected and a body `userId` is ignored | Step 11 |
| `@AC-4` order reads scoped to `x-user-id` for scopes 3 and 4, body `user_id` ignored | Step 6 (Step 2 for the stream identity precondition) |
| `@AC-5` headerless order read is refused with `PERMISSION_DENIED` | Step 6 |
| `@AC-6` `GetOrder` for another user's order is `NOT_FOUND`, identical to an absent order | Step 6 |

`@AC-4`, `@AC-5` and `@AC-6` were appended to `acceptance.feature` in this `/sdd-spec` run (design
D-17, operator decision 2026-11-20). They are promoted as durable trading `@AC`s at launch.

## Step Dependencies

- Step 2 [test] covers Step 1 [service].
- Step 6 [test] covers Step 3 [service] and Step 5 [service]. Step 7 [test] covers Step 4 [service].
  Step 9 [test] covers Step 8 [service]. Step 11 [test] covers Step 10 [service].
- Step 3 requires Step 1: the gRPC stream path has no `PropagationData` until the stream
  interceptor is registered, so `ResolveOrderOwner` would refuse every stream.
- Step 4 requires Step 3: it reuses the `missingCallerMsg` constant Step 3 declares.
- Step 5 requires Steps 3 and 4: it calls `ResolveOrderOwner` and surfaces the Step 4 refusals.
- Step 6 requires Steps 1, 3, 4 and 5: it builds the production chain and asserts every refusal on
  the wire. Step 7 requires Step 4.
- Steps 12+13 land together: Step 12 edits a `.proto` and Step 13 regenerates the checked-in stubs
  (`step-constraints.md` §C, "edits a `.proto`"). No descriptor-parity guard turns red: the change
  adds no field, so the `_MAPPED` / `*_covers_every_proto_field` tests in `xstockstrat-agent` and
  `xstockstrat-analysis` are untouched.
- Steps 12+13 require Steps 3, 5, 6 and 10. **This reorders design.md's build order, which puts
  proto first.** `[deprecated = true]` makes the generated Go `UserId` fields trip staticcheck
  SA1019 (`services/xstockstrat-trading/.golangci.yml:7` enables `staticcheck`) at the seven read
  sites Steps 3 and 5 remove. A proto-first tree could not pass the trading lint in Step 1's own
  **Verification**. No decision D-n depends on the order; D-12's "322 and 312 in either order, the
  second rebases and re-runs buf-gen" is unaffected.
- Step 10 requires feature 315 to be merged into `feature/fix-read-path-owner-trust`'s base first
  (D-12). Rebase, then re-grep the `listAlerts` anchors before editing.
- If feature 326 touches `services/xstockstrat-trading/internal/handler/trading.go`, 312 merges
  after 326 and Step 5 re-greps its anchors (D-12).
- Feature 326's implementation spec (`origin/main-dev`, `code-completed`) modifies no trading file;
  it cites `handler/trading.go:223-237` as evidence only. It does modify
  `services/xstockstrat-portfolio/internal/service/portfolio_service.go` and that package's
  `export_test.go`, and feature 357 (`in-progress`) edits the same service file in regions it
  records as disjoint from this spec's. Step 8 therefore rebases and re-greps its anchors if either
  has merged first.
- Feature 321 edits `internal/service/trading.go` (Steps 3–5 here) and a comment in
  `trading.proto` `RegisterBrokerAccountRequest` (a different message from Step 12's; no field
  number changes). Whichever merges second rebases, re-greps its anchors and re-runs
  `./scripts/buf-gen.sh` for the Step 13 stubs.
- Step 18 must merge in the same PR as Step 3: after Step 3 no RPC returns cross-user orders, so the
  runbook's flat-book check needs its DB-query substitute (design Open Risk 1, O-9).
- Step 20 is an operator gate before the integration PR merges (O-11).
- **Flagged for impl-spec review.** design.md §8 says the `export_test.go` constructor sets `repo`,
  `orders` and `subs` "and nothing else", and also says the same test carries the wire proof of
  agent `@AC-7` (non-owner `PermissionDenied`, offline `FailedPrecondition`). Those two cases reach
  `s.accountRepo.GetBrokerAccount`, an unexported field. Step 6 therefore gives the constructor one
  more parameter, `accounts repository.AccountRepository`. It stays a constructor plus a broadcast
  shim.
- **Design claim corrected by the re-grep.** design.md §3 and recon.md § Risks say the two
  `RegisterBrokerAccount` tests at `trading_offline_test.go:320` and `trading_ibkr_auth_test.go:290`
  are caller-less. Both pass `"user-1"` as the `userID` argument, so the Step 4 guard does not break
  them and no step edits them.
- **Design claim corrected by the re-grep.** design.md §6 says existing body-only `listAlerts` tests
  are converted to metadata callers. All three existing calls already use `metaCall('u1', …)`
  (`notifyServiceImpl.test.ts:855,865,874`), so Step 11 only adds tests.

---

### Step 1 — service: trading stream identity interceptor

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/middleware/propagation.go` — modify
- `services/xstockstrat-trading/cmd/server/main.go` — modify

**Reviewers**: `xstockstrat-trading` owner — Order execution correctness, broker API safety, fill detection, paper-only dev invariant, position limit enforcement

**Codebase Evidence**:
- Re-grepped 2026-11-26 on `feature/fix-read-path-owner-trust` @ `4230df50` (main-dev `f802b184`
  merged): every anchor below is unchanged.
- `internal/middleware/propagation.go:33-41` — `UnaryServerInterceptor` builds `PropagationData`
  from `metadata.FromIncomingContext(ctx)` (`x-user-id`, `x-access-scope`, `x-trace-id`) and stores
  it under `propKey{}`. `FromContext` is at `:20-23`, `first` at `:57-62`.
- `grep -rn "StreamServerInterceptor" services/xstockstrat-trading` → no match. **Not found** — the
  stream interceptor is created by this step.
- `cmd/server/main.go:153-162` — `grpc.NewServer(` registers only
  `grpc.ChainUnaryInterceptor(middleware.UnaryServerInterceptor)` (`:155`).
- Stream RPC audit (design Open Risk 6): `packages/proto/trading/v1/trading.proto:15` —
  `StreamOrderUpdates` is the only server-streaming `TradingService` RPC. The health and reflection
  services registered at `main.go:164-166` also stream; the interceptor only adds a context value.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. In `propagation.go`, move the metadata read at `:34-39` into one unexported helper,
   `withIncomingPropagation(ctx context.Context) context.Context` (new symbol). `UnaryServerInterceptor`
   calls it and passes the result to `handler` (D-1: one shared extraction helper).
2. Add `StreamServerInterceptor(srv interface{}, ss grpc.ServerStream, _ *grpc.StreamServerInfo, handler grpc.StreamHandler) error`.
   It wraps `ss` in an unexported struct `propagatedStream` (new symbol) that embeds
   `grpc.ServerStream` and overrides `Context()` to return `withIncomingPropagation(ss.Context())`,
   then returns `handler(srv, wrapped)`.
3. In `main.go`, add `grpc.ChainStreamInterceptor(middleware.StreamServerInterceptor),` directly
   after `:155`.
4. Do not read metadata in the stream adapter (`handler/trading.go:204`); that is rejected
   alternative R-1.
5. Trading-domain constraints: order placement, `TRADING_MODE` gating, broker dispatch, order types
   and fill handling are unaffected by this step.

**Verification**:
```bash
cd services/xstockstrat-trading && export GOWORK=off \
  && go build ./... \
  && go test ./internal/middleware/... ./internal/service/... -race -count=1 \
  && grep -n "ChainStreamInterceptor(middleware.StreamServerInterceptor)" cmd/server/main.go \
  && golangci-lint run --modules-download-mode=mod
```

---

### Step 2 — test: trading propagation interceptors

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/middleware/propagation_test.go` — create

**Reviewers**: `xstockstrat-trading` owner — Order execution correctness, broker API safety, fill detection, paper-only dev invariant, position limit enforcement

**Codebase Evidence**:
- `ls services/xstockstrat-trading/internal/middleware` → `authz.go`, `authz_test.go`,
  `propagation.go`. **Not found** — `propagation_test.go` is created by this step.
- `internal/middleware/authz_test.go` — existing `package middleware` test file; follow its layout.
- `internal/middleware` is not in the CI coverage exclusion list
  (`cmd|handler|repository|telemetry|service`), so this file counts toward the 40% threshold.

**TDD**: `red-green required` — on the tree before Step 1 the RED is
`undefined: StreamServerInterceptor`. The behavioural RED for stream identity is Step 6's stream cases.

**Covers**: `AC-1, AC-4` (stream rows: the caller identity reaches a stream handler)

**Instructions**:
1. `TestStreamServerInterceptor_PopulatesPropagationData`: build a fake `grpc.ServerStream` whose
   `Context()` returns `metadata.NewIncomingContext` with `x-user-id`, `x-access-scope` and
   `x-trace-id`. Call `StreamServerInterceptor` with a handler that reads
   `FromContext(ss.Context())` and assert all three fields.
2. `TestStreamServerInterceptor_NoMetadataYieldsEmptyIdentity`: no incoming metadata → `FromContext`
   returns the zero `PropagationData`, and the handler is still called.
3. `TestUnaryServerInterceptor_PopulatesPropagationData`: the same three headers through
   `UnaryServerInterceptor`, proving both interceptors share one extraction.
4. C-13: the header values are not domain data and have one consumer; they stay inline.

**Verification**:
```bash
cd services/xstockstrat-trading && export GOWORK=off \
  && COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') \
  && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" \
  && go tool cover -func=coverage.out | grep "^total:" \
  && golangci-lint run --modules-download-mode=mod
```
Confirm the `total:` line is ≥ 40%.

---

### Step 3 — service: trading order reads resolve the owner from the header

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading.go` — modify
- `services/xstockstrat-trading/internal/service/trading_ownership_test.go` — modify
- `services/xstockstrat-trading/internal/service/trading_offline_test.go` — modify
- `services/xstockstrat-trading/internal/service/trading_order_race_test.go` — modify

**Reviewers**: `xstockstrat-trading` owner — Order execution correctness, broker API safety, fill detection, paper-only dev invariant, position limit enforcement

**Codebase Evidence**:
- Re-grepped 2026-11-26 on `feature/fix-read-path-owner-trust` @ `4230df50` (main-dev `f802b184`
  merged): the `GetOrder`/`ListOrders`/`StreamOrderUpdates` anchors moved down 44 lines.
- `trading.go:1670-1687` — `GetOrder` has no caller check. It returns the in-memory hit
  (`s.orders[req.OrderId]`, `:1672-1678`) or the repo hit (`s.repo.GetOrder`, `:1680`), and an
  absent order returns `fmt.Errorf("order %s not found", req.OrderId)` (`:1682`), not a gRPC status.
- `trading.go:1689-1690` — `ListOrders` passes `req.UserId` to `s.repo.ListOrders(...)`. The
  in-memory fallback filters at `:1696`: `if req.UserId != "" && o.UserId != req.UserId`.
- `internal/repository/trading_repo.go:229-233` — the repo adds `AND user_id = $N` only when
  `userID != ""`, so an empty owner is unscoped. The owner must be resolved before the call.
- `trading.go:1770-1789` — `StreamOrderUpdates`; snapshot filter at `:1774`:
  `if req.UserId != "" && order.UserId != req.UserId`. No handler routes to this method.
- `trading.go:435-446` — `broadcastOrder`; the all-users arm is `:439`:
  `if sub.userID != "" && order.UserId != sub.userID`.
- Comments stating "empty = all users": `trading.go:389-392` (`orderSubscriber`), `:398-399`
  (`SubscribeOrderUpdates`), `:419-420` (`broadcastOrder` doc — it now sits above `updateOrder`
  `:421-433`, detached from `broadcastOrder` at `:435`).
- Reuse (recon § Patterns to REUSE): fail-closed caller idiom
  `if callerID := middleware.FromContext(ctx).UserID; callerID == "" || … { return nil, grpcstatus.Errorf(codes.PermissionDenied, …) }`
  at `trading.go:482` and `:967`. `middleware`, `grpcstatus` and `codes` are already imported.
- `grep -rn "ResolveOrderOwner\|missingCallerMsg" services/xstockstrat-trading` → no match. **Not
  found** — both are created by this step.
- Break radius (`go test` compiles and runs these with the package):
  - `trading_ownership_test.go:116-147` — `TestBroadcastOrder_ScopesToSubscriberUser` subscribes
    `"sub-all"` with `""` (`:120`) and requires it to receive the order (`:140-146`).
  - `trading_offline_test.go:1860` — `h.svc.GetOrder(context.Background(), …)` for an order built by
    `newOfflineOrder` (`:1717`, `UserId: testdata.S1UserID` at `:1721`).
  - `trading_order_race_test.go:34` — `svc.GetOrder(context.Background(), …)` for the
    `notCancelableSvc` order (`trading_cancel_not_cancelable_test.go:25-27`, `UserId: "user-1"`).
  - `ctxAsUser(userID)` is the existing seam: `trading_ownership_test.go:21`.
  - `SubscribeOrderUpdates` keeps its signature, so `handler/trading.go:119,206` still compile.
  - No test calls `TradingService.ListOrders` or `TradingService.StreamOrderUpdates`.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Directly above `GetOrder` (`:1670`), add the unexported constant
   `missingCallerMsg = "x-user-id is required"` and the method
   `func (s *TradingService) ResolveOrderOwner(ctx context.Context) (string, error)`. It returns
   `middleware.FromContext(ctx).UserID`, or `grpcstatus.Errorf(codes.PermissionDenied, missingCallerMsg)`
   when that is empty. It never reads a request body and has no admin branch (D-7; R-3 and R-4 are
   off the table).
2. `GetOrder`: make `ResolveOrderOwner(ctx)` the first statement and return its error. For the
   in-memory hit and the repo hit, return the not-found error when `order.UserId != owner`. Replace
   the `fmt.Errorf` at `:1682` so the absent case and both non-owner cases return the same
   `grpcstatus.Errorf(codes.NotFound, "order %s not found", req.OrderId)` (D-15; R-8 is off the
   table: headerless stays `PermissionDenied`).
3. `ListOrders`: make `ResolveOrderOwner(ctx)` the first statement. Pass the owner in place of
   `req.UserId` at `:1690`, and change `:1696` to `if o.UserId != owner { continue }`.
4. `StreamOrderUpdates`: resolve the owner from `stream.Context()` as the first statement and
   change `:1774` to `if order.UserId != owner { continue }`.
5. `broadcastOrder`: change `:439` to `if order.UserId != sub.userID { continue }` (D-8). Rewrite
   the three comments (`:389-392`, `:398-399`, `:419-420`) so none says an empty selector means all
   users; keep each to two lines stating the constraint. `SubscribeOrderUpdates` keeps its signature
   (R-5 is off the table).
6. Test call-site edits, in the same commit:
   - `trading_ownership_test.go:113-147`: the `""` subscriber must now receive nothing. Invert the
     final `select` and update the test's doc comment.
   - `trading_offline_test.go:1860`: call `GetOrder` with `ctxAsUser(testdata.S1UserID)`.
   - `trading_order_race_test.go:34`: call `GetOrder` with `ctxAsUser("user-1")`.
7. Trading-domain constraints: this step changes read RPCs only. `TRADING_MODE` gating, broker
   dispatch (ALPACA and IBKR), the five order types and fill handling (`PARTIALLY_FILLED`, `FILLED`)
   are unaffected.

**Verification**:
```bash
cd services/xstockstrat-trading && export GOWORK=off \
  && go build ./... \
  && go test ./internal/service/... ./internal/handler/... -race -count=1 \
  && ! sed -n '1665,1800p' internal/service/trading.go | grep -n "req.UserId" \
  && ! grep -n 'sub.userID != ""' internal/service/trading.go \
  && golangci-lint run --modules-download-mode=mod
```

---

### Step 4 — service: trading broker-account owner gate and owner-less pool skip

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading.go` — modify

**Reviewers**: `xstockstrat-trading` owner — Order execution correctness, broker API safety, fill detection, paper-only dev invariant, position limit enforcement

**Codebase Evidence**:
- Re-grepped 2026-11-26 on `feature/fix-read-path-owner-trust` @ `4230df50` (main-dev `f802b184`
  merged): the broker-account anchors moved down 105-115 lines; `LoadBrokerPool` did not move.
- `trading.go:2700` — `RegisterBrokerAccount(ctx, req, userID string)`; the OFFLINE branch starts at
  `:2703` and persists `UserID: userID` (`:2711`) with no empty check. The credentialed path
  persists at `:2748`.
- `trading.go:2769` — `UpdateBrokerAccountCredentials(ctx, accountID, callerUserID, credentialsJSON)`;
  `json.Valid` is `:2770`; the only owner check is `:2777` `if rec.UserID != callerUserID`, which a
  headerless caller passes on a `user_id = ''` row. The pool insert is at `:2811`.
- `trading.go:3184` — `ListBrokerAccountsSvc(ctx, userID)`; no empty check.
- `trading.go:3259` — `DeregisterBrokerAccountSvc(ctx, accountID, callerUserID)`; owner check at
  `:3264`, same gap as `:2777`.
- `trading.go:3295` — `ResumeAccountSvc` stays gated by `RequireAdminScope`
  (`internal/middleware/authz.go:17`); not edited.
- `trading.go:293-333` — `LoadBrokerPool`; loop at `:302`. Skip idiom to follow at `:312-313`:
  `slog.WarnContext(ctx, "LoadBrokerPool: decrypt failed, skipping account", "account_id", rec.ID, "error", err)` then `continue`.
- Callers pass the header value: `handler/trading.go:274-275,286-287,298-299,312-313`
  (`extractUserID(ctx)`, `:258-268`, returns `""` without `x-user-id`).
- Break radius: every existing test passes a non-empty caller —
  `trading_offline_test.go:320-324` (`"user-1"`), `:371`, `:467`, `:1353`;
  `trading_ibkr_auth_test.go:290-292` (`"user-1"`), `:303`. The one `LoadBrokerPool` test fixture has
  `UserID: "user-1"` (`trading_ibkr_auth_test.go:234`). No existing test breaks.
- Trading-domain survey: `BrokerType` dispatch for registration is `trading.go:2703` (OFFLINE),
  `:2727` (IBKR credential validation), and the shared credentialed path (`:2733-2763`) for ALPACA
  and IBKR.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add `if <caller> == "" { return …, grpcstatus.Errorf(codes.PermissionDenied, missingCallerMsg) }`
   as the **first statement** of `RegisterBrokerAccount` (before the OFFLINE branch),
   `UpdateBrokerAccountCredentials` (before `json.Valid`), `ListBrokerAccountsSvc` and
   `DeregisterBrokerAccountSvc` (D-13). The check stays inline; do not add a helper function.
2. Broker coverage: the `RegisterBrokerAccount` guard precedes the broker-type branch, so it covers
   ALPACA, IBKR and OFFLINE alike. No broker client code changes.
3. `LoadBrokerPool`: as the first statement of the loop at `:302`, skip a record with
   `rec.UserID == ""` using `slog.WarnContext(ctx, "LoadBrokerPool: account has no owner, skipping account", "account_id", rec.ID)`
   and `continue` (D-9; R-6 is off the table: no per-cycle skip in `syncPositions`).
4. Accepted side effects of the skip (design Open Risk 5, no code for them): an owner-less account
   leaves the pool, so `resolveAccount`'s sole-account rule (`:356-386`) no longer counts it, its
   credential-health and halt state are not hydrated, and `pollFills` (`:1816`) cannot reconcile its
   in-flight orders. Step 19 files the cleanup follow-up and Step 20 records the row count.
5. Trading-domain constraints: `TRADING_MODE` gating, order placement, the five order types and
   fill handling (`PARTIALLY_FILLED`, `FILLED`) are unaffected.

**Verification**:
```bash
cd services/xstockstrat-trading && export GOWORK=off \
  && go build ./... \
  && go test ./internal/service/... -race -count=1 \
  && test "$(grep -c 'codes.PermissionDenied, missingCallerMsg' internal/service/trading.go)" -eq 5 \
  && grep -n "account has no owner, skipping account" internal/service/trading.go \
  && golangci-lint run --modules-download-mode=mod
```
(Five uses: `ResolveOrderOwner` from Step 3 plus the four guards.)

---

### Step 5 — service: trading handler owner resolution and status mapping

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/handler/trading.go` — modify

**Reviewers**: `xstockstrat-trading` owner — Order execution correctness, broker API safety, fill detection, paper-only dev invariant, position limit enforcement

**Codebase Evidence**:
- `handler/trading.go:97-107` — Connect `GetOrder` maps every service error to
  `connect.CodeNotFound` (`:104`).
- `handler/trading.go:109-115` — Connect `ListOrders` maps every error to `connect.CodeInternal`
  (`:112`).
- `handler/trading.go:117-119` — Connect `StreamOrderUpdates`:
  `subID := fmt.Sprintf("trading-%s-%p", req.Msg.UserId, stream)` and
  `ch := h.svc.SubscribeOrderUpdates(subID, req.Msg.UserId)`.
- `handler/trading.go:204-206` — `grpcTradingAdapter.StreamOrderUpdates`, the same two lines with
  `req.UserId` and `grpcStream`.
- `handler/trading.go:277,289,300,315` — the four broker-account Connect methods return
  `toGRPCError(err)` for a service error. The service returns gRPC status errors, not
  `*connect.Error`, so `toGRPCError` (`:221-238`) falls through to `codes.Internal`.
- Reuse: `connect.NewError(connectCodeFromErr(err), err)` at `:40`, `:53`, `:66`, `:80`, `:93`.
  `connectCodeFromErr` (`:242-256`) maps `NotFound`, `FailedPrecondition`, `InvalidArgument` and
  `PermissionDenied`; `toGRPCError` maps the same four back for the adapter.
- Per-RPC audit (D-15): the adapter has 14 methods at `:148,156,164,172,180,188,196,204,339,347,355,363,371,379`.
  `PlaceOrder`, `CancelOrder`, `ReplaceOrder`, `ConfirmOrder` and `SnapshotOfflinePositions` already
  gate on the header in the service; `GetTradingEnvironment` returns no per-user data;
  `ResumeAccount` is admin-gated. `GetOrder`, `ListOrders` and `StreamOrderUpdates` are fixed by
  Steps 3 and 5, and the four broker-account RPCs by Steps 4 and 5.
- Consumer mapper audit (design Open Risk 4): the agent passes the real codes through
  (`services/xstockstrat-agent/app/tools.py:228-239` `_PASS_THROUGH_CODES`, `:272` `NOT_FOUND`);
  the UI maps them in `services/xstockstrat-ui/src/lib/connectClients.ts:134-161`
  (`connectCodeToHttp`). Neither special-cases `Internal` for these RPCs, so no consumer edit is
  needed. (Re-grepped 2026-11-26 @ `4230df50`: the `handler/trading.go` anchors above are unchanged.)

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Replace the error return at `:104`, `:112`, `:277`, `:289`, `:300` and `:315` with
   `connect.NewError(connectCodeFromErr(err), err)` (D-14). `ResumeAccount` (`:334`) is outside D-14
   and stays as it is.
2. Connect `StreamOrderUpdates` (`:117-119`): call `h.svc.ResolveOrderOwner(ctx)` first; on error
   return `connect.NewError(connectCodeFromErr(err), err)`. Use the resolved owner in `subID` and in
   `SubscribeOrderUpdates`.
3. `grpcTradingAdapter.StreamOrderUpdates` (`:204-206`): call
   `a.h.svc.ResolveOrderOwner(grpcStream.Context())` first and return its error unchanged (it is
   already a gRPC status). Use the resolved owner in `subID` and in `SubscribeOrderUpdates`. The
   adapter must not read metadata itself (R-1).
4. Refusal codes that reach the wire after this step:

   | RPC | Refusal codes |
   |---|---|
   | `GetOrder` | `PermissionDenied` (headerless), `NotFound` (absent or another user's order), `InvalidArgument` (empty `order_id`, handler `:99-101`) |
   | `ListOrders` | `PermissionDenied` (headerless) |
   | `StreamOrderUpdates` | `PermissionDenied` (headerless) |
   | `RegisterBrokerAccount` | `PermissionDenied` (headerless), `InvalidArgument` (invalid credentials JSON or incomplete IBKR blob) |
   | `UpdateBrokerAccountCredentials` | `PermissionDenied` (headerless or non-owner), `NotFound`, `FailedPrecondition` (offline account), `InvalidArgument` (empty `account_id`, invalid credentials JSON) |
   | `ListBrokerAccounts` | `PermissionDenied` (headerless) |
   | `DeregisterBrokerAccount` | `PermissionDenied` (headerless or non-owner), `NotFound` |

5. Trading-domain constraints: `TRADING_MODE` gating, broker dispatch (ALPACA and IBKR unaffected),
   the five order types and fill handling are unaffected.

**Verification**:
```bash
cd services/xstockstrat-trading && export GOWORK=off \
  && go build ./... \
  && go test ./internal/service/... ./internal/handler/... -race -count=1 \
  && test "$(grep -c 'connect.NewError(connectCodeFromErr(err), err)' internal/handler/trading.go)" -eq 12 \
  && test "$(grep -c 'UserId' internal/handler/trading.go)" -eq 1 \
  && golangci-lint run --modules-download-mode=mod
```
(Twelve mapped returns: five existing, six replaced, one new in the Connect stream. The one remaining
`UserId` is the `SnapshotOfflinePositions` header injection at `:90`.)

---

### Step 6 — test: trading owner-scope harness on the production interceptor chain

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/export_test.go` — create
- `services/xstockstrat-trading/internal/service/trading_owner_scope_test.go` — create

**Reviewers**: `xstockstrat-trading` owner — Order execution correctness, broker API safety, fill detection, paper-only dev invariant, position limit enforcement

**Codebase Evidence**:
- `ls services/xstockstrat-trading/internal/service/export_test.go` → absent. **Not found** — created
  by this step. Every existing `internal/service` test is `package service`.
- Fields the constructor sets are unexported: `trading.go:140` `accountRepo`, `:149` `repo`, `:165`
  `orders`, `:168` `subs`. `broadcastOrder` is unexported (`:435`). `NewTradingService` (`:215`)
  dials mTLS peers, so it cannot be used (R-7).
- Layout precedent: `services/xstockstrat-portfolio/internal/service/export_test.go:1-4` — "An
  in-package _test.go must never import internal/handler (import cycle with the external wire
  test)"; an external `package service_test` file may import it.
- Repo seam: `internal/repository/trading_repo.go:41` — `NewTradingRepoWithDB(db dbQuerier)`. Used
  with pgxmock at `trading_offline_test.go:1624-1631` (`pgxmock.NewPool()`).
- Fixture home (C-13): `internal/testdata/order_rows.go` — `OrderRowColumns` (`:9-16`) and
  `NewOrderRow(orderID, updatedAt, intentState)` (`:20-28`), which fixes `user_id` to `"user-1"`
  (`:25`). (Re-grepped 2026-11-26 @ `4230df50`; line drift only.)
- `repository.AccountRepository` is an exported interface (`internal/repository/account_repo.go:42-55`).
- bufconn precedent: `telemetry_allowlist_test.go:130-145` (`bufconn.Listen(1 << 20)` `:132`,
  `grpc.NewClient("passthrough:///bufnet", grpc.WithContextDialer(...), insecure)` `:137-139`).
- Production chain to mirror: `cmd/server/main.go:155` plus the Step 1 stream line, and
  `tradingv1.RegisterTradingServiceServer(grpcServer, grpcHdl.GRPCHandler())` at `:163`;
  `handler.NewTradingHandler` at `handler/trading.go:26`, `GRPCHandler` at `:138`.
- Repo SQL: `ListOrders` adds `user_id = $1` as the only argument when no other filter is set
  (`trading_repo.go:227-231`); `GetOrder` queries `WHERE order_id = $1` (`:111-125`).
- Lint: `staticcheck` is enabled (`.golangci.yml:7`); `//nolint:staticcheck // reason` precedent at
  `internal/broker/ibkr_session.go:219`.
- Agent rule proven here: `services/xstockstrat-agent/acceptance/agent-broker-account-tools.feature:52-57`
  (`@AC-7`).

**TDD**: `red-green required` — RED on the tree before Steps 3–5. `ListOrders` with body `user-b`
returns user-b's orders, a headerless read succeeds, `GetOrder` returns another user's order, and
the broker-account refusals arrive as `Internal`.

**Covers**: `AC-1, AC-4, AC-5, AC-6, AC-2` (AC-2: the rejection on the wire)

**Instructions**:
1. `export_test.go` (`package service`), exactly two exports (design Open Risk 3):
   - `NewOwnerScopeTestService(repo *repository.TradingRepo, accounts repository.AccountRepository, orders ...*tradingv1.Order) *TradingService`
     — sets `repo`, `accountRepo`, `orders` (keyed by `OrderId`) and an empty `subs` map. See the
     flagged note in `## Step Dependencies` for the `accounts` parameter.
   - `func (s *TradingService) BroadcastOrderForTest(o *tradingv1.Order)` — calls `s.broadcastOrder(o)`.
2. `trading_owner_scope_test.go` (`package service_test`). A helper starts a bufconn server with
   `grpc.ChainUnaryInterceptor(middleware.UnaryServerInterceptor)` and
   `grpc.ChainStreamInterceptor(middleware.StreamServerInterceptor)`, registers
   `handler.NewTradingHandler(svc).GRPCHandler()` and returns a `tradingv1.TradingServiceClient`.
   Put a two-line comment on the server options: they mirror `cmd/server/main.go` and must change
   with it (design Open Risk 2).
3. Caller identity goes on the wire with `metadata.NewOutgoingContext` (`x-user-id`,
   `x-access-scope`). Never seed `WithPropagationData` in this file (R-2). Every call uses a
   `context.WithTimeout`, so a pre-fix unscoped stream fails instead of hanging.
4. Order rows come from `testdata.NewOrderRow`; a local helper overwrites the `user_id` column,
   found by its index in `testdata.OrderRowColumns`. The ids `user-a` / `user-b` have this one
   consumer and stay inline (C-13).
5. Build the request bodies in two local helpers that set the body `user_id`, each annotated
   `//nolint:staticcheck // regression input: the deprecated body user_id must be ignored` so the
   file stays lint-clean once Steps 12–13 deprecate the field.
6. Cases:
   - `ListOrders` scoped (`@AC-1`, `@AC-4`): for (scope, body) in `("3","")`, `("3","user-b")`,
     `("4","user-b")`, `("4","")`, with `x-user-id` `user-a`. pgxmock expects one query on
     `FROM trading.orders` with args exactly `("user-a")`. Assert every returned order belongs to
     `user-a` and `ExpectationsWereMet()`.
   - `ListOrders` in-memory fallback: the query returns an error; the service holds orders for both
     users; only `user-a`'s are returned.
   - `StreamOrderUpdates` scoped (`@AC-1`, `@AC-4`): the same four rows. Broadcast `user-b`'s order
     then `user-a`'s through `BroadcastOrderForTest` until the first message arrives, then
     broadcast the pair once more; every received order must belong to `user-a`.
   - Headerless (`@AC-5`): `ListOrders`, `GetOrder` and `StreamOrderUpdates` (first `Recv`) with no
     `x-user-id` return `codes.PermissionDenied`, and no order is delivered.
   - `GetOrder` (`@AC-6`): for scopes `"3"` and `"4"`, `user-a` asking for `user-b`'s order returns
     `codes.NotFound` on both the in-memory hit and the repo hit. The status code and message format
     equal those for an id with no row. The owner reading the same order succeeds.
   - Broker-account refusals on the wire (agent `@AC-7`, 312 `@AC-2`): with a stub
     `repository.AccountRepository` whose `GetBrokerAccount` returns a fixed record — non-owner
     `DeregisterBrokerAccount` and `UpdateBrokerAccountCredentials` → `PermissionDenied`; owner
     `UpdateBrokerAccountCredentials` on an OFFLINE record → `FailedPrecondition`; headerless
     `RegisterBrokerAccount`, `UpdateBrokerAccountCredentials`, `ListBrokerAccounts` and
     `DeregisterBrokerAccount` → `PermissionDenied`.
7. Trading-domain constraints: the headerless `RegisterBrokerAccount` case runs for ALPACA, IBKR and
   OFFLINE. Order types, `TRADING_MODE` gating and fill handling are unaffected.
8. Coverage: the new logic is in excluded packages (`service/`, `handler/`) — no coverage threshold
   applies to it; this integration test is the evidence. The service-wide gate below must still hold.

**Verification**:
```bash
cd services/xstockstrat-trading && export GOWORK=off \
  && go test ./internal/service/... -race -count=1 -run 'OwnerScope|Headerless|GetOrder|BrokerAccountRefusals' -v | grep -E "^(--- |ok|FAIL)" \
  && COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') \
  && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" \
  && go tool cover -func=coverage.out | grep "^total:" \
  && ! grep -n "WithPropagationData" internal/service/trading_owner_scope_test.go \
  && test "$(grep -c '^func ' internal/service/export_test.go)" -eq 2 \
  && golangci-lint run --modules-download-mode=mod
```
Confirm the `total:` line is ≥ 40% and that the `-v` output lists the cases as `--- PASS`.

---

### Step 7 — test: trading broker-account owner gate and pool skip

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading_broker_owner_gate_test.go` — create

**Reviewers**: `xstockstrat-trading` owner — Order execution correctness, broker API safety, fill detection, paper-only dev invariant, position limit enforcement

**Codebase Evidence**:
- Fakes to reuse (`package service`): `offlineAccountRepo` (`trading_offline_test.go:32-55`,
  records `created` and `deactive`, returns `getRec`); `fakeAccountRepo` with `listActiveFn`
  (`trading_bracket_test.go:476`, field `:479`, used by `ListActiveBrokerAccounts` at `:496-497`).
  (Re-grepped 2026-11-26 @ `4230df50`; the other anchors below are unchanged.)
- Service literal pattern: `trading_offline_test.go:312-318` and `trading_ibkr_auth_test.go:286-289`
  (`&TradingService{cfg, cfgW, platformCfgW, encKey: testEncKeyHex, accountRepo, brokers, credStatus}`).
- Log capture: `captureLogs(t)` at `trading_sync_test.go:16`.
- Pool literal for `LoadBrokerPool`: `trading_ibkr_auth_test.go:237-241` (`brokers`, `credStatus`,
  `halted`, `haltReasons` maps).
- `ls services/xstockstrat-trading/internal/service/trading_broker_owner_gate_test.go` → absent.
  **Not found** — created by this step.

**TDD**: `red-green required` — RED on the tree before Step 4: a headerless register persists a
record with `UserID == ""`.

**Covers**: `AC-2`

**Instructions**:
1. `RegisterBrokerAccount` with `userID == ""`, table over `BROKER_TYPE_OFFLINE`,
   `BROKER_TYPE_ALPACA` and `BROKER_TYPE_IBKR`: `codes.PermissionDenied`, `len(repo.created) == 0`
   and an empty `svc.brokers` (`@AC-2`: rejected, nothing persisted).
2. `UpdateBrokerAccountCredentials` with `callerUserID == ""` on a record whose `UserID` is `""`:
   `PermissionDenied` and no pool entry (O-7).
3. `ListBrokerAccountsSvc` with `userID == ""`: `PermissionDenied`.
4. `DeregisterBrokerAccountSvc` with `callerUserID == ""` on a record whose `UserID` is `""`:
   `PermissionDenied` and `len(repo.deactive) == 0`.
5. `LoadBrokerPool` with one OFFLINE record owned by `""` and one owned by `"user-1"`: only the owned
   account is in `svc.brokers`, and `captureLogs` holds one WARN with the owner-less `account_id`.
6. C-13: the account ids and `"user-1"` are single-consumer literals in this file and stay inline;
   no `internal/testdata` entry is added.
7. Fill handling is unaffected by the gate, so no partial-fill case applies here.

**Verification**:
```bash
cd services/xstockstrat-trading && export GOWORK=off \
  && COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') \
  && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" \
  && go tool cover -func=coverage.out | grep "^total:" \
  && golangci-lint run --modules-download-mode=mod
```
Confirm the `total:` line is ≥ 40%. New logic is in an excluded package (`service/`) — no coverage
threshold applies to it; the unit tests above are the evidence.

---

### Step 8 — service: portfolio skips owner-less ledger events

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go` — modify

**Reviewers**: `xstockstrat-portfolio` owner — P&L calculation accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- Re-grepped 2026-11-26 on `feature/fix-read-path-owner-trust` @ `4230df50` (main-dev `f802b184`
  merged): every `portfolio_service.go` anchor moved; the lines below are current.
- `portfolio_service.go:376-388` — `processOrderFill` parses `orderFillPayload` (parse `:384-388`);
  `:436-439` is the dead fallback `acctID := fill.AccountId; if acctID == "" { acctID = "alpaca-default" }`.
- `:1590-1624` — `processAccountDeregistered`: an empty `AccountID` returns nil at `:1603-1605`;
  `:1606-1609` substitutes `"default"`; the purge uses it at `:1615`, and
  `DeleteOfflineRealized(ctx, payload.AccountID)` runs at `:1619`.
- `:1639-1665` — `processPositionSync`: an empty `AccountID` returns nil at `:1652-1654`;
  `var failures` is `:1655` and the lock is taken at `:1657`; the legacy comment and `"default"`
  fallback are `:1660-1665`.
- `:1794-1817` — `processBalanceSync` (no return value): `"default"` at `:1810-1813`, then
  `UpsertAccountBalance(..., userID, ...)` at `:1814`.
- Ack wiring: `:1477` and `:1489` wrap the handlers in `boundedRetry`; `:1791` uses
  `observed("balance sync", "acked", ackAlways(...))`; `:180` uses `observed("order fill", "ok", ...)`.
  A nil return never enters retry or parking.
- WARN idiom: `slog.WarnContext(ctx, "parse position sync payload", "error", err)` (`:1649`);
  `"event_type"` attribute precedent at `:1416`.
- Break radius: every existing sync, deregistration and fill test payload carries `user_id` and
  `account_id` (`portfolio_sync_retry_test.go:32,113,136`; `portfolio_sync_cancel_test.go:48`;
  `portfolio_offline_test.go:273-281,295,305`; `portfolio_fill_sync_race_test.go:68`;
  `portfolio_fill_errors_test.go:27`). `portfolio_helpers_test.go:227-235` is a local mirror that
  does not call production code. No existing test breaks.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add one unexported message constant for the skip log (new symbol, e.g. `ownerlessEventMsg`) and
   use it at all four sites with the attributes `"account_id"` and `"event_type", event.EventType`.
2. `processPositionSync`: after the `AccountID` check (`:1652-1654`) and before the lock (`:1657`),
   WARN and `return nil` when `sync.UserID == ""`. Then use `sync.UserID` directly and delete the
   fallback block and the legacy comment (`:1660-1665`).
3. `processAccountDeregistered`: replace `:1606-1609` with WARN and `return nil` when
   `payload.UserID == ""`; pass `payload.UserID` at `:1615`. The skip also skips
   `DeleteOfflineRealized` at `:1619`; that is accepted under D-5.
4. `processBalanceSync`: replace `:1810-1813` with WARN and `return` when `bal.UserID == ""`.
5. `processOrderFill`: after the payload parse (`:384-388`), WARN (attributes `"order_id"` and
   `"event_type"`) and `return nil` when `fill.AccountId == ""`. Delete the `"alpaca-default"` block
   at `:437-439`, keeping `acctID := fill.AccountId` (`:436`).
6. Each skip is a pre-write `return nil`. Do not change `boundedRetry`, `classifyConsumerErr` or any
   telemetry label; the skip is counted as `acked` (`ok` for the fill consumer) by the existing
   wrappers.
7. Fill state: `processOrderFill` consumes `order.filled` only; `order.partially_filled` is folded
   at `GetPnL` query time (`CLAUDE.md:96`) and is untouched. Both keep their handling for events
   that carry an `account_id`. Legacy pre-`user_id` events are dropped on replay (D-5).

**Verification**:
```bash
cd services/xstockstrat-portfolio && export GOWORK=off \
  && go build ./... \
  && go test ./internal/service/... -race -count=1 \
  && ! grep -n '"default"\|"alpaca-default"' internal/service/portfolio_service.go \
  && golangci-lint run --modules-download-mode=mod
```

---

### Step 9 — test: portfolio owner-less event skip

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_ownerless_event_test.go` — create
- `services/xstockstrat-portfolio/internal/service/portfolio_helpers_test.go` — modify

**Reviewers**: `xstockstrat-portfolio` owner — P&L calculation accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- Write recorder: `syncRecorderDB` (`portfolio_offline_test.go:219-244`, records every `Exec`;
  `find(substr)`), used with `repository.NewPortfolioRepoWithDB(db)` (`:256`).
- Event builder: `syncEvent(t, seq, payload)` (`portfolio_sync_retry_test.go:21`).
- WARN capture: `recordWarns(t)` (`portfolio_quote_deadline_test.go:63`), `warnCount`
  (`portfolio_sync_cancel_test.go:52`), `parkedCount` (`portfolio_sync_retry_test.go:47`).
- Ack proof pattern: `svc.boundedRetry(...)` with `svc.streamEventsFrom(...)` and the `streamLedger`
  fake, asserting `lastSeq` (`portfolio_sync_retry_test.go:63-84`).
- Stale mirror to remove: `portfolio_helpers_test.go:227-235` (`resolveSyncUserID`), its assertion
  at `:251-253`, and `TestPositionSyncPayload_FallsBackToDefault` at `:309-319`.
- `ls services/xstockstrat-portfolio/internal/service/portfolio_ownerless_event_test.go` → absent.
  **Not found** — created by this step.

**TDD**: `red-green required` — RED on the tree before Step 8: the recorder holds a write whose
arguments include `"default"`.

**Covers**: `AC-2`

**Instructions**:
1. For `account.positions.synced`, `account.balance.synced` and `account.deregistered`, feed an event
   with `account_id` set and `user_id` `""`. Assert the recorder holds no `Exec`, no argument equals
   `"default"`, and one WARN carries the `account_id`.
2. For `order.filled` with an empty `account_id`: no `Exec` and no `"alpaca-default"` argument.
3. Acked, not retried or parked: run an owner-less `account.positions.synced` event at sequence N
   followed by a well-formed one at N+1 through `boundedRetry` and `streamEventsFrom`. Assert
   `lastSeq == N+1`, the well-formed event's write is recorded, and `parkedCount == 0`. Repeat the
   two-event case for `account.deregistered`.
4. In `portfolio_helpers_test.go`, delete `resolveSyncUserID`, its assertion in
   `TestPositionSyncPayload_ParsesUserID` and the whole `TestPositionSyncPayload_FallsBackToDefault`;
   they mirror the removed fallback.
5. C-13: the event payload literals are single-consumer and stay inline.
6. Fill state: the fill case covers the full-fill (`order.filled`) stream event, the only event
   `processOrderFill` consumes; partial fills never reach it (`CLAUDE.md:128`).

**Verification**:
```bash
cd services/xstockstrat-portfolio && export GOWORK=off \
  && COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') \
  && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" \
  && go tool cover -func=coverage.out | grep "^total:" \
  && ! grep -rn "resolveSyncUserID" internal/service \
  && golangci-lint run --modules-download-mode=mod
```
Confirm the `total:` line is ≥ 40%. New logic is in an excluded package (`service/`) — no coverage
threshold applies to it; the tests above are the evidence.

---

### Step 10 — service: notify ListAlerts takes the owner from the header only

**Status**: `done`
**Service**: `xstockstrat-notify`
**Files**:
- `services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts` — modify

**Reviewers**: `xstockstrat-notify` owner — Stream delivery guarantees, backpressure handling, alert deduplication

**Codebase Evidence**:
- Re-grepped 2026-11-26 on `feature/fix-read-path-owner-trust` @ `4230df50` (main-dev `f802b184`
  merged, so feature 315 is in the base): the anchors moved 30-60 lines; the lines below are current.
- `notifyServiceImpl.ts:226-262` — `listAlerts`. Owner chain at `:230`:
  `call.metadata?.get?.('x-user-id')?.[0]?.toString() || req.userId || null`. Stale comment at
  `:228-229`.
- Unscoped predicate `($1::text IS NULL OR a.target_user_id = $1 OR a.target_user_id IS NULL)` at
  `:240` (main query) and `:248` (count query); params `[userId, limit]` at `:243`, `[userId]` at `:253`.
- Reuse (NOTIFY-5): `registerPushSubscription` at `:299-303` —
  `const userId = (call.metadata?.get?.('x-user-id')?.[0] ?? '').toString(); if (!userId) { return callback({ code: 3, message: 'x-user-id header required' }); }`.
  `getAlert` (`:267-271`) uses the same header-only idiom.
- Out of scope (D-11): `streamAlerts` body `userId` (`:160`), `acknowledgeAlert` body `userId`
  (`:184-193`, `call.request.userId` at `:188`) and the `markAlertRead` fallback (`:203`). Step 19
  files the report.
- Break radius: `tsc` compiles `src/__tests__` (`package.json` `"test": "tsc && node --test dist/__tests__/*.test.js"`).
  The only `listAlerts` callers are `notifyServiceImpl.test.ts:920,930,939`, all `metaCall('u1', …)`.
  No existing test breaks.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Feature 315 is already in the base (D-12); the anchors above were re-grepped after it merged.
2. Replace the owner chain at `:230` with the header-only read and the code-3 early return from
   `registerPushSubscription` (D-4). Do not read `req.userId`.
3. In both queries, change the predicate to `(a.target_user_id = $1 OR a.target_user_id IS NULL)`.
   Untargeted alerts stay visible to every identified caller.
4. Replace the comment at `:228-229` with at most two lines stating the constraint: the owner is the
   `x-user-id` header and the body `userId` is ignored.
5. No new outbound call, config key or env var.

**Verification**:
```bash
cd services/xstockstrat-notify \
  && pnpm run build && pnpm test && pnpm run lint \
  && ! grep -n '\$1::text IS NULL' src/grpc/notifyServiceImpl.ts \
  && test "$(grep -c "req.userId" src/grpc/notifyServiceImpl.ts)" -eq 1
```
(The one remaining `req.userId` is the out-of-scope `streamAlerts` read at `:160`; the
`call.request.userId` reads at `:188` and `:203` do not match the pattern.)

---

### Step 11 — test: notify ListAlerts owner scope

**Status**: `done`
**Service**: `xstockstrat-notify`
**Files**:
- `services/xstockstrat-notify/src/__tests__/notifyServiceImpl.test.ts` — modify

**Reviewers**: `xstockstrat-notify` owner — Stream delivery guarantees, backpressure handling, alert deduplication

**Codebase Evidence**:
- Re-grepped 2026-11-26 on `feature/fix-read-path-owner-trust` @ `4230df50` (main-dev `f802b184`
  merged): the anchors moved; the lines below are current.
- `notifyServiceImpl.test.ts:534-539` — `metaCall(userId | null, request)`.
- `:520` — `capturingPool(rows)`; `:831-846` — `seqPool(responses)`, which records `{ sql, params }`
  per call (main query first, count query second).
- Missing-header template: `:874-882` (the `markAlertRead` case: `err.code === 3` at `:880`,
  `pool.calls.length === 0` at `:881`).
- Existing block: `describe('listAlerts — read state (feature 203)', …)` at `:896-944`.
- `ls services/xstockstrat-notify/src/__tests__/fixtures` → `collectingReader.ts`, `fakeCommsgun.ts`,
  `fakeConfig.ts`, `scriptedPool.ts`, `stubFetch.ts`; none is an alert or user fixture, and none is
  added (C-13, single consumer).

**TDD**: `red-green required` — RED on the tree before Step 10: the headerless call returns rows
instead of code 3, and both SQL strings contain `$1::text IS NULL`.

**Covers**: `AC-3`

**Instructions**:
1. Add `describe('listAlerts — owner scope (feature 312)', …)` after the existing block.
2. `@AC-3` headerless: `impl.listAlerts(metaCall(null, {}), …)` → `err.code === 3` and
   `pool.calls.length === 0`.
3. `@AC-3` body ignored: `metaCall('user-a', { userId: 'user-b' })` → `pool.calls[0].params[0]` and
   `pool.calls[1].params[0]` are `'user-a'`, and no param of either call equals `'user-b'`.
4. `@AC-3` no unscoped branch: neither SQL string matches `/\$1::text IS NULL/`, and both match
   `/a\.target_user_id = \$1 OR a\.target_user_id IS NULL/` (untargeted alerts stay visible —
   PRESERVE `@AC-2` @feature-203).
5. The pool is a fake, so "no alert targeted to user-b is returned" is proven at the predicate and
   parameter level; state that in the test name.
6. C-13: `user-a` / `user-b` have this one consumer and stay inline.

**Verification**:
```bash
cd services/xstockstrat-notify \
  && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40 \
  && pnpm run lint
```

---

### Step 12 — proto: deprecate the three ignored body user_id fields

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/trading/v1/trading.proto` — modify
- `packages/proto/notify/v1/notify.proto` — modify

**Reviewers**: Proto Reviewer — Field number uniqueness per message, no breaking changes without deprecation comment, `buf lint` passes, `buf breaking` passes against dev trunk; `xstockstrat-trading` owner — Order execution correctness, broker API safety; `xstockstrat-notify` owner — Stream delivery guarantees, backpressure handling, alert deduplication

**Codebase Evidence**:
- `trading.proto:168-169` — `message ListOrdersRequest { string user_id = 1;` (no comment).
- `trading.proto:189-190` — `message StreamOrderUpdatesRequest { string user_id = 1;`.
- `notify.proto:106-107` — `message ListAlertsRequest { string user_id = 1;` (re-grepped
  2026-11-26 @ `4230df50`; the `trading.proto` anchors are unchanged).
- Precedent to follow: `trading.proto:201` —
  `string user_id = 6 [deprecated = true]; // DEPRECATED: caller identity resolved from the x-user-id header; body value ignored.`
- Out of scope (D-11): `notify.proto:91` (`StreamAlertsRequest.user_id = 1`) and `:99`
  (`AcknowledgeAlertRequest.user_id = 2`).
- No field is added, renumbered, renamed or removed. Field numbers stay `1`, `1` and `1`.

**Lands with**: `Step 13`

**TDD**: `N/A (proto)`

**Covers**: —

**Instructions**:
1. Add `[deprecated = true]` and a trailing comment to the three fields, keeping field number `1`
   on each: `// DEPRECATED: ignored; the owner is resolved from the x-user-id header.` (D-10).
2. Do not touch `StreamAlertsRequest` or `AcknowledgeAlertRequest`.
3. Approval class: additive (`buf breaking` clean) — trading owner and notify owner approval, no
   platform-lead sign-off.
4. If feature 322 merged first, rebase before editing; 322 edits `trading.proto` in other messages
   (D-12).

**Verification**:
```bash
cd packages/proto && buf lint \
  && buf breaking --against "$(git rev-parse --show-toplevel)/.git#branch=feature/fix-read-path-owner-trust,subdir=packages/proto" \
  && test "$(grep -c 'string user_id = 1 \[deprecated = true\]' trading/v1/trading.proto)" -eq 2 \
  && grep -n 'string user_id = 1 \[deprecated = true\]' notify/v1/notify.proto
```
(`subdir=packages/proto` is mandatory, PLAT-10.)

---

### Step 13 — proto-gen: regenerate trading and notify stubs

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/go/trading/v1/trading.pb.go` — modify (regenerated)
- `packages/proto/gen/go/notify/v1/notify.pb.go` — modify (regenerated)
- `packages/proto/gen/python/trading/v1/trading_pb2.py` — modify (regenerated)
- `packages/proto/gen/python/notify/v1/notify_pb2.py` — modify (regenerated)
- `packages/proto/gen/ts/trading/v1/trading.ts` — modify (regenerated)
- `packages/proto/gen/ts/trading/v1/trading_pb.ts` — modify (regenerated)
- `packages/proto/gen/ts/notify/v1/notify.ts` — modify (regenerated)
- `packages/proto/gen/ts/notify/v1/notify_pb.ts` — modify (regenerated)
- `packages/proto/gen/ts/dist/trading/v1/trading.d.ts` — modify (regenerated)
- `packages/proto/gen/ts/dist/trading/v1/trading.js` — modify (regenerated)
- `packages/proto/gen/ts/dist/trading/v1/trading_pb.d.ts` — modify (regenerated)
- `packages/proto/gen/ts/dist/trading/v1/trading_pb.js` — modify (regenerated)
- `packages/proto/gen/ts/dist/notify/v1/notify.d.ts` — modify (regenerated)
- `packages/proto/gen/ts/dist/notify/v1/notify.js` — modify (regenerated)
- `packages/proto/gen/ts/dist/notify/v1/notify_pb.d.ts` — modify (regenerated)
- `packages/proto/gen/ts/dist/notify/v1/notify_pb.js` — modify (regenerated)

**Reviewers**: Proto Reviewer — Field number uniqueness per message, no breaking changes without deprecation comment, `buf lint` passes, `buf breaking` passes against dev trunk; `xstockstrat-trading` owner — Order execution correctness, broker API safety; `xstockstrat-notify` owner — Stream delivery guarantees, backpressure handling, alert deduplication

**Codebase Evidence**:
- `scripts/buf-gen.sh` exists; it runs `buf lint`, `buf breaking`, generation and the TS compile.
- The paths above are the tracked message-bearing stubs (`git ls-files packages/proto/gen/{go,python,ts}/{trading,notify}/v1`).
  The generated files were listed by name only, never read.
- After Steps 3, 5 and 10 no production code reads the three fields:
  `grep -n "UserId" services/xstockstrat-trading/internal/handler/trading.go` → the
  `SnapshotOfflinePositions` injection only; `grep -n "req.userId" services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts`
  → the `streamAlerts` read only. The deliberate test writes in Step 6 carry `//nolint:staticcheck`.
- TS and Python have no deprecation lint: `services/xstockstrat-ui/.eslintrc.json` and
  `services/xstockstrat-notify/.eslintrc.json` have no `deprecat` rule. The UI BFF
  (`traderBff.ts:43,61`), the agent (`client.py:2600`) and analysis (`entry_backfill.py:81`,
  `servicer.py:6626`) keep sending the field; it is ignored. (Consumer anchors re-grepped
  2026-11-26 @ `4230df50`; the 16 gen paths above exist and are tracked.)

**Lands with**: `Step 12`

**TDD**: `N/A (proto-gen)`

**Covers**: —

**Instructions**:
1. From the repo root run `AGAINST_BRANCH=feature/fix-read-path-owner-trust ./scripts/buf-gen.sh`.
2. Stage exactly the files `git status --porcelain packages/proto/gen` reports. They must all be
   under `trading/v1` or `notify/v1`; a file listed above that the generator leaves byte-identical
   is simply not staged. Any other changed path is a blocker.
3. If the trading lint reports SA1019 on a line that is not one of the Step 6 annotated helpers,
   stop: a read of a deprecated field survived Steps 3 and 5.

**Verification**:
```bash
./scripts/buf-gen.sh \
  && test -z "$(git status --porcelain packages/proto/gen | grep -v 'trading/v1\|notify/v1')" \
  && (cd services/xstockstrat-trading && GOWORK=off go build ./... && GOWORK=off go test ./internal/service/... ./internal/handler/... -race -count=1 && GOWORK=off golangci-lint run --modules-download-mode=mod) \
  && (cd services/xstockstrat-notify && pnpm run build && pnpm test)
```
After the unit's commit, `./scripts/buf-gen.sh && git diff --exit-code packages/proto/gen/` must be
empty (CI `proto-freshness`).

---

### Step 14 — docs: xstockstrat-ui BFF order-read comment

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/traderBff.ts` — modify

**Reviewers**: none

**Codebase Evidence**:
- `traderBff.ts:35-36` — "Ownership comes from the x-user-id header, so these forward unchanged.
  listOrders keeps an explicit user_id — there it's a cross-user filter (empty = all), which the
  BFF pins to the session."
- `traderBff.ts:40-46` — `listOrders` sends `{ ...req, userId: claims.user_id }` with
  `backendHeaders(claims, ctx)`; `:58-64` — `streamOrderUpdates` does the same; `:47` — `getOrder`
  is a plain `forward`; `:104` — `listAlerts` is a plain `forward`.
- PRESERVE `@AC-2` @feature-270 (`services/xstockstrat-ui/acceptance/fix-ui-trader-feedback.feature`):
  the stream contract for an identified caller is unchanged.

**TDD**: `N/A (comment-only; no behaviour change)`

**Covers**: —

**Instructions**:
1. Rewrite the comment at `:35-36` in at most two lines: ownership comes from the `x-user-id`
   header on every trading RPC, and the trading service ignores the body `user_id` the BFF still
   sets on `listOrders` / `streamOrderUpdates`.
2. Change no code. The `userId` pin at `:42` and `:61` stays; it is harmless and removing it is out
   of scope.
3. C-12: no test or fixture is added or changed.

**Verification**:
```bash
cd services/xstockstrat-ui \
  && ! grep -n "cross-user filter" src/lib/traderBff.ts \
  && pnpm run lint \
  && pnpm exec vitest run src/lib/traderBff.test.ts src/lib/__tests__/traderBff.test.ts
```

---

### Step 15 — docs: xstockstrat-agent body user_id wording

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/CLAUDE.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- Re-grepped 2026-11-26 on `feature/fix-read-path-owner-trust` @ `4230df50` (main-dev `f802b184`
  merged): the old "target/scope selector, not the caller — `list_account_orders`" wording is gone.
- `services/xstockstrat-agent/CLAUDE.md:22-24` — "Identity travels only in `x-user-id`; set a body
  `user_id` only when it is a target/scope selector (e.g. `ListOrders` filter, config per-user scope,
  `emit_alert` target, `IssueAuthCode` subject), never to name the caller." `:23` is the only
  `ListOrders` mention in the file.
- `services/xstockstrat-agent/app/client.py:2593-2604` — `list_account_orders` sends
  `ListOrdersRequest(user_id=user_id, account_id=account_id)` (`:2600`) with `x-user-id` set to the
  same caller, so results are unchanged. `get_order` (`:2579-2590`) sends the header only.
- `services/xstockstrat-agent/tests/test_offline_client.py:165-183` pins the current request shape
  and is not edited.
- Agent `@AC-7` (`acceptance/agent-broker-account-tools.feature:52-57`) is proven on the wire by
  Step 6; the tool already passes `PERMISSION_DENIED` through (`app/tools.py:228-239`).

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. At `CLAUDE.md:22-24`, take "`ListOrders` filter" out of the target/scope-selector examples and
   state that trading ignores the body `user_id` on `ListOrders`; the owner is `x-user-id`. Keep the
   paragraph's other examples and line wrapping intact.
2. Change no agent code, tool contract or test. The six tool-inventory surfaces are untouched.

**Verification**:
```bash
! grep -n "ListOrders. filter" services/xstockstrat-agent/CLAUDE.md \
  && grep -n "ListOrders" services/xstockstrat-agent/CLAUDE.md
```

---

### Step 16 — docs: xstockstrat-analysis entry-backfill comment

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/engine/entry_backfill.py` — modify

**Reviewers**: none

**Codebase Evidence**:
- `entry_backfill.py:73` — "# Body user_id is load-bearing: trading treats an empty user_id as all users."
- `entry_backfill.py:78-84` — the call sends `owner_metadata(user_id)` plus `x-trace-id`, and
  `ListOrdersRequest(user_id=user_id, strategy_id=strategy_id, symbol=symbol)`.
- `services/xstockstrat-analysis/app/handlers/servicer.py:6625-6628` — `GetStrategyAnalytics` sends
  the same owner in body (`ListOrdersRequest(strategy_id=strategy_id, user_id=user_id)`, `:6626`)
  and header (`metadata=propagation_meta`); no comment to change there. (Re-grepped 2026-11-26 @
  `4230df50`; the `entry_backfill.py` anchors are unchanged.)
- PRESERVE `@AC-1` @feature-262 (`services/xstockstrat-analysis/acceptance/fix-analysis-owner-scope.feature`):
  the call shape is not altered.

**TDD**: `N/A (comment-only; no behaviour change)`

**Covers**: —

**Instructions**:
1. Replace the comment at `:73` with one line stating the constraint that now holds: trading scopes
   `ListOrders` to the `x-user-id` in `owner_metadata(user_id)`, so that header is load-bearing.
2. Change no code; the request keeps its body `user_id`.

**Verification**:
```bash
cd services/xstockstrat-analysis \
  && ! grep -n "empty user_id as all users" app/engine/entry_backfill.py \
  && ruff check . && ruff format --check .
```

---

### Step 17 — docs: service CLAUDE.md files and context constitutions

**Status**: `pending`
**Service**: `docs` (trading, notify, portfolio, proto, root constitution)
**Files**:
- `services/xstockstrat-trading/CLAUDE.md` — modify
- `services/xstockstrat-notify/CLAUDE.md` — modify
- `services/xstockstrat-notify/docs/context-constitution.md` — modify
- `services/xstockstrat-portfolio/CLAUDE.md` — modify
- `packages/proto/docs/context-constitution.md` — modify
- `docs/context-constitution.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- Re-grepped 2026-11-26 on `feature/fix-read-path-owner-trust` @ `4230df50` (main-dev `f802b184`
  merged). Two edit targets are gone and one moved home; the lines below are current.
- `services/xstockstrat-trading/CLAUDE.md:39-45` — "**Exception:** `ListOrders` and
  `StreamOrderUpdates` keep their body `user_id` … (empty = all users, for trusted internal callers)
  … so it is not deprecated" (`:39-41`), and the `broadcastOrder` sentence with "empty = all users"
  (`:42-45`).
- `services/xstockstrat-trading/docs/context-constitution.md:28` — TRADING-N1 now reads "**Retired
  2026-09-02** — identity is header-based; see root **PLAT-11** …". The "keep it as a *filter*"
  parenthesis no longer exists and the file has no other body-`user_id` text, so this step does not
  edit it.
- `services/xstockstrat-notify/CLAUDE.md:32` — "Per-user read state (`notify.alert_reads`, feature
  203) and the owner fallback: NOTIFY-7." The old `:38-40` `ListAlerts` sentence is gone; the file
  has no `ListAlerts` mention.
- `services/xstockstrat-notify/docs/context-constitution.md:17` (NOTIFY-5, header-only
  `RegisterPushSubscription`) and `:19` (NOTIFY-7: "`MarkAlertRead` / `ListAlerts` take the owner
  from the `x-user-id` header and fall back to the body `userId`", "with no identity at all
  `ListAlerts` is unscoped").
- `services/xstockstrat-portfolio/CLAUDE.md:91` § Ledger Events Consumed — rows `order.filled`
  (`:95`), `account.positions.synced` (`:97`), `account.deregistered` (`:98`),
  `account.balance.synced` (`:99`).
- `packages/proto/docs/context-constitution.md:33` — "Body `user_id` rules → root PLAT-11;
  module-specific additions: Also deprecated + server-ignored (feature 224): …". The old `:38`
  trading/notify inventory is gone; that inventory now lives only in root PLAT-11.
- `docs/context-constitution.md:35` — PLAT-11: live body `user_id` list includes "notify
  `StreamAlerts/Acknowledge/ListAlerts`" and "`ListOrders/StreamOrderUpdates` (empty = all users)".

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. Trading `CLAUDE.md:39-45`: replace the Exception with the new contract — `GetOrder`,
   `ListOrders` and `StreamOrderUpdates` resolve the owner from `x-user-id` (`ResolveOrderOwner`);
   the body `user_id` is deprecated and ignored for every scope including ADMIN; headerless →
   `PermissionDenied`; another user's order → `NotFound`; no RPC returns cross-user orders. Drop
   "empty = all users" from the `broadcastOrder` sentence. Add the broker-account owner gate and the
   `LoadBrokerPool` owner-less skip in one sentence each (C-16 CHANGE, operator sign-off 2026-11-20).
2. TRADING-N1 is retired and the trading constitution carries no body-`user_id` text; do not edit
   `services/xstockstrat-trading/docs/context-constitution.md`.
3. Notify `CLAUDE.md:32`: reword the pointer so it says `ListAlerts` is header-only (a missing
   `x-user-id` is rejected with code 3) and only `MarkAlertRead` keeps the body fallback (NOTIFY-7).
4. NOTIFY-5 (`:17`): add `ListAlerts` to the header-only rule. NOTIFY-7 (`:19`): narrow the body
   fallback wording to `MarkAlertRead` and remove "with no identity at all `ListAlerts` is unscoped".
5. Portfolio `CLAUDE.md:95,97-99`: on the four rows, state that an event without `user_id`
   (`account_id` for `order.filled`) is acked, WARN-logged and skipped, and that legacy
   pre-`user_id` events are therefore dropped on replay. Use the literal phrase
   `acked, WARN-logged and skipped` on each of the four rows; the **Verification** counts it (the
   file has no such phrase today, and a bare `skipped` already matches `:139` and `:141`).
6. Proto constitution `:33`: add `trading.proto#ListOrdersRequest.user_id` (~L169),
   `#StreamOrderUpdatesRequest.user_id` (~L190) and `notify.proto#ListAlertsRequest.user_id` (~L107)
   to the module-specific "Also deprecated + server-ignored" additions, as a "(feature 312)" clause
   beside the feature-224 one. Do not add the trading fields to PROTO-10 (D-10).
7. Root PLAT-11 (`:35`): remove `ListAlerts` and `ListOrders/StreamOrderUpdates` from the live body
   `user_id` list; `StreamAlerts/Acknowledge` stay live.
8. State current behaviour only; no history narration.

**Verification**:
```bash
! grep -n "empty = all users" services/xstockstrat-trading/CLAUDE.md docs/context-constitution.md \
  && ! grep -n "is unscoped" services/xstockstrat-notify/CLAUDE.md services/xstockstrat-notify/docs/context-constitution.md \
  && grep -n "ResolveOrderOwner" services/xstockstrat-trading/CLAUDE.md \
  && grep -n "ListAlerts" services/xstockstrat-notify/CLAUDE.md \
  && test "$(grep -c 'acked, WARN-logged and skipped' services/xstockstrat-portfolio/CLAUDE.md)" -eq 4 \
  && grep -n "ListAlertsRequest.user_id" packages/proto/docs/context-constitution.md
```

---

### Step 18 — docs: mTLS rollout runbook flat-book check

**Status**: `pending`
**Service**: `docs/runbooks/`
**Files**:
- `docs/runbooks/inter-service-mtls-rollout.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `docs/runbooks/inter-service-mtls-rollout.md:99-101` — "**Verify a flat book** — zero open/working
  orders across all accounts … Confirm via the trader surface or `ListOrders` filtered to
  open/working states; wait for or cancel any working order."
- Predicate to copy verbatim: `services/xstockstrat-trading/internal/repository/trading_repo.go:310-312`
  (`ListSubmittedOrders`) — `WHERE status IN ('new', 'partially_filled') AND broker_order_id IS NOT NULL AND broker_order_id != ''`.
- `docs/runbooks/operator-db-access.md:42-53` — § Running admin SQL, the `psql` connection recipe
  (`:46-49`); "Prefer read-only inspection" is in § Safety (`:79`) at `:81`. (Re-grepped 2026-11-26
  @ `4230df50`; the runbook and `trading_repo.go` anchors above are unchanged.)

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. Replace the "Confirm via the trader surface or `ListOrders` …" sentence at `:100-101` with a
   read-only query run through `docs/runbooks/operator-db-access.md`:
   `SELECT count(*) FROM trading.orders WHERE status IN ('new', 'partially_filled') AND broker_order_id IS NOT NULL AND broker_order_id != '';`
   The expected result is `0`.
2. Remove the "trader surface / `ListOrders`" option entirely; it only ever showed one operator's
   own orders (D-18, O-9). Keep "wait for or cancel any working order".
3. macOS-compatible commands only; link the access runbook instead of repeating its recipe.

**Verification**:
```bash
grep -n "status IN ('new', 'partially_filled')" docs/runbooks/inter-service-mtls-rollout.md \
  && grep -n "operator-db-access.md" docs/runbooks/inter-service-mtls-rollout.md \
  && ! grep -n "trader surface" docs/runbooks/inter-service-mtls-rollout.md
```

---

### Step 19 — docs: file the two follow-up defect reports

**Status**: `pending`
**Service**: `docs/reports/`
**Files**:
- `docs/reports/2026-11-20-notify-streamalerts-acknowledgealert-body-user-id-defect.md` — create
- `docs/reports/2026-11-20-notify-streamalerts-acknowledgealert-body-user-id-defect.status` — create
- `docs/reports/2026-11-20-trading-broker-accounts-ownerless-rows-cleanup-defect.md` — create
- `docs/reports/2026-11-20-trading-broker-accounts-ownerless-rows-cleanup-defect.status` — create

**Reviewers**: none

**Codebase Evidence**:
- Re-grepped 2026-11-26 on `feature/fix-read-path-owner-trust` @ `4230df50` (main-dev `f802b184`
  merged): the evidence anchors moved; the lines below are current (pre-Step 3/4/10 tree — re-grep
  after those steps land, since they shift these lines again).
- Template and sidecar contract: `.claude/skills/sdd-qa/reference/defect-filing.md` (§ The template
  `:50`, with `## Observed` `:64` and `## Evidence` `:77`; § The status sidecar `:26`: line 1 `open`,
  no `ref:` line). The section headings are load-bearing.
- Report 1 evidence (D-11): `packages/proto/notify/v1/notify.proto:91` (`StreamAlertsRequest.user_id`,
  "filter by user; empty = all") and `:99` (`AcknowledgeAlertRequest.user_id = 2`);
  `services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts:160` (`userId: req.userId ?? ''`) and
  `:184-193` (`acknowledgeAlert` uses `call.request.userId`, `:188`).
- Report 2 evidence (D-9): `services/xstockstrat-trading/internal/service/trading.go:293-333`
  (`LoadBrokerPool`, with the Step 4 skip), `:356-387` (`resolveAccount`), `:1816` (`pollFills`);
  last trading migration `services/xstockstrat-trading/migrations/011_offline_fees_snapshot_headers.up.sql`,
  so the candidate cleanup migration is `012`.
- `ls docs/reports | grep 2026-11-20` → no match; both names are free.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. Write both reports from the template with `**Recorded**: 2026-11-20` and `**Severity**: SEV-3`.
   Each report contains exactly one severity token, in that field.
2. Report 1 — notify `StreamAlerts` / `AcknowledgeAlert` trust a body `user_id`: Observed, Expected
   (header-only on the NOTIFY-5 model), Reproduction, Evidence (the lines above), root cause, and
   that feature 312 scoped only `ListAlerts`. `**Affected service(s)**: xstockstrat-notify`;
   `**Config-only fix possible**: no`.
3. Report 2 — `trading.broker_accounts` rows with `user_id = ''` need cleanup: Observed (rows the
   pre-fix `RegisterBrokerAccount` could persist; after 312 they are skipped at load with a WARN, so
   their in-flight orders are not reconciled), Expected (rows deactivated or re-owned), trigger (the
   `LoadBrokerPool` WARN appearing in dev or prod logs), candidate fix (a trading `012` deactivation
   migration with DBA approval), and a pointer to the Step 20 row count in 312's `context.md`.
   `**Affected service(s)**: xstockstrat-trading`; `**Config-only fix possible**: no`.
4. Each `.status` sidecar is the single line `open`.

**Verification**:
```bash
for f in notify-streamalerts-acknowledgealert-body-user-id trading-broker-accounts-ownerless-rows-cleanup; do
  test "$(head -1 docs/reports/2026-11-20-$f-defect.status)" = "open" \
    && test "$(grep -o 'SEV-[0-9]' docs/reports/2026-11-20-$f-defect.md | wc -l | tr -d ' ')" -eq 1 \
    && grep -q '^## Observed' docs/reports/2026-11-20-$f-defect.md \
    && grep -q '^## Evidence' docs/reports/2026-11-20-$f-defect.md || exit 1
done
```

---

### Step 20 — docs: record the owner-less broker-account row count (operator gate)

**Status**: `pending`
**Service**: `docs/roadmap/features/312-fix-read-path-owner-trust/`
**Files**:
- `docs/roadmap/features/312-fix-read-path-owner-trust/context.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- design.md §10 and debate.md O-11: before merge, a read-only
  `SELECT count(*) FROM trading.broker_accounts WHERE user_id = '' AND is_active` runs per
  environment and the count is recorded in `context.md`.
- Columns exist: `services/xstockstrat-trading/internal/repository/account_repo.go:70-78`
  (`INSERT INTO trading.broker_accounts (id, display_name, broker_type, is_paper, is_active, user_id, …)`).
- Access path: `docs/runbooks/operator-db-access.md:46-57`.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. This step needs database access the executor does not have. Ask the operator to run, read-only,
   in each environment (staging and production):
   `SELECT count(*) FROM trading.broker_accounts WHERE user_id = '' AND is_active;`
2. Append the two counts to `context.md` under the step's session entry as one bullet line that
   starts at column zero with `- O-11 row count:` (the **Verification** greps that exact prefix),
   with the environment, the count and the date for each.
3. Never invent a count. If the operator cannot supply one, block the step and keep the integration
   PR unmerged (P-03).
4. A non-zero count does not block the merge; it sizes the Step 19 cleanup follow-up.

**Verification**:
```bash
grep -n "^- O-11 row count:" docs/roadmap/features/312-fix-read-path-owner-trust/context.md
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

Spec-time deviations from design.md, recorded at `/sdd-review impl-spec` (2026-11-20):

| Step | design.md says | This spec does | Why | Sign-off |
|---|---|---|---|---|
| 6 | §8: the `export_test.go` constructor sets `repo`, `orders` and `subs` "and nothing else" | `NewOwnerScopeTestService` takes a third parameter, `accounts repository.AccountRepository` | The same test carries the agent `@AC-7` wire proof, which reaches the unexported `accountRepo` (`trading.go:140`). `export_test.go` stays at two funcs (constructor plus broadcast shim), so the C-18 minimality bound holds | Trading owner ack pending (context.md Open Thread) |
| 12+13 | Build order puts the proto deprecation first | Proto and proto-gen land after Steps 3, 5, 6 and 10 | `[deprecated = true]` trips staticcheck SA1019 (`services/xstockstrat-trading/.golangci.yml:7`) at the body `UserId` read sites until those steps remove them. `nolintlint` is not enabled, so the `//nolint:staticcheck` lines Step 6 adds before the deprecation lands are inert | Proto reviewer and trading owner ack pending (context.md Open Thread) |

Execution-time deviations (`/sdd-execute`, 2026-11-27):

- **Steps 12+13 — scope expansion of Step 13 (operator ruling 2026-11-27, option A).** Once the deprecation was generated, the trading lint failed with `internal/service/trading_helpers_test.go:292:6: SA1019: ... ListOrdersRequest).UserId is deprecated`. The unit also edits `services/xstockstrat-trading/internal/service/trading_helpers_test.go`, which is not in Step 13's **Files**. It deletes the stale `if req.UserId != "" && o.UserId != req.UserId { return false }` clause from the `TestListOrdersInMemoryFilters` copy of the filter. The production filter has been owner-based since Step 3, and no case in this test sets `UserId`. **Disposition**: scope expansion approved by the operator; ruling recorded verbatim in context.md.
- **Step 13 — codegen in Docker (CI-equivalent fallback).** The host has `buf` 1.72.0 but not the pinned Go plugins, `grpcio-tools` or the `packages/proto/gen/ts` dependencies. The Verification's `./scripts/buf-gen.sh` therefore ran inside the cached, version-pinned `xstockstrat-codegen` image (`Dockerfile.codegen`, the image `scripts/localenv-setup.py` builds), with the main checkout's root and `gen/ts` `node_modules` mounted read-only. `localenv-setup.py` itself was not run, because it would also write dev certs. Inside the container `buf-gen.sh` skips `buf breaking` (the worktree's git dir is not mounted), but Step 12's Verification ran `buf breaking` on the host and it was clean. The rest of the union Verification ran on the host unchanged. **Disposition**: CI-equivalent fallback.
- **Step 13 — `gen/ts/dist/{trading,notify}/v1/{trading,notify}.js` were left byte-identical by the generator** and so were not staged (Instruction 2). The other 14 listed paths changed.
