# Recon: symbol-page-panel-refinements

**Phase 0 dossier** — grounded facts for `/sdd-design` and `/sdd-spec`. Evidence is `path:line`.

## Objective

Refine the trader symbol page (`/trader/positions/[symbol]`) so every section follows the Card/panel
pattern, remove two redundant/broken panels (Manage, Broker), make Fundamentals always-on, tab a
symbol's multiple live opportunities, and drive Indicators/Backtests/"Why this fired" from one
user-controllable strategy selection (`?strategy=` → watchlist binding → picker; default empty). UI
(`xstockstrat-ui`) only — no proto/config/DB/backend change.

## Codebase Map

Single affected service: **`xstockstrat-ui`** (`/trader` segment).

- **Page**: `services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx`
  - Section spine (feature 139): `sectionGroups` Overview/Trade/Research/Analysis `:224-229`; sections `:345,369,380,397`.
  - `owningStrategy` (orders-derived, to be DROPPED as a resolution source) `:86-92`.
  - `boundStrategyId` (watchlist binding) `:127-141`; `symbolOpportunities` / `opportunity` `:146-154`.
  - Trade panels (`tradePanels`: Position stats / Orders / Place order) `:233-270`.
  - Research branch: watchlisted → `researchPanels` group; else stacked `symbolOpportunities.map(...)` + `SymbolScreening` `:380-393`.
  - Analysis panels (Backtests + Backfill coverage) `:300-311`.
  - `PositionBody` (full-width header + `lg:grid-cols-[1fr_320px]` sidebar w/ Risk&exit / **Manage** / Why-it's-held / **Broker**) `:568-773`; Manage `:705-727`, Broker `:751-768`.
  - `OpportunitySection` `:778-843`; `FundamentalsSection` `:848-896`; `BacktestsSection` (resolves on `strategyId` prop) `:901-1009`; `IndicatorSection` (resolves on `strategyId` prop) `:1016-1061`; `BackfillSection` `:1066-1110`.
  - Both `BacktestsSection` and `IndicatorSection` are passed `strategyId={boundStrategyId || owningStrategy}` `:304,360` — the resolution the feature replaces.
- **Readiness panel**: `services/xstockstrat-ui/src/components/insights/SignalReadiness.tsx`
  - Reads `?strategy=` `:34`; `liveEnabled` filter `:32`; `Select` picker `aria-label="Strategy"` `:67-78`; strategy-track-record block `:143`. Rendered ONLY on the symbol page (`insights/market/[symbol]/page.tsx` is a redirect-only stub `:1-22`).
- **Grouping primitive**: `services/xstockstrat-ui/src/components/trader/SymbolPanelGroup.tsx` — desktop columns / mobile `ToggleGroup` tabbed; every panel stays mounted; 1 panel → bare, 0 → null `:27-78`.
- **Section nav**: `services/xstockstrat-ui/src/components/trader/SymbolSectionNav.tsx` — sticky `ToggleGroup`; writes bare `#id` via `history.replaceState` preserving `?strategy=` `:100-106`.

## Patterns to REUSE (anti-duplication core)

- **Strategy picker + `liveEnabled` filter** — mirror `SignalReadiness.tsx:32,67-78` exactly:
  `useStrategyDefinitions(false)` → `.filter((s) => s.liveEnabled)`, a `Select` of `<SelectItem value={s.strategyId}>{s.displayName || s.strategyId}</SelectItem>`. Do NOT invent a new list source.
- **`?strategy=` read** — `useSearchParams().get('strategy')` (`SignalReadiness.tsx:34`); **write** — bare-hash `history.replaceState` convention (`SymbolSectionNav.tsx:100-106`) preserves the query; the strategy write is its mirror (preserve the `#section` hash, don't trigger Next nav).
- **Panel grouping** — `SymbolPanelGroup` (`SymbolPanelGroup.tsx`) for tabbing the opportunities (FR-1) and the Position/Risk&exit split (FR-2). Its tab bar is `role="radio"` (not `tab`), deliberately avoiding the section-nav's `getByRole('tab')`-collision (`SymbolPanelGroup.tsx:20-24`).
- **`Select`/`ToggleGroup` primitives** — `src/components/ui/select.tsx:174` (exports incl. `SelectTrigger size?: 'sm'|'default'`), `src/components/ui/toggle-group.tsx:22,86`.
- **Opportunity data** — `useOpportunities(minConviction=0)` key `['opportunities', min]` (`useOpportunities.ts:17`); key panels on `opportunity.opportunityKey`, label on `strategyId` (`analysis.proto:485-496`).
- **Fixtures (C-12/C-13)** — reuse `e2e/fixtures/{opportunities,strategies,positions,fundamentals,orders,indicatorSeries}.ts`; `STRATEGY_DEF_LIVE`/`STRATEGY_DEF_DENY` are `liveEnabled:true` (`strategies.ts:53,68`), `FUNDAMENTALS_AAPL` (`fundamentals.ts`), `POSITION_AAPL/MSFT` (`positions.ts`).

## Dependencies

- Proto/RPC: none new. Consumes existing `ListOpportunities`, `GetFundamentals`,
  `ListStrategyDefinitions`, `GetStrategy`, `GetIndicatorSeries`, `ListBacktests`, `RunBacktest`,
  `EvaluateReadiness` via existing browser clients/hooks. `StrategyDefinition` carries
  `strategyId`/`displayName`/`liveEnabled` (`analysis.proto:254`; consumed camelCase `SignalReadiness.tsx:32,73`).
- Migration chain: n/a. Config keys: none. New env vars: none.

## Risks / Not-found

- **`getByLabel('Strategy', {exact:true})` is load-bearing** — `position-detail.spec.ts:315` expects
  exactly ONE picker so labeled; `symbol-section-nav.spec.ts` / `signal-readiness` testid also depend
  on the readiness panel. Three synced pickers all labeled "Strategy" ⇒ ambiguous locator (matches the
  `fails.md` 2026-07 Breadcrumb implicit-role trap). **The three pickers must have distinct accessible
  names** and the spec must be updated in the same PR (C-10, P-06). Related e2e anchors that must stay
  green or be updated: `position-detail.spec.ts` Risk & exit `:29,66,86,132`, Opportunity heading
  `:113,133`, Fundamentals heading `:146,164`, section radios `:440,467`, "Trade panels" radiogroup
  radios Position/Orders & fills/Place order `:480-488`, no-strategy text `/No strategy resolves for …/`.
- **Mock returns ONE opportunity per symbol** (`mock-backend.ts listOpportunities :612`; `opportunities.ts`
  has one row per symbol). FR-1 (tab multiple opportunities) is **untestable without new fixture/mock
  data** — a symbol with ≥2 live-strategy opportunities must be added (C-12/C-13, in the same step).
- **Adding "Risk & exit" to the Trade panels group** changes the `radiogroup name="Trade panels"`
  membership asserted at `position-detail.spec.ts:480-488` — spec update required.
- **`FUNDAMENTALS_AAPL` is the only fundamentals fixture**; `getFundamentals` returns `Unavailable`
  for other symbols (`mock-backend.ts:474-482`). FR-5's always-on panel on a non-AAPL symbol exercises
  the no-data/error branch — fine, but a positive always-on test wants AAPL (non-watchlisted).
- `?strategy=` write must not clobber the section `#hash` (both use `history.replaceState`) — design
  the URL update to carry both, or accept query-only + let the section-nav own the hash.

## Recommended Scope (advisory step boundaries)

1. **Strategy selection state + shared picker** — lift `selectedStrategyId` to the page (seed `?strategy=`
   → `boundStrategyId` → empty); build one reusable `<StrategyPicker>` (liveEnabled list) with a
   caller-supplied distinct `aria-label`; wire into Indicators, Backtests headers; make `SignalReadiness`
   controlled (props `strategyId`/`onStrategyChange`), drop `owningStrategy`. + e2e.
2. **Research section**: tab all `symbolOpportunities` via `SymbolPanelGroup`; make Fundamentals
   always-on. + fixture/mock for a multi-opportunity symbol. + e2e.
3. **Trade section / PositionBody**: split into Card "Position" panel + "Risk & exit" panel in the
   panel group; remove Manage + Broker. + e2e updates for the new "Trade panels" membership.
