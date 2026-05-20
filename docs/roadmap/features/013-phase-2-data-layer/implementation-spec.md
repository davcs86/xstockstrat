# Implementation Spec: phase-2-data-layer

**Status**: `pending`
**Created**: 2026-05-20
**Feature**: `docs/roadmap/features/013-phase-2-data-layer/feature.md`
**Total Steps**: 2
**Feature Branch**: `feature/phase-2-data-layer`

---

## Execution Summary

There are no proto, migration, or config changes. The entire fix is contained in `xstockstrat-portfolio`'s `GetPnL` method in `services/xstockstrat-portfolio/internal/service/portfolio_service.go`. The existing `s.ledger` client (a `ledgerv1.LedgerServiceClient` already dialed at L47–65) exposes `QueryEvents` — a unary RPC confirmed in the generated stub at `packages/proto/gen/go/ledger/v1/ledger_grpc.pb.go:36`. The fix replaces the stub return-zero body with a ledger query + FIFO realized-P&L loop, followed by a paired unit-test step.

The ledger service is **read-only** from portfolio's perspective (no writes added). Header propagation for the new `QueryEvents` call is handled automatically by the existing `middleware.UnaryClientInterceptor` already wired into the `ledgerConn` at `portfolio_service.go:47`.

---

## Step Dependencies

- Step 2 [test] requires Step 1 [service]: tests exercise the logic added in Step 1.

---

### Step 1 — service: fix GetPnL to compute realized P&L from ledger order.filled events

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go` — modify

**Reviewers**: Service owner (`xstockstrat-portfolio`) — P&L calculation accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- Bug confirmed at: `services/xstockstrat-portfolio/internal/service/portfolio_service.go:254–272` — `GetPnL` returns `&portfoliov1.PnLResponse{UnrealizedPnl: unrealized, Range: req.Range}` with no `RealizedPnl` field set (zero value).
- Ledger client already present: `portfolio_service.go:32` — `ledger ledgerv1.LedgerServiceClient`; dialed at L47 with `middleware.UnaryClientInterceptor` (header propagation wired).
- `QueryEvents` method confirmed in generated stub: `packages/proto/gen/go/ledger/v1/ledger_grpc.pb.go:36` — `QueryEvents(ctx context.Context, in *QueryEventsRequest, opts ...grpc.CallOption) (*QueryEventsResponse, error)`
- `QueryEventsRequest` fields confirmed: `event_type` (L344), `source_service` (L351), `page` (L365) — from `packages/proto/gen/go/ledger/v1/ledger.pb.go`
- `order.filled` event payload schema confirmed at `portfolio_service.go:107–114` (the `orderFillPayload` struct already used by `processOrderFill`): `user_id`, `symbol`, `qty` (positive=buy, negative=sell), `fill_price`, `trading_mode`, `account_id`
- `order.filled` stream_key is `order:{order_id}` (confirmed at `services/xstockstrat-trading/internal/service/trading.go:512` — `emitLedgerEvent(ctx, "order.filled", order.OrderId, ...)` using `order.OrderId` as the stream key). There is **no per-user stream_key** for fills; user identity is only in the payload.
- Two distinct event types exist (confirmed at `trading.go:511–526`): `order.filled` fires **once** when an order is fully filled (payload: `qty = order.Qty` — total quantity); `order.partially_filled` fires during Alpaca polling as the order fills incrementally (payload: `filled_qty = order.FilledQty` — cumulative partial qty). The portfolio service's existing subscriber (`portfolio_service.go:88`) already filters on `"order.filled"` only. `GetPnL` must do the same: query `event_type = "order.filled"` only; `order.partially_filled` events are observability events and excluded from P&L computation.
- `PnLResponse` fields confirmed at `packages/proto/gen/go/portfolio/v1/portfolio.pb.go:376–378`: `RealizedPnl float64` (field 1), `UnrealizedPnl float64` (field 2), `TotalPnl float64` (field 3). All three fields used in the return statement exist.
- `orderFillPayload.Mode` Go field name confirmed at `portfolio_service.go:112`: struct field is `Mode string \`json:"trading_mode"\`` — Go field `Mode` is correct (not `TradingMode`).
- `TradingMode_TRADING_MODE_UNSPECIFIED` is 0 (confirmed at `packages/proto/gen/go/common/v1/common.pb.go:30`).
- Pagination pattern for `QueryEvents` — `page` field accepts `commonv1.PageRequest`; confirmed at `packages/proto/ledger/v1/ledger.proto:54`.
- `commonv1` already imported at `portfolio_service.go:17`.

**Instructions**:

Replace the `GetPnL` function body at `services/xstockstrat-portfolio/internal/service/portfolio_service.go:254–272`. The existing function signature is unchanged:

```go
func (s *PortfolioService) GetPnL(ctx context.Context, req *portfoliov1.GetPnLRequest) (*portfoliov1.PnLResponse, error) {
```

The new body must:

1. Compute `unrealized` as it is today (lines 256–266 — iterate open positions, call `GetLatestQuote`, accumulate `(price - avgEntry) * qty`). Keep this block unchanged.

2. After computing `unrealized`, query the ledger for all `order.filled` events emitted by `trading`:
   ```go
   var realized float64
   var pageToken string
   for {
       resp, err := s.ledger.QueryEvents(ctx, &ledgerv1.QueryEventsRequest{
           EventType:     "order.filled",
           SourceService: "trading",
           Page:          &commonv1.PageRequest{PageSize: 500, PageToken: pageToken},
       })
       if err != nil {
           slog.Warn("GetPnL: QueryEvents failed", "error", err)
           break
       }
       for _, ev := range resp.GetEvents() {
           if ev.Payload == nil {
               continue
           }
           raw, err := ev.Payload.MarshalJSON()
           if err != nil {
               continue
           }
           var fill orderFillPayload
           if err := json.Unmarshal(raw, &fill); err != nil {
               continue
           }
           // Filter by user
           if fill.UserID != req.UserId {
               continue
           }
           // Filter by trading mode (UNSPECIFIED = no filter)
           if req.TradingMode != commonv1.TradingMode_TRADING_MODE_UNSPECIFIED {
               fillMode := commonv1.TradingMode_TRADING_MODE_PAPER
               if fill.Mode == "TRADING_MODE_LIVE" {
                   fillMode = commonv1.TradingMode_TRADING_MODE_LIVE
               }
               if fillMode != req.TradingMode {
                   continue
               }
           }
           // Negative qty = sell = closing event; positive qty = buy = entry event
           // Realized P&L for a closing fill: (exit_fill_price - avg_entry_price) × abs(sell_qty)
           // avg_entry_price approximation: use fill.FillPrice for the matching entry fill.
           // Because we are iterating all fills in recorded_at order, we accumulate
           // an average cost basis per (user, symbol) and realize on each sell fill.
           // Implementation: maintain a per-symbol running position map, mirroring
           // processOrderFill logic, and accumulate realized on each sell.
       }
       if resp.GetPage().GetNextPageToken() == "" {
           break
       }
       pageToken = resp.GetPage().GetNextPageToken()
   }
   ```

3. Implement the signed average-cost-basis accumulation loop. Use a `map[string]*fillAccumulator` keyed by symbol. The `fillAccumulator` struct (file-local, unexported) holds `qty float64` (signed: positive = long, negative = short) and `costBasis float64` (signed: `qty × avgPrice`). This unified representation handles both long and short positions with the same arithmetic.

   Declare the accumulator type at the bottom of the file alongside the other private types:
   ```go
   type fillAccumulator struct {
       qty       float64 // signed: positive = long, negative = short
       costBasis float64 // signed: qty × avg_entry_price
   }
   ```

   For each qualifying fill event, determine whether it opens/adds to the current position or closes/reduces it:
   ```go
   acc := accs[fill.Symbol]
   if acc == nil {
       acc = &fillAccumulator{}
       accs[fill.Symbol] = acc
   }
   sameDirection := acc.qty == 0 || (fill.Qty > 0) == (acc.qty > 0)
   if sameDirection {
       // Opening or adding to a position (long buy or short sell)
       acc.qty += fill.Qty
       acc.costBasis += fill.Qty * fill.FillPrice
   } else {
       // Closing or reducing a position (opposite direction)
       // Works for both long→sell and short→buy:
       //   realized = -fill.Qty × (fill.FillPrice - acc.costBasis/acc.qty)
       // Long example: sell 100 @ $70, avg_entry $50 → -(-100) × (70-50) = +2000 ✓
       // Short example: buy 100 @ $40, avg_entry $50 → -(100) × (40-50) = +1000 ✓
       avgEntry := acc.costBasis / acc.qty
       closeQty := fill.Qty
       // Cap close at current position size (handle partial close)
       if math.Abs(closeQty) > math.Abs(acc.qty) {
           closeQty = -acc.qty // only close what we have; remainder opens new position
       }
       realized += (-closeQty) * (fill.FillPrice - avgEntry)
       oldQty := acc.qty
       acc.qty += closeQty
       if math.Abs(acc.qty) < 1e-9 {
           acc.qty = 0
           acc.costBasis = 0
       } else {
           acc.costBasis = acc.costBasis * acc.qty / oldQty
       }
       // If fill.Qty exceeded the closed position (reversal), open opposite direction
       remainder := fill.Qty - closeQty
       if math.Abs(remainder) > 1e-9 {
           acc.qty += remainder
           acc.costBasis += remainder * fill.FillPrice
       }
   }
   ```

   **Import required**: `math` for `math.Abs`. Check whether `math` is already imported at `portfolio_service.go:1–25`; add it to the import block if absent. Declare `accs := make(map[string]*fillAccumulator)` before the pagination loop.

4. Return the updated response:
   ```go
   return &portfoliov1.PnLResponse{
       RealizedPnl:   realized,
       UnrealizedPnl: unrealized,
       TotalPnl:      realized + unrealized,
       Range:         req.Range,
   }, nil
   ```

**Import check**: `json`, `slog`, `ledgerv1`, `commonv1`, `portfoliov1` are already imported at L1–25. Verify whether `math` is present; if absent, add `"math"` to the import block (needed for `math.Abs` in the accumulator).

**Verification**:
```bash
cd /home/user/xstockstrat-orchestration/services/xstockstrat-portfolio && GOWORK=off go build ./...
```
Build must succeed with zero errors.

---

### Step 2 — test: unit tests for GetPnL realized P&L computation

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_helpers_test.go` — modify (append new test cases)

**Reviewers**: Service owner (`xstockstrat-portfolio`) — P&L calculation accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- Existing test file confirmed at `services/xstockstrat-portfolio/internal/service/portfolio_helpers_test.go` — package `service`, already contains `computeNewPosition` helper and 5 table-driven tests.
- Pattern used: copy the logic into a package-local pure function (`computeNewPosition`) tested directly without gRPC mocks — same pattern must be followed for realized P&L to keep tests dependency-free.
- `fillAccumulator` will be in package `service` (same package as the test file) so it is directly accessible.
- Coverage threshold for `xstockstrat-portfolio`: 40% (CI excludes `cmd/`, `handler/`, `repository/`, `telemetry/`, `service/` packages). New logic lands in `internal/service/` which is **excluded from CI coverage measurement** (the `service` package directory is excluded by the `grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)'` CI filter). Note this in the test step.

**Instructions**:

Add a helper function and five test functions to `services/xstockstrat-portfolio/internal/service/portfolio_helpers_test.go`:

1. Add a `computeRealizedPnL(fills []orderFillPayload) float64` helper that mirrors the signed accumulation loop added in Step 1, accepting a slice of `orderFillPayload` and returning `float64`. Filter is omitted (all fills accepted) to keep the helper dependency-free.

2. Add `TestRealizedPnL_NoFills` — empty fills slice → realized == 0.0.

3. Add `TestRealizedPnL_ClosedLong` — one buy fill (100 shares @ $50) followed by one sell fill (-100 shares @ $70) → realized == 100 × (70 − 50) = 2000.0.

4. Add `TestRealizedPnL_ClosedShort` — one sell fill (−100 shares @ $50, opening short) followed by one buy fill (+100 shares @ $40, closing short) → realized == 100 × (50 − 40) = 1000.0.

5. Add `TestRealizedPnL_MultipleOrders` — four independent `order.filled` events for the same symbol: buy +50@50, buy +50@50 (two separate completed buy orders), sell -50@70, sell -50@70 (two separate completed sell orders). Equivalent in effect to one buy of 100@50 and one sell of 100@70 → realized == 2000.0. This verifies that multiple independent `order.filled` events accumulate correctly through the average-cost-basis loop. Note: `order.partially_filled` events are excluded from this computation — only fully-completed order fills are queried.

6. Add `TestRealizedPnL_MixedOpenAndClosed` — two buy fills (100 @ $50, then 50 @ $60), one partial sell fill (−80 @ $75):
   - After first buy: avg_cost = 50.00, qty = 100
   - After second buy: avg_cost = (5000 + 3000) / 150 = 53.333..., qty = 150
   - Sell 80 @ 75: realized = 80 × (75 − 53.333...) = 1733.333...
   - Verify realized within tolerance ±0.01.

**New logic lands in `internal/service/` which is excluded from CI coverage measurement** (confirmed by `grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)'` in the CI threshold command). No coverage threshold applies; integration test verification via build + run is sufficient.

**Verification**:
```bash
cd /home/user/xstockstrat-orchestration/services/xstockstrat-portfolio && GOWORK=off go test ./internal/service/... -v -run TestRealizedPnL
```
All five new test cases must pass. Additionally, confirm existing tests are not broken:
```bash
cd /home/user/xstockstrat-orchestration/services/xstockstrat-portfolio && GOWORK=off go test ./... -race -count=1
```
Zero failures.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
