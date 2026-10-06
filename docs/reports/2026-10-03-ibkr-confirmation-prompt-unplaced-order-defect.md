# Defect: IBKR order confirmation prompt is never answered, so the order is stored as submitted but never placed

**Recorded**: 2026-10-03
**Severity**: SEV-2
**Impact type**: order-silently-not-placed
**Environment**: production (main)
**Affected service(s)**: xstockstrat-trading
**Config-only fix possible**: no

## Observed

The IBKR Client Portal API can answer `POST /iserver/account/{id}/orders` with a confirmation prompt
(`[{"id": …, "message": [...]}]`) instead of an order reply. The order is not placed until the
client confirms via `POST /iserver/reply/{id}`.

`ibkr.go` `SubmitOrder` unmarshals the response into `{order_id, order_status}` only, and has no
`/iserver/reply` handling anywhere in the file (`ReplaceOrder` has the same gap). A prompt therefore
parses as an element with an empty `order_id`, and `SubmitOrder` returns a `BrokerOrder` with an
empty `BrokerOrderID` and no error.

The order is stored as submitted. The fill poller skips orders with an empty broker id, and so does
reconciliation, so the order is silently never placed and nothing notices.

Separately, `TRAIL` is mapped as an order type, but `trailingAmt` and `trailingType` are never sent.
IBKR rejects such an order, so that path fails safe.

## Expected

`SubmitOrder` answers a confirmation prompt (or fails the submission loudly), and never returns
success with an empty broker order id. Trailing stops send `trailingAmt` and `trailingType`.

## Reproduction

1. On an IBKR paper account, submit an order that triggers a precautionary prompt, for example a
   large notional or an order outside regular hours.
2. The response is a prompt array. Trading stores the order with `broker_order_id = ''`, and it never
   appears at the broker.

## Evidence

`services/xstockstrat-trading/internal/broker/ibkr.go:169-176`
> var replies []struct {
> 	OrderID     string `json:"order_id"`
> 	OrderStatus string `json:"order_status"`
> }
> ...
> return &BrokerOrder{BrokerOrderID: replies[0].OrderID, Status: replies[0].OrderStatus}, nil

`services/xstockstrat-trading/internal/service/trading.go:1623-1624`
> if o.BrokerOrderId == "" {
> 	continue

`services/xstockstrat-trading/internal/service/trading.go:1895`
> if o.AccountId == accountID && o.BrokerOrderId != "" {

## Root cause hypothesis

The adapter assumes the single-step reply shape. Fix: detect the prompt shape (`id` + `message`) and
confirm via `/iserver/reply/{id}` (or reject explicitly), and treat an empty `order_id` as an error.

## Confidence

high
