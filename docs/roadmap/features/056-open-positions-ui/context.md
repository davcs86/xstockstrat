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

## Session 2026-06-11 — sdd-spec

- Generated implementation-spec.md with 9 steps. Status → implementation-ready.
- Key codebase findings (all grep/Read-confirmed):
  - **Lineage event type correction**: the product spec's `trade.filled` does not exist. Trading
    emits `order.filled` (`services/xstockstrat-trading/internal/service/trading.go:531`) and
    `order.partially_filled` (`:542`) with `source_service = "trading"`. FR-4 lineage must filter
    on these. The `order.filled` payload carries `account_id` + `trading_mode` + `user_id` +
    `symbol` + `qty` + `fill_price` (trading.go:531-536; consumer struct `orderFillPayload` at
    portfolio_service.go:107-117) — so the position↔fill join is unambiguous (resolves the
    product spec's deferred open question).
  - **No ledger client in the UI**: `connectClients.ts` has no `LedgerService`/`LEDGER_ENDPOINT`
    and `traderBff.ts` exposes only `getPortfolio`/`listPortfolios` (not `listPositions`). Step 5
    adds the ledger client, the `listPositions` + `queryEvents` BFF methods, and `LEDGER_ENDPOINT`
    to all three deployment files (confirmed absent from the `xstockstrat-ui` block in
    docker-compose.yml + .do/app.dev.yaml:387 + .do/app.yaml).
  - **Service `ListPositions` does not enrich** current price / market value / unrealized P&L
    (only `GetPortfolio`:192-199 and `GetPosition`:224-231 do). Step 3 adds enrichment so FR-3
    detail fields and the winners/losers P&L-sign filter have data.
  - **Portfolio CI coverage excludes** `repository`/`service`/`handler`/`cmd`/`telemetry`
    (ci.yml:229). New SQL filters + service forwarding land in excluded packages, so Step 4 tests
    extracted pure helpers (side-derivation, enrichment math); integration behavior covered by
    Step 7 UI E2E.
  - **Proto**: `ListPositionsRequest` (portfolio.proto:79-85) highest field = 4; additive
    `symbol=5`, `side=6` + new `PositionSide` enum (LONG/SHORT). Existing `OrderSide` is
    order-execution semantics, not position long/short — not reused.

## Next action

`/sdd-review open-positions-ui impl-spec`, then `/sdd-execute open-positions-ui`.
