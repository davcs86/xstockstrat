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
Fill-status/lifecycle handling (partial vs. full fill, working vs. terminal state) is **unmodified**
— reused verbatim from 096's existing field grid, not touched by this feature.

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
unbound.

**Amended 2026-08-15 (user decision — see context.md § Session 2026-08-15); architecture resolved by
design.md § "Design Addendum — FR-6 Indicator Overlay Panels" (3-round full debate, approved
2026-08-15).** The prior scope note here ("raw indicator values beyond per-strategy readiness are out
of scope") is **superseded**: this feature now also renders **indicator overlay chart panels** for
the resolved strategy's declared components. For the strategy resolved by this FR's own precedence
(watchlist binding, or the picker's current selection), the page reads
`StrategyDefinition.components` (`packages/proto/analysis/v1/analysis.proto:241-246` — each a
`StrategyComponent{ref_name, kind, indicator, formula_id, params}`, `kind` is
`COMPONENT_KIND_BUILTIN_INDICATOR` or `COMPONENT_KIND_CUSTOM_FORMULA`) via `GetStrategy` and plots one
panel per component beneath the existing candlestick price chart.

**Series are computed by a new additive `AnalysisService.GetIndicatorSeries` RPC** — NOT by the UI
calling `xstockstrat-indicators` directly. That RPC's new handler internally reuses
`xstockstrat-analysis`'s existing `StrategyEvaluator._compute_component` (which in turn calls
`ComputeIndicator`/`ExecuteFormula` on `xstockstrat-indicators` server-side), so the UI reaches
indicators only transitively through analysis — the same shape `EvaluateReadiness` already uses, and
the reason the design rejected both a UI-direct-orchestration approach and widening `EvaluateReadiness`
(which is shared with launched feature 097's `ListOpportunities` exit trace). The page passes the RPC
the **same bar closes+times it already fetched for the candlestick chart** (structural x-axis parity,
no second bars fetch; verified `_compute_component` consumes only closes, matching what backtest/
readiness already feed it). This is **new analysis-RPC + UI wiring**, reusing the `analysisClient`
cross-segment sanctioned exception (no new BFF registration), same as FR-7/FR-8's new surfaces.
Rendering is stacked `recharts` panels (the `FormulaRunResult.tsx` in-repo pattern), one per
component, with every emitted series (incl. MACD/BB/STOCH sub-lines) drawn in that component's panel;
warm-up/gap points use `google.protobuf.DoubleValue` presence so no `0.0` is fabricated (P-03). Scope
stays bounded to *this resolved strategy's own declared components* — a general-purpose,
strategy-agnostic indicator browser remains out of scope (see Out of Scope, updated below). A strategy
with zero components, an unresolvable strategy, or a per-component compute error degrades to an
explicit no-data/error state (no fabricated panels — P-03).

FR-7. **Fundamentals** (watchlist symbols only): show the symbol's fundamentals ratios/metrics via
`GetFundamentals` on `MarketDataService` (`xstockstrat-marketdata`) — **corrected by `/sdd-design`
Phase 0 recon**: the original draft of this FR cited `RunFundamentalsScan`/`FundamentalsScanSummary`
on `AnalysisService`, which is **admin-scope-gated and side-effecting** (triggers a live FMP rescan
and emits signals) and cannot be called from an ordinary trader's page view. `GetFundamentals` is a
plain, ungated, read-through cache over the same underlying data (`analysis`'s own
fundamentals-signal producer reads through this exact RPC) — see recon.md. **This is new UI/BFF
work, not reuse** — no page today calls it or displays fundamentals detail; the Screener only uses
fundamentals as scoring *criteria*, with a "pending" banner when data isn't available. If the symbol
has no fundamentals data, show that explicitly rather than an empty gap.

FR-8. **Screening tools** (non-watchlist symbols only): if the symbol is **not** on any watchlist,
let the user run/see a screening evaluation for it in place. **This is also new UI work** — today
`ScreenSymbols` only returns a ranked list from a multi-symbol scan; there is no existing
single-symbol screening view to reuse verbatim. Design phase determines the minimal shape (e.g.
running the user's saved screener criteria against just this one symbol and showing its per-
criterion gaps) — this FR does not mandate rebuilding the full Screener UI.

FR-9. **Backtesting**: show past backtest runs relevant to this symbol, and provide a way to
trigger a new run scoped to it. **Resolved by design.md (2026-08-10)**: the strategy used to look
up backtest history follows the same fallback precedence as Readiness (FR-6) —
`WatchlistBinding.strategy_id` first, falling back to the symbol's orders-derived `owningStrategy`
(already computed for the "Why it's held" sidebar) when the symbol is unbound or has no watchlist
entry — never watchlist-binding alone, since a held-but-unwatchlisted symbol would otherwise show a
contradictory "no backtest data" next to a populated "Held under `<strategy>`" sidebar card. Runs
are found via a **client-side filter** of `ListBacktests(strategy_id)` against
`BacktestRunSummary.symbols` (zero backend change) — this covers only the resolved strategy's
runs, **not** every strategy platform-wide that happened to include the symbol; a symbol with no
resolvable strategy shows an explicit no-data state, not an empty gap. Full cross-strategy coverage
(an additive `symbol` field on `ListBacktestsRequest`, backed by the already-existing
`analysis.backtest_runs.symbols` column) is a named follow-up, not built here.

FR-10. **Backfill info**: show the symbol's ingested OHLCV date-range coverage, dates only, no
chart. **Corrected by recon**: the relevant RPC is `ListBackfillJobs`, which already has a
**server-side** `symbol` filter (`/insights/backfills` already calls it this way) — not
`GetBackfillStatus`, which only looks up a single job by id with no symbol param. This section
reuses `ListBackfillJobs(symbol=X)` and reduces the returned jobs' date ranges into a display
summary client-side; low risk, no new RPC anticipated.

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
- **Amended 2026-08-15**: a **general-purpose**, strategy-agnostic "indicator values" viewer is
  still out of scope. FR-6's indicator overlay panels are scoped strictly to the *resolved
  strategy's own declared `components`* — not an arbitrary indicator picker, not indicators outside
  what the strategy itself references.
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
  `EvaluateReadiness`, `ScreenSymbols`, `RunBacktest` + backtest history/detail). Backtest-to-symbol
  mapping may need an additive `symbol` filter field on `ListBacktestsRequest` — see recon.md
  Dependencies; otherwise no proto change anticipated.
- `xstockstrat-marketdata` — read-only consumer via existing `GetFundamentals`/`GetFundamentalsMulti`
  (corrected Affected Services entry — recon found this, not `xstockstrat-analysis`, is the
  fundamentals RPC this feature needs; see FR-7). Already implicitly a dependency via `GetBars` for
  the entry-to-stop chart 096 already ships.
- `xstockstrat-portfolio` — read-only consumer via existing RPCs (`GetPosition`, `ListWatchlists`
  for the new membership lookup). Recon also found a pre-existing latent gap in `GetPosition`
  (ignores `account_id`, unlike `ListPositions`) — flagged for the design phase, not introduced by
  this feature.
- `xstockstrat-ingest` — read-only consumer via existing `ListBackfillJobs` (already has a
  server-side `symbol` filter — corrected from the original draft's `GetBackfillStatus` citation,
  which is a single-job lookup with no symbol param; see recon.md).
- `xstockstrat-trading` — read-only consumer via existing `ListOrders`; write path via the existing
  order-placement flow the reused `OrderForm` already calls.
- `xstockstrat-indicators` — **amended 2026-08-15 (corrected by design.md)**: **not directly called
  by the UI**. FR-6's indicator overlay panels reach `ComputeIndicator`/`ExecuteFormula` only
  transitively — server-side, through `xstockstrat-analysis`'s new `GetIndicatorSeries` RPC (which
  reuses `StrategyEvaluator._compute_component`), the same indirection `EvaluateReadiness` already
  uses. An earlier draft of this line said the UI calls indicators directly; the design debate
  rejected that path. Read-only, existing edge, unchanged.
- `xstockstrat-analysis` — **amended 2026-08-15**: gains a new additive **`GetIndicatorSeries` RPC**
  (FR-6 indicator overlay panels) whose handler reuses the existing `StrategyEvaluator._compute_component`/
  `align_indicator_points` logic in its own loop (not the shared `evaluate_conditions_traced`, to
  avoid touching launched feature 097's `ListOpportunities` exit trace). No longer read-only-consumer
  of existing RPCs only.

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

_Updated by `/sdd-design` (2026-08-10) — recon.md Dependencies + design.md Chosen Approach have the
full detail; this section corrects an earlier omission the design debate caught (round 4/5)._

- [x] **No proto changes required** for Positions, Orders, Trade widget, Opportunity/conviction,
  Readiness, Fundamentals, or Backfill — confirmed every RPC needed already exists with the exact
  fields required (`GetPosition`, `ListOrders`, `PlaceOrder`, `ListOpportunities`,
  `EvaluateReadiness`, `GetFundamentals`/`GetFundamentalsMulti`, `ListBackfillJobs`). Per design.md,
  these are reused via the existing cross-segment `/insights/api`-bound browser clients (a sanctioned
  exception documented in `services/xstockstrat-ui/CLAUDE.md`), with `GetFundamentals` the one
  genuinely new `traderBff.ts` registration — no schema/contract change either way.
- [x] **One additive proto change IS required, for Screening (FR-8)** — the original draft of this
  section omitted it under a blanket "no proto changes" claim; corrected here. `ScreenResult`
  (`packages/proto/analysis/v1/analysis.proto:369-384`) gains two additive fields —
  `map<string, double> criterion_raw_values = 12` and `map<string, bool> criterion_passed = 13` —
  so single-symbol screening can show each criterion's real reading instead of the
  universe-relative `score`/`criterion_scores`, which collapses to a content-free `0.5` for a
  one-symbol scan (confirmed live trap, see recon.md Risks). This is a hard predecessor step to the
  UI screening work — `/sdd-spec` must not cite the generated TS symbols before it lands.
- [x] **Backtesting decided**: client-side filter (zero proto change) — see FR-9, corrected above.
  The additive `ListBacktestsRequest.symbol` alternative is a named follow-up, not built here.
- [x] **A second additive proto change IS required, for Indicator overlay panels (FR-6)** — added
  2026-08-15 (design.md § "Design Addendum — FR-6"). `AnalysisService` gains a new additive RPC
  `GetIndicatorSeries(GetIndicatorSeriesRequest) returns (GetIndicatorSeriesResponse)` plus its
  messages: `GetIndicatorSeriesRequest{strategy_id, symbol, repeated double closes, repeated
  google.protobuf.Timestamp times}`, `GetIndicatorSeriesResponse{repeated google.protobuf.Timestamp
  times, repeated ComponentSeries components}`, `ComponentSeries{ref_name, ComponentKind kind, repeated
  NamedSeries series, string error}`, `NamedSeries{name, repeated google.protobuf.DoubleValue values}`
  — requires adding `import "google/protobuf/wrappers.proto"` to `analysis.proto`. Additive/
  non-breaking. Hard predecessor to the FR-6 UI step (`buf lint`/`buf breaking`/`./scripts/buf-gen.sh`
  must land before the UI cites the generated symbols — C-09/F-04), same governance shape as the
  `ScreenResult` change above.

## Config Key Changes

- [x] **One new config key (added 2026-08-15, design.md § "Design Addendum — FR-6")**:
  `analysis.series.max_concurrent_components` (int, default `4`) — a process-lifetime singleton
  semaphore in `AnalysisServicer` bounding cross-request concurrency of per-component
  `ComputeIndicator`/`ExecuteFormula` execution driven by `GetIndicatorSeries`, so a routinely-visited
  Symbol page can't starve the analysis live loop (mirrors `analysis.screener.max_concurrent_formula_evals`;
  read via `cfg.get_int(...)` with a `max(1, …)` clamp). Needs a `services/xstockstrat-analysis/CLAUDE.md`
  § Config Keys row + a per-feature registered-keys entry in `docs/patterns/config-governance.md` (C-05).
  (The earlier draft of this section said "No new config keys anticipated"; corrected here.)

## Database Changes

- [ ] No schema changes anticipated — every data source is read through an existing service's
  existing storage.

## Feature Workflow Notes

Branch to create: `feature/unified-symbol-page` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (`xstockstrat-ui` + `xstockstrat-analysis` for the additive,
  non-breaking `ScreenResult` fields **and** the additive `GetIndicatorSeries` RPC — FR-6) — no
  migration; both proto changes are additive-only
- [ ] 2 service owners + platform lead (breaking proto change) — not expected, the `ScreenResult`
  change is purely additive
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
4a. **(Amended 2026-08-15)** For a symbol whose resolved strategy has one or more declared
   `components`, an indicator overlay panel renders per component beneath the price chart, each
   showing the real series returned by the new `GetIndicatorSeries` RPC for that component (every
   emitted named series, incl. MACD/BB/STOCH sub-lines) — no fabricated/placeholder series
   (warm-up/gap points are absent via `DoubleValue` presence, never `0.0`). A strategy with zero
   declared components, a symbol with no resolvable strategy, or a per-component compute error shows
   an explicit no-data/error state instead of an empty gap or a fabricated panel.
5. For a symbol not on any watchlist: the Screening-tools section renders — Opportunity/conviction,
   readiness, and Fundamentals sections are absent.
6. The Backtesting section lists past runs for the strategy resolved by FR-9's watchlist-binding-
   then-owningStrategy precedence, filtered client-side to runs whose `symbols` include this symbol
   (not every strategy platform-wide), and offers a way to trigger a new run scoped to it. A symbol
   with no resolvable strategy shows an explicit no-data state.
7. The Backfill section shows the symbol's ingested date-range coverage, read-only, dates only, no
   chart — matching what `/insights/backfills`' own symbol filter would show for the same symbol.
8. The page is reachable from the shared nav (C-10(a)) and from every existing entry point that
   links to any of the three pages it consolidates.
9. No displayed value is fabricated (P-03) — verified in design.md against each section's actual
   backing RPC/response field.

## Open Questions

_Per `/sdd-review` (2026-08-10, PASS WITH WARNINGS): the items below are genuine architecture-level
forks, not silently-skipped ambiguities. `/sdd-design` Phase 0 recon (2026-08-10, see recon.md)
resolved several with grounded evidence and narrowed the rest to concrete options — the
proposer-vs-adversary debate (Phase 1) makes the final call on anything still unchecked._

- [x] ~~Segment placement~~ — **Resolved** (user, 2026-08-10): the unified page lives under
  `/trader`. `/insights/market/[symbol]` most likely redirects to it; `/trader` already has
  `AccountProvider`, so the trade widget (FR-4) no longer needs 083's own-`AccountProvider` wrapper
  pattern — it can consume the ambient one directly (recon confirmed no `AccountProvider` mount
  exists under `/insights`).
- [x] ~~`main-dev` staleness re-check for `PlatformHeader.tsx`/`OrderForm.tsx`~~ — **Done** (recon,
  2026-08-10): both files' current content confirmed and cited in recon.md's Codebase Map; PRs
  #912/#913's merge status could not be confirmed (the discovery subagent has no Bash/git access),
  so `/sdd-spec` must re-verify line numbers immediately before citing them, not rely on recon's.
- [x] ~~Watchlist-membership lookup~~ — **Resolved** (recon, 2026-08-10): no dedicated RPC exists;
  reuse the existing `useWatchlists()` hook (already fetches all watchlists with `bindings[]`
  populated) and scan client-side. Cheap given `portfolio.watchlist.max_per_user` caps at 50.
- [x] ~~Backfill RPC~~ — **Resolved/corrected** (recon, 2026-08-10): `ListBackfillJobs(symbol=X)`
  already has server-side filtering; folded into FR-10 (the original FR-10 wrongly cited
  `GetBackfillStatus`, a single-job lookup with no symbol param).
- [x] ~~Fundamentals RPC~~ — **Resolved/corrected** (recon, 2026-08-10): `GetFundamentals` on
  `xstockstrat-marketdata`, not `RunFundamentalsScan` on `xstockstrat-analysis` (which is
  admin-gated and side-effecting — would have been a real bug if built as originally specced).
  Folded into FR-7 and Affected Services.
- [x] ~~Fate of the three source pages~~ — **Resolved** (design.md, 2026-08-10, 5 rounds):
  `/trader/positions/[symbol]` reused in place as the sole route; `/insights/market/[symbol]`
  becomes an unconditional redirect forwarding the query string; `/trader/orders/[id]` stays
  standalone, unmerged. Exactly **one** real caller needed repointing
  (`opportunities/page.tsx:129-130`) — the other three sites recon originally cited were
  re-verified and found to already point at unaffected routes (a stale citation the debate itself
  caught and corrected).
- [x] ~~Backtest-to-symbol mapping~~ — **Resolved** (design.md): client-side filter (option a) —
  zero backend change — using a resolved strategy id following the precedence
  `WatchlistBinding.strategy_id || owningStrategy`. Narrower-coverage trade-off named explicitly in
  FR-9/AC-6 above; the additive-proto-field option (b) is a named follow-up, not built here.
- [x] ~~Single-symbol screening must not surface `ScreenResult.score`~~ — **Resolved** (design.md):
  two additive `ScreenResult` proto fields (`criterion_raw_values`, `criterion_passed`) expose the
  engine's already-computed raw per-criterion values — real per-criterion data, not a
  reuse-repackaging of the same broken normalized fields round 1 of the design debate initially
  (and incorrectly) proposed. See corrected Proto Contract Changes above.
- [x] ~~Pre-existing `GetPosition` `account_id` gap~~ — **Resolved** (design.md): fixed in-scope, as
  this feature's first backend step, paired with a Go regression test (C-08).
- [x] ~~Any other useful data currently missing~~ — **Closed** (design.md): no further gap surfaced
  beyond what recon already inventoried; the design debate's own page-structure round (round 4) is
  itself the mechanism that caught the one thing that would otherwise have gone silently missing —
  the new sections being unreachable for unheld symbols due to the inherited all-or-nothing position
  gate.
- [x] ~~**(New, 2026-08-15) FR-6 indicator overlay panels — architecture re-opened.**~~ **Resolved**
  (design.md § "Design Addendum — FR-6", 3-round full debate, approved 2026-08-15). All the named
  sub-questions were answered: series are sourced via a new `AnalysisService.GetIndicatorSeries` RPC
  that reuses the existing `_compute_component`/`align_indicator_points` logic server-side (which
  already handles both builtin `ComputeIndicator` and custom-formula `ExecuteFormula` per component,
  returning full aligned series — the `ExecuteFormula`-returns-a-series concern was verified against
  `evaluator.py`'s existing usage); input closes+times are the page's own already-fetched candlestick
  bars (structural x-axis parity, no second fetch); panels render as stacked `recharts` charts
  (`FormulaRunResult.tsx` pattern), not a `lightweight-charts` second pane; warm-up/gap points use
  `DoubleValue` presence (no fabricated `0.0`); and zero-components / unresolvable-strategy /
  per-component-error all degrade to explicit no-data states.

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
- **fails.md 2026-08-08 (screener-data-readiness-polling)**: any value computed relative to a
  result set's full membership (universe-relative normalization, cross-row ranking, a percentile,
  a min/max) breaks when computed from a narrowed/single-item subset instead of the original full
  set — confirmed live and unguarded in `ScreenSymbols`' `_normalize_universe` for FR-8's
  single-symbol case (recon, 2026-08-10). Design the single-symbol screening section around raw
  per-criterion values, never the composite `score`.
- **fails.md 2026-07-01 (060-screener-engine)**: a new UI page is unreachable unless it's
  registered in the shared nav with a reachability test — do not let this ship linked only from the
  pages it replaces.
