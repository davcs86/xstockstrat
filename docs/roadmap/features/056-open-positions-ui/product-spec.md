# Product Spec: open-positions-ui

**Created**: 2026-06-10

---

## Problem Statement

The trader Positions page renders all open positions in a single unpaginated table
(`usePositions` → `ListPositions`) with no filters, and offers no way to see which orders
built a given position. As position counts grow this becomes unwieldy, and traders cannot
trace a position back to its constituent fills/orders.

## User Story

As a trader, I want a paginated, filterable open-positions page where I can drill into a
position to see the orders that opened and added to it, so that I can understand my exposure
and how each position was assembled.

## Functional Requirements

FR-1. **Paginated positions** — Render open positions using `PortfolioService.ListPositions`
  with its existing `PageRequest`/`PageResponse`, replacing the current "fetch all" behavior.
FR-2. **Filters** — Filter by symbol, side (long/short, derived from `qty` sign),
  account/broker, and P&L sign (winners/losers). `ListPositions` already supports
  `trading_mode` and `account_id`; **symbol and side filters require additive fields** on
  `ListPositionsRequest` (or are applied client-side per page — see Open Questions).
FR-3. **Position detail** — Per-position view: qty, avg entry, current price, market value,
  unrealized P&L ($/%), cost basis, opened-at (all already on `Position`).
FR-4. **Position slots ↔ orders (exploration)** — From a position, view the orders/fills
  that built it. `Position` has no order linkage today, so this requires a new additive
  RPC (e.g. `ListPositionOrders(symbol, account, mode)`) sourced from trading orders or
  ledger fill events. **This FR is exploratory** — /sdd-spec must confirm the source of
  truth and whether "slot" is a per-fill row or a higher-level grouping before committing.
FR-5. **Mode / account scoping** — Honor selected trading mode and account, consistent with
  the existing positions page.

## Out of Scope

- Closing/reducing positions from this page (that is order placement — see
  `055-orders-management-ui`).
- Portfolio-level analytics / rebalancing (cf. `036-portfolio-rebalancing`,
  `028-mpt-portfolio-optimization`).
- Realized-P&L history and tax lots.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-ui` — paginate + filter the `trader/positions` page; add position-detail /
  order-lineage drill-in.
- `xstockstrat-portfolio` — additive `ListPositions` filter fields; new position→orders
  linkage RPC (or proxy to trading/ledger).
- `packages/proto` — additive position filter fields + lineage RPC/messages.
- `xstockstrat-trading` / `xstockstrat-ledger` — **read-only dependency** for order/fill
  lineage (confirm source of truth in /sdd-spec).

## Proto Contract Changes

- [ ] ~~No proto changes required~~
- **`portfolio/v1/portfolio.proto`** (additive, non-breaking):
  - Additive filter fields on `ListPositionsRequest` (e.g. `string symbol`, side enum).
  - New RPC for order lineage, e.g. `ListPositionOrders(ListPositionOrdersRequest) returns
    (ListPositionOrdersResponse)` — **shape pending source-of-truth decision**.
- Run `./scripts/buf-gen.sh`; `buf breaking` must stay green.

## Config Key Changes

- [x] No new config keys.

## Database Changes

- [x] No schema changes expected — positions and fills already persist in portfolio/ledger.
  The lineage RPC reads existing data. (If a "slot" abstraction needs its own storage,
  /sdd-spec will flag a migration + DBA gate.)

## Feature Workflow Notes

Branch to create: `feature/open-positions-ui` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto + UI/service change) — Proto Reviewer +
  `xstockstrat-portfolio` owner + `xstockstrat-ui` owner
- [ ] 2 service owners + platform lead (breaking proto change) — N/A (additive only)
- [ ] DBA review + service owner — only if a "slot" table is introduced (TBD in /sdd-spec)

## Acceptance Criteria

1. `trader/positions` renders a paginated list driven by `ListPositions` page tokens.
2. Symbol, side, account, and P&L-sign filters narrow the list correctly.
3. A position detail view shows all `Position` fields.
4. Selecting a position shows the orders/fills that built it (or, if lineage is deferred,
   a clearly-scoped follow-up is recorded — see Open Questions).
5. `buf lint`/`buf breaking` pass; changes additive.
6. All views scope to the selected trading mode and account.

## Open Questions

- [ ] **Define "position slot."** Is a slot one fill/order, or a logical grouping (e.g. a
  tranche)? This determines whether FR-4 is a simple join or a new modeled entity.
- [ ] **Source of truth for lineage:** trading `ListOrders` filtered by symbol/account, or
  `xstockstrat-ledger` fill events? Portfolio currently has no order reference.
- [ ] Should symbol/side filtering be server-side (new proto fields) or client-side per
  page? Server-side is correct with pagination but adds proto surface.
- [ ] Is FR-4 (order lineage) in-scope for the first cut, or split into a follow-up feature
  so the pagination/filter upgrade can ship independently?
