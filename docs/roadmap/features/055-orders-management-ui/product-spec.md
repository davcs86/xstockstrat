# Product Spec: orders-management-ui

**Created**: 2026-06-10

---

## Problem Statement

Traders can view an individual order detail page (`trader/orders/[id]`) but there is no
consolidated UI to place a new order, modify a working order, cancel an order, or browse
order history with filters. Order management today requires the agent/API or the broker
console, which is opaque and error-prone for human operators.

## User Story

As a trader, I want a dedicated Orders page where I can create, edit, and cancel orders and
browse my full order history with filters, so that I can manage execution without leaving
the platform or reaching for raw API calls.

## Functional Requirements

FR-1. **Order list** — Paginated table of orders for the selected account/trading mode,
  using `TradingService.ListOrders` (existing `PageRequest`/`PageResponse`). Default sort
  by `created_at` descending.
FR-2. **Filters** — Filter the list by symbol, side (buy/sell), order type, status, date
  range, and account/broker. `ListOrders` already supports `status`, `range`, `strategy_id`,
  and `trading_mode`; **symbol, side, and order_type filters require additive fields** on
  `ListOrdersRequest`.
FR-3. **Create order** — Form to place an order (symbol, side, type, qty, limit/stop price,
  time-in-force, account) via `TradingService.PlaceOrder`. Respect the `requires_approval`
  path and surface `ORDER_STATUS_PENDING_APPROVAL`.
FR-4. **Edit (replace) order** — Modify a working order's qty / limit price / stop price /
  TIF for orders in a replaceable state (`NEW`, `PARTIALLY_FILLED`). No replace RPC exists
  today → **requires a new additive `ReplaceOrder` RPC** on `TradingService` (maps to
  Alpaca's PATCH /orders/{id} replace).
FR-5. **Cancel order** — Cancel an open order via `TradingService.CancelOrder`, with a
  confirmation step and optimistic status update.
FR-6. **Live status** — Reflect order status transitions (optionally via
  `StreamOrderUpdates`, or polling consistent with the existing positions page 10s refresh).
FR-7. **Mode / account scoping** — All reads and writes honor the selected trading mode
  (paper/live) and account, consistent with the existing trader segment.

## Out of Scope

- Bracket / OCO / multi-leg orders (tracked separately, cf. `030-stop-loss-bracket-orders`).
- Options orders (cf. `034-options-trading-support`).
- Changes to the order approval threshold logic itself (only surfacing approval state).
- Backend changes to fill detection or broker routing beyond exposing replace.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-ui` — new `trader/orders` list/create page + edit/cancel actions; BFF
  connect-web route to trading.
- `xstockstrat-trading` — new `ReplaceOrder` RPC handler + Alpaca replace call; additive
  `ListOrders` filter fields.
- `packages/proto` — `ReplaceOrder` RPC + `ReplaceOrderRequest`/response; new filter fields
  on `ListOrdersRequest`.

## Proto Contract Changes

- [ ] ~~No proto changes required~~
- **`trading/v1/trading.proto`** (additive, non-breaking):
  - New RPC `ReplaceOrder(ReplaceOrderRequest) returns (Order)`.
  - New message `ReplaceOrderRequest` (order_id, optional qty/limit_price/stop_price/TIF,
    user_id).
  - New filter fields on `ListOrdersRequest`: `string symbol`, `OrderSide side`,
    `OrderType order_type` (next free field numbers ≥ 7).
- Run `./scripts/buf-gen.sh`; `buf breaking` must stay green (additive only).

## Config Key Changes

- [x] No new config keys.

## Database Changes

- [x] No schema changes — `xstockstrat-trading` already persists orders (dual in-memory+DB,
  per phase4-deviations). Replace updates an existing row; no new table.

## Feature Workflow Notes

Branch to create: `feature/orders-management-ui` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto + UI/service change) — Proto Reviewer +
  `xstockstrat-trading` owner + `xstockstrat-ui` owner
- [ ] 2 service owners + platform lead (breaking proto change) — N/A (additive only)
- [ ] DBA review + service owner (schema migration) — N/A

## Acceptance Criteria

1. `trader/orders` renders a paginated order list with working symbol/side/type/status/
   date-range/account filters.
2. A trader can place a market and a limit order from the UI and see it appear in the list.
3. A trader can replace a working limit order's price/qty and see the updated values.
4. A trader can cancel an open order and see it transition to `CANCELED`.
5. Orders pending approval are clearly surfaced as `PENDING_APPROVAL`.
6. `buf lint` and `buf breaking` pass; all changes are additive.
7. All actions scope correctly to the selected trading mode and account.

## Open Questions

- [ ] Confirm Alpaca replace semantics the trading service should support (which fields are
  replaceable for paper vs live) and how partial fills interact with replace.
- [ ] Live updates: adopt `StreamOrderUpdates` for the list, or reuse the positions page's
  polling pattern for consistency?
- [ ] Should the symbol/side/type filters be applied server-side (new proto fields) or
  client-side over a page? (Spec assumes server-side for correctness with pagination.)
- [ ] Account/broker filter — does `ListOrders` need an `account_id` filter field too
  (relates to `002-broker-accounts-ui`)?
