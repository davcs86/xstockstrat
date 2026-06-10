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
  and `trading_mode`; **symbol, side, order_type, and account_id filters require additive
  fields** on `ListOrdersRequest`. Filtering is applied **server-side** so it composes
  correctly with pagination.
FR-3. **Create order** — Form to place an order (symbol, side, type, qty, limit/stop price,
  time-in-force, account) via `TradingService.PlaceOrder`. The create form supports **all
  five `OrderType` values**: `MARKET`, `LIMIT`, `STOP`, `STOP_LIMIT`, `TRAILING_STOP`, with
  the price fields (`limit_price`/`stop_price`) shown/required per type. Respect the
  `requires_approval` path and surface `ORDER_STATUS_PENDING_APPROVAL`.
FR-4. **Edit (replace) order** — Modify a working order's qty / limit price / stop price /
  TIF for orders in a replaceable state (`ORDER_STATUS_NEW`, `ORDER_STATUS_PARTIALLY_FILLED`).
  No replace RPC exists today → **requires a new additive `ReplaceOrder` RPC** on
  `TradingService`. Replace is supported for **both broker types** (`BROKER_TYPE_ALPACA` and
  `BROKER_TYPE_IBKR`); the service routes per the order's `broker_type`. Alpaca maps to PATCH
  /orders/{id}; IBKR replace semantics differ and are handled in the broker-specific adapter
  (the proto surface is broker-agnostic).
FR-5. **Cancel order** — Cancel an open order via `TradingService.CancelOrder`, with a
  confirmation step and optimistic status update.
FR-6. **Live status** — Reflect order status transitions in the list via the existing
  `TradingService.StreamOrderUpdates` server-streaming RPC (push updates), filtered by the
  selected user/account. The BFF bridges the gRPC stream to the browser (SSE/long-lived
  fetch) consistent with the trader segment's Connect-RPC call chain.
FR-7. **Mode / account scoping** — All reads and writes honor the selected trading mode
  (paper/live) and account, consistent with the existing trader segment. The feature is
  **paper-safe**: all create/replace/cancel paths are exercisable under `TRADING_MODE=paper`
  in compose/dev without live-market access (replace/cancel hit the Alpaca paper endpoint).
FR-8. **Fill-state handling** — Replace and cancel correctly handle both
  `ORDER_STATUS_PARTIALLY_FILLED` (replace adjusts the remaining qty; cancel cancels the
  unfilled remainder) and `ORDER_STATUS_FILLED` (terminal — replace/cancel disabled in the
  UI). Existing fill-detection behavior in `xstockstrat-trading` is unchanged.

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
    user_id). Broker-agnostic — the service routes by the order's `broker_type`.
  - New filter fields on `ListOrdersRequest`: `string symbol`, `OrderSide side`,
    `OrderType order_type`, `string account_id` (next free field numbers ≥ 7).
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
   date-range/account filters (server-side).
2. A trader can place an order of **each** of the five order types (MARKET, LIMIT, STOP,
   STOP_LIMIT, TRAILING_STOP) from the UI and see it appear in the list.
3. A trader can replace a working limit order's price/qty for an **Alpaca** account and an
   **IBKR** account and see the updated values.
4. Replacing a `PARTIALLY_FILLED` order adjusts the remaining qty; a `FILLED` order shows
   replace/cancel disabled.
5. A trader can cancel an open order and see it transition to `CANCELED` (via the live
   `StreamOrderUpdates` feed, no manual refresh).
6. Orders pending approval are clearly surfaced as `PENDING_APPROVAL`.
7. `buf lint` and `buf breaking` pass; all changes are additive.
8. All actions are exercisable under `TRADING_MODE=paper` and scope correctly to the
   selected trading mode and account.

## Open Questions

_All resolved during /sdd-review 2026-06-10:_

- [x] **Replace broker scope** → **Alpaca + IBKR** (resolved). Proto surface is
  broker-agnostic; the trading service routes by `broker_type`. Alpaca uses PATCH; IBKR
  replace handled in its adapter. Per-broker replace-field support to be confirmed against
  each adapter in /sdd-spec.
- [x] **Order types** → **all five** `OrderType` values supported in the create form
  (resolved). Price-field visibility/validation is per type.
- [x] **Live updates** → **`StreamOrderUpdates`** server-streaming RPC, bridged by the BFF
  (resolved).
- [x] **Filter placement** → **server-side** via additive `ListOrdersRequest` fields
  (resolved).
- [x] **Account/broker filter** → add an additive `account_id` filter field to
  `ListOrdersRequest` (resolved; complements `002-broker-accounts-ui`).

_Deferred to /sdd-spec (implementation detail, not a product blocker):_

- Exact per-broker replaceable-field matrix (Alpaca vs IBKR adapter capabilities).
