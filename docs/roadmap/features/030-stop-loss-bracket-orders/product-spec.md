# Product Spec: stop-loss-bracket-orders

**Created**: 2026-05-26

---

## Problem Statement

The position sizing engine (feature 023) computes a stop price for every sized order but does not submit that stop to the broker. Open positions are therefore exposed to unlimited downside if the platform goes offline, the agent scheduler misses a signal, or market hours end unexpectedly. The platform cannot be safely left unattended with real capital until stop orders are live at the broker.

## User Story

As a trader, I want the platform to automatically place a stop-loss bracket order at the broker when it opens a position so that my downside is hard-limited even if the platform is offline or I am unavailable.

## Functional Requirements

FR-1. When the trading service successfully opens a position (fill confirmed), it must immediately submit a corresponding stop-loss order at the stop price computed by `ComputePositionSize` (feature 023). This FR states the single-fill happy path; partial-fill reconciliation (a partial fill, then further fills arriving after the stop is already submitted) is a named design question — see Open Questions — not silently unhandled.
FR-2. If `trading.risk.take_profit_rr_multiple` is configured (> 0), a take-profit limit order is also submitted at `entry_price + (entry_price - stop_price) × rr_multiple`.
FR-3. For IBKR: submit stop-loss and take-profit as an OCA (One-Cancels-All) group so that a fill of either leg cancels the other.
FR-4. For Alpaca: use the native bracket order fields (`stop_loss.stop_price`, `take_profit.limit_price`) on the original order submission to avoid a separate API call.
FR-5. Bracket order IDs must be stored alongside the position record so that they can be cancelled if the position is closed via a signal before either bracket triggers.
FR-6. If bracket order submission fails after the entry fill, the trading service must emit a CRITICAL alert via the notify service and log the position ID and intended stop price — the human must be notified immediately.
FR-7. When `trading.risk.bracket_orders_enabled = false`, no bracket orders are submitted (default: true in prod, configurable for testing).
FR-8. Bracket orders are submitted in paper trading mode identically to live — Alpaca paper supports bracket orders natively.

## Out of Scope

- Trailing stop orders (fixed stop price only in V1)
- Dynamic stop adjustment as the position moves in profit (breakeven stop — V2)
- Existing `OrderType` handling for the *entry* order (MARKET/LIMIT/STOP_LIMIT) is unaffected by this
  feature — it only adds a stop-loss/take-profit *bracket* on top of however the entry order was
  placed (`packages/proto/trading/v1/trading.proto:61-68`)
- Bracket orders for manually submitted orders (only auto-sized orders via feature 023 in V1)

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-trading` — bracket order submission logic, OCA group management, position record update
- `xstockstrat-notify` — CRITICAL alert path if bracket submission fails
- `xstockstrat-portfolio` — position record must store bracket order IDs for cancellation
- `xstockstrat-ui` — the CRITICAL bracket-failure alert (FR-6) and the new bracket order IDs surface in
  the trader UI (see Consumer Surface(s))
- `xstockstrat-config` — new config keys for bracket-order parameters (`trading.risk.*`, see Config Key Changes)

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **UI** — two surfaces: (1) the CRITICAL alert on bracket-submission failure (FR-6) is delivered
  via the existing `xstockstrat-notify` → `xstockstrat-ui` alert stream, already rendered by
  `services/xstockstrat-ui/src/components/trader/AlertStream.tsx` — no new alert-delivery surface, just
  a new alert reason code flowing through the existing one. (2) `stop_order_id`/`take_profit_order_id`
  (new `Position` fields, see Proto Contract Changes) should be visible on the position detail view so
  a trader can confirm a position is protected — reconcile with the pre-existing, ledger-derived
  `Position.stop_price` field (`packages/proto/portfolio/v1/portfolio.proto:68`, feature 083) at
  `/sdd-design` (see the reconciliation note under Proto Contract Changes).
- [ ] **Agent** — no order-placement or position-management tool exists today
  (`services/xstockstrat-agent/app/tools.py`); N/A until one is added.
- [ ] **None**

## Proto Contract Changes

- `Position` message in portfolio proto: add `stop_order_id` and `take_profit_order_id` fields (optional; non-breaking)
- No new RPCs required
- `trading` proto (`packages/proto/trading/v1/trading.proto`) has no bracket-order fields today (no
  `stop_loss`/`take_profit` sub-message, no OCA-group-id field) — FR-3 (IBKR OCA group) and FR-4
  (Alpaca native bracket fields) need one. Named design question for `/sdd-design`, not resolved here.
- **Reconciliation needed (C-10, named design question):** `Position.stop_price`
  (`packages/proto/portfolio/v1/portfolio.proto:68`) already exists — populated from `xstockstrat-trading`'s
  order events via the ledger (in-memory, rebuilt on boot-replay), not a synchronous read of the actual
  broker-side stop order. This feature's `stop_order_id`/`take_profit_order_id` are a second,
  independently-sourced notion of "the position's stop" (a persisted DB column pointing at the real
  broker order) on the same message. `/sdd-design` must state how these two coexist — e.g. does
  `stop_price` become derived from the bracket order once one exists, or do they remain deliberately
  distinct (ledger-derived estimate vs. broker-confirmed order)?

## Config Key Changes

- `trading.risk.bracket_orders_enabled` — boolean (default: true)
- `trading.risk.take_profit_rr_multiple` — float; reward-to-risk ratio for take-profit (default: 2.0; set to 0 to disable take-profit leg)

## Database Changes

- Portfolio service positions table: add `stop_order_id` and `take_profit_order_id` columns (nullable; additive migration)

## Feature Workflow Notes

Branch to create: `feature/stop-loss-bracket-orders` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (trading + portfolio service modification)
- [ ] 2 service owners + platform lead (breaking proto change) — not applicable (additive fields)
- [x] DBA review + service owner (schema migration) — additive columns on positions table

## Acceptance Criteria

1. Opening a paper position triggers a bracket order visible in the Alpaca paper dashboard with the correct stop and take-profit prices.
2. The take-profit leg cancels the stop-loss leg (and vice versa) when one triggers on Alpaca paper.
3. IBKR: stop-loss and take-profit appear as an OCA group in the IBKR TWS paper account.
4. If bracket submission is intentionally failed (mocked), a CRITICAL alert is delivered via the notify service within 5 seconds.
5. Closing a position via signal before bracket triggers successfully cancels both bracket legs at the broker.
6. Setting `bracket_orders_enabled = false` via config (no restart) prevents bracket submission on the next order.

## Open Questions

- [ ] IBKR bracket orders require the child orders to reference the parent order ID — confirm the IBKR Go client library supports OCA group submission in the current trading service implementation. **Decide at `/sdd-design`.**
- [ ] Should bracket order cancellation on signal-driven close be best-effort (log failure, don't block close) or blocking? Best-effort preferred to avoid close-path latency, but this is a real race with a stop order also trying to sell the same position — needs an explicit decision, not two independent, uncoordinated API calls. **Decide at `/sdd-design`** (treat as a cancel-and-replace state machine, not ad hoc calls).
- [ ] How does FR-1's stop submission reconcile with a partial fill followed by further fills (stop quantity must track filled quantity, not just the first fill event)? Flagged as a real safety gap in `context.md` (2026-08-04 session), not a nice-to-have. **Decide at `/sdd-design`.**
- [ ] Should the new `stop_order_id`/`take_profit_order_id` supersede the existing ledger-derived `Position.stop_price`, or do the two remain deliberately distinct (see Proto Contract Changes reconciliation note)? **Decide at `/sdd-design`.**

## Dependencies

- `feature/position-sizing-engine` (023) must be `launched` — this feature consumes `ComputePositionSize` output.
