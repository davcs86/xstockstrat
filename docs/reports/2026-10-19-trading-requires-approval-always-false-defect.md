# Defect: trading.orders.requires_approval is always persisted false

**Recorded**: 2026-10-19
**Severity**: SEV-3
**Impact type**: audit-trail-loss
**Environment**: dev (main-dev) @ 1302e6d
**Affected service(s)**: xstockstrat-trading
**Config-only fix possible**: no
**Source**: `services/xstockstrat-trading/docs/context-constitution-findings.md` § Latent bugs, row 2

## Observed
`UpsertOrder` binds a literal `false` to the `requires_approval` column for every order, including
orders that `submitOrder` routes to `ORDER_STATUS_PENDING_APPROVAL`. No code writes the
`approved_by` / `approved_at` columns from migration 001. The persisted approval audit trail is
therefore never written.

## Expected
`requires_approval` reflects whether the order crossed the approval thresholds
(`trading.approval.require_above_qty` / `require_above_notional`).

## Reproduction
1. Place an order with qty above `trading.approval.require_above_qty` (default 500).
2. Confirm the response status is `ORDER_STATUS_PENDING_APPROVAL`.
3. `SELECT requires_approval FROM trading.orders WHERE order_id = '<id>'` returns `false`.

## Evidence
`services/xstockstrat-trading/internal/repository/trading_repo.go:68`
> requires_approval, created_at, updated_at,

`services/xstockstrat-trading/internal/repository/trading_repo.go:92`
> false, createdAt, updatedAt,

`services/xstockstrat-trading/internal/service/trading.go:566`
> orderStatus = tradingv1.OrderStatus_ORDER_STATUS_PENDING_APPROVAL

`services/xstockstrat-trading/migrations/001_orders_hypertable.up.sql:24`
> requires_approval   BOOLEAN     NOT NULL DEFAULT FALSE,

## Root cause hypothesis
`submitOrder` receives `requiresApproval bool`, but the value never reaches the persisted order.
The repository has no source for it and hardcodes `false`.

## Confidence
high
