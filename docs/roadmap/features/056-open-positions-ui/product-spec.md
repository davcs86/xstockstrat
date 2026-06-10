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
FR-4. **Position → order/fill lineage (read-only join)** — From a position, view the
  fills that built it. Implemented as a **read-only join**, no new "slot" entity: query
  `LedgerService.QueryEvents` with `event_type = "trade.filled"` (optionally `stream_key`/
  symbol + time range + account), and render the matching fill events for the position's
  symbol/account. No write path, no new storage. The trading service / portfolio is **not**
  modified for this; lineage reads come from `xstockstrat-ledger`.
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
- `xstockstrat-ui` — paginate + filter the `trader/positions` page; add a position-detail /
  fill-lineage drill-in; BFF routes to portfolio and ledger.
- `xstockstrat-portfolio` — additive `ListPositions` filter fields (symbol, side).
- `packages/proto` — additive position filter fields only.
- `xstockstrat-ledger` — **read-only dependency** for fill lineage via existing
  `QueryEvents` (`event_type = "trade.filled"`). No ledger changes required.

## Proto Contract Changes

- [ ] ~~No proto changes required~~
- **`portfolio/v1/portfolio.proto`** (additive, non-breaking):
  - Additive filter fields on `ListPositionsRequest` (e.g. `string symbol`, side enum).
- **No lineage RPC needed** — FR-4 reuses the existing `LedgerService.QueryEvents` RPC
  (filter `event_type = "trade.filled"`). No `ledger.proto` change.
- Run `./scripts/buf-gen.sh`; `buf breaking` must stay green.

## Config Key Changes

- [x] No new config keys.

## Database Changes

- [x] No schema changes — positions and fills already persist in portfolio/ledger. FR-4 is
  a read-only join over existing ledger events; no new "slot" storage is introduced.

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
4. Selecting a position shows the `trade.filled` events for that symbol/account, read from
   the ledger via `QueryEvents` (read-only, no new storage).
5. `buf lint`/`buf breaking` pass; the only proto change is additive `ListPositionsRequest`
   filter fields.
6. All views scope to the selected trading mode and account.

## Open Questions

_All resolved during /sdd-review 2026-06-10:_

- [x] **"Position slot" definition** → **no new entity**. FR-4 ships as a read-only join, not
  a modeled slot. (A first-class "slot" abstraction, if ever wanted, is a separate future
  feature.)
- [x] **Source of truth for lineage** → **`xstockstrat-ledger` fill events** (`event_type =
  "trade.filled"`) via existing `QueryEvents`. Portfolio is not given an order reference.
- [x] **FR-4 scope** → **in this cut**, as a read-only drill-in (resolved).
- [x] **Filter placement** → **server-side** additive `ListPositionsRequest` fields.

_Deferred to /sdd-spec (implementation detail):_

- Exact match key between a ledger `trade.filled` payload and a position (symbol + account +
  trading_mode); confirm the fill payload carries account/mode so the join is unambiguous.
