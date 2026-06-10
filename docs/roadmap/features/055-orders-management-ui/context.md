# Context: orders-management-ui

**Feature**: `docs/roadmap/features/055-orders-management-ui/feature.md`
**Product Spec**: `docs/roadmap/features/055-orders-management-ui/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/055-orders-management-ui/implementation-spec.md`

---

## Session 2026-06-10 — backlog capture

- Created feature.md at `idea` status as a backlog entry.

## Session 2026-06-10 — sdd-story

- Upgraded feature.md `idea` → `draft`; wrote product-spec.md and this context log.
- Codebase grounding (not invented — found via grep):
  - `packages/proto/trading/v1/trading.proto` `TradingService` already has `PlaceOrder`,
    `CancelOrder`, `GetOrder`, `ListOrders` (paginated via `PageRequest`/`PageResponse`,
    filters: `status`, `range`, `strategy_id`, `trading_mode`), `StreamOrderUpdates`.
  - **No `ReplaceOrder`/`UpdateOrder` RPC exists** → "edit" requires a new additive RPC.
  - `ListOrdersRequest` lacks symbol/side/order_type filters → additive fields needed.
  - UI has `trader/orders/[id]/page.tsx` (detail) but **no `trader/orders/page.tsx`**
    list/create page.
  - Trading already persists orders (phase4-deviations: dual in-memory+DB) → no migration.
- Decision: keep all proto changes additive (no breaking change, single-owner gate).

## Session 2026-06-10 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Open questions resolved (user decisions):
  - Replace/edit broker scope → **Alpaca + IBKR** (broker-agnostic proto, route by
    `broker_type`; per-broker replaceable-field matrix deferred to /sdd-spec).
  - Create form order types → **all five** (MARKET/LIMIT/STOP/STOP_LIMIT/TRAILING_STOP).
  - Live updates → **StreamOrderUpdates** (BFF-bridged), not polling.
  - Filters → **server-side**; add additive `account_id` filter field too.
- Trading-domain gaps closed in spec: C-4 (enumerate 5 order types), C-2 (state Alpaca+IBKR
  broker scope), C-5 (explicit PARTIALLY_FILLED vs FILLED handling → new FR-8), C-3
  (paper-safe statement in FR-7).
- Overlap: `002-broker-accounts-ui` (launched) also touches `trading.proto` — coordination
  note only, no live conflict.
- Warnings: none blocking.

## Next action

`/sdd-spec orders-management-ui`.
