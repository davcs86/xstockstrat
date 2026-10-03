# Defect: Reconciliation classifies Alpaca bracket legs as unknown broker orders and halts the account

**Recorded**: 2026-10-03
**Severity**: SEV-1
**Impact type**: false-account-halt
**Environment**: production (main)
**Affected service(s)**: xstockstrat-trading
**Config-only fix possible**: no

## Observed

The Alpaca adapter lists orders with `GET /v2/orders?status=all&limit=500` and does not pass
`nested=true`. Without `nested=true`, Alpaca returns the stop-loss and take-profit legs of a bracket
as top-level orders, each with its own broker order id.

Broker-state reconciliation checks each listed id against `KnownBrokerOrderIDs`, which reads only
`trading.orders`. Leg ids are stored in `trading.order_brackets` (`stop_leg_order_id`,
`take_profit_leg_order_id`), so every live leg is classified `unknown_broker_order`. Once the grace
ticks pass, `emitReconciliationFinding` halts the account (`HALT_SOURCE_RECONCILIATION`).

Production runs with brackets ON (config migration `029`, feature 189). Any account with an active
Alpaca bracket is therefore exposed to a false halt, which blocks new orders on that account.

## Expected

Reconciliation recognizes bracket legs as known orders. Either list with `nested=true` and walk
`legs`, or have `KnownBrokerOrderIDs` also match `trading.order_brackets` leg ids.

## Reproduction

1. On an Alpaca account (paper is sufficient), place an auto-sized entry so that a bracket is
   created and the legs reach `ACTIVE`.
2. Let `reconcileTick` run past `graceTicks`.
3. A `reconciliation` finding of class `unknown_broker_order` is emitted for a leg id, and the account
   is halted.

## Evidence

`services/xstockstrat-trading/internal/broker/alpaca.go:351`
> endpoint := fmt.Sprintf("%s/v2/orders?status=all&limit=500", c.baseURL())

`services/xstockstrat-trading/internal/repository/trading_repo.go:131-135`
> SELECT DISTINCT broker_order_id
> FROM trading.orders
> WHERE account_id = $1
>   AND broker_order_id = ANY($2)

`services/xstockstrat-trading/migrations/005_broker_accounts_halted.up.sql:20-21`
> stop_leg_order_id TEXT
> take_profit_leg_order_id TEXT

`services/xstockstrat-trading/internal/service/trading.go:1955`
> s.emitReconciliationFinding(ctx, accountID, mismatchClassUnknownBrokerOrder, boID, 0, brokerByID[boID].FilledQty)

`services/xstockstrat-trading/internal/service/trading.go:1828`
> s.haltAccount(ctx, accountID, fmt.Sprintf("%s: %s", mismatchClass, orderID), int32(tradingv1.HaltSource_HALT_SOURCE_RECONCILIATION))

## Root cause hypothesis

Reconciliation was built against `trading.orders` only, and the leg ids that the bracket feature
introduced live in a separate table. This went unnoticed because production brackets stayed off
until migration `029`.

## Confidence

high
