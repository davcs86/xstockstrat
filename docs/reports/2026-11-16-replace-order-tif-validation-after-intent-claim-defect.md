# Defect: ReplaceOrder validates time-in-force after claiming its intent

**Recorded**: 2026-11-16
**Severity**: SEV-3
**Impact type**: order-intent-stranded
**Environment**: dev (main-dev)
**Affected service(s)**: xstockstrat-trading
**Config-only fix possible**: no

## Observed

`ReplaceOrder` inserts its dedup intent and marks the order's intent state PENDING before it validates
the requested time-in-force. When `validateTIF` rejects the request, the handler returns
`InvalidArgument` without finalizing or releasing the intent. No broker call was made, but:

- the intent row stays PENDING and the order's in-memory `IntentState` stays PENDING;
- an identical replace is refused with `FailedPrecondition` "replace on order … is still pending";
- once the staleness threshold passes, the sweeper (or the next identical request) reclaims the row to
  UNKNOWN and emits `order_intent.reclaimed_unknown` for a request that never reached the broker;
- from then on the identical replace is refused with "replace intent for order … outcome is unknown;
  verify with the broker before retrying", permanently: the UNKNOWN resolver matches intents by a
  derived client order id, which a replace never carries.

## Expected

A time-in-force the broker does not allow is rejected before any intent is claimed, as `PlaceOrder`
does, so the request leaves no intent row, no PENDING mark on the order and no reclaim event, and the
caller can correct the request and retry freely.

## Reproduction

1. Have a NEW order on an IBKR account (IBKR allows neither OPG nor CLS).
2. Call `ReplaceOrder` for it with `time_in_force` OPG.
3. Observe `InvalidArgument`, and that the order now shows intent state PENDING.
4. Send the identical `ReplaceOrder` again: `FailedPrecondition` "still pending".
5. Wait past the staleness threshold (30 s at defaults) and send it again: the intent is reclaimed to
   UNKNOWN, `order_intent.reclaimed_unknown` is emitted, and every later identical request is refused
   with "outcome is unknown".

## Evidence

`services/xstockstrat-trading/internal/service/trading.go:1531`
> ok2, err := s.orderIntentRepo.InsertIntent(ctx, &repository.OrderIntentRecord{

`services/xstockstrat-trading/internal/service/trading.go:1565`
> order = s.updateOrder(order, func(o *tradingv1.Order) { o.IntentState = tradingv1.IntentState_INTENT_STATE_PENDING })

`services/xstockstrat-trading/internal/service/trading.go:1575`
> if err := validateTIF(*req.TimeInForce, commonv1.BrokerType(entry.brokerType)); err != nil {
> 	return nil, err

`services/xstockstrat-trading/internal/service/order_intent.go:82`
> case repository.IntentStateUnknown:
> 	return intentActionRejectUnknown, false

`services/xstockstrat-trading/internal/service/trading.go:2358`
> bo, found := byClientOrderID[broker.DeriveBrokerClientOrderID(intent.IntentID)]

`docs/roadmap/ledger/fails.md` (2026-10-07, order-time-in-force-enum — assumption)
> `ReplaceOrder` validates TIF after claiming the intent … returning `InvalidArgument` with no `FinalizeIntent` or revert.

`services/xstockstrat-trading/docs/context-constitution.md:21` (TRADING-7)
> Time-in-force is validated per broker BEFORE any broker call … `ReplaceOrder` only when a TIF is supplied

## Root cause hypothesis

The TIF check was added to `ReplaceOrder` (feature 202) after the dedup claim instead of before it;
moving `validateTIF` ahead of `deriveReplaceCancelIntentID`/`InsertIntent` removes the stranded intent.
No handler-level test covers the gate's position.

## Confidence

high
