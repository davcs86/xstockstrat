# Context: open-positions-ui

**Feature**: `docs/roadmap/features/056-open-positions-ui/feature.md`
**Product Spec**: `docs/roadmap/features/056-open-positions-ui/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/056-open-positions-ui/implementation-spec.md`

---

## Session 2026-06-10 — backlog capture

- Created feature.md at `idea` status as a backlog entry.

## Session 2026-06-10 — sdd-story

- Upgraded feature.md `idea` → `draft`; wrote product-spec.md and this context log.
- Codebase grounding (found via grep, not invented):
  - `packages/proto/portfolio/v1/portfolio.proto` `PortfolioService.ListPositions` is
    already paginated (`PageRequest`) with filters `user_id`, `trading_mode`, `account_id`.
    Lacks symbol/side filters.
  - `Position` message fields: symbol, qty, avg_entry_price, current_price, market_value,
    unrealized_pnl(_pct), cost_basis, opened_at, trading_mode, account_id. **No order/fill
    reference** → "slots ↔ orders" needs a new linkage RPC + a source-of-truth decision.
  - UI `services/xstockstrat-ui/src/app/trader/positions/page.tsx` exists but uses
    `usePositions` and renders all positions with no pagination/filters.
- Key open design question carried to /sdd-spec: define what a "position slot" is and where
  order lineage is read from (trading orders vs ledger fill events). FR-4 may be split into
  a follow-up so the pagination/filter upgrade can ship independently.

## Session 2026-06-10 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Open questions resolved (user decisions):
  - "Position slot" → **no new entity**; FR-4 is a **read-only join**.
  - Lineage source → **`xstockstrat-ledger` `trade.filled` events** via existing
    `QueryEvents` (verified: `QueryEventsRequest` filters by `event_type`/`stream_key`/
    time/page; `LedgerEvent.payload` is a Struct). No ledger.proto change.
  - FR-4 in this cut (read-only drill-in); filters server-side.
- Net effect: only proto change is additive `ListPositionsRequest` filter fields; portfolio
  gets no order reference. Ledger is a read-only dependency.
- Deferred to /sdd-spec: confirm the `trade.filled` payload carries account_id + trading_mode
  so the position↔fill join is unambiguous.

## Next action

`/sdd-spec open-positions-ui`.
