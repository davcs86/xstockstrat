# IBKR Broker Notes

> On-demand detail relocated from `CLAUDE.md` (context-forge just-in-time move). Load when working on `internal/broker/ibkr.go` or IBKR P&L.

### IBKR: Hedged Mode not supported

The IBKR integration (`internal/broker/ibkr.go`) assumes the account uses **netting mode** (the default for standard and margin accounts), where a buy order automatically offsets an open short position in the same security. IBKR also offers **Hedged Mode** (available to portfolio-margin and institutional accounts), which allows simultaneous long and short lots in the same security without automatic netting.

If an IBKR account is configured for Hedged Mode:

1. `pollFills` may emit `order.filled` events for both a buy and a sell in the same security that coexist rather than net — the fill payloads will be structurally valid but represent distinct lots.
2. `xstockstrat-portfolio`'s `GetPnL` two-pass algorithm (feature `013-phase-2-data-layer`) applies all `order.filled` events before all `order.partially_filled` events regardless of chronological order. In netting-mode accounts this produces correct P&L because opposing positions cannot coexist; in Hedged Mode the ordering may produce incorrect cost-basis calculations for interleaved fills.

**To add Hedged Mode support**: add an `IsHedged bool` field to `IBKRConfig`, propagate it to `BrokerOrder` or a separate signal, and update `GetPnL` in `xstockstrat-portfolio` to merge and sort both event types by `recorded_at` before feeding the accumulator.

Alpaca is unaffected: Alpaca prohibits simultaneous long and short positions in the same security at the API level (returns `position intent mismatch` if attempted).

### IBKR: order confirmation prompts are auto-confirmed (bounded)

The Client Portal API can answer an order POST (`SubmitOrder`, `ReplaceOrder`, `SubmitBracketLegs`) with a precautionary prompt (`[{"id", "message"}]`) instead of an order reply. The order is not placed until `POST /iserver/reply/{id}` confirms it, and IBKR may chain one prompt per warning. `resolveIBKROrderReplies` **auto-confirms** each prompt with `{"confirmed":true}` (operator decision, 2026-10-05) and logs every confirmed message at WARN (`ibkr: auto-confirming order prompt`) for audit. After `ibkrMaxConfirmRounds` (5) it stops and returns `broker.ErrIBKRConfirmationRequired`, so the order is recorded `REJECTED`. A transport error on a reply is returned wrapped, so a timeout stays an *uncertain* outcome (the confirmation may have placed the order) and is reclaimed like any other. Any final reply element with an empty `order_id` is an error. No order is ever stored as submitted with an empty broker id.

Trailing stops (`trailing_stop` → `TRAIL`) send `trailingAmt` with `trailingType` `amt` (from `trail_price`) or `%` (from `trail_percent`). `ReplaceOrder` does not map `trail` for IBKR.
