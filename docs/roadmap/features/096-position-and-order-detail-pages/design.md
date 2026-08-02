# Design: position-and-order-detail-pages

**Created**: 2026-08-02
**Rounds**: 1 (quick; termination: approved)
**Approved by**: user @ 2026-08-02
**Grounded in**: recon.md

---

## Chosen Approach

**Consumer surface**: `xstockstrat-ui` `/trader` (Book group) — two client pages. No backend
behavior change; one additive BFF method over an existing gRPC RPC.

### 1. Single Position page — `app/trader/positions/[symbol]/page.tsx` (new)

A dedicated route, not a Sheet, so it is linkable from both Exposure and Portfolio and bookmarkable.

- **Data**: a new `usePosition(symbol, mode, accountId)` hook → `portfolioClient.getPosition`
  (`recon.md` — `portfolioClient.ts`, generic) → new trader-BFF `getPosition` method
  (`traderBff.ts:67` block, mirroring `listPositions` at `:82` with `userId` injection +
  `backendHeaders`). Reading the single authoritative `Position` (not filtering `listPositions`
  client-side) keeps C-10(b) parity honest and avoids paging concerns.
- **Chart**: `useCandlestickChart` + `getBars` + `mapBars` (`lib/chart.ts`), the same path
  `app/insights/market/[symbol]/page.tsx` uses; add horizontal price lines for **avg-cost**
  (`position.avgEntryPrice`) and **stop** (`position.stopPrice`, only when non-zero) via
  lightweight-charts `createPriceLine`.
- **Orders & fills**: `useOrders(mode, accountId, { symbol })` (`useOrders.ts:33`) rendered with the
  shared `orderShared.tsx` badges/labels; each row links to `/trader/orders/[id]`.
- **Risk sidebar**: `StatTile`/rows from the enriched `Position` risk fields (factor, exitRule,
  flag→`POSITION_RISK_FLAG`, stopDistancePct, riskAtStop), a stop-distance meter, and **Manage**
  buttons that deep-link to the order ticket / quick-trade (`/trader?symbol=`). Owning strategy is
  **derived** from the symbol's orders' `strategyId` (most frequent), linking to
  `/insights/strategies/[id]`; "—" when none.
- **Grammar**: Nocturne — mono `tabular-nums` numerics, `StatTile` kicker labels, gain/loss/paper
  tints, `Card` chrome. Shared helpers `openR`/`fmtR`/`sideLabel` come from the new
  `lib/positionRisk.ts` (extracted from `positions/page.tsx`, which is refactored to import them —
  the second-consumer centralization the DRY guard requires).

### 2. Single Order ticket page — `app/trader/orders/[id]/page.tsx` (upgrade in place)

Keep the route + `useOrder` hook; re-lay-out to the ticket grammar and add the working-order actions.

- **Header**: symbol + `OrderSideBadge` + `OrderStatusBadge` + order id (all `orderShared.tsx`).
- **Field grid**: type / TIF / qty / filled / limit / stop / avg fill / account / strategy (origin) /
  broker order id / mode — from the `Order` message.
- **Order-preview sidebar**: notional (`qty × (limitPrice||filledAvgPrice)`), filled %, remaining
  qty, origin strategy — all **derived from the order's own fields**, no new data.
- **Actions**: for `NEW`/`PARTIALLY_FILLED`, an **Edit** button opening the existing
  `EditOrderDialog` (→ `useReplaceOrder`) and a **Cancel** button (→ `useCancelOrder`); hidden for
  terminal statuses. Reuses the mutation path verbatim (FR-20 parity).

### Mobile

One responsive layout per page (not a divergent tree): the desktop `grid-cols-[1fr_320px]` collapses
to a single column below `sm`, tables live in `overflow-x-auto` wrappers, and controls carry
`min-h-[44px]`. Rationale in *Rejected Alternatives* — a second `SectionRenderer` tree would
duplicate the data mapping for a detail page whose desktop layout already stacks cleanly.

### Un-faked handoff elements (deferred to feature 095)

Prose "why it's held" thesis, price **target**, reward:risk, realized-P&L, and a live sparkline have
no backend source. Per P-03 they are **omitted**, not fabricated; feature 095
(`opportunity-live-market-enrichment`) already tracks them. "Why it's held" is replaced by a factual
**Risk & exit** block built from real fields.

## Rejected Alternatives

- **Reuse `listPositions` with a `symbol` filter instead of `GetPosition`** — rejected: returns a
  page (paging/edge cases), and reading a different RPC than the parity source muddies C-10(b). The
  dedicated `GetPosition` RPC already exists; exposing it is one additive BFF line.
- **Keep the Position as a Sheet, drop the page** — rejected: the handoff shows a page; a Sheet can't
  be linked from Portfolio or bookmarked, and Manage/chart don't fit a drawer at fidelity. The Sheet
  stays as the fast in-list peek; the page is the deep view (row → page; Sheet remains for quick look
  or is superseded — see Open Risks).
- **A second mobile `SectionRenderer` tree** — rejected: duplicates the data mapping for a layout
  that already reflows; responsive Tailwind is DRY and sufficient here.
- **Fabricate thesis/target/R:R to match the mock 1:1** — rejected on P-03; deferred to 095.

## Open Risks

- [ ] The Exposure page's row-click currently opens the Sheet; adding a page means a decision — keep
  the Sheet as a quick peek *and* add a full-page link, or replace the Sheet with navigation. Chosen:
  **keep the Sheet, add a "Open full view →" link + make the whole row navigate to the page**, with
  the quick-Trade shortcut preserved. Revisit if it feels redundant — Step 3/5.
- [ ] `GetPosition` mock must be added to `e2e/mock-backend.ts` or the page 404s in e2e — Step 5.

## Constitution Rules Touched

- `C-10(a)` — honored: `/trader/positions/[symbol]` reachable by walking Book → Exposure → row;
  reachability e2e asserts the click-through. Detail route (no `PLATFORM_SUBNAV` entry, like
  `/trader/orders/[id]`); breadcrumb resolves via existing `startsWith` match.
- `C-10(b)` — honored: Position page reads the same broker-authoritative `Position` unrealized-P&L as
  Exposure/Portfolio; parity asserted in e2e (AC-3).
- `C-12 / C-13` — honored: e2e specs + `getPosition` mock use `e2e/fixtures/*`; a new position
  fixture gets an `INVENTORY.md` row.
- `C-14` — honored: the consumer surface (`/trader` pages) is named and each earns implementation
  steps; no backend-only change.
- `P-03` — honored: no fabricated values; unsourced fields omitted and deferred to 095.
- `F-07` — honored: no config values hardcoded (none added).
- `F-02 / F-03` — honored: work on `feature/position-and-order-detail-pages`; PR targets that branch
  / main-dev, never pushed directly.
