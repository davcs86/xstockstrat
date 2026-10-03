# Defect: Trading mutates shared order pointers after releasing the order-map lock

**Recorded**: 2026-10-03
**Severity**: SEV-2
**Impact type**: data-race
**Environment**: production (main)
**Affected service(s)**: xstockstrat-trading
**Config-only fix possible**: no

## Observed

`TradingService.orders` is a `map[string]*tradingv1.Order` guarded by `s.mu`. The readers that take
the lock (`pollFills`, `reconcileTick`, `ListOrders`) collect the `*Order` pointers and release it.
The writers look up the same pointer under the lock, release it, and then mutate the shared struct
with no lock held:

- **`pollFills` → `applyBrokerOrderStatus`:** collects candidates under the lock, unlocks, then
  writes `Status`, `FilledQty`, `FilledAvgPrice` and `UpdatedAt`.
- **`CancelOrder`:** looks up the order under the lock, unlocks, then writes `Status` and
  `UpdatedAt`.
- **`ReplaceOrder`:** looks up the order under the lock, unlocks, then writes `Qty` and the prices.
- **`PlaceOrder`:** stores the order under the lock, unlocks, then writes `BrokerOrderId`.

Any of these can run concurrently with another writer or a locked reader. In particular, a cancel can
race the fill poller on the same order, and the last writer wins on `Status`. The race detector
reported this race (`WARNING: DATA RACE … pollFills()`) during the 2026-10-02 needs-confirmation pass
(`docs/repo-surveyor/debt-radar-findings.md`, NC-5).

## Expected

Every read and write of an order reachable from `s.orders` happens under `s.mu`. Alternatively,
writers clone the order, mutate the copy, and swap it into the map under the lock.

## Reproduction

1. Write a test that runs `CancelOrder` and `pollFills` concurrently on the same open order.
2. Run `cd services/xstockstrat-trading && GOWORK=off go test -race ./internal/service/...`.
3. The race detector reports a write in `applyBrokerOrderStatus` racing a read under `s.mu`.

## Evidence

`services/xstockstrat-trading/internal/service/trading.go:1620-1634`
> s.mu.Lock()
> candidates := make([]*tradingv1.Order, 0)
> ...
> s.mu.Unlock()

`services/xstockstrat-trading/internal/service/trading.go:1679-1682`
> order.Status = newStatus
> order.UpdatedAt = timestamppb.New(time.Now())
> order.FilledAvgPrice = brokerOrder.FilledAvgPrice
> order.FilledQty = brokerOrder.FilledQty

`services/xstockstrat-trading/internal/service/trading.go:1143-1145`
> s.mu.Lock()
> order, ok := s.orders[req.OrderId]
> s.mu.Unlock()

`services/xstockstrat-trading/internal/service/trading.go:1260`
> order.Status = tradingv1.OrderStatus_ORDER_STATUS_CANCELED

## Root cause hypothesis

`s.mu` was written to protect the map but not the structs it points to. Fix: copy-on-write under the
lock, or a per-order mutex. Add the concurrent cancel-plus-poll test to CI under `-race`.

## Confidence

high
