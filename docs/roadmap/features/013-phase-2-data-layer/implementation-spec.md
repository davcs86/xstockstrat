# Implementation Spec: phase-2-data-layer

**Status**: `complete`
**Created**: 2026-05-20
**Feature**: `docs/roadmap/features/013-phase-2-data-layer/feature.md`
**Total Steps**: 5
**Feature Branch**: `feature/phase-2-data-layer`

---

## Execution Summary

There are no proto, migration, or config changes. The fix spans two services:

**`xstockstrat-trading` (Steps 1–3)**: The root cause is that `BrokerOrder` carries only `BrokerOrderID` and `Status` — both `AlpacaClient.GetOrder` and `IBKRClient.GetOrder` parse the broker API response but discard the fill price. `pollFills` in `trading.go` then emits `order.filled` ledger events with `fill_price = 0.0`. The fix adds `FilledAvgPrice float64` to `BrokerOrder`, updates both `GetOrder` implementations to parse the fill price from their respective API formats (Alpaca: string `filled_avg_price`, IBKR: float64 `avgPrice`), and adds one line to `pollFills` to propagate the value to `order.FilledAvgPrice`.

**`xstockstrat-portfolio` (Steps 4–5)**: `GetPnL` never queries the ledger; `RealizedPnl` is always the Go zero value. The fix adds a paginated `QueryEvents` loop against the existing `s.ledger` client (a `ledgerv1.LedgerServiceClient` already dialed at L47–65 with `middleware.UnaryClientInterceptor`). Qualifying fills feed a per-symbol signed average-cost-basis accumulator; realized P&L is returned in all three `PnLResponse` fields.

Steps 4–5 are logically independent from Steps 1–3 at implementation time (different services), but require Steps 1–3 to be deployed first to produce non-zero `fill_price` values in the ledger.

---

## Step Dependencies

- Step 2 [service] requires Step 1 [broker]: `pollFills` uses `BrokerOrder.FilledAvgPrice` added in Step 1.
- Step 3 [test] requires Steps 1–2: tests exercise the broker and pollFills changes.
- Step 4 [service] is logically independent from Steps 1–3 (different service), but correct non-zero P&L output requires Steps 1–3 to be deployed first so the ledger contains non-zero fill prices.
- Step 5 [test] requires Step 4: tests exercise the logic added in Step 4.

---

### Step 1 — broker: extend BrokerOrder struct and update both GetOrder implementations

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/broker/broker.go` — modify
- `services/xstockstrat-trading/internal/broker/alpaca.go` — modify
- `services/xstockstrat-trading/internal/broker/ibkr.go` — modify

**Reviewers**: Service owner (`xstockstrat-trading`) — broker interface changes, fill price parsing accuracy, IBKR API field name correctness

**Codebase Evidence**:
- `BrokerOrder` struct confirmed at `broker.go:6–9`: only `BrokerOrderID string` and `Status string`; no `FilledAvgPrice`. Interface declared at `broker.go:19–25`.
- Alpaca `GetOrder` at `alpaca.go:177–207`: deserializes response into `AlpacaOrder`. `AlpacaOrder.FilledAvgPrice string \`json:"filled_avg_price"\`` is present at `alpaca.go:79` and parsed but discarded — return at `alpaca.go:206` is `&BrokerOrder{BrokerOrderID: alpacaResp.ID, Status: alpacaResp.Status}`.
- Alpaca encodes fill price as a decimal string (same pattern as `Qty` and `FilledQty`). `strconv` already imported at `alpaca.go:10`.
- IBKR `GetOrder` at `ibkr.go:155–188`: inline response struct at `ibkr.go:177–182` has only `OrderID string \`json:"orderId"\`` and `Status string \`json:"status"\``; IBKR Web API `/iserver/account/orders` returns `avgPrice float64` for the average fill price. Return at `ibkr.go:187` is `&BrokerOrder{BrokerOrderID: o.OrderID, Status: o.Status}`.
- `strconv` already imported at `ibkr.go:14` (used in `signRequest`).

**Instructions**:

1. In `services/xstockstrat-trading/internal/broker/broker.go`, add `FilledAvgPrice float64` to `BrokerOrder`. Replace:
   ```go
   type BrokerOrder struct {
       BrokerOrderID string
       Status        string
   }
   ```
   With:
   ```go
   type BrokerOrder struct {
       BrokerOrderID  string
       Status         string
       FilledAvgPrice float64 // zero for unfilled orders
   }
   ```

2. In `services/xstockstrat-trading/internal/broker/alpaca.go`, update `GetOrder` return (currently at L206). Replace:
   ```go
   return &BrokerOrder{BrokerOrderID: alpacaResp.ID, Status: alpacaResp.Status}, nil
   ```
   With:
   ```go
   var filledAvgPrice float64
   if alpacaResp.FilledAvgPrice != "" {
       filledAvgPrice, _ = strconv.ParseFloat(alpacaResp.FilledAvgPrice, 64)
   }
   return &BrokerOrder{BrokerOrderID: alpacaResp.ID, Status: alpacaResp.Status, FilledAvgPrice: filledAvgPrice}, nil
   ```

3. In `services/xstockstrat-trading/internal/broker/ibkr.go`, update the inline response struct inside `GetOrder` (at `ibkr.go:177–182`). Replace:
   ```go
   var result struct {
       Orders []struct {
           OrderID string `json:"orderId"`
           Status  string `json:"status"`
       } `json:"orders"`
   }
   ```
   With:
   ```go
   var result struct {
       Orders []struct {
           OrderID  string  `json:"orderId"`
           Status   string  `json:"status"`
           AvgPrice float64 `json:"avgPrice"`
       } `json:"orders"`
   }
   ```
   Then update the return at `ibkr.go:187`. Replace:
   ```go
   return &BrokerOrder{BrokerOrderID: o.OrderID, Status: o.Status}, nil
   ```
   With:
   ```go
   return &BrokerOrder{BrokerOrderID: o.OrderID, Status: o.Status, FilledAvgPrice: o.AvgPrice}, nil
   ```

**Note on IBKR field name**: The IBKR Web API field `avgPrice` (float64) is used by the `/iserver/account/orders` response for the average fill price. If integration tests reveal the actual field name differs (e.g., `avgFillPrice`), update the JSON tag accordingly — the Go struct field name `AvgPrice` and the `FilledAvgPrice` propagation are correct regardless.

**Verification**:
```bash
cd /home/user/xstockstrat-orchestration/services/xstockstrat-trading && GOWORK=off go build ./...
```
Build must succeed with zero errors. All existing broker tests must still pass:
```bash
cd /home/user/xstockstrat-orchestration/services/xstockstrat-trading && GOWORK=off go test ./internal/broker/... -v
```

---

### Step 2 — service: propagate FilledAvgPrice in pollFills

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading.go` — modify

**Reviewers**: Service owner (`xstockstrat-trading`) — fill event payload correctness

**Codebase Evidence**:
- `pollFills` at `trading.go:445–539` calls `entry.client.GetOrder(ctx, order.BrokerOrderId)` (L489), storing the result in `brokerOrder`.
- After `order.Status = newStatus` (L500) and `order.UpdatedAt = timestamppb.New(time.Now())` (L501), a now-stale comment at L502 reads: "BrokerOrder.Status is the only normalized field; fill qty/price are broker-specific."
- `order.FilledAvgPrice` is used in the `order.filled` event emit at `trading.go:514` (`"fill_price": order.FilledAvgPrice`) but is always 0.0 because it is never populated from `brokerOrder`.

**Instructions**:

In `services/xstockstrat-trading/internal/service/trading.go` at lines 500–502, replace the status update block (including the now-stale comment):
```go
		order.Status = newStatus
		order.UpdatedAt = timestamppb.New(time.Now())
		// BrokerOrder.Status is the only normalized field; fill qty/price are broker-specific.
```
With:
```go
		order.Status = newStatus
		order.UpdatedAt = timestamppb.New(time.Now())
		order.FilledAvgPrice = brokerOrder.FilledAvgPrice
```

**Verification**:
```bash
cd /home/user/xstockstrat-orchestration/services/xstockstrat-trading && GOWORK=off go build ./...
```
Build must succeed. The `order.filled` event at `trading.go:514` will now emit a non-zero `fill_price` for completed orders when the broker reports a non-zero fill price.

---

### Step 3 — test: unit tests for broker fill price parsing

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/broker/alpaca_test.go` — modify (append new test)
- `services/xstockstrat-trading/internal/broker/ibkr_test.go` — create

**Reviewers**: Service owner (`xstockstrat-trading`) — fill price parsing accuracy, test mock correctness

**Codebase Evidence**:
- `alpaca_test.go` exists at `services/xstockstrat-trading/internal/broker/alpaca_test.go`; package `broker_test`; existing tests use `makeTestServer` helper (L15–21) that creates a `httptest.Server` with routes on `/v2/orders` and `/v2/orders/`. `broker.AlpacaOrder` is exported. Existing tests cover `SubmitOrder`, `CancelOrder`, `IsPaper` — `GetOrder` is not yet tested.
- No `ibkr_test.go` exists. `broker.NewIBKRClient` and `broker.IBKRConfig` are exported at `ibkr.go:42–57`. IBKR `GetOrder` URL is `{baseURL}/iserver/account/orders` with `orderId` query param (L156–163).

**Instructions**:

1. Append `TestGetOrder_AlpacaFilledAvgPrice` to `services/xstockstrat-trading/internal/broker/alpaca_test.go`:
   ```go
   func TestGetOrder_AlpacaFilledAvgPrice(t *testing.T) {
       srv := makeTestServer(t, func(w http.ResponseWriter, r *http.Request) {
           if r.Method != http.MethodGet {
               t.Errorf("expected GET, got %s", r.Method)
           }
           w.Header().Set("Content-Type", "application/json")
           _ = json.NewEncoder(w).Encode(broker.AlpacaOrder{
               ID:             "order-abc",
               Status:         "filled",
               FilledAvgPrice: "75.50",
           })
       })
       defer srv.Close()

       c := broker.NewClient(broker.ClientConfig{
           APIKey: "k", APISecret: "s", PaperURL: srv.URL, LiveURL: srv.URL, Paper: true,
       })

       o, err := c.GetOrder(context.Background(), "order-abc")
       if err != nil {
           t.Fatalf("GetOrder failed: %v", err)
       }
       if o.FilledAvgPrice != 75.50 {
           t.Errorf("expected FilledAvgPrice 75.50, got %f", o.FilledAvgPrice)
       }
       if o.Status != "filled" {
           t.Errorf("expected status filled, got %s", o.Status)
       }
   }
   ```

2. Create `services/xstockstrat-trading/internal/broker/ibkr_test.go`:
   ```go
   package broker_test

   import (
       "context"
       "encoding/json"
       "net/http"
       "net/http/httptest"
       "testing"

       "github.com/xstockstrat/trading/internal/broker"
   )

   func TestGetOrder_IBKRAvgPrice(t *testing.T) {
       srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
           if r.URL.Path != "/iserver/account/orders" {
               http.NotFound(w, r)
               return
           }
           w.Header().Set("Content-Type", "application/json")
           _ = json.NewEncoder(w).Encode(map[string]interface{}{
               "orders": []map[string]interface{}{
                   {"orderId": "ibkr-ord-1", "status": "Filled", "avgPrice": 82.25},
               },
           })
       }))
       defer srv.Close()

       c := broker.NewIBKRClient(broker.IBKRConfig{
           BaseURL: srv.URL,
       })

       o, err := c.GetOrder(context.Background(), "ibkr-ord-1")
       if err != nil {
           t.Fatalf("GetOrder failed: %v", err)
       }
       if o.FilledAvgPrice != 82.25 {
           t.Errorf("expected FilledAvgPrice 82.25, got %f", o.FilledAvgPrice)
       }
       if o.Status != "Filled" {
           t.Errorf("expected status Filled, got %s", o.Status)
       }
   }
   ```

**Verification**:
```bash
cd /home/user/xstockstrat-orchestration/services/xstockstrat-trading && GOWORK=off go test ./internal/broker/... -v -run TestGetOrder
```
Both `TestGetOrder_AlpacaFilledAvgPrice` and `TestGetOrder_IBKRAvgPrice` must pass. All existing broker tests must remain green:
```bash
cd /home/user/xstockstrat-orchestration/services/xstockstrat-trading && GOWORK=off go test ./... -race -count=1
```
Zero failures.

---

### Step 4 — service: fix GetPnL to compute realized P&L from ledger order.filled events

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go` — modify

**Reviewers**: Service owner (`xstockstrat-portfolio`) — P&L calculation accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- Bug confirmed at: `services/xstockstrat-portfolio/internal/service/portfolio_service.go:254–272` — `GetPnL` returns `&portfoliov1.PnLResponse{UnrealizedPnl: unrealized, Range: req.Range}` with no `RealizedPnl` field set (zero value).
- Ledger client already present: `portfolio_service.go:32` — `ledger ledgerv1.LedgerServiceClient`; dialed at L47 with `middleware.UnaryClientInterceptor` (header propagation wired).
- `QueryEvents` method confirmed in generated stub: `packages/proto/gen/go/ledger/v1/ledger_grpc.pb.go:36` — `QueryEvents(ctx context.Context, in *QueryEventsRequest, opts ...grpc.CallOption) (*QueryEventsResponse, error)`
- `QueryEventsRequest` fields confirmed: `event_type` (L344), `source_service` (L351), `page` (L365) — from `packages/proto/gen/go/ledger/v1/ledger.pb.go`
- `order.filled` event payload schema confirmed at `portfolio_service.go:107–114` (the `orderFillPayload` struct already used by `processOrderFill`): `user_id`, `symbol`, `qty` (positive=buy, negative=sell), `fill_price`, `trading_mode`, `account_id`. Two new fields must be added to `orderFillPayload`: `OrderID string \`json:"order_id"\`` and `FilledQty float64 \`json:"filled_qty"\`` — for `order.filled` events `FilledQty` is 0 (field absent in that payload); for `order.partially_filled` events `Qty` is 0 (field absent in that payload). Adding both fields is backward-compatible: `json.Unmarshal` silently leaves absent fields at zero value.
- `order.filled` stream_key is `order:{order_id}` (confirmed at `services/xstockstrat-trading/internal/service/trading.go:512` — `emitLedgerEvent(ctx, "order.filled", order.OrderId, ...)` using `order.OrderId` as the stream key). There is **no per-user stream_key** for fills; user identity is only in the payload.
- Two distinct event types exist (confirmed at `trading.go:511–526`): `order.filled` fires **once** when an order is fully filled (payload keys: `order_id`, `symbol`, `qty` = total, `fill_price`, `user_id`, `trading_mode`); `order.partially_filled` fires during Alpaca polling with cumulative progress (payload keys: `order_id`, `symbol`, `filled_qty` = cumulative total so far, `fill_price`, `user_id`, `trading_mode`). `GetPnL` must query **both** event types: `order.filled` for completed orders, and `order.partially_filled` for orders that were partially filled then canceled (i.e., `order.filled` never fired for that `order_id`).
- `PnLResponse` fields confirmed at `packages/proto/gen/go/portfolio/v1/portfolio.pb.go:376–378`: `RealizedPnl float64` (field 1), `UnrealizedPnl float64` (field 2), `TotalPnl float64` (field 3). All three fields used in the return statement exist.
- `orderFillPayload.Mode` Go field name confirmed at `portfolio_service.go:112`: struct field is `Mode string \`json:"trading_mode"\`` — Go field `Mode` is correct (not `TradingMode`).
- `TradingMode_TRADING_MODE_UNSPECIFIED` is 0 (confirmed at `packages/proto/gen/go/common/v1/common.pb.go:30`).
- Pagination pattern for `QueryEvents` — `page` field accepts `commonv1.PageRequest`; confirmed at `packages/proto/ledger/v1/ledger.proto:54`.
- `commonv1` already imported at `portfolio_service.go:17`.

**Instructions**:

**A. Add two fields to `orderFillPayload`** at `portfolio_service.go:107–114`. Add `OrderID` and `FilledQty` alongside the existing fields:
```go
type orderFillPayload struct {
    UserID    string  `json:"user_id"`
    Symbol    string  `json:"symbol"`
    Qty       float64 `json:"qty"`       // set by order.filled; zero for order.partially_filled
    FilledQty float64 `json:"filled_qty"` // set by order.partially_filled; zero for order.filled
    FillPrice float64 `json:"fill_price"`
    Mode      string  `json:"trading_mode"`
    AccountId string  `json:"account_id"`
    OrderID   string  `json:"order_id"`
}
```

**B. Replace the `GetPnL` function body** at `services/xstockstrat-portfolio/internal/service/portfolio_service.go:254–272`. The existing function signature is unchanged:

```go
func (s *PortfolioService) GetPnL(ctx context.Context, req *portfoliov1.GetPnLRequest) (*portfoliov1.PnLResponse, error) {
```

The new body must:

1. Compute `unrealized` as it is today (lines 256–266 — iterate open positions, call `GetLatestQuote`, accumulate `(price - avgEntry) * qty`). Keep this block unchanged.

2. Declare the accumulator state and a reusable `applyFill` closure:
   ```go
   var realized float64
   accs := make(map[string]*fillAccumulator)
   filledOrderIDs := make(map[string]bool)
   latestPartials := make(map[string]orderFillPayload)

   applyFill := func(qty, fillPrice float64, symbol string) {
       acc := accs[symbol]
       if acc == nil {
           acc = &fillAccumulator{}
           accs[symbol] = acc
       }
       sameDirection := acc.qty == 0 || (qty > 0) == (acc.qty > 0)
       if sameDirection {
           acc.qty += qty
           acc.costBasis += qty * fillPrice
       } else {
           avgEntry := acc.costBasis / acc.qty
           closeQty := qty
           if math.Abs(closeQty) > math.Abs(acc.qty) {
               closeQty = -acc.qty
           }
           realized += (-closeQty) * (fillPrice - avgEntry)
           oldQty := acc.qty
           acc.qty += closeQty
           if math.Abs(acc.qty) < 1e-9 {
               acc.qty = 0
               acc.costBasis = 0
           } else {
               acc.costBasis = acc.costBasis * acc.qty / oldQty
           }
           remainder := qty - closeQty
           if math.Abs(remainder) > 1e-9 {
               acc.qty += remainder
               acc.costBasis += remainder * fillPrice
           }
       }
   }
   ```

   Declare the `fillAccumulator` type at the bottom of the file alongside the other private types:
   ```go
   type fillAccumulator struct {
       qty       float64 // signed: positive = long, negative = short
       costBasis float64 // signed: qty × avg_entry_price
   }
   ```

3. **Pass 1** — query `order.filled` events, accumulate P&L and track completed order IDs:
   ```go
   var pageToken string
   for {
       resp, err := s.ledger.QueryEvents(ctx, &ledgerv1.QueryEventsRequest{
           EventType:     "order.filled",
           SourceService: "trading",
           Page:          &commonv1.PageRequest{PageSize: 500, PageToken: pageToken},
       })
       if err != nil {
           slog.Warn("GetPnL: QueryEvents (filled) failed", "error", err)
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
           if fill.UserID != req.UserId {
               continue
           }
           if req.TradingMode != commonv1.TradingMode_TRADING_MODE_UNSPECIFIED {
               fillMode := commonv1.TradingMode_TRADING_MODE_PAPER
               if fill.Mode == "TRADING_MODE_LIVE" {
                   fillMode = commonv1.TradingMode_TRADING_MODE_LIVE
               }
               if fillMode != req.TradingMode {
                   continue
               }
           }
           filledOrderIDs[fill.OrderID] = true
           applyFill(fill.Qty, fill.FillPrice, fill.Symbol)
       }
       if resp.GetPage().GetNextPageToken() == "" {
           break
       }
       pageToken = resp.GetPage().GetNextPageToken()
   }
   ```

4. **Pass 2** — query `order.partially_filled` events and collect the last event per order:
   ```go
   pageToken = ""
   for {
       resp, err := s.ledger.QueryEvents(ctx, &ledgerv1.QueryEventsRequest{
           EventType:     "order.partially_filled",
           SourceService: "trading",
           Page:          &commonv1.PageRequest{PageSize: 500, PageToken: pageToken},
       })
       if err != nil {
           slog.Warn("GetPnL: QueryEvents (partially_filled) failed", "error", err)
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
           if fill.UserID != req.UserId {
               continue
           }
           if req.TradingMode != commonv1.TradingMode_TRADING_MODE_UNSPECIFIED {
               fillMode := commonv1.TradingMode_TRADING_MODE_PAPER
               if fill.Mode == "TRADING_MODE_LIVE" {
                   fillMode = commonv1.TradingMode_TRADING_MODE_LIVE
               }
               if fillMode != req.TradingMode {
                   continue
               }
           }
           // Events arrive in recorded_at order; overwrite = keep last (highest cumulative FilledQty).
           latestPartials[fill.OrderID] = fill
       }
       if resp.GetPage().GetNextPageToken() == "" {
           break
       }
       pageToken = resp.GetPage().GetNextPageToken()
   }
   // Apply partial fills only for orders that never reached order.filled status.
   for orderID, fill := range latestPartials {
       if filledOrderIDs[orderID] {
           continue
       }
       applyFill(fill.FilledQty, fill.FillPrice, fill.Symbol)
   }
   ```

5. Return the updated response:
   ```go
   return &portfoliov1.PnLResponse{
       RealizedPnl:   realized,
       UnrealizedPnl: unrealized,
       TotalPnl:      realized + unrealized,
       Range:         req.Range,
   }, nil
   ```

**Import check**: `json`, `slog`, `ledgerv1`, `commonv1`, `portfoliov1` are already imported at L1–25. Verify whether `math` is present; if absent, add `"math"` to the import block (needed for `math.Abs` in `applyFill`).

**Verification**:
```bash
cd /home/user/xstockstrat-orchestration/services/xstockstrat-portfolio && GOWORK=off go build ./...
```
Build must succeed with zero errors.

---

### Step 5 — test: unit tests for GetPnL realized P&L computation

**Status**: `done`
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

Add a helper function and six test functions to `services/xstockstrat-portfolio/internal/service/portfolio_helpers_test.go`:

1. Add a `computeRealizedPnL(completeFills, partialFills []orderFillPayload) float64` helper that mirrors the two-pass algorithm added in Step 4. `completeFills` (from `order.filled`) are applied first using `fill.Qty`; `partialFills` (from `order.partially_filled`) are deduplicated by `OrderID` keeping the last per ID (slice order), and applied for order IDs not seen in `completeFills` using `fill.FilledQty`. Filter is omitted (all fills accepted) to keep the helper dependency-free.

2. Add `TestRealizedPnL_NoFills` — empty both slices → realized == 0.0.

3. Add `TestRealizedPnL_ClosedLong` — completeFills: buy +100@50 (OrderID "A"), sell −100@70 (OrderID "B"); no partialFills → realized == 100 × (70 − 50) = 2000.0.

4. Add `TestRealizedPnL_ClosedShort` — completeFills: sell −100@50 (OrderID "A", opening short), buy +100@40 (OrderID "B", closing short); no partialFills → realized == 100 × (50 − 40) = 1000.0.

5. Add `TestRealizedPnL_MultipleOrders` — completeFills: four independent order.filled events for the same symbol: buy +50@50 (OrderID "A"), buy +50@50 (OrderID "B"), sell −50@70 (OrderID "C"), sell −50@70 (OrderID "D"); no partialFills → realized == 2000.0. Verifies multiple independent order.filled events accumulate correctly.

6. Add `TestRealizedPnL_MixedOpenAndClosed` — completeFills: buy +100@50 (OrderID "A"), buy +50@60 (OrderID "B"), sell −80@75 (OrderID "C"); no partialFills:
   - After first buy: avg_cost = 50.00, qty = 100
   - After second buy: avg_cost = (5000 + 3000) / 150 = 53.333..., qty = 150
   - Sell 80 @ 75: realized = 80 × (75 − 53.333...) = 1733.333...
   - Verify realized within tolerance ±0.01.

7. Add `TestRealizedPnL_PartiallyFilledCanceled` — partialFills: buy +50@50 via `FilledQty` (OrderID "A", never completed); completeFills: sell −50@70 (OrderID "B"):
   - The partial buy 50@50 is NOT in completeFills so it is applied via Pass 2.
   - After complete sell −50@70: acc.qty = −50 (short), costBasis = −3500.
   - After partial buy +50@50 (opposite direction, closing short): avgEntry = 70, realized += (−50) × (50 − 70) = +1000.
   - Expected realized == 1000.0.
   - Note: Pass 1 (complete fills) is applied before Pass 2 (partial fills) regardless of chronological order. On **Alpaca** this produces correct results in all cases: Alpaca prohibits simultaneous long and short positions in the same security (any order that would create an opposite-side position while the other side is open is rejected with `position intent mismatch`), making the problematic interleaved scenario structurally impossible. On **IBKR**: standard and margin accounts use netting mode by default (opposing positions are automatically offset, a buy closes a short) — same guarantee holds. IBKR Hedged mode (available for portfolio-margin/institutional accounts, must be explicitly enabled) does allow simultaneous long+short lots and would break this assumption; the current `IBKRConfig` struct has no hedge-mode flag, so the integration is assumed to target standard netting-mode accounts.

**New logic lands in `internal/service/` which is excluded from CI coverage measurement** (confirmed by `grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)'` in the CI threshold command). No coverage threshold applies; integration test verification via build + run is sufficient.

**Verification**:
```bash
cd /home/user/xstockstrat-orchestration/services/xstockstrat-portfolio && GOWORK=off go test ./internal/service/... -v -run TestRealizedPnL
```
All six new test cases must pass. Additionally, confirm existing tests are not broken:
```bash
cd /home/user/xstockstrat-orchestration/services/xstockstrat-portfolio && GOWORK=off go test ./... -race -count=1
```
Zero failures.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
