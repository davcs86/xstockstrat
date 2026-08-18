# Recon: symbol-page-section-nav

**Phase 0 dossier — written by /sdd-design. Grounded in a `codebase-discovery` pass over `xstockstrat-ui`.**

## Objective

Group the ~10 stacked `Card` sections of `/trader/positions/[symbol]` behind a same-page navigation
control so a trader can reach a lower section (Backtests, indicator panels, Coverage) without scrolling
the whole page, on desktop and mobile — without changing any section's behavior, data, or gating
(feature 125 owns that). UI-only; no backend/proto/config/DB.

## Codebase Map (`xstockstrat-ui`, all `path:line` verified)

**The page** — `src/app/trader/positions/[symbol]/page.tsx`, a single-column stack:
- Wrapper: `:214` `<AppShell>` → `:215` `<div className="p-4 sm:p-6 space-y-4">` (the section stack).
- Sections in render order + gating:
  - Breadcrumb `:218-221` (always) · title `<h1>` `:226` (always)
  - Loading skeleton `:228-233` (`isLoading`) · genuine-error `:234-236` (`genuineError`)
  - **Price chart** `:240` `<SymbolPriceChart>` (always; comp `:322`) — `timeframe` hardcoded `:93` `const timeframe: Timeframe = '1Day'`; **no `Tabs`** remain (feature 143 removed the chart switcher — confirmed)
  - **Indicator panels** `:252` `<IndicatorSection strategyId={boundStrategyId||owningStrategy}>` (always; comp `:921`)
  - **Orders & fills** `:259` `<SymbolOrdersCard>` (always; comp `:377`)
  - **Trade widget** `:261-270` inline `<Card>`+`<OrderForm mode initialSymbol>` (always)
  - **Watchlist-conditional block** `:275-289`: `watchlistsLoading`→Skeleton `:276`; `isSymbolWatchlisted`→`<OpportunitySection>` `:278` + `<Suspense><SignalReadiness/></Suspense>` `:280-282` + `<FundamentalsSection>` `:283` + `<MuteForStrategy>` `:285`; else→`<SymbolScreening>` `:288`
  - **Backtests** `:293` `<BacktestsSection>` (always; comp `:806`)
  - **Backfill coverage** `:296` `<BackfillSection>` (always; comp `:971`)
  - **Held-position body** `:298-313`: `position?.symbol`→`<PositionBody>` (header + stat grid + `lg:grid-cols-[1fr_320px]` Risk/Manage/Why/Broker sidebar, comp `:473`); else `positionNotFound`→`<CardNotice>` `:306`
- Gating state: `genuineError`/`positionNotFound` `:210-211`; `isSymbolWatchlisted`/`boundStrategyId` `:124-138`; `owningStrategy` `:83-89`.
- `?strategy=` searchParam is **not** read in `page.tsx`; it lives in `SignalReadiness.tsx:27,34`
  (`useSearchParams().get('strategy')` seeded into `useState` on mount).

**Candidate shadcn primitives** (`src/components/ui/`): `tabs.tsx:80` (`Tabs/TabsList/TabsTrigger/TabsContent`),
`toggle-group.tsx:86` (`ToggleGroup/ToggleGroupItem`), `accordion.tsx:84` (`Accordion/AccordionItem/AccordionTrigger/AccordionContent`).
**`scroll-area.tsx` is ABSENT** (Not found — would need `npx shadcn add`).

**Mobile/nav**: `BottomTabBar.tsx:37` `fixed inset-x-0 bottom-0 z-40 … sm:hidden`, tap targets `:52` `min-h-[56px]`,
built from `NAV_GROUPS.slice(0,4)`; content wrappers add `pb-20 sm:pb-0`. The header's Row-2 cross-**page**
sub-nav uses `aria-label="Section"` (`PlatformHeader.tsx:348`) — a *different* concept; a new same-page nav
must **not** reuse that label.

## Patterns to REUSE

- **shadcn `Tabs` usage exemplars** (if Tabs chosen): `RuleEditor.tsx:177-181` (Visual/JSON), `FormulaReferencePanel.tsx:50-57` (4-tab reference). Copy their composition; do not hand-roll.
- **`ToggleGroup` as a segmented control**: `insights/opportunities/page.tsx:212` (`type="multiple"` filter row), `OrderForm.tsx`. For a single-select section-nav use `type="single"`.
- **Fixtures** (`e2e/fixtures/`, C-12/C-13): `POSITION_AAPL`/`positionForSymbol` (positions.ts), `ORDERS`/`orderForId` (orders.ts), `OPPORTUNITIES`/`symbolReadiness` (opportunities.ts), `FUNDAMENTALS_AAPL` (fundamentals.ts), `backfillJob` (backfillJobs.ts), `INDICATOR_SERIES_AAPL` (indicatorSeries.ts), `criterionDetailRow` (screenResults.ts), `mockWatchlists` (helpers/watchlistMock.ts), auth `addAuthCookie` (helpers/auth.ts).
- **Existing e2e to keep green**: `position-detail.spec.ts` (20 tests, section content via `getByText`/`getByTestId`) and `mobile-overflow.spec.ts` (covers `/trader/positions/AAPL` at 390px, asserts `scrollWidth-clientWidth<=1`).

## Dependencies

- No proto / RPC / migration / config / env-var change (UI-only). No new inter-service edge.
- Route already registered (feature 096/125) — **no `NAV_GROUPS` entry needed** (C-10(a) satisfied; this reorganizes an existing route, adds no new one).
- New presentational component under `src/components/trader/` — must pick a fresh filename (e.g. `SymbolSectionNav.tsx`); none of the 19 existing `components/trader/*` collide.
- Merge order: depends on 125 (delivers the sectioned page) + 143 (same-file); **both already merged to `main-dev`** — no active blocker.

## Risks / Not-found

1. **`position-detail.spec.ts` expects multiple sections visible at once** on a single `page.goto`
   (chart+orders+trade together `:81-83,:126-128`; readiness/backtests/backfill/indicators each asserted).
   A pattern that **hides inactive sections** (shadcn `Tabs`, Radix `Accordion` — both unmount/hide collapsed content) would break many of these, forcing broad spec rewrites and per-section re-navigation. A pattern that **keeps all sections mounted** (anchor/scroll-to nav) keeps them green.
2. **`role="tab"` collision trap** (`fails.md` 2026-08-09 / `:927-946`): Radix `TabsTrigger` hardcodes `role="tab"`. Trader/insights e2e already query `getByRole('tab')` (`strategy-authoring.spec.ts`, `watchlists.spec.ts`) and `chart-panel.spec.ts:134` asserts `getByRole('tab').toHaveCount(0)` on the `/trader/` dashboard (different route, but the pattern is live). A Tabs nav must design its locators up front and run the broader suite at the wiring step.
3. **`aria-label="Section"` already claimed** by the header sub-nav — a new anchor-nav must use a distinct label (`getByRole('navigation',{name:'Section'})` is asserted in `backfills.spec.ts`, `nav-reachability.spec.ts`).
4. **Fetch-lifecycle under unmount (FR-7)**: unmounting the Research/Backtests groups drops in-flight polling queries and a running-backtest mutation; keeping them mounted avoids this entirely.
5. **`?strategy=` seed**: read on mount in `SignalReadiness` via `useSearchParams` — safe as long as that component stays mounted (anchor-nav) or re-reads the URL when its group mounts (Tabs). No prop-threading needed.
6. **`scroll-area.tsx` absent** — a design leaning on `ScrollArea` needs `npx shadcn add scroll-area`; native `scrollIntoView` needs no primitive.
7. **No same-page section-nav precedent** in the repo — this establishes the pattern; no existing helper to reuse for the nav mechanism itself.
8. **Mobile `BottomTabBar` (fixed, z-40, 56px, `sm:hidden`)** — a sticky section-nav must not overlap it; keep the `pb-20 sm:pb-0` clearance and place a sticky nav at the top, not the bottom.

## Recommended Scope (advisory, for the debate + /sdd-spec)

1. New `SymbolSectionNav` presentational component (shadcn primitive TBD by debate) + section-group model.
2. Wire it into `positions/[symbol]/page.tsx`, grouping the existing sections without changing their gating/behavior (FR-3), all sections mounted (mitigates Risks 1/4/5) OR an explicit fetch-lifecycle decision if a hiding pattern is chosen.
3. e2e: update `position-detail.spec.ts` for the nav interaction only; keep `mobile-overflow.spec.ts` green; add a nav-interaction test with collision-safe locators.
