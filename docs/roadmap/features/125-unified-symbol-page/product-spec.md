# Product Spec: unified-symbol-page

**Created**: 2026-08-10

---

## Problem Statement

A trader researching or managing a single stock symbol today has to visit up to **five separate
pages** to assemble a complete picture of it: `/trader/positions/[symbol]` (position + risk),
`/trader/orders/[id]` (a single order), `/insights/market/[symbol]` (opportunity/conviction +
per-strategy readiness + an embedded trade widget), `/insights/screener` (screening, list-only,
no per-symbol view), and `/insights/backfills` (backfill status, a global list with a client-side
symbol filter, not a symbol-scoped route). Backtests are visible only per-*strategy*
(`/insights/strategies/[id]`), not per-symbol, and fundamentals data — computed and scored by
launched features 062/063 — has **no UI display anywhere** today. There is no single place a
trader can land on for one ticker and see everything the platform already knows about it.

## User Story

As a trader, I want one unified page per symbol/ticker showing my position (if any), its orders,
a trade-entry widget, and — depending on whether the symbol is on one of my watchlists — either
its opportunity/conviction and per-strategy indicator signal and fundamentals data, or the
screening tools to evaluate it fresh, plus its backtest history and data-backfill coverage — so I
can research, decide, and act on a symbol without hopping between pages.

## Functional Requirements

FR-1. A single route under **`/trader`** consolidates the content of **three existing
per-symbol/per-order surfaces** into one page: `/trader/positions/[symbol]` (position, risk
sidebar, entry-to-stop chart, orders-and-fills table — feature 096), `/trader/orders/[id]`
(single-order ticket grammar, also feature 096), and `/insights/market/[symbol]`
(opportunity/conviction header, per-strategy condition readiness via `SignalReadiness`, and an
already-embedded trade widget — feature 083). **Segment placement is decided** (user, 2026-08-10):
the page lives under `/trader`, not `/insights` — resolves the architecture fork the first version
of this spec left open. `/insights/market/[symbol]` likely redirects to the new `/trader` page
rather than staying a separate surface; exact redirect behavior and the new route's final path
(and whether it reuses `/trader/positions/[symbol]` in place or introduces a new path with the two
096 routes redirecting to it) are design-phase decisions — 096's pages are less than two weeks old
and already linked from Exposure/Portfolio/order lists; 083's page is linked from every Opportunity
card, so every one of those callers needs to be repointed regardless of the exact path chosen.

FR-2. **Positions**: if the user holds a position in the symbol, show it — reuse 096's existing
Position fields, risk sidebar (stop meter, risk-at-stop, exit rule, factor/flag), and entry-to-stop
chart.

FR-3. **Orders**: list open + historical orders for the symbol (reuse the existing
`ListOrders(symbol)` filter and 096's ticket-grammar field grid + Edit/Cancel for working orders).

FR-4. **Trade widget**: an inline order-entry form to place a new order for the symbol without
leaving the page. Reuse the existing `OrderForm` component (`components/trader/OrderForm.tsx`) the
same way `SignalOrderTicket` already reuses it inside `/insights` (its own `AccountProvider`
wrapper, since `/insights` doesn't otherwise provide account context) — this is a proven pattern,
not new plumbing.

FR-5. **Opportunity + conviction** (watchlist symbols only): if the symbol is on one of the user's
watchlists, show its current `Opportunity` data (conviction, action tag, thesis, source, strategy,
expiry) exactly as `/insights/market/[symbol]` shows it today. **No new computation** — read-only
against what `ListOpportunities`/the matching `Opportunity` already returns. Per the resolved scope
decision below, this does **not** wait on or depend on feature 095 (`opportunity-live-market-
enrichment`, still `draft` — live price/change, sparkline, target/stop overlays, R:R/sizing); those
richer fields are explicitly out of scope here and stay 095's to add later.

FR-6. **Indicators + per-strategy conviction** (watchlist symbols only): show per-strategy
condition readiness for the symbol exactly as the existing `SignalReadiness` component (backed by
`EvaluateReadiness`) does on `/insights/market/[symbol]` today — strategy-scoped, using whatever
strategy the watchlist binding names (`WatchlistBinding.strategyId`) or a strategy picker if
unbound. Raw indicator values beyond per-strategy readiness (`ComputeIndicator`) are **out of
scope** — no UI surface exposes those generically today and this feature does not add one (flag
any real need for that as a named follow-up, don't build it here).

FR-7. **Fundamentals** (watchlist symbols only): show whatever fundamentals data the platform
already computes for the symbol (`RunFundamentalsScan`/`FundamentalsScanSummary` on
`AnalysisService`, launched by features 062/063). **This is new UI work, not reuse** — no page
today calls these RPCs or displays fundamentals detail; the Screener only uses fundamentals as
scoring *criteria*, with a "pending" banner when data isn't available. If the symbol has no
fundamentals data, show that explicitly rather than an empty gap.

FR-8. **Screening tools** (non-watchlist symbols only): if the symbol is **not** on any watchlist,
let the user run/see a screening evaluation for it in place. **This is also new UI work** — today
`ScreenSymbols` only returns a ranked list from a multi-symbol scan; there is no existing
single-symbol screening view to reuse verbatim. Design phase determines the minimal shape (e.g.
running the user's saved screener criteria against just this one symbol and showing its per-
criterion gaps) — this FR does not mandate rebuilding the full Screener UI.

FR-9. **Backtesting**: show past backtest runs that involved this symbol, and provide a way to
trigger a new run scoped to it. **Backtests are currently surfaced only per-strategy**
(`/insights/strategies/[id]`, via `RunBacktest`/`useBacktestHistory`/`useBacktestDetail`) — there
is no existing "backtests by symbol" filter or view. Design phase must determine how a symbol maps
to relevant backtest runs (e.g. via the strategy's universe/watchlist binding) before this FR can
be scoped as an implementation step — do not assume a trivial filter exists.

FR-10. **Backfill info**: show the symbol's ingested OHLCV date-range coverage, dates only, no
chart. The existing `/insights/backfills` page already renders this per-job with a client-side
symbol filter over `GetBackfillStatus` — this section reuses that same data, scoped display-side
to the current symbol; low risk, no new RPC anticipated.

FR-11. **Section visibility**: exactly one of {Opportunity/conviction + Indicators + Fundamentals}
or {Screening tools} renders, gated on watchlist membership — never both, never neither. Watchlist
membership itself is a **new read pattern**: no existing UI code checks "is this symbol on any of
my watchlists" today (watchlists only expose their own member list via `ListWatchlists`); this
feature must add that lookup.

FR-12. **No fabricated data (P-03)**: every value shown must trace to an existing, already-returned
platform field. Anything the user's ask implies but the platform cannot currently produce (e.g.
richer per-condition live values, target/stop overlays beyond 096's avg-cost/stop lines, streaming
LAST/CHG) is called out as a named gap or explicitly deferred to the feature that already owns it
(095, 099) — never approximated or invented.

FR-13. **Reachability (C-10(a))**: the new page is registered in the shared nav
(`PLATFORM_SUBNAV` and, if it needs a top-level entry, `NAV_GROUPS`) with a nav-reachability test,
and every existing caller that links to `/trader/positions/[symbol]`, `/trader/orders/[id]`, or
`/insights/market/[symbol]` is repointed consistently with whatever FR-1 decides about the source
pages' fate.

FR-14. **Valuation parity (C-10(b))**: the position/unrealized-P&L values shown here must match
Exposure and Portfolio exactly, same as 096 already guarantees for its own page — this becomes a
*third* read path that must stay in parity, not just two.

## Out of Scope

- Any new backend computation: live streaming quotes (LAST/CHG — feature 099, parked, no data
  source yet), richer conviction/target/R:R/sizing fields (feature 095, still `draft`), and any new
  indicator formula or scoring model.
- Building a general-purpose "indicator values" viewer beyond existing per-strategy readiness.
- Rebuilding the full multi-symbol Screener UI — only a single-symbol evaluation surface for this
  page.
- New proto RPCs, unless design-phase recon proves none of the existing RPCs above can serve a
  section even through an additive BFF method (see Open Questions).
- Redesigning the existing entry-to-stop candlestick chart beyond what 096 already ships.

## Affected Services

- `xstockstrat-ui` — primary: new consolidated page, BFF wiring for any section not yet exposed to
  the trader BFF (fundamentals, symbol-scoped backtests, watchlist-membership lookup), nav
  registration, repointing existing callers.
- `xstockstrat-analysis` — read-only consumer via existing RPCs (`ListOpportunities`,
  `EvaluateReadiness`, `RunFundamentalsScan`/`FundamentalsScanSummary`, `RunBacktest` + backtest
  history/detail). No proto change anticipated unless design-phase recon finds a genuine gap.
- `xstockstrat-portfolio` — read-only consumer via existing RPCs (`GetPosition`, `ListWatchlists`
  for the new membership lookup).
- `xstockstrat-ingest` — read-only consumer via existing `GetBackfillStatus`.
- `xstockstrat-trading` — read-only consumer via existing `ListOrders`; write path via the existing
  order-placement flow the reused `OrderForm` already calls.
- `xstockstrat-indicators` — not directly called by this feature (readiness goes through
  `xstockstrat-analysis`'s `EvaluateReadiness`); listed for completeness only.

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **UI** — `/trader` segment (decided, see FR-1). The three pages being consolidated currently
  live one in `/trader`, two in `/insights`; the new unified page lands in `/trader`, and
  `/insights/market/[symbol]` most likely redirects to it rather than remaining a separate surface
  (exact redirect mechanics are a design-phase detail, not an open architecture question anymore).
  Must be reachable per **C-10(a)** (registered in `PLATFORM_SUBNAV`, and `NAV_GROUPS` if it needs a
  top-level entry) from both segments' navs during/after the transition.
- [ ] **Agent** — no new MCP tool anticipated; existing tools (`run_backtest`,
  `trigger_backfill`/`get_backfill_status`) are unaffected.
- [ ] **None** — n/a, this is a UI feature.

## Proto Contract Changes

- [ ] No proto changes required — **provisionally**. Every RPC named in the FRs above already
  exists (`GetPosition`, `ListOrders`, `ListOpportunities`, `EvaluateReadiness`,
  `RunFundamentalsScan`, `RunBacktest` + history/detail, `GetBackfillStatus`, `ListWatchlists`).
  What's unconfirmed is whether each is already wired through the relevant BFF (trader vs.
  insights) for this new page's needs, or needs an **additive** BFF method only (no proto change) —
  resolve at `/sdd-design` Phase 0 recon before assuming "reuse" is free for every section.

## Config Key Changes

- [ ] No new config keys anticipated.

## Database Changes

- [ ] No schema changes anticipated — every data source is read through an existing service's
  existing storage.

## Feature Workflow Notes

Branch to create: `feature/unified-symbol-page` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (`xstockstrat-ui`) — no proto/config/migration anticipated
- [ ] 2 service owners + platform lead (breaking proto change) — not expected
- [ ] DBA review + service owner (schema migration) — not expected

## Acceptance Criteria

1. Visiting the unified page for a symbol the user holds shows the position with the same risk
   fields 096 shows today, and its unrealized P&L matches Exposure and Portfolio exactly (C-10(b),
   now a three-way parity).
2. The Orders section lists exactly what `ListOrders(symbol)` returns, with the same
   ticket-grammar fields and working-order Edit/Cancel that `/trader/orders/[id]` shows today.
3. The trade widget places a real order via the existing order-placement path (paper trading in
   dev, verified against the reused `OrderForm`/`AccountProvider` pattern).
4. For a symbol on a watchlist: Opportunity/conviction, per-strategy readiness, and Fundamentals
   sections render (each with an explicit no-data state where the platform has none) — the
   Screening-tools section is absent.
5. For a symbol not on any watchlist: the Screening-tools section renders — Opportunity/conviction,
   readiness, and Fundamentals sections are absent.
6. The Backtesting section lists past runs relevant to the symbol (per whatever mapping design
   settles on) and offers a way to trigger a new run.
7. The Backfill section shows the symbol's ingested date-range coverage, read-only, dates only, no
   chart — matching what `/insights/backfills`' own symbol filter would show for the same symbol.
8. The page is reachable from the shared nav (C-10(a)) and from every existing entry point that
   links to any of the three pages it consolidates.
9. No displayed value is fabricated (P-03) — verified in design.md against each section's actual
   backing RPC/response field.

## Open Questions

- [x] ~~Segment placement~~ — **Resolved** (user, 2026-08-10): the unified page lives under
  `/trader`. `/insights/market/[symbol]` most likely redirects to it; `/trader` already has
  `AccountProvider`, so the trade widget (FR-4) no longer needs 083's own-`AccountProvider` wrapper
  pattern — it can consume the ambient one directly. `/sdd-design` still resolves the exact final
  route and redirect mechanics (see below), not the segment itself.
- [ ] **Fate of the three source pages** (FR-1): `/insights/market/[symbol]` most likely redirects
  to the new page (per the placement decision above); whether `/trader/positions/[symbol]` and
  `/trader/orders/[id]` are replaced in place (same paths, new content) or superseded by a new path
  with those two redirecting is still a design-phase decision. The Order ticket in particular might
  reasonably stay reachable standalone since not every order maps to "the" position view for its
  symbol (e.g. a closed position's historical order) — resolve in `/sdd-design`. Affects every
  existing linker (Exposure, Portfolio, order lists, Opportunity cards) and the C-10(a)
  reachability test surface.
- [ ] **Backtest-to-symbol mapping** (FR-9): backtests are strategy-scoped today with no symbol
  filter. Recon must determine whether a strategy's universe/watchlist binding can derive "backtests
  relevant to this symbol" cleanly, or whether this needs a new filter parameter.
- [ ] **Fundamentals and Screening-tools sections are net-new UI**, not reuse (FR-7, FR-8) — do not
  let `/sdd-spec` scope these as trivial display-only steps; they need their own BFF wiring design.
- [ ] **Watchlist-membership lookup** (FR-11): no existing code answers "is symbol X on any of my
  watchlists" — confirm at design time whether this is cheap client-side (fetch all watchlists,
  check bindings) or needs a dedicated read.
- [ ] **Any other useful data currently missing** (the user's own item 10): `/sdd-design`'s Phase 0
  recon should inventory further symbol-relevant data the platform already computes but shows
  nowhere (mirroring what this spec found for fundamentals) — but only wire what needs zero new
  backend computation (P-03); anything requiring new computation is a named follow-up, not this
  feature's scope.

### Known traps (from the Ledger — read before designing)

- **fails.md 2026-08-05 (023-position-sizing-engine)**: `Opportunity.conviction`
  (`analysis.proto`) is a deterministic **ordinal**, explicitly *not a probability* per its own
  proto comment — do not confuse it with `ExternalSignal.conviction` (`ingest.proto`, a genuine
  0.0–1.0 confidence value) when wiring FR-5/FR-6. This spec's conviction display is the same
  `Opportunity.conviction` field 083 already uses correctly; just don't let a later step "upgrade"
  it to the wrong field because the name and range look convenient.
- **fails.md 2026-07-01 (056-open-positions-ui)**: a position's valuation must be surfaced
  identically by *every* read path (C-10(b)) — this feature adds a third path (after Exposure and
  Portfolio) and must be parity-tested against both, not just one.
- **fails.md 2026-07-01 (060-screener-engine)**: a new UI page is unreachable unless it's
  registered in the shared nav with a reachability test — do not let this ship linked only from the
  pages it replaces.
