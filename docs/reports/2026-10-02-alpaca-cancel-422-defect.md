# Defect: Alpaca cancel 422 (already filled) recorded as CANCELED, fill lost

**Recorded**: 2026-10-02
**Severity**: SEV-1
**Impact type**: lost-fill
**Environment**: production (main)
**Affected service(s)**: xstockstrat-trading
**Config-only fix possible**: no

## Observed

The Alpaca adapter treats HTTP 422 on `DELETE /v2/orders/{id}` ("already filled/canceled") as a
successful cancel and returns nil. `CancelOrder` then unconditionally sets
`ORDER_STATUS_CANCELED` with intent COMPLETED. When the order had actually filled at the broker,
`pollFills` skips it as terminal, `order.filled` is never emitted, portfolio never books the fill,
and broker-state reconciliation later finds an unexplained position.

## Expected

A 422 on cancel is "terminal at broker, state unknown locally": the service re-reads the order
from the broker (`GetOrder`) and adopts the broker's status — FILLED/PARTIALLY_FILLED emit the fill
events as `pollFills` would; only a broker-confirmed CANCELED is recorded as CANCELED.

## Reproduction

1. Place a market/marketable-limit order; it fills at Alpaca.
2. Before the next fill-poll tick, call CancelOrder for it.
3. Alpaca answers 422; the order is persisted CANCELED; no `order.filled`; the position is missing
   from portfolio.

## Evidence

`services/xstockstrat-trading/internal/broker/alpaca.go:223-224`
> // 204 No Content is success; 422 means already filled/canceled
> if resp.StatusCode != http.StatusNoContent && resp.StatusCode != http.StatusUnprocessableEntity {

`services/xstockstrat-trading/internal/service/trading.go:1256`
> order.Status = tradingv1.OrderStatus_ORDER_STATUS_CANCELED

## Root cause hypothesis

The adapter collapses two distinct broker outcomes (canceled vs already-terminal) into success, and
the service has no reconcile-on-ambiguity step. Fix: return a sentinel for 422, then re-fetch and
adopt the broker status.

## Confidence

high
