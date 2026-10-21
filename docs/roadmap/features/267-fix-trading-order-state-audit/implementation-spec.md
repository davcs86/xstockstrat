# Implementation Spec: fix-trading-order-state-audit

**Status**: `pending`
**Created**: 2026-10-21
**Feature**: `docs/roadmap/features/267-fix-trading-order-state-audit/feature.md`
**Total Steps**: 7
**Feature Branch**: `feature/fix-trading-order-state-audit`

---

## Execution Summary

The work is three red-before-green pairs in `services/xstockstrat-trading/internal/service/`, then one docs
step. This follows design.md's build order.

1. **D-04 (Steps 1→2).** Add the checked order-state write helper and use it at the four sites.
2. **D-62 (Steps 3→4).** Add the audited reactive reclaim helper and the shared payload builder, and change
   the sweeper's payload.
3. **Scope widening (Steps 5→6).** The operator decided on 2026-10-21 to convert every remaining
   request-reachable `context.Background()` ledger emit, alert emit and finalize/bracket call in `trading.go`
   to `context.WithoutCancel(ctx)`. Each site gets a trace assertion.
4. **Docs (Step 7).**

Each RED test is written against the pre-implementation tree and must fail there before its service step
runs (P-06). All new tests and fakes go in one new file, `trading_order_state_audit_test.go`, as design.md
§ Tests requires.

There are no proto, migration or config steps. recon.md:109-113 confirms none is needed: trading's last
migration is `011_offline_fees_snapshot_headers`, and the `buf` gate does not apply. xstockstrat-ledger gets
no change. `AppendEvent` stores `eventType` verbatim (`services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts:31-58`).
It resolves the owner from `req.userId` and falls back to the `x-user-id` metadata (`:37-39`), and every
converted request-path emit passes a non-empty `order.UserId`, so the newly forwarded header changes no stored
owner.

**Consumer surface (C-14):** product-spec.md § Consumer Surface(s) says `None — internal/platform-only`.
This feature has no UI or agent step by decision, not by omission. RPC codes and `FailedPrecondition`
messages are unchanged.

**Trading-domain constraints (step-constraints.md §A):**
- **Brokers.** ALPACA and IBKR both go through the provider-agnostic `TradingService` sites. Step 5
  exercises the IBKR bracket paths `createBracket`/`resizeBracket` and the Alpaca atomic path.
- **Paper vs live.** No trading-mode gate is touched. The fakes report `IsPaper()==true`
  (`trading_bracket_test.go:72`), and behaviour is the same in both modes.
- **Order types.** Order-type handling is unaffected. MARKET and LIMIT are the types the tests drive; STOP,
  STOP_LIMIT and TRAILING_STOP take the same write and reclaim paths and are unaffected (product-spec C-4).
- **Fills.** Step 1 adds PARTIALLY_FILLED sub-cases for the CancelOrder and ReplaceOrder final writes
  (product-spec C-5). Step 5 asserts both FILLED and PARTIALLY_FILLED through `applyBrokerOrderStatus`. The
  fill semantics themselves are unchanged.

### Scenario Coverage (C-15)

| Scenario | Covered by |
|---|---|
| `@AC-1` (broker timeout write failure logged, status NEW) | Step 1 |
| `@AC-2` (broker reject write failure logged, status REJECTED) | Step 1 |
| `@AC-3` (CancelOrder final write failure logged, status CANCELED) | Step 1 |
| `@AC-6` (ReplaceOrder final write failure logged) | Step 1 |
| `@AC-4` (reactive_place reclaim audited) | Step 3 |
| `@AC-5` (CancelOrder reclaim failure logged) | Step 3 |
| `@AC-7` (ReplaceOrder reclaim failure logged) | Step 3 |
| `@AC-8` (reactive_cancel reclaim audited) | Step 3 |
| `@AC-9` (reactive_replace reclaim audited) | Step 3 |

## Step Dependencies

- Step 1 [test] covers Step 2 [service]. It is authored first and must be RED against the unmodified tree.
- Step 3 [test] covers Step 4 [service]. It is RED first. It needs Step 2, because the cancel and replace
  harnesses share `failingExecDB`/`ctxCapturingDB` and the AC-8/AC-9 paths must not hit an unlogged write.
- Step 5 [test] covers Step 6 [service]. It is RED first. It needs Steps 2 and 4, because sites
  `:688`/`:703`/`:1367`/`:1550` and `:603`/`:1301`/`:1498` already belong to those steps, and Step 5 must not
  re-assert them as new conversions.
- Step 7 [docs] needs Steps 4 and 6. It documents the shipped triggers, payload and stream.
- **Integration PR:** `trading.go` overlaps with 241, 242, 249 and 256 (recon.md:150). Sequence via
  `docs/roadmap/features/merge-order.md` before the integration PR. Every line cite below is anchored to its
  enclosing symbol so that it survives a rebase.

---

### Step 1 — test: RED — D-04 order-state write failures are logged (AC-1, AC-2, AC-3, AC-6)

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading_order_state_audit_test.go` — create

**Reviewers**: `xstockstrat-trading` owner — order execution correctness, broker API safety, fill detection, paper-only dev invariant, position limit enforcement

**Codebase Evidence**:
- D-04 sites, all confirmed this session with `grep -n "context.Background()\|_ = s.repo.UpsertOrder" internal/service/trading.go`:
  - `trading.go:688` (`submitOrder` timeout branch, `_ = s.repo.UpsertOrder(context.Background(), order)`)
  - `:703` (definite-reject branch)
  - `:1367` (`CancelOrder`, `_ = s.repo.UpsertOrder(ctx, order)`)
  - `:1550` (`ReplaceOrder`, `_ = s.repo.UpsertOrder(ctx, order)`)
- The precedent log it must be told apart from: `trading.go:646` `slog.Warn("db upsert order failed", "order_id", orderID, "error", err)`. It fires first under an always-failing DB (recon.md:129-130).
- DB fake to embed: `execOnlyDB` at `trading_flatten_rejection_test.go:27`. Its `Exec` always succeeds. Repo constructor: `repository.NewTradingRepoWithDB(db dbQuerier)` at `internal/repository/trading_repo.go:41`.
- Log capture: `captureLogs(t)` at `trading_sync_test.go:16`. It swaps `slog.Default`, so tests that use it must not call `t.Parallel`.
- Ctx seam: `middleware.WithPropagationData` at `internal/middleware/propagation.go:24-28`, and `middleware.FromContext` at `:19-22`.
- Fakes: `fakeBroker` at `trading_bracket_test.go:26` (`submitOrderFn`, `cancelOrderFn`; `ReplaceOrder` at `:53`). `fakeOrderIntentRepo` at `:496` (`InsertIntent`→true, `FinalizeIntent`→nil). `fakeLedgerClient` at `:201`. `fakeNotifyClient` at `:176`. `fakeBracketRepo` at `:95`.
- PlaceOrder gate table:
  - `platform.maintenance_mode` at `trading.go:401`
  - `client_order_id` required at `:419`
  - `resolveAccount` at `:423`
  - ownership at `:433`
  - the `s.accountRepo != nil` guard at `:440` (leave it nil)
  - `isAccountHalted` at `:460`
  - `checkTradingStateForPlaceOrder` at `:466`, which reads `platform.trading_state` and defaults to `HALTED` (`trading.go:3496-3498`); inject it with `config.NewSnapshotWatcher` (`internal/config/config.go:249`), as `trading_state_gate_test.go:156` does
  - `validateTIF` at `:472`, where TIF is required (`tif_validation.go:61-64`)
  - `needRiskCheck` at `:494`, controlled by `trading.risk.max_position_pct`; set it to `0`
- ReplaceOrder gate table:
  - status NEW or PARTIALLY_FILLED at `:1435-1441`
  - `isAccountHalted` at `:1445`
  - `checkTradingStateForReplace` at `:1450`
  - `BrokerOrderId != ""` at `:1454`
  - `resolveAccount` at `:1459`
- CancelOrder: ownership at `:1256`; the broker path requires `order.BrokerOrderId != ""` and a pool entry (`:1309-1314`). The template is `notCancelableSvc` at `trading_cancel_not_cancelable_test.go:22`.
- No assertion library: `go.mod` has no testify. The existing bounded poll is `waitForAlert` at `trading_bracket_test.go:397` (2s deadline, 5ms sleep).

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2, AC-3, AC-6`

**Instructions**:

1. Create `trading_order_state_audit_test.go` (package `service`). Add the test-local fakes below. C-13
   verdict: this file is their only consumer, so declaring them inline is compliant. A second consumer later
   would move them to `internal/testdata/`.
   - `ctxCapturingDB` embeds `execOnlyDB`.
     - It has a settable `failExec error`.
     - Its `Exec(ctx, sql, args...)` records `{traceID: middleware.FromContext(ctx).TraceID, ctxErr: ctx.Err()}` under a mutex, then returns `failExec`.
     - `failingExecDB` is the same type with `failExec = errors.New("db unavailable")`.
   - A helper `tracedCancelledCtx(user string) context.Context`:
     - it builds `middleware.WithPropagationData(parent, PropagationData{UserID: user, TraceID: "t-267"})` on a cancellable parent;
     - it cancels the parent **before** returning.
     - This realizes design.md § Tests "parent cancelled before the invoker ran" deterministically. The fakes ignore ctx on every earlier call, so the handler still reaches the site.
     - Fallback: if any path aborts on `ctx.Err()`, the test falls back to the design's cancel-after-return ordering plus a bounded poll, and records a Deviation Log entry.
   - A helper `findLog(recs, msg, status string)` selects by `msg` plus `status`, never by level alone.
2. **AC-1 test `TestPlaceOrder_BrokerTimeout_FailedWriteLogged_AC1`** (non-parallel, uses `captureLogs`).
   - Service:
     - `repo: NewTradingRepoWithDB(&failingExecDB)`;
     - `orderIntentRepo: &fakeOrderIntentRepo{}`;
     - broker entry `"acct-1"` → `{client: &fakeBroker{submitOrderFn: returns context.DeadlineExceeded}, brokerType: ALPACA, userID: "u-1"}`;
     - `cfgW` snapshot with `platform.trading_state=ACTIVE` and `trading.risk.max_position_pct=0`;
     - `ledger: &fakeLedgerClient{}`, `notify: &fakeNotifyClient{}`, `orders: map{}`, and the halt maps as in `newFlattenHarness`.
   - Call `PlaceOrder(ctxAsUser("u-1"), {Symbol "AAPL", Side BUY, Qty 10, OrderType MARKET, TimeInForce DAY, ClientOrderId "c-1", AccountId "acct-1"})`.
   - Assert that exactly one record has `msg == "order state write failed"`, `level == "ERROR"`, a non-empty `order_id`, `user_id == "u-1"`, `status == "ORDER_STATUS_NEW"`, `path == "broker_timeout"`, and `error` containing `db unavailable`.
3. **AC-2 test `..._BrokerReject_..._AC2`**: the same harness, with `submitOrderFn` returning `errors.New("insufficient buying power")`. Assert the record with `status == "ORDER_STATUS_REJECTED"` and `path == "broker_reject"`.
4. **AC-3 test `TestCancelOrder_FinalWriteFailureLogged_AC3`**: the `notCancelableSvc`-shaped service has:
   - order `{OrderId "o-1", UserId "u-1", AccountId "acct-1", BrokerOrderId "brk-1", Status NEW, BrokerType ALPACA}`;
   - a broker whose `cancelOrderFn` returns nil;
   - `repo` over `failingExecDB`.

   Call `CancelOrder(ctxAsUser("u-1"), {OrderId: "o-1"})`. Assert a record with `order_id "o-1"`, `user_id "u-1"`, `status "ORDER_STATUS_CANCELED"` and `path "cancel_final"`.
5. **AC-6 test `TestReplaceOrder_FinalWriteFailureLogged_AC6`**: the order is a LIMIT `"o-1"` in NEW, `BrokerOrderId "brk-1"`, with the ACTIVE snapshot and the broker `ReplaceOrder` succeeding (`trading_bracket_test.go:53`). Call `ReplaceOrder(ctxAsUser("u-1"), {OrderId "o-1", LimitPrice 101.00})`. Assert a record with `order_id "o-1"`, `user_id "u-1"`, `status "ORDER_STATUS_NEW"` (the existing status, FR-4) and `path "replace_final"`.
   - **PARTIALLY_FILLED sub-cases (product-spec C-5).** Repeat AC-3 and AC-6 with the order in `ORDER_STATUS_PARTIALLY_FILLED`.
     - CancelOrder has no status gate before the broker call (`trading.go:1237-1314`), so it reaches the final write; assert `status "ORDER_STATUS_CANCELED"`, `path "cancel_final"`.
     - ReplaceOrder accepts PARTIALLY_FILLED (`:1435-1441`) and its final `updateOrder` (`:1533-1547`) does not touch `Status`; assert `status "ORDER_STATUS_PARTIALLY_FILLED"`, `path "replace_final"`.
6. **Ctx assertions (binding operator rule, design.md § Binding ctx rule).** Repeat AC-1/2/3/6 with `tracedCancelledCtx("u-1")` and a `ctxCapturingDB` that succeeds. The **last** captured Exec, which is the D-04 site's write, must have `traceID == "t-267"` and `ctxErr == nil`.
   - Before the fix, `:688`/`:703` use `Background()`, so `traceID` is `""`.
   - Before the fix, `:1367`/`:1550` use the raw ctx, so `ctxErr` is `context.Canceled`.
   - Both are RED.
7. Every test that triggers a `go s.emitLedgerEvent` ends by polling its fake ledger until the expected event count is reached, using a bounded loop (deadline ≥ 1s, 10ms tick, as in `waitForAlert`). It never sleeps. This stops a late goroutine from logging after `captureLogs` restores `slog.Default` (design.md Open Risk 3).

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go test ./internal/service/ -run 'AC1|AC2|AC3|AC6' -race -count=1 -v
# RED (pre-Step-2): FAIL — no "order state write failed" record; trace/ctxErr assertions fail
```
Coverage threshold: N/A for this step. The new tests live in `internal/service/`, which the CI coverage
gate excludes (`.github/workflows/ci.yml:259`); the `>= 40%` gate is run in Step 6.

---

### Step 2 — service: `persistOrderBestEffort` and the four D-04 sites (FR-1..FR-4)

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading.go` — modify

**Reviewers**: `xstockstrat-trading` owner — order execution correctness, broker API safety, fill detection, paper-only dev invariant, position limit enforcement

**Codebase Evidence**:
- `emitLedgerEvent` at `trading.go:3661`, preceded by `const ledgerEmitTimeout = 10 * time.Second` at `:3657`, whose comment is "bounds a single AppendEvent so a half-open connection … surfaces as a logged error".
- `brokerCallTimeout()` at `trading.go:2440-2447` reads `trading.broker.timeout_ms` (default 5000).
- Sites: `:688`, `:703`, `:1367`, `:1550`, with the code quoted in Step 1.
- No `context.WithoutCancel` exists anywhere in `internal/` today (grep this session returned no hits). Go 1.27 (root CLAUDE.md) supports it.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:

1. Add this method directly above `emitLedgerEvent` (`trading.go:3659`):
   ```go
   // persistOrderBestEffort writes order state after a broker side effect; log-only, never surfaced.
   func (s *TradingService) persistOrderBestEffort(ctx context.Context, order *tradingv1.Order, path string) {
       wctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), ledgerEmitTimeout)
       defer cancel()
       if err := s.repo.UpsertOrder(wctx, order); err != nil {
           slog.Error("order state write failed", "order_id", order.OrderId, "user_id", order.UserId,
               "status", order.Status.String(), "path", path, "error", err)
       }
   }
   ```
   - **Bound choice (design.md Open Risk 2, F-07):** use `ledgerEmitTimeout`, the service's existing fixed
     bound for a single best-effort post-side-effect write.
   - Do not use `brokerCallTimeout()`. That value is operator-tuned for broker REST latency, and coupling a DB
     write deadline to it would silently change when the broker timeout is retuned.
   - No new literal is introduced.
2. Replace each site:
   - `:688` → `s.persistOrderBestEffort(ctx, order, "broker_timeout")`
   - `:703` → `s.persistOrderBestEffort(ctx, order, "broker_reject")`
   - `:1367` → `s.persistOrderBestEffort(ctx, order, "cancel_final")`
   - `:1550` → `s.persistOrderBestEffort(ctx, order, "replace_final")`
3. Leave the `:645-647` and `:744-746` checked writes as they are. Their ctx is Step 6's concern, not the
   helper's.

**Broker/fill note:** the change covers ALPACA and IBKR alike through the shared `TradingService` sites.
Fill handling is unaffected; Step 1's PARTIALLY_FILLED sub-cases exercise the cancel and replace final
writes for a partially filled order.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go test ./internal/service/ -run 'AC1|AC2|AC3|AC6' -race -count=1 -v   # GREEN
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod
grep -n "_ = s.repo.UpsertOrder" services/xstockstrat-trading/internal/service/trading.go   # expect no output
```

---

### Step 3 — test: RED — reactive reclaims are audited and their failures logged (AC-4, AC-5, AC-7, AC-8, AC-9)

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading_order_state_audit_test.go` — modify

**Reviewers**: `xstockstrat-trading` owner — order execution correctness, broker API safety, fill detection, paper-only dev invariant, position limit enforcement

**Codebase Evidence**:
- Reactive sites (the discarded reclaim `_, _, _ = s.orderIntentRepo.ReclaimOrphanIntent(ctx, intentID, existing.UpdatedAt.Add(staleThreshold(s.cfgW)))`):
  - `trading.go:603` returns `order intent %q is still pending` (`:605-606`).
  - `:1301` returns `cancel on order %s is still pending` (`:1303-1304`).
  - `:1498` returns `replace on order %s is still pending` (`:1500-1501`).
- Sweeper: `sweepOrderIntents` at `order_intent.go:136-159`.
  - Its log is `"order intent sweep: reclaim failed"` at `:146`.
  - Its emit at `:152-157` uses `"was_pending_since": out.UpdatedAt`, which is a `time.Time`.
- `emitLedgerEvent` discards the `structpb.NewStruct` error (`p, _ :=`, `trading.go:3662`), so today the payload is nil.
- `OrderIntentRecord.UpdatedAt time.Time` is at `internal/repository/order_intent_repo.go:31`. The CAS's `RETURNING updated_at` is the reclaim's `now()` (`:104-109`).
- The interface signature is `ReclaimOrphanIntent(ctx, intentID string, staleBefore time.Time) (reclaimed bool, rec *OrderIntentRecord, err error)` (`order_intent_repo.go:43`). `SweepStalePending(ctx, staleBefore, limit)` is at `:46`.
- Hash helpers:
  - `placeOrderRequestHash` (used at `trading.go:478`; tested at `order_intent_test.go:38`);
  - `deriveReplaceCancelIntentID(req)` (`trading.go:1269`, `:1465`; tested at `order_intent_test.go:63`).
- `classifyIntentLookup` is at `order_intent.go:74`. It returns `intentActionRejectPending, isStale` when the state is PENDING and older than `staleThreshold`, which is 15s at the defaults (`order_intent.go:98-106`).
- The real interceptor is `middleware.UnaryClientInterceptor` (`propagation.go:46-56`). It writes `x-trace-id` into outgoing metadata from the ctx value.
- `recordingLedgerClient` is at `trading_reconciliation_test.go:136`. It has a `mu` and `events`.
- Downstream readers of `order_intent.reclaimed_unknown`: none. `grep -rln reclaimed_unknown services packages/proto` (excluding `gen/`) returns only `order_intent.go`. This closes design.md Open Risk 1: nothing reads the sweeper payload.

**TDD**: `red-green required`

**Covers**: `AC-4, AC-5, AC-7, AC-8, AC-9`

**Instructions**:

1. Add these fakes. C-13 verdict: single consumer, inline.
   - `staleIntentRepo` embeds `fakeOrderIntentRepo` and overrides four methods:
     - `InsertIntent` returns `false, nil`.
     - `GetIntentByID` returns `{IntentID: id, OrderID: "o-1", RequestHash: <exact hash>, State: repository.IntentStatePending, UpdatedAt: pendingSince}`, where `pendingSince = time.Now().Add(-time.Hour)` is stored on the fake.
     - `ReclaimOrphanIntent(ctx, id, staleBefore)` records `{traceID: FromContext(ctx).TraceID, ctxErr: ctx.Err(), called: true}` and returns the programmable `(reclaimed, out, err)`. The default `out` is `{IntentID: id, OrderID: "o-1", UpdatedAt: time.Now()}`, so its UpdatedAt is the CAS time and deliberately differs from `pendingSince`.
     - `SweepStalePending` returns a programmable slice.
   - Set `RequestHash` exactly: hex of `placeOrderRequestHash(req)` for PlaceOrder, and the `requestHashHex` returned by `deriveReplaceCancelIntentID(req)` for cancel and replace. With any other hash the test would take the hash-mismatch branch (`:588`/`:1287`/`:1484`) for the wrong reason (design.md Open Risk 4).
   - `traceCapturingLedger` embeds `recordingLedgerClient`. Its `AppendEvent(ctx, req, opts...)` does three things:
     - records `ctx.Err()`;
     - runs `middleware.UnaryClientInterceptor(ctx, "/ledger.v1.LedgerService/AppendEvent", req, nil, nil, invoker, opts...)` with a fake `invoker` that reads `metadata.FromOutgoingContext(ctx).Get("x-trace-id")`;
     - stores `{req, traceID, ctxErr}` under the embedded `mu`.
2. **Reach-the-branch guard.** Before asserting any emit or log, every test asserts two things:
   - `staleIntentRepo.called == true`, which proves the reclaim branch ran;
   - the full error message equals the expected text: `order intent "c-1" is still pending`, `cancel on order o-1 is still pending`, or `replace on order o-1 is still pending`. A HALTED-gate or hash-mismatch `FailedPrecondition` therefore cannot pass.
3. **AC-4 `TestPlaceOrder_StaleIntent_ReclaimAudited_AC4`.**
   - Use the Step 1 PlaceOrder harness with `orderIntentRepo: staleIntentRepo{reclaimed: true}` and `ledger: traceCapturingLedger`.
   - Call it with `tracedCancelledCtx("u-1")` and `ClientOrderId "c-1"`.
   - Assert `codes.FailedPrecondition` and the full message.
   - Poll (bounded ≥ 1s, 10ms tick) until one event has `EventType == "order_intent.reclaimed_unknown"`, then assert:
     - `StreamKey == "order:o-1"` and `UserId == "u-1"`;
     - `Payload != nil`;
     - payload `trigger == "reactive_place"`, `order_id == "o-1"`, `intent_id == "c-1"`;
     - `was_pending_since == pendingSince.UTC().Format(time.RFC3339Nano)`, which is **not** the CAS time;
     - recorded `traceID == "t-267"` and `ctxErr == nil`.
   - Also assert that the reclaim CAS's captured `traceID == "t-267"` and `ctxErr == nil`. This is the CAS on `WithoutCancel(ctx)`.
4. **AC-8 / AC-9.** These are the same as AC-4, driven by `CancelOrder` and `ReplaceOrder` on order `"o-1"` with `trigger` `reactive_cancel` and `reactive_replace`.
   - ReplaceOrder needs its gate table (Step 1).
   - CancelOrder only needs the order and the ownership match, because the reclaim branch comes before the broker call at `:1309`.
5. **AC-5 / AC-7.** Use `staleIntentRepo{err: errors.New("db unavailable")}` with `captureLogs`.
   - Assert the full "still pending" message.
   - Assert exactly one record with `msg == "order intent reclaim failed"`, `intent_id == <the derived cancel/replace intent id>`, `trigger` (`reactive_cancel` or `reactive_replace`), and `error` containing `db unavailable`.
   - Assert that no `order_intent.reclaimed_unknown` event was recorded.
6. **Sweeper payload test `TestSweepOrderIntents_PayloadPopulated`.**
   - `SweepStalePending` returns `[{IntentID "i-1", OrderID "o-1", UpdatedAt: T0}]`.
   - The reclaim returns `out` with `UpdatedAt: T1` (T1 ≠ T0).
   - Call `s.sweepOrderIntents(context.Background())`. It is synchronous, so no polling is needed.
   - Assert:
     - `Payload != nil`;
     - `trigger == "sweep"`;
     - `was_pending_since == T0.UTC().Format(time.RFC3339Nano)`;
     - `UserId == ""` and `StreamKey == "order:o-1"`.
   - RED today: the payload is nil.
7. **Pure test `TestReclaimedUnknownPayload`**: `structpb.NewStruct(reclaimedUnknownPayload("sweep", out, T0))` returns no error, and the map has exactly the four keys. This test does not compile before Step 4, which counts as the RED evidence.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go test ./internal/service/ -run 'AC4|AC5|AC7|AC8|AC9|SweepOrderIntents_Payload|ReclaimedUnknownPayload' -race -count=1 -v
# RED (pre-Step-4): FAIL / build failure (reclaimedUnknownPayload undefined); no reclaimed_unknown event; no reclaim-failure log
```
Coverage threshold: N/A for this step (`internal/service/` is excluded from the CI coverage gate,
`.github/workflows/ci.yml:259`); the `>= 40%` gate is run in Step 6.

---

### Step 4 — service: `reclaimStaleIntent`, `reclaimedUnknownPayload`, the three reactive sites, and the sweeper payload swap (FR-5, FR-6)

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/order_intent.go` — modify
- `services/xstockstrat-trading/internal/service/trading.go` — modify

**Reviewers**: `xstockstrat-trading` owner — order execution correctness, broker API safety, fill detection, paper-only dev invariant, position limit enforcement

**Codebase Evidence**:
- Sweeper three-way handling at `order_intent.go:144-157`; the stale record `rec` comes from `SweepStalePending` at `:138`.
- Reactive sites `trading.go:600-606`, `:1300-1305`, `:1497-1502` (quoted in Step 3).
- Owner sources:
  - `accountEntry.userID` is set on the order at `:627` and ownership-gated at `:433`. Flatten passes its own `accountEntry` at `:2838`.
  - `order.UserId` is gated at `:1256` (cancel) and `:1429` (replace).
- The ledger client already chains `middleware.UnaryClientInterceptor` (`trading.go:184`), so `WithoutCancel(ctx)` carries `x-trace-id` with no new header code. This is design.md § Binding ctx rule, and step-constraints §B "Header propagation" is satisfied by reusing the propagating client.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:

1. In `order_intent.go`, add these immediately above `sweepOrderIntents`:
   ```go
   const reclaimedUnknownEventType = "order_intent.reclaimed_unknown"

   // reclaimedUnknownPayload must stay structpb-safe: emitLedgerEvent drops a NewStruct error, nil-ing the payload.
   func reclaimedUnknownPayload(trigger string, out *repository.OrderIntentRecord, pendingSince time.Time) map[string]interface{} {
       return map[string]interface{}{
           "trigger": trigger, "order_id": out.OrderID, "intent_id": out.IntentID,
           "was_pending_since": pendingSince.UTC().Format(time.RFC3339Nano),
       }
   }

   // Mirrors sweepOrderIntents' reclaim handling — change both together. Keep WithoutCancel(ctx):
   // Background() drops x-trace-id and a client cancel must not abort the CAS.
   func (s *TradingService) reclaimStaleIntent(ctx context.Context, intentID string, pendingSince, staleBefore time.Time, trigger, ownerID string) {
       bg := context.WithoutCancel(ctx)
       reclaimed, out, err := s.orderIntentRepo.ReclaimOrphanIntent(bg, intentID, staleBefore)
       if err != nil {
           slog.Warn("order intent reclaim failed", "intent_id", intentID, "trigger", trigger, "error", err)
           return
       }
       if !reclaimed {
           return
       }
       go s.emitLedgerEvent(bg, reclaimedUnknownEventType, "order:"+out.OrderID, ownerID,
           reclaimedUnknownPayload(trigger, out, pendingSince))
   }
   ```
   The `reclaimedUnknownEventType` const is a spec-level DRY choice: the event string would otherwise appear
   at two emit sites (the dry-guard-rail). It does not change design semantics.
2. Sweeper (`order_intent.go:152-157`): replace the map literal and the event string with
   `s.emitLedgerEvent(ctx, reclaimedUnknownEventType, fmt.Sprintf("order:%s", out.OrderID), "", reclaimedUnknownPayload("sweep", out, rec.UpdatedAt))`.
   Leave the rest of the sweeper exactly as it is: its own ctx, the synchronous emit, user `""`, the log at
   `:146`, and `continue` at `:149-151`.
   - **The payload changing from nil to populated is ACCEPTED by the operator (round-3 gate).** Call it out
     in the integration PR body, and say that Step 3 found no downstream reader.
3. Replace the reactive sites. Keep the existing `if isStale {` guard, the `:602` comment and the
   `FailedPrecondition` returns unchanged:
   - `:603` → `s.reclaimStaleIntent(ctx, intentID, existing.UpdatedAt, existing.UpdatedAt.Add(staleThreshold(s.cfgW)), "reactive_place", accountEntry.userID)`
   - `:1301` → `s.reclaimStaleIntent(ctx, intentID, existing.UpdatedAt, existing.UpdatedAt.Add(staleThreshold(s.cfgW)), "reactive_cancel", order.UserId)`
   - `:1498` → `s.reclaimStaleIntent(ctx, intentID, existing.UpdatedAt, existing.UpdatedAt.Add(staleThreshold(s.cfgW)), "reactive_replace", order.UserId)`
4. Leave the four-way `classifyIntentLookup` switch unextracted (design.md: Open Question 2 closed). The
   offline copy at `:789` gets no change, because it has no reclaim.
5. **Flatten label (P-03, accepted):** `submitOrder` is shared with `flattenAndHalt` (`:2838`), so a
   flatten-originated reclaim is labelled `reactive_place`. It carries no trace id, because flatten runs on
   the watchdog's ctx, and may carry owner `""`. Step 7 documents this.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go test ./internal/service/ -run 'AC4|AC5|AC7|AC8|AC9|SweepOrderIntents_Payload|ReclaimedUnknownPayload' -race -count=1 -v   # GREEN
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod
grep -n "_, _, _ = s.orderIntentRepo.ReclaimOrphanIntent" services/xstockstrat-trading/internal/service/trading.go   # expect no output
```

---

### Step 5 — test: RED — every request-reachable `Background()` emit/finalize carries the inbound x-trace-id

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading_order_state_audit_test.go` — modify

**Reviewers**: `xstockstrat-trading` owner — order execution correctness, broker API safety, fill detection, paper-only dev invariant, position limit enforcement

**Codebase Evidence**:
- Full enumeration, by `grep -n "context.Background()" services/xstockstrat-trading/internal/service/trading.go` this session. This is 36 hits (re-verified at impl-spec review): the 31 converted rows below, the two Step 2 sites `:688`/`:703`, and the three left-as-is sites. Every hit is classified, so design.md Open Risk 8 is discharged for the enumeration; the `:2617` disposition is still an open operator decision (see Left as-is).
- `grep -rn "context.Background()" internal/service/*.go`, excluding `_test` and `trading.go`, returned nothing else.
- Each hit is classified by its reachable callers below. Sites already owned by Steps 2 and 4 are `:688`, `:703`, `:1367`, `:1550`, `:603`, `:1301` and `:1498`; `:688` and `:703` are in the grep list and appear here only as owned elsewhere.

**Converted in Step 6 (request-reachable):**

| # | Site | Enclosing fn | Call | Request-path caller(s) | Background caller(s) |
|---|---|---|---|---|---|
| 1 | `:649` | `submitOrder` | emit `order.created` | `PlaceOrder` `:544` | flatten `:2838` |
| 2 | `:655` | `submitOrder` | emit `order.approval_requested` | `PlaceOrder` | — |
| 3 | `:659` | `submitOrder` | `emitApprovalAlert` (notify) | `PlaceOrder` | — |
| 4 | `:665` | `submitOrder` | emit `order.submitted` | `PlaceOrder` | flatten |
| 5 | `:689` | `submitOrder` | emit `order.broker_call_uncertain` | `PlaceOrder` | flatten |
| 6 | `:700` | `submitOrder` | emit `order.broker_rejected` | `PlaceOrder` | flatten |
| 7 | `:706` | `submitOrder` | `FinalizeIntent` (rejected) | `PlaceOrder` | flatten |
| 8 | `:740` | `submitOrder` | `maybeSubmitBracket` | `PlaceOrder` | flatten |
| 9 | `:744` | `submitOrder` | `UpsertOrder` (checked) | `PlaceOrder` | flatten |
| 10 | `:749` | `submitOrder` | `FinalizeIntent` (completed) | `PlaceOrder` | flatten |
| 11 | `:755` | `submitOrder` | emit `order.broker_submitted` | `PlaceOrder` | flatten |
| 12 | `:842` | `recordOfflineOrder` | emit `order.created` | `PlaceOrder` `:452` | — |
| 13 | `:1353` | `CancelOrder` | emit `order.bracket_updated` | `CancelOrder` | — |
| 14 | `:1370` | `CancelOrder` | emit `order.canceled` | `CancelOrder` | — |
| 15 | `:1405` | `finalizeCancelIntent` | `FinalizeIntent` | `CancelOrder` `:1368`; `reconcileNotCancelable` `:1386`, `:1396` | — |
| 16 | `:1524` | `ReplaceOrder` | `FinalizeIntent` (rejected) | `ReplaceOrder` | — |
| 17 | `:1553` | `ReplaceOrder` | `FinalizeIntent` (completed) | `ReplaceOrder` | — |
| 18 | `:1559` | `ReplaceOrder` | emit `order.replaced` | `ReplaceOrder` | — |
| 19 | `:1805` | `applyBrokerOrderStatus` | emit `order.filled` | `reconcileNotCancelable` `:1394` ← `CancelOrder` | `pollFills` `:1766` |
| 20 | `:1813` | `applyBrokerOrderStatus` | `emitFillAlert` (notify) | same | same |
| 21 | `:1818` | `applyBrokerOrderStatus` | `maybeSubmitBracket` (FILLED) | same | same |
| 22 | `:1822` | `applyBrokerOrderStatus` | emit `order.partially_filled` | same | same |
| 23 | `:1832` | `applyBrokerOrderStatus` | `maybeSubmitBracket` (PARTIAL) | same | same |
| 24 | `:1836` | `applyBrokerOrderStatus` | emit `order.canceled` | function shared with a request path (the CANCELED branch is unreachable from `reconcileNotCancelable`, which returns early on CANCELED at `:1390`) | same |
| 25 | `:1841` | `applyBrokerOrderStatus` | emit `order.rejected` | same as #19 | same |
| 26 | `:3397` | `createBracket` | `emitBracketFailureAlert` | via `maybeSubmitBracket` ← #8 / #21 | via #21 / #23 from `pollFills` |
| 27 | `:3408` | `createBracket` | emit `order.bracket_updated` (Alpaca) | same | same |
| 28 | `:3419` | `createBracket` | `emitBracketFailureAlert` (IBKR) | same | same |
| 29 | `:3425` | `createBracket` | emit `order.bracket_updated` (IBKR) | same | same |
| 30 | `:3461` | `resizeBracket` | `emitBracketFailureAlert` | via `maybeSubmitBracket` ← #21 / #23 | same |
| 31 | `:3467` | `resizeBracket` | emit `order.bracket_updated` | same | same |

**Left as-is:**
- `:2859` `haltAccount` in `flattenAndHalt`, and `:2907` `flattenAndHalt`. Their only caller chain is `StartBracketProtectionWatchdog` (`:2866`) → `checkBracketProtection` (`:2884`), which is background-only per the operator decision.
- `:2617` `accountRepo.UpdateCredentialStatus` in `validateAndRecordCredential`. It is request-reachable (`RegisterBrokerAccount` `:2528`, `UpdateBrokerAccountCredentials` `:2575`) as well as poller-reachable (`:2690`). It is neither a ledger emit nor a finalize, it sits outside the order-state neighbourhood, and it carries no trace on the wire. It is **not converted**; this is surfaced as an operator Open Thread in context.md (P-03), not silently dropped.

For shared functions (#19-#31), `WithoutCancel(ctx)` on a background caller's ctx behaves the same as
today's `Background()`. The poller ctx carries no `PropagationData`, and `WithoutCancel` strips only its
shutdown cancel, which `Background()` never had. So converting the shared site keeps background behaviour
unchanged.

- Fakes to reuse, with ctx capture added in this step:
  - `fakeNotifyClient` (`trading_bracket_test.go:176-187`) ignores ctx. Add a `traceCapturingNotify` wrapper with the same interceptor-through-fake-invoker technique as `traceCapturingLedger`.
  - `fakeBracketRepo` (`:95`).
  - The bracket tests show how to drive `maybeSubmitBracket` directly: `TestMaybeSubmitBracket_AlpacaAtomicRecordsLegs` (`:223`), `..._IBKRSubmitsFollowUpLegs` (`:247`), `..._IBKRFailureTransitionsFailedAndAlerts` (`:367`), `TestPollFills_PartialFillResizesActiveBracket` (`:415`), `TestCreateBracket_FailureEmitsCriticalAlert` (`:738`).
  - The not-cancelable cancel paths are driven by `notCancelableSvc` / `TestCancelOrder_NotCancelable_*` (`trading_cancel_not_cancelable_test.go:22-120`).

**TDD**: `red-green required`

**Covers**: — (operator scope widening, 2026-10-21; no `@AC-*`, since the trace guarantee is an implementation rule per design.md § Business Rules Touched)

**Instructions**:

1. Add a `ctxCapturingIntentRepo` that embeds `fakeOrderIntentRepo` and records `{traceID, ctxErr}` per `FinalizeIntent` call. Add `traceCapturingNotify` as described above. C-13 verdict: single consumer, inline.
2. Write one table-driven or grouped test per driver. Every driver runs on `tracedCancelledCtx("u-1")`, and package-internal functions may be called directly. For **every** row, assert the captured `traceID == "t-267"` and `ctxErr == nil`. Async emits and alerts are polled with a bound of at least 1s and a 10ms tick; never sleep.
   - **`TestTrace_SubmitOrder_HappyPath`** (`submitOrder`, `requiresApproval=false`, Alpaca):
     - the broker returns `{BrokerOrderID "brk-1", Status "filled", FilledQty 10, FilledAvgPrice 148, StopLegOrderID "s", TakeProfitLegOrderID "t"}`;
     - set `req.StopPrice = 145` so that `maybeSubmitBracket` runs with the bracket enabled by default;
     - this covers rows #1, #4, #8 (through #27 `order.bracket_updated`), #9 (the `ctxCapturingDB` last Exec), #10 and #11.
   - **`TestTrace_SubmitOrder_Approval`** (`requiresApproval=true`): rows #1, #2 and #3.
   - **`TestTrace_SubmitOrder_Timeout`**: row #5. Row #9 does not apply.
   - **`TestTrace_SubmitOrder_Reject`**: rows #6 and #7.
   - **`TestTrace_RecordOfflineOrder`** (`s.recordOfflineOrder(ctx, req, "acct-1", "u-1")`): row #12.
   - **`TestTrace_CancelOrder`** (an ACTIVE bracket exists in `fakeBracketRepo`, the broker cancel succeeds): rows #13, #14 and #15 (the `:1368` caller).
   - **`TestTrace_CancelOrder_NotCancelable_ReReadFails`**: row #15 (the `:1386` caller).
   - **`TestTrace_CancelOrder_NotCancelable_BrokerFilled`** (order `StopPrice 145`): rows #15 (the `:1396` caller), #19, #20 and #21 (through #27).
   - **`TestTrace_ReplaceOrder`**:
     - a success sub-case covers rows #17 and #18;
     - a non-timeout broker error sub-case covers row #16.
   - **`TestTrace_ApplyBrokerOrderStatus`** (direct call, table over broker status):
     - `partially_filled` with an ACTIVE IBKR bracket covers rows #22, #23, #30-fail and #31;
     - `canceled` covers row #24;
     - `rejected` covers row #25.
   - **`TestTrace_CreateBracket`** (direct `maybeSubmitBracket`):
     - `CreateBracket` erroring covers row #26;
     - IBKR `SubmitBracketLegs` erroring covers row #28;
     - IBKR success covers row #29.
3. These must be RED before Step 6. Every converted site uses `Background()` today, so `traceID` is `""`. Row #15 has no ctx param today, so it captures `""` as well.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go test ./internal/service/ -run 'TestTrace_' -race -count=1 -v
# RED (pre-Step-6): FAIL — traceID "" at every row
```
Coverage threshold: N/A for this step (`internal/service/` is excluded from the CI coverage gate,
`.github/workflows/ci.yml:259`); the `>= 40%` gate is run in Step 6.

---

### Step 6 — service: convert the request-reachable `Background()` sites to `context.WithoutCancel(ctx)`

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading.go` — modify

**Reviewers**: `xstockstrat-trading` owner — order execution correctness, broker API safety, fill detection, paper-only dev invariant, position limit enforcement

**Codebase Evidence**:
- The site table in Step 5, from `grep -n "context.Background()" internal/service/trading.go`.
- `finalizeCancelIntent(intentID string, order *tradingv1.Order, state int16)` is at `trading.go:1400`. It has no ctx parameter. Its callers are `:1368`, `:1386` and `:1396`, and each has a request `ctx` in scope (`CancelOrder` and `reconcileNotCancelable(ctx, …)` at `:1381`).
- Function signatures that already carry ctx:
  - `applyBrokerOrderStatus(ctx, …)` at `:1772`;
  - `createBracket(ctx, …)` at `:3389`;
  - `resizeBracket(ctx, …)` at `:3432`;
  - `maybeSubmitBracket(ctx, …)` at `:3359`;
  - `recordOfflineOrder(ctx, …)` at `:767`;
  - `submitOrder(ctx, …)` at `:550`.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:

1. At every converted row in Step 5's table, replace `context.Background()` with `context.WithoutCancel(ctx)`.
   - `ctx` is the enclosing function's parameter.
   - Inside `submitOrder`, that is the request ctx on `PlaceOrder` and the flatten loop's own ctx on flatten (design.md § Scope widening), so the change is correct for both callers.
   - Inside `createBracket`/`resizeBracket`, `ctx` already arrives as `WithoutCancel` from #8/#21/#23. Wrapping it again is idempotent and keeps each site self-evidently correct.
2. Change `finalizeCancelIntent` to `finalizeCancelIntent(ctx context.Context, intentID string, order *tradingv1.Order, state int16)`. Use `context.WithoutCancel(ctx)` at `:1405`, and pass `ctx` at `:1368`, `:1386` and `:1396`.
3. Do not touch `:2617`, `:2859` or `:2907` (see Step 5, "Left as-is").
4. Add no comments beyond what C-18/§How to Act #5 allow. The helper comments from Steps 2 and 4 carry the constraint, so the site edits need none.

**Broker/fill note:** the IBKR and Alpaca bracket paths and the FILLED/PARTIALLY_FILLED branches change only
in their ctx. Fill semantics are unchanged (C-5).

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go test ./internal/service/ -run 'TestTrace_' -race -count=1 -v   # GREEN
grep -n "context.Background()" services/xstockstrat-trading/internal/service/trading.go   # expect exactly :2617, :2859, :2907 (line numbers may shift)
# if the operator resolves the :2617 Open Thread as 'convert in 267' before execution, expect only :2859, :2907
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod
cd services/xstockstrat-trading && export GOWORK=off && COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"
# confirm total >= 40%. New logic is in the excluded service/ package — no coverage threshold applies to it; the full suite (including every existing PRESERVE-guarding test) must pass.
```

---

### Step 7 — docs: ledger-event row, trading findings

**Status**: `pending`
**Service**: `xstockstrat-trading` (docs)
**Files**:
- `services/xstockstrat-trading/CLAUDE.md` — modify
- `services/xstockstrat-trading/docs/context-constitution-findings.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- The "Ledger Events Emitted" table is at `services/xstockstrat-trading/CLAUDE.md:139-159`. It has no `order_intent.reclaimed_unknown` row, and it lists lifecycle streams as `order:{order_id}`.
- The code emits lifecycle events on a bare `orderID` stream key (`trading.go:649`, `:689`, `:700`, `:1370`, all passing `orderID`/`req.OrderId` as `streamKey`), while the reclaim emits use `"order:"+OrderID`.
- The drift row at `docs/context-constitution-findings.md:13` reads "omits `order_intent.reclaimed_unknown`".
- `emitLedgerEvent` swallows the `NewStruct` error (`p, _ :=`, `trading.go:3662`).

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:

1. In CLAUDE.md "Ledger Events Emitted", add this row:
   `| order_intent.reclaimed_unknown | order:{order_id} | A stale PENDING order intent reclaimed to UNKNOWN. trigger: sweep (sweeper, user_id ""), reactive_place (PlaceOrder retry, including the internal flatten retry, which carries no trace id and may carry user_id ""), reactive_cancel, reactive_replace (owner user_id). Payload: trigger, order_id, intent_id, was_pending_since (RFC3339Nano string, the pre-reclaim pending time) |`
2. In the findings file:
   - mark the `:13` row resolved, citing this feature (267);
   - add a doc-lie row: lifecycle events emit on a bare `orderID` stream while CLAUDE.md says `order:{order_id}`, and the reclaim events use `order:`. Per-order queries must read both until this is reconciled. Out of scope here (design.md Rejected Alternatives).
   - add a latent-bug row: `emitLedgerEvent` discards the `structpb.NewStruct` error (`trading.go#emitLedgerEvent`), so any payload holding a non-structpb type (for example `time.Time`) reaches the ledger as nil, silently. Candidate hardening: log the error. Only the reclaim payload was fixed here.
   - add an open row: `validateAndRecordCredential`'s `context.Background()` write (`trading.go#validateAndRecordCredential`) is request-reachable and is not converted by 267, pending an operator decision.
3. Teardown (root CLAUDE.md): this step changes context files. Run `/context-constitution refresh` scoped to the two files, or, if the plugin is unavailable, re-read both files against the code by hand and record that in the integration PR body.

**Verification**:
```bash
grep -n "order_intent.reclaimed_unknown" services/xstockstrat-trading/CLAUDE.md services/xstockstrat-trading/docs/context-constitution-findings.md
grep -n "reactive_place\|was_pending_since" services/xstockstrat-trading/CLAUDE.md
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
