# Implementation Spec: fix-replace-tif-before-intent

**Status**: `pending`
**Created**: 2026-11-16
**Feature**: `docs/roadmap/features/349-fix-replace-tif-before-intent/feature.md`
**Total Steps**: 3
**Feature Branch**: `feature/fix-replace-tif-before-intent`

---

## Execution Summary

Steps 1+2 are one atomic unit and one red→green commit: Step 1 adds the handler-level regression
tests (and a `replaceOrderFn` hook on the shared `fakeBroker`), Step 2 moves the `brokerReq` literal
and the TIF block in `ReplaceOrder` up to sit right after `resolveAccount` and before
`deriveReplaceCancelIntentID` (design.md § Chosen Approach, D-1/D-2). The test step is numbered first
so the executor writes it and captures RED before touching `trading.go` (fails.md 2026-11-04 and
2026-11-10: an order fixed only in prose does not take effect). Step 3 amends TRADING-7 and adds one
caller-facing sentence to `services/xstockstrat-trading/CLAUDE.md` (D-6).

Paths that start with `internal/` are under `services/xstockstrat-trading/`; a bare `trading_*_test.go`
is in its `internal/service/`; `trading.go` = `services/xstockstrat-trading/internal/service/trading.go`.
Every other path is written from the repo root. Every line number was re-read on
`Tree: feature/fix-replace-tif-before-intent@747bcdb ≡ origin/feature/fix-replace-tif-before-intent (merged origin/main-dev@7eeab3d)`
(C-01). The `main-dev` merge brought no service code (feature 345 docs, one fails.md entry,
`.gitleaks.toml`), so recon.md's `trading.go` anchors still hold.

**Prototype run (fails.md 2026-11-16: never claim "no existing expectation changes" from reading).**
Both steps were applied to a scratch worktree of `747bcdb` during this spec session and then thrown
away; nothing from it is committed. Results:

- Tests alone, on today's `trading.go`: `@AC-1` RED on all four rows (`replace intent rows = 1, want none`);
  `@AC-2` RED at its last call (`FailedPrecondition … is still pending`); `@AC-4` RED
  (`FailedPrecondition … outcome is unknown`); `@AC-3` passes (guard).
- Tests plus the move: `go test ./... -race -count=1` exit 0 across the service with no existing test
  edited; coverage total 84.8%; `golangci-lint` v2.14.0 (built with go1.27.0) `0 issues`.
- Step 3's edits: `scripts/check-context-map.py` OK; `markdownlint-cli2` 0 issues on the service `CLAUDE.md`.

### Scenario Coverage (C-15)

| Scenario | Covered by | On today's code |
|---|---|---|
| `@AC-1` a replace with a disallowed time-in-force leaves nothing behind | Step 1 | RED |
| `@AC-2` the caller can correct the time-in-force and retry | Step 1 | RED |
| `@AC-3` an allowed replace still claims exactly one intent | Step 1 | guard (passes) |
| `@AC-4` a disallowed time-in-force is refused even when an intent for the same request exists | Step 1 | RED |

`@AC-1`'s "no intent-reclaim event … however long the caller waits" is covered by the zero-row
assertion: both reclaim paths (the sweeper and the reactive reclaim at `trading.go:1596-1598`) act
only on an existing PENDING row (design.md, debate.md O-2).

### Consumer Surfaces (C-14)

None — internal, by decision (product-spec.md § Consumer Surface(s)). The RPC, its `InvalidArgument`
code and every UI, agent, proto and config surface are unchanged, so there is no
`services/xstockstrat-ui/` or `services/xstockstrat-agent/` step.

### Assumptions made by this spec

- The `@AC-1` table carries one Alpaca row (explicit `UNSPECIFIED`) beside the three IBKR rows the
  design names. Basis: `step-constraints.md` §A broker coverage asks for both dispatch paths in the
  test step, and `UNSPECIFIED` is the only TIF Alpaca refuses (`internal/service/tif_validation.go:35-42`).
- TRADING-7's **Why** cell gains one clause naming the failure mode of validating after the claim.
  Basis: D-6 amends the rule text; every rule row in that table states its failure mode.
- Lint is run with the CI-pinned `golangci-lint` v2.14.0 built with go1.27. The v2.5.0 binary on the
  session image refuses the module ("Go language version (go1.25) … lower than the targeted Go
  version (1.27.0)"); feature 347's execute sessions installed v2.14.0 the same way.

### Open items carried from design (not resolved by this spec)

- Intent rows already stranded PENDING/UNKNOWN by this defect in a deployed database are not repaired
  (product-spec.md § Out of Scope; design.md § Open Risks). No step; reported at the integration PR.
- D-3 (a disallowed TIF beats an existing intent row) was not spelled out in the operator's handover;
  context.md asks for it to be flagged in the integration PR.

## Step Dependencies

- Steps 1+2 land together: Step 1's tests assert the fixed behavior, so its own `**Verification**`
  cannot pass on a tree without Step 2 (`step-constraints.md` §C, "every step must pass its own
  Verification on a tree that contains only the steps before it"; F-05). The RED is a behavior
  failure, not a compile failure: the one new symbol the tests use (`replaceOrderFn`) is created by
  Step 1 itself. One backend surface, two adjacent steps.
- Execution order inside the unit is the step order: write Step 1, capture RED, apply Step 2, capture
  GREEN (P-06). Step 1 [test] covers Step 2 [service] (C-08).
- Step 3 requires Steps 1+2: it documents the position the code now has.
- No other feature is in flight on `ReplaceOrder`. Feature 347 (`prevIntent` capture `trading.go:1603`,
  the `ErrRateLimited` branch `:1620-1622`) is already on `main-dev`; both lines stay where they are.
  No `merge-order.md` entry is needed (context.md, sdd-review overlap scan).
- CI side effect, no action: `trading.go` is in the `xstockstrat-agent` paths-filter
  (`.github/workflows/ci.yml:59`), so the agent job runs on this change. The only thing it reads from
  the file is the offline `Unavailable` string at `trading.go:1008`
  (`services/xstockstrat-agent/tests/test_tool_errors.py:184-190`), which Step 2 does not touch.
- C-16 promotion of `@AC-1`..`@AC-4` into `services/xstockstrat-trading/acceptance/` happens at the
  integration PR (`/sdd-execute`), not in a step; the operator approved it in advance (context.md).

---

### Step 1 — test: handler-level regression tests for the replace TIF check

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading_replace_tif_test.go` — create
- `services/xstockstrat-trading/internal/service/trading_bracket_test.go` — modify

**Reviewers**: `xstockstrat-trading` owner — order execution correctness, broker API safety, fill detection, paper-only dev invariant, position limit enforcement

**Codebase Evidence**:
- No existing `ReplaceOrder` test sets `TimeInForce` (recon.md § Risks / Not-found). The nine existing
  call sites (`grep -n "ReplaceOrder(" internal/service/*_test.go`) send `Qty` or `LimitPrice` only (`:467` and `:872` reuse a `req` built with `LimitPrice`):
  `trading_bracket_test.go:546`, `trading_order_state_audit_test.go:229`, `:286`, `:467`, `:872`,
  `:881`, `trading_ownership_test.go:87`, `trading_rate_limit_test.go:602`, `:611`.
- `fakeBroker` — `internal/service/trading_bracket_test.go:26-34`: hooks `submitOrderFn`,
  `submitBracketLegsFn`, `cancelOrderFn`, `getOrderFn` (`:27-30`), no replace hook;
  `fakeBroker.ReplaceOrder` panics (`:53-55`).
- Existing replace doubles, each an embedding wrapper with fixed behavior: `replaceOKBroker`
  (`trading_order_state_audit_test.go:68-72`), `replaceFailBroker` (`:707-711`), `rlReplaceBroker`
  (`trading_rate_limit_test.go:583-594`). None records the request (debate.md O-5 → the hook).
- Harness: `newRLFakeHarness(client broker.Broker) *rlFakeHarness` — `trading_rate_limit_test.go:475-483`;
  fields `svc`, `intents *memIntentRepo`, `db *ctxCapturingDB`, `ledger *recordingLedgerClient`
  (`:468-473`); `intentCount()` `:491-495`. It builds the service through `auditSvc`
  (`trading_order_state_audit_test.go:117-126`), whose pool is
  `"acct-1": {client: fb, brokerType: int32(commonv1.BrokerType_BROKER_TYPE_ALPACA), userID: "u-1"}` (`:122`).
- Order fixture: `rlWorkingOrder` — `trading_rate_limit_test.go:207-213`: `ord-1`, owner `user-1`,
  account `acct-1`, broker order id `b-1`, `Qty: 10`, `IntentState: INTENT_STATE_COMPLETED`.
- `memIntentRepo` — `trading_flatten_rejection_test.go:40-82`: rows in `recs` under `mu`;
  `InsertIntent` returns false for an existing id (`:46-57`); `GetIntentByID` returns a copy (`:59-64`).
- `updateOrder` stores a clone (`trading.go:422-433`), so the order must be read from `s.orders`
  after the call (debate.md O-1).
- IBKR-typed pool entry pattern: `brokerPoolEntry{client: fb, brokerType: int32(commonv1.BrokerType_BROKER_TYPE_IBKR)}`
  (`trading_bracket_test.go:255`).
- `ctxAsUser` — `trading_ownership_test.go:21`; `waitForLedgerEvents(t, l, n)` —
  `trading_order_state_audit_test.go:93-103`; `recordingLedgerClient.eventTypes()` —
  `trading_reconciliation_test.go:158`.
- Intent id for a seeded row: `deriveReplaceCancelIntentID(msg) (intentID, hashHex, err)` —
  `internal/service/order_intent.go:45`; `classifyIntentLookup` returns `intentActionRejectUnknown`
  for `IntentStateUnknown` only when `RequestHash` matches (`:75-83`); states
  `internal/repository/order_intent_repo.go:16-19`.
- `ReplaceOrderRequest.time_in_force` is `optional` (`packages/proto/trading/v1/trading.proto:200`),
  so the Go field is a pointer; the generated enum's `.Enum()` method builds it.
- Wire strings: `tifToWireString` DAY → `"day"` (`internal/service/tif_validation.go:14-29`);
  `validateTIF` messages both contain `time_in_force` (`:63`, `:66-67`).
- Naming precedent: `TestReplaceOrder_RateLimitedLeavesOrderUnchanged_F347_AC31` with a `// @AC-31:`
  comment (`trading_rate_limit_test.go:596-597`).
- Whole-package safety: the `recover()` sites (`trading_bracket_test.go:573`, `:700`, `:729`,
  `trading_offline_test.go:567`, `:609`) wrap `CancelOrder` or the offline record path; the nil-repo
  replace tests (`trading_ownership_test.go:87`, `trading_bracket_test.go:546`) return at the
  ownership and halt gates above `resolveAccount`. Confirmed by the prototype run, not by reading.
- C-13: `internal/testdata/` holds repository row fixtures (`order_rows.go`) and no service-level
  order; the order here comes from `rlWorkingOrder` through the harness.
- Coverage: `internal/service` is excluded from the CI threshold (`.github/workflows/ci.yml:374`).

**Lands with**: `Step 2`

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2, AC-3, AC-4`

**Instructions**:
1. `trading_bracket_test.go`: add the field
   `replaceOrderFn func(ctx context.Context, brokerOrderID string, req broker.OrderRequest) (*broker.BrokerOrder, error)`
   to `fakeBroker` after `getOrderFn` (`:30`). `fakeBroker.ReplaceOrder` (`:53-55`) calls it when it is
   non-nil and otherwise keeps the existing panic. Change nothing else in the file; the three
   existing replace doubles stay as they are.
2. Create `trading_replace_tif_test.go`, package `service`, with a two-line header comment naming
   `docs/reports/2026-11-16-replace-order-tif-validation-after-intent-claim-defect.md` and feature 349.
   File-local helpers:
   - `replaceTIFHarness(fb *fakeBroker, brokerType commonv1.BrokerType) *rlFakeHarness` —
     `newRLFakeHarness(fb)`, then replace the whole map value:
     `h.svc.brokers["acct-1"] = brokerPoolEntry{client: fb, brokerType: int32(brokerType), userID: "u-1"}`.
   - `replaceRecorder() (*fakeBroker, *[]broker.OrderRequest)` — a `fakeBroker` whose `replaceOrderFn`
     appends each request and returns `&broker.BrokerOrder{BrokerOrderID: "b-1"}, nil`.
   - `replaceTIFReq(tif tradingv1.TimeInForce) *tradingv1.ReplaceOrderRequest` —
     `{OrderId: "ord-1", Qty: 7, TimeInForce: tif.Enum()}`.
   - `storedOrder(h *rlFakeHarness) *tradingv1.Order` — `h.svc.orders["ord-1"]` read under `h.svc.mu`.
   - `wantInvalidTIF(t, err)` — fails unless the code is `codes.InvalidArgument` and the message
     contains `time_in_force`.
   Every call uses `ctxAsUser("user-1")`.
3. `TestReplaceOrder_DisallowedTIFLeavesNothing_F349_AC1` (`// @AC-1:`), table-driven subtests:
   IBKR + OPG, IBKR + CLS, IBKR + `TIME_IN_FORCE_UNSPECIFIED`, ALPACA + `TIME_IN_FORCE_UNSPECIFIED`.
   Each builds `replaceTIFHarness(&fakeBroker{}, <broker>)` (no hook, so any broker replace panics)
   and asserts, in this order: `wantInvalidTIF`; `h.intentCount() == 0`;
   `storedOrder(h).IntentState == INTENT_STATE_COMPLETED` (unchanged).
4. `TestReplaceOrder_CorrectedTIFRetries_F349_AC2` (`// @AC-2:`), IBKR, `replaceRecorder()`:
   - the OPG request → `wantInvalidTIF`;
   - `replaceTIFReq(DAY)` → no error, exactly one recorded broker replace, returned
     `order.TimeInForce == TIME_IN_FORCE_DAY`; then `waitForLedgerEvents(t, h.ledger, 1)` (`order.replaced`);
   - the same OPG request again → `wantInvalidTIF`;
   - finally `h.intentCount() == 1` and still one recorded broker replace.
5. `TestReplaceOrder_AllowedTIFClaimsOneIntent_F349_AC3` (`// @AC-3 (guard, passes before the fix):`),
   IBKR, two subtests, each with its own `replaceRecorder()` harness:
   - "identical replay returns the stored result": `req := replaceTIFReq(DAY)`; first call succeeds;
     `waitForLedgerEvents(t, h.ledger, 1)`; `h.intentCount() == 1` and the row read with
     `h.intents.GetIntentByID(ctx, intentID)` (id from `deriveReplaceCancelIntentID(req)`) has
     `State == repository.IntentStateCompleted`; one recorded broker replace with
     `TimeInForce == "day"`. The identical second call returns no error and `Qty == 7`, with still one
     recorded broker replace and one intent row.
   - "a replace without a time-in-force sends none": `&tradingv1.ReplaceOrderRequest{OrderId: "ord-1", Qty: 7}`
     succeeds; `waitForLedgerEvents(t, h.ledger, 1)`; one recorded broker replace with
     `TimeInForce == ""`; one intent row (debate.md O-3).
6. `TestReplaceOrder_DisallowedTIFBeatsExistingIntent_F349_AC4` (`// @AC-4:`), IBKR,
   `&fakeBroker{}`: `req := replaceTIFReq(OPG)`; `intentID, hashHex, _ := deriveReplaceCancelIntentID(req)`;
   seed `h.intents.recs[intentID] = &repository.OrderIntentRecord{IntentID: intentID, OrderID: "ord-1", RequestHash: hashHex, State: repository.IntentStateUnknown, UpdatedAt: time.Now()}`.
   The call → `wantInvalidTIF`; afterwards `h.intentCount() == 1` and the seeded row's state is still
   `IntentStateUnknown`.
7. RED, captured with only this step's two files written (expected lines from the prototype run):
   - `@AC-1`: every subtest fails with `replace intent rows = 1, want none`;
   - `@AC-2`: fails at the third call with `FailedPrecondition … replace on order ord-1 is still pending`;
   - `@AC-4`: fails with `FailedPrecondition … replace intent for order ord-1 outcome is unknown`;
   - `@AC-3`: passes. Record it as "red N/A — guard: the allowed path is unchanged by the fix", never silently.
8. C-13: this file declares no domain-data literal. The order comes from `rlWorkingOrder` through
   `newRLFakeHarness`; the requests and the seeded intent row are scenario one-offs. One consumer →
   inline is compliant; nothing moves to `internal/testdata/`.
9. Trading-domain constraints:
   - Broker coverage: IBKR (`BROKER_TYPE_IBKR`) is exercised by `@AC-1`..`@AC-4`; Alpaca
     (`BROKER_TYPE_ALPACA`) by the fourth `@AC-1` row, and its allowed path by the existing
     `F347_AC31` and feature-267 replace tests, which must stay green.
   - Fill state: fill handling is unaffected. The status gate (`trading.go:1534-1540`) sits above the
     moved block and treats `NEW` and `PARTIALLY_FILLED` alike; the harness order is `NEW`, as the
     scenarios state.
   - Order type and trading mode: unaffected — `ReplaceOrder` reads neither.
10. New logic is in an excluded package — no coverage threshold applies; integration test
    verification is sufficient. The service-wide total is still checked below.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod   # 0 issues (v2.14.0 built with go1.27)
export GOWORK=off; COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//')
go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"   # >= 40% (prototype: 84.8%)
go test ./internal/service/ -race -count=1 -run 'F349_AC[1-4]$' -v | grep -c "^--- PASS"   # 4: one top-level test per scenario
grep -rn "^func (.*) ReplaceOrder(" --include="*_test.go" internal/service | wc -l          # 5, as before: no new broker double
grep -c "tradingv1.Order{" internal/service/trading_replace_tif_test.go                     # 0: no second order literal (C-13)
grep -c "BROKER_TYPE_IBKR\|BROKER_TYPE_ALPACA" internal/service/trading_replace_tif_test.go # >= 2: both dispatch paths
```

---

### Step 2 — service: validate the replace time-in-force before the intent claim

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading.go` — modify

**Reviewers**: `xstockstrat-trading` owner — order execution correctness, broker API safety, fill detection, paper-only dev invariant, position limit enforcement

**Codebase Evidence**:
- `ReplaceOrder` — `trading.go:1511-1666`. Gate order today: order lookup `:1512-1524` → ownership
  `:1528-1530` → status `:1534-1540` → account halt `:1544-1546` → trading-state `:1549-1551` →
  broker-order-id `:1553-1556` → `_, entry, err := s.resolveAccount(order.AccountId)` `:1558-1561` →
  `deriveReplaceCancelIntentID(req)` `:1563-1567` → `InsertIntent` `:1569-1575` → dedup switch
  `:1576-1602` (every branch returns) → `prevIntent := order.IntentState` `:1603` → PENDING mark
  `:1604` → comment `:1606` + `brokerReq` literal `:1607-1612` → TIF block `:1613-1618`
  (`validateTIF` `:1614`, the leaking `return nil, err` `:1615`, `tifToWireString` `:1617`) →
  `entry.client.ReplaceOrder(ctx, order.BrokerOrderId, brokerReq)` `:1619` → `ErrRateLimited` →
  `refuseRateLimitedMutation` `:1620-1622` → rejected finalize `:1623-1629` → success `:1634-1665`.
- `:1615` is the only return between `InsertIntent` and the broker call that neither finalizes nor
  releases the intent (recon.md).
- The block to move reads only `req` and `entry`; both exist after `:1561`. Nothing between `:1562`
  and `:1606` reads `brokerReq`.
- Pattern to mirror: `PlaceOrder` validates at `trading.go:519-523`, before `placeOrderRequestHash`
  `:527-531` and before `InsertIntent` (`:623`, in `submitOrder`).
- `validateTIF(tif tradingv1.TimeInForce, brokerType commonv1.BrokerType) error` —
  `internal/service/tif_validation.go:61-70`; pure: reads its arguments and `allowedTIFs` (`:34-57`).
  `resolveAccount` — `trading.go:356`, read lock only.
- An empty `brokerReq.TimeInForce` means "leave unchanged" in both adapters:
  `internal/broker/alpaca.go:389-391`, `internal/broker/ibkr.go:383-385` (D-2).
- Trading-domain survey over `trading.go:1511-1666`: the one `BrokerType` read is `:1614`; the one
  `OrderStatus` read is the gate `:1534-1540`; no `TRADING_MODE` / `resolveTradingMode` and no
  `OrderType` read.
- Module rules: TRADING-6 (intent-id derivation), TRADING-8 (`ReleasePendingIntent` only after
  `broker.ErrRateLimited`) — `services/xstockstrat-trading/docs/context-constitution.md:20`, `:22`.
- No signature, constructor or return shape changes, so no caller or test call site needs an edit
  (`step-constraints.md` §C row 1 does not apply); the unit exists only because of Step 1's RED.

**Lands with**: `Step 1`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. In `ReplaceOrder`, cut the 13 lines `trading.go:1606-1618` — the comment
   `// Only the changed fields are sent to the broker (zero/empty/nil = leave unchanged).`, the
   `brokerReq := broker.OrderRequest{…}` literal and the `if req.TimeInForce != nil { … }` block —
   and paste them unchanged between the `resolveAccount` error check (`:1559-1561`) and the
   `// Dedup insert:` comment (`:1563`), with one blank line before and after. A pure move: no new
   local, no second `req.TimeInForce != nil` branch (D-2; R-5 is off the table).
2. Add one comment line directly above the moved comment, stating the constraint as "must" (D-6):
   `// Must stay above the intent claim: a refused time-in-force must leave no intent row (TRADING-7).`
   The block's comment is then two lines, the cap.
3. Leave everything else in the function exactly as it is: the gates above `resolveAccount` and their
   order; `deriveReplaceCancelIntentID`; `InsertIntent`; the dedup switch; `prevIntent` (`:1603`);
   the PENDING mark (`:1604`); the broker call; the `ErrRateLimited` branch; both finalize paths. The
   PENDING mark is now followed by one blank line and then the broker call.
4. Do not add `ReleasePendingIntent`, a REJECTED finalize or any cleanup on the TIF error path (D-4;
   R-1, R-2), do not read `order.BrokerType` (R-3), do not move `resolveAccount` (R-4), and do not
   touch `validateTIF`, `tifToWireString`, `PlaceOrder` or `CancelOrder`.
5. Resulting precedence (D-3): a disallowed TIF returns `InvalidArgument` whatever intent row exists
   for that content; Step 1's `@AC-4` pins it.
6. Trading-domain constraints:
   - Broker coverage: the check is broker-agnostic — it reads the `allowedTIFs` row of
     `entry.brokerType`. ALPACA and IBKR take the same moved path; OFFLINE accounts hold no broker
     order id and return at `:1553-1556`, as before.
   - Trading mode gate: unaffected — `ReplaceOrder` places no order and reads no trading mode;
     paper and live behave the same.
   - Order type handling is unaffected by this step.
   - Fill handling is unaffected by this step: the `NEW` / `PARTIALLY_FILLED` gate is above the
     moved block and unchanged.
   - No env var, no config read and no outbound gRPC call is added (no header-propagation change).

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go build ./... && GOWORK=off go vet ./internal/service/...
awk '/^func \(s \*TradingService\) ReplaceOrder\(/{f=1} f&&/validateTIF\(/{v=NR} f&&/deriveReplaceCancelIntentID\(/{d=NR} f&&/^}/{exit} END{exit !(v&&d&&v<d)}' internal/service/trading.go && echo "TIF validated before the intent claim"
grep -c "validateTIF(" internal/service/trading.go                      # 2: PlaceOrder and ReplaceOrder, no third site
git diff --numstat -- internal/service/trading.go                       # 15 added, 13 deleted: the 13 moved lines, the new comment, one blank
grep -c 'codes.Unavailable, "positions not published; re-confirm to retry"' internal/service/trading.go   # 1: the agent-pinned string is untouched
GOWORK=off go test ./internal/service/ -race -count=1                   # whole package green, no existing test edited
```
Lint and the coverage command run in Step 1's `**Verification**` (same unit).

---

### Step 3 — docs: TRADING-7 and the Order Replace section

**Status**: `pending`
**Service**: `services/xstockstrat-trading/` (docs)
**Files**:
- `services/xstockstrat-trading/docs/context-constitution.md` — modify
- `services/xstockstrat-trading/CLAUDE.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- TRADING-7 — `services/xstockstrat-trading/docs/context-constitution.md:21`. Rule cell: "**Time-in-force
  is validated per broker BEFORE any broker call, via `validateTIF(tif, brokerType)` … `tifToWireString`.**
  `PlaceOrder` always validates; `ReplaceOrder` only when a TIF is supplied; the internal bracket and
  flatten paths hard-code DAY and bypass validation. …". Why cell starts "A new submit path that
  forwards TIF without `validateTIF` sends an unsupported value to the broker;". It says nothing
  about the intent claim (recon.md § Risks / Not-found).
- `services/xstockstrat-trading/CLAUDE.md` § Order Replace — heading `:144`; the second paragraph
  ends at `:156-157` ("…A successful replace persists the order, emits the `order.replaced` ledger
  event, and broadcasts to `StreamOrderUpdates` subscribers."); `### Per-broker replaceable-field matrix`
  follows. No sentence there covers TIF validation.
- Rule-ID citation style in that file: "(`ReleasePendingIntent`, TRADING-8)" in § Adaptive rate limit,
  outcome (c) — a bare ID, no path.
- CI: `**/CLAUDE.md` is linted by markdownlint (`.github/workflows/ci.yml:1068-1081`,
  `.markdownlint.yaml`); doc references are checked by `scripts/check-context-map.py` (`ci.yml:1094`).
- The findings log's open TIF question (`services/xstockstrat-trading/docs/context-constitution-findings.md:41`, why `ReplaceOrder`
  validates only when a TIF is supplied) is a different topic and stays open.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. `services/xstockstrat-trading/docs/context-constitution.md`, TRADING-7 row (`:21`), three in-place edits; the Evidence and
   Example cells and the file's "last refreshed" line stay as they are:
   - Rule cell, bold lead: `BEFORE any broker call, via` → `BEFORE any broker call and before any order-intent claim, via`.
   - Rule cell: replace "`ReplaceOrder` only when a TIF is supplied; the internal bracket and flatten
     paths hard-code DAY and bypass validation." with "`ReplaceOrder` only when a TIF is supplied,
     right after `resolveAccount` and above `deriveReplaceCancelIntentID`, and a refused TIF returns
     `InvalidArgument` whatever intent row already exists for that content. The internal bracket and
     flatten paths hard-code DAY and bypass validation."
   - Why cell: after "…sends an unsupported value to the broker;" insert "validating after the intent
     claim strands a `PENDING` row (later `UNKNOWN`) for a request that never reached the broker;".
2. `services/xstockstrat-trading/CLAUDE.md` § Order Replace: add one paragraph after the paragraph ending at `:157` and before
   `### Per-broker replaceable-field matrix`:
   "A `time_in_force` the order's broker does not allow is rejected with `InvalidArgument` and has no
   side effect, so the caller can correct it and resend (TRADING-7)."
   It points at the rule; it does not restate the ordering (debate.md O-7).
3. No other doc changes: no ledger entry is due (the trap is already fails.md 2026-10-07,
   `order-time-in-force-enum`), no runbook mentions the replace TIF check, and the defect report's
   sidecar is closed out by the integration flow, not here.

**Verification**:
```bash
grep -c "before any order-intent claim" services/xstockstrat-trading/docs/context-constitution.md        # 1
grep -c "above \`deriveReplaceCancelIntentID\`" services/xstockstrat-trading/docs/context-constitution.md  # 1
grep -n "can correct it and resend (TRADING-7)" services/xstockstrat-trading/CLAUDE.md                    # one line, inside § Order Replace
git diff --numstat -- services/xstockstrat-trading/docs/context-constitution.md                           # 1 added, 1 deleted: only the TRADING-7 row
python3 scripts/check-context-map.py                                                                      # OK - all context-map and doc references resolve.
npx --yes markdownlint-cli2 --config .markdownlint.yaml "services/xstockstrat-trading/CLAUDE.md"          # 0 issues
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
