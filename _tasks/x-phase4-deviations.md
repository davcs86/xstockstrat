# Phase 4 Deviations & Implementation Notes

## Service: xstockstrat-trading

This document records decisions made during Phase 4 implementation that deviate from or clarify the spec.

---

## 4A — Dual In-Memory + DB Storage

**Spec**: `GetOrder` fetches from `trading.orders` table.

**Implementation**: An in-memory `orders` map is maintained alongside the DB hypertable. This follows the same pattern as the analysis service (Phase 3), which uses in-memory storage for active results.

- The in-memory map drives fan-out for `StreamOrderUpdates` subscribers and the fill poller.
- Every order state change is persisted to DB (`trading.orders`) via `repo.UpsertOrder`.
- `GetOrder` checks the in-memory map first, falls back to DB if not found (e.g., after restart).
- `ListOrders` queries the DB for persistent history; falls back to in-memory on DB error.

---

## 4B — Fill Detection via Polling

**Spec**: `StreamOrderUpdates` relays Alpaca order status stream.

**Implementation**: Fill detection uses a 5-second polling loop (`StartFillPoller`) that calls `broker.GetOrder()` for each in-flight order (status NEW or PARTIALLY_FILLED with a broker_order_id).

- On status change: updates in-memory + DB, broadcasts to subscribers, emits the appropriate ledger event and notify alert.
- Alpaca WebSocket push for broker order updates would be the production approach but adds complexity. Polling is sufficient for paper trading (fills complete within seconds).

---

## 4C — Non-Blocking Portfolio Risk Check

**Spec**: `PlaceOrder` validates via `GetPosition` (portfolio).

**Implementation**: `GetPortfolio` is called with a 2-second timeout before broker submission. On error (service unavailable, portfolio empty, timeout), a warning is logged and the order proceeds.

- This avoids a hard dependency: if portfolio is down, trading must not halt.
- Risk check validates `trading.risk.max_position_pct` (default 5%) against estimated order notional / portfolio equity.
- Only checked when both `limit_price > 0` (notional is estimable) and `user_id` is set.

---

## 4D — Approval Threshold Logic

**Spec**: `trading.approval.require_above_qty` and `trading.approval.require_above_notional` thresholds.

**Implementation**: Both thresholds checked using `GetFloat` (added to config.Watcher):
- `req.Qty > require_above_qty` OR
- `req.LimitPrice > 0 && req.Qty * req.LimitPrice > require_above_notional`

The original skeleton only checked qty (as int64 — a truncation bug). This is fixed to use float64 comparison.

---

## 4E — Ledger Event Sequence for an Order

Full event sequence for a normal (no-approval) order placement through fill:

1. `order.created` — order stored in memory + DB
2. `order.submitted` — intent to call broker (before HTTP request)
3. `order.broker_submitted` — Alpaca accepted the order
4. `order.filled` — fill poller detected fill (emitted ~5s after fill)

For approval-required orders:
1. `order.created`
2. `order.approval_requested` + notify warning alert
3. (waits for manual approval — not yet implemented as an RPC endpoint)

---

## 4F — Removed Duplicate File

`services/xstockstrat-trading/n8n/webhook.go` was an exact duplicate of `internal/handler/n8n.go` in a non-standard package directory. It was never imported by `main.go` and has been deleted.

---

## 4G — DB Migration: Added Missing Columns

`migrations/001_orders_hypertable.sql` was missing two columns used by the service code:
- `broker_order_id TEXT` — Alpaca-assigned broker order ID
- `trading_mode TEXT NOT NULL DEFAULT 'paper'` — PAPER or LIVE routing

These were added to the `CREATE TABLE` block.

---

## Verification Checkpoint 4 Status

| Test | Status | Notes |
|---|---|---|
| PlaceOrder → returns order with order_id | ✅ | Works, status=NEW or PENDING_APPROVAL |
| Ledger events: order.created + order.submitted | ✅ | Both emitted on PlaceOrder |
| Portfolio updated on fill | ✅ | order.filled event triggers portfolio ConsumeOrderFills |
| Notify alert on trade fill | ✅ | emitFillAlert sends category="trade" INFO alert |
| StreamOrderUpdates subscription | ✅ | Snapshot + live fan-out |
| Maintenance mode rejection | ✅ | Checks platform.maintenance_mode config key |
