# Product Spec: symbol-page-panel-refinements

**Created**: 2026-08-18

---

## Problem Statement

The trader symbol page (`/trader/positions/[symbol]`) — restructured into four anchored sections by
feature 139 — has several rough edges surfaced in operator review: the held-position overview breaks
the Card/panel visual pattern the rest of the page follows; two panels ("Manage", "Broker") are
redundant with broken/duplicate links; multiple live opportunities stack vertically instead of
tabbing; Fundamentals is wrongly gated to watchlisted symbols; and the strategy-scoped panels
(Indicators, Backtests, "Why this fired") each resolve a strategy differently, so a symbol like AMZN
that carries a `?strategy=` seed or a live opportunity — but no watchlist binding and no order
strategy — shows "No strategy resolves" and cannot chart indicators or run backtests.

## User Story

As a trader viewing a symbol page, I want every section to follow a consistent panel pattern and a
single strategy selection I control, so that the page is legible and the strategy-scoped panels are
never dead-ends.

## Functional Requirements

FR-1. **Opportunities → one tabbed panel group.** Render *all* of a symbol's live-strategy
opportunities (`useOpportunities` filtered to the symbol) as a single `SymbolPanelGroup` — one
`OpportunitySection` card per strategy, tabbed on mobile / columns on desktop — replacing the current
vertical stack in the non-watchlisted branch. Each panel is labeled by its strategy (`strategy_id`,
or `displayName` when resolvable). This is **not** a bug: AMZN is legitimately evaluated by 3 live
strategies (`range_mean_reversion`, `range_mean_reversion_v3`, `quality_dip_buyer`).

FR-2. **Held-position overview matches the panel pattern.** Split the current `PositionBody` (a
full-width header + a 2-column `[1fr_320px]` grid with an ad-hoc card sidebar) so the held-position
content becomes Card-based panels inside the **Trade** section's `SymbolPanelGroup`:
- a **Position** panel = the position header (symbol/side/qty/price/day-change/weight + Unrealized +
  Open R) and the stat-tile grid (Avg cost / Last / Cost basis / Market value / Unrealized / Day P&L),
  wrapped in a `Card`;
- a **Risk & exit** panel = the existing stop meter + risk/exit `dl`, moved out of the sidebar into
  its own tabbed panel alongside Position.
The `lg:grid-cols-[1fr_320px]` sidebar layout is dropped.

FR-3. **Remove the "Manage" panel.** Its five buttons (Add / Trim / Move stop / Close / Open order
ticket) all deep-link to the same generic `/trader?symbol=` URL, duplicating the on-page "Place
order" panel (`OrderForm`). Delete it.

FR-4. **Remove the "Broker" panel.** The account id already appears in the Position header subtitle,
and "See all positions" is already reachable via the page breadcrumb ("Exposure"). Delete it. The
one-line read-only-mirror disclaimer may be folded into the Position panel as a small footnote (design
phase decides) or dropped.

FR-5. **Fundamentals always-on.** The Fundamentals panel (`FundamentalsSection`, `GetFundamentals`) is
symbol-level data independent of any strategy or watchlist membership. Render it for **every** symbol
(held, watchlisted, or ad-hoc), not only in the watchlisted branch. Its own error/no-data state
(P-03) is unchanged.

FR-6. **Single page-level strategy selection.** Introduce one strategy selection, lifted to the page,
shared by the three strategy-scoped panels — Indicators (`IndicatorSection`), Backtests
(`BacktestsSection`), and "Why this fired" (`SignalReadiness`). The **effective strategy** resolves as:
`?strategy=` query param → watchlist `boundStrategyId` → the user's picker choice. The orders-derived
`owningStrategy` is **dropped** as a resolution source. Default is **empty** — no strategy is
auto-selected; each strategy-scoped panel shows its existing "select/no strategy" prompt until the
user picks one.

FR-7. **Strategy picker in each of the three panel headers.** The picker is a `Select` of
**active, live-enabled** strategies only — `useStrategyDefinitions(false)` (active) then
`.filter((s) => s.liveEnabled)`, the exact filter `SignalReadiness` already applies. The same synced
picker renders in the Indicators, Backtests, and "Why this fired" card headers; changing it in one
updates all three (shared page state). Selecting a strategy writes a bare `?strategy=<id>` hash/query
via `history.replaceState` in keeping with the existing FR-5 query-preservation convention (must not
trigger a Next navigation/refetch, and must not clobber the `#section` anchor hash used by the
section-nav).

FR-8. **`SignalReadiness` becomes controlled.** Its internal `useState`/`useSearchParams` picker is
replaced by controlled `strategyId` + `onStrategyChange` props fed from the page-level state, so the
page never shows two strategy pickers that can disagree. `SignalReadiness` renders only on this page
(`insights/market/[symbol]` is a redirect-only stub), so blast radius is limited to the symbol page.

## Out of Scope

- Any backend/proto/gRPC change. This is a pure `xstockstrat-ui` presentation + client-state change;
  all data already comes from existing RPCs (`ListOpportunities`, `GetFundamentals`,
  `ListStrategyDefinitions`, `GetStrategy`, `GetIndicatorSeries`, `ListBacktests`, `RunBacktest`,
  `EvaluateReadiness`).
- Wiring the removed "Manage" buttons to real order actions (Add/Trim/Move stop/Close deep-links) —
  they are removed, not reimplemented.
- The section-nav spine (Overview/Trade/Research/Analysis) and `SymbolPanelGroup`/`SymbolSectionNav`
  mechanics from feature 139 — reused as-is, not redesigned.
- Auto-defaulting the strategy selection to the top opportunity (explicitly rejected — default empty).

## Affected Services

- `xstockstrat-ui` — the only affected service. All changes are in the `/trader` segment's symbol
  page (`src/app/trader/positions/[symbol]/page.tsx`) and the shared `SignalReadiness` component
  (`src/components/insights/SignalReadiness.tsx`), plus the e2e suite.

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **UI** — `xstockstrat-ui` segment `/trader`: the existing symbol page
  `/trader/positions/[symbol]` (already registered/reachable per C-10 — no new route). Changes:
  opportunities tabbed, position overview re-paneled, Manage/Broker removed, Fundamentals always-on,
  a shared strategy picker added to three panel headers.
- [ ] **Agent** — none.
- [ ] **None** — n/a (this is a user-facing UI change).

No new route is added, so no `PLATFORM_SUBNAV`/nav-registration (C-10(a)) is required — the page is
already reachable from Book → Exposure and from the Decide queue.

## Proto Contract Changes

- [x] No proto changes required.

## Config Key Changes

- [x] No new config keys.

## Database Changes

- [x] No schema changes.

## Feature Workflow Notes

Branch to create: `feature/symbol-page-panel-refinements` (branch from `main-dev`). **Harness
constraint:** this session must develop on and push to the assigned `claude/symbol-page-ui-refinements-t2xp26`
branch and open a single PR into `main-dev` (not per-step feature-step branches).

Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval — `xstockstrat-ui` owner (UI-only, non-breaking, no proto/config/DB).
- [ ] 2 service owners + platform lead (breaking proto change) — n/a.
- [ ] DBA review + service owner (schema migration) — n/a.

## Acceptance Criteria

1. On a symbol with multiple live opportunities (e.g. AMZN with 3), the Research section shows them as
   one tabbed/columned panel group (one card per strategy), not a vertical stack.
2. On a held symbol, the Trade section shows a Card-based **Position** panel and a separate
   **Risk & exit** panel (tabbed on mobile, columns on desktop); the old 2-column sidebar is gone.
3. The "Manage" and "Broker" panels no longer render anywhere on the page.
4. The Fundamentals panel renders for a non-watchlisted symbol (e.g. AMZN), showing its data or its
   own no-data/error state.
5. With no `?strategy=` and no watchlist binding, Indicators / Backtests / "Why this fired" show their
   "select a strategy" prompt and a picker listing only active live-enabled strategies; picking one in
   any of the three headers updates all three panels and reflects in the URL as `?strategy=<id>`.
6. Navigating to `/trader/positions/AMZN?strategy=range_mean_reversion` pre-selects that strategy in
   all three panels (Indicators charts its components, Backtests keys on it, "Why this fired"
   evaluates it) — no longer "No strategy resolves for AMZN".
7. Existing `position-detail` e2e assertions still pass (or are updated in the same PR), and any
   `getByLabel('Strategy')`/`getByRole` ambiguity introduced by the three synced pickers is resolved
   (see Known trap).

## Open Questions

- [ ] **Known trap (ledger fails.md, 2026-07 Breadcrumb entry):** `SignalReadiness`'s picker uses
  `aria-label="Strategy"`. Rendering the same synced picker in three panel headers will make
  `getByLabel('Strategy')` (and any `getByRole('combobox')`) **ambiguous** across the page. The design
  must disambiguate the three pickers' accessible names (e.g. `aria-label="Strategy for Indicators"`
  / "…Backtests" / "…Why this fired", or a single shared control) and the e2e suite must be grepped
  for `getByLabel`/`getByRole` collisions before the step closes (P-06 red-before-green in the suite
  it ships in).
- [ ] Does the read-only-mirror disclaimer from the removed Broker panel carry enough value to fold
  into the Position panel as a footnote, or is it dropped entirely? (FR-4 — design phase to decide.)
- [ ] Should the shared strategy picker also appear in the **Overview** section header (where
  Indicators lives) or only inline in the Indicators card? (FR-7 places it in the panel headers;
  confirm the Indicators one reads naturally given Indicators sits in Overview, not a panel group.)
