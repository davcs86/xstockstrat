# Implementation Spec: symbol-page-panel-refinements

**Status**: `pending`
**Created**: 2026-08-18
**Feature**: `docs/roadmap/features/145-symbol-page-panel-refinements/feature.md`
**Total Steps**: 3
**Feature Branch**: `feature/symbol-page-panel-refinements` (harness branch: `claude/symbol-page-ui-refinements-t2xp26` — single PR into `main-dev`, no per-step feature-step branches)

---

## Execution Summary

This is a pure `xstockstrat-ui` `/trader`-segment presentation + client-state change (no proto / config /
DB / backend). All work lands in `src/app/trader/positions/[symbol]/page.tsx`, the shared
`src/components/insights/SignalReadiness.tsx`, one new co-located `StrategyPicker.tsx`, and the
`e2e/trader/position-detail.spec.ts` suite (+ one `e2e/fixtures/opportunities.ts` extension with its
`INVENTORY.md` row). Order: **Step 1** establishes the single lifted strategy selection and the reusable
picker (the load-bearing change every other panel depends on), **Step 2** re-panels the Research section
(tabbed opportunities + always-on Fundamentals), **Step 3** re-panels the Trade section (Position /
Risk & exit split, Manage + Broker removal). Steps 2 and 3 are independent of each other but both consume
Step 1's `effectiveStrategyId` derivation and controlled `SignalReadiness`.

**Consumer surface (C-14)**: the product spec names exactly one surface — UI `xstockstrat-ui` segment
`/trader`, the existing `/trader/positions/[symbol]` page (already reachable per C-10, no new route, so
no `PLATFORM_SUBNAV` registration is required). All three steps land on that surface; there is no backend
step because no backend behavior changes.

**No coverage-threshold `test` step is separately required**: `xstockstrat-ui` (Next.js) has no CI coverage
threshold (`reference/spec-template.md` § coverage table — Next.js row → `pnpm test:e2e`). Each step is a
frontend `service` step that carries its own Playwright e2e assertions written **RED-first** (P-06) — the
new assertion is added and observed failing before the implementation lands, then observed passing after.

## Step Dependencies

- Step 2 requires Step 1: the Research section's readiness panel renders the **controlled** `SignalReadiness`
  (props `strategyId`/`onStrategyChange`) introduced in Step 1, and reads `effectiveStrategyId`.
- Step 3 requires Step 1: `owningStrategy` is dropped as a *resolution* source in Step 1 (the
  `strategyId={boundStrategyId || owningStrategy}` passes become `effectiveStrategyId`) while its *display*
  use is retained; Step 3 depends on that display value still existing for the Position subtitle and
  "Why it's held" panel (design Open Risk R3 — enumerate every `owningStrategy` ref).
- Steps 2 and 3 are mutually independent (Research vs. Trade section) and may execute in either order after Step 1.
- **Open Risk R1** (design.md) is discharged in **Step 1**: after the three synced pickers exist, grep the
  **whole** e2e suite for `getByLabel('Strategy')` / `getByRole('combobox')` collisions and run a broad e2e
  pass — the collision surfaces on a *different* spec than the one under test (fails.md 2026-08-09 Breadcrumb).
- **Open Risk R2** (design.md) is discharged in **Step 1**: the page-level `useSearchParams()` read must sit
  inside a `Suspense` boundary; `pnpm build` must show no `useSearchParams()`-CSR-bailout error.

---

### Step 1 — service: Single lifted strategy selection + reusable StrategyPicker; controlled SignalReadiness

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/insights/StrategyPicker.tsx` — create
- `services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx` — modify
- `services/xstockstrat-ui/src/components/insights/SignalReadiness.tsx` — modify
- `services/xstockstrat-ui/e2e/trader/position-detail.spec.ts` — modify

(No new env var or port → no `docker-compose.yml` / `.do/app.dev.yaml` / `.do/app.yaml` edits. Confirmed: the
product spec's `## Config Key Changes` and `## Proto Contract Changes` are both "none", and this change adds
no `*_ENDPOINT` var.)

**Reviewers**: `xstockstrat-ui` (service owner) — Trading UI correctness, analytics display accuracy, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI, no direct DB access

**Codebase Evidence**:
- Strategy-list source to mirror exactly (do NOT invent a new list): `SignalReadiness.tsx:28,32` —
  `const { data: defs } = useStrategyDefinitions();` then
  `(defs?.definitions ?? []).filter((s) => s.liveEnabled)`. The hook default is `includeInactive = false`
  (`src/hooks/useStrategyDefinitions.ts:17`), i.e. active strategies; `.filter(liveEnabled)` narrows to live.
- `Select` primitive + `SelectTrigger aria-label` pattern: `SignalReadiness.tsx:67-78`
  (`<Select value={strategyId} onValueChange={setStrategyId}>` → `SelectTrigger className="h-8 w-56" aria-label="Strategy"` → `SelectItem value={s.strategyId}>{s.displayName || s.strategyId}`). Imports at `SignalReadiness.tsx:7-13`.
- Orders-derived `owningStrategy` (drop as *resolution* source, keep as *display* value): computed
  `page.tsx:86-92`; current resolution passes to be changed — `page.tsx:304` (`BacktestsSection strategyId={boundStrategyId || owningStrategy}`) and `page.tsx:360` (`IndicatorSection strategyId={boundStrategyId || owningStrategy}`). Display uses to KEEP: subtitle `page.tsx:612` (`· owned by ${owningStrategy}`) and "Why it's held" panel `page.tsx:729,738,743,744` (all inside `PositionBody`, refactored in Step 3).
- Watchlist binding read (a resolution input to keep): `page.tsx:127-141` → `boundStrategyId`.
- `?strategy=` read pattern: `SignalReadiness.tsx:27,34` (`useSearchParams()` → `searchParams?.get('strategy') ?? ''`). URL-write mirror to imitate (preserve `#section` hash, no Next nav): `SymbolSectionNav.tsx:104-106` (`window.history.replaceState(null, '', '#${id}')`).
- `SignalReadiness` currently self-owns its picker via `useState(searchParams?.get('strategy') ?? '')` (`:34`) and `useSearchParams()` (`:27`) — these are removed and replaced by controlled props; it renders ONLY on this page (`insights/market/[symbol]/page.tsx` is a redirect stub — recon.md).
- `IndicatorSection` success branch returns bare `<IndicatorPanels .../>` with no card header (`page.tsx:1060`); its empty/no-strategy branch is a `Card`+header at `page.tsx:1041-1056`; loading is a bare `Skeleton` at `page.tsx:1038-1039`. `BacktestsSection` success branch already has a `Card`+`CardHeader` at `page.tsx:951-957`; its empty/no-strategy branch is a `Card` at `page.tsx:912-926`.
- Existing Suspense boundary around `SignalReadiness`: `page.tsx:284`. Page component is `'use client'` (`page.tsx:1`) and does not currently read `useSearchParams` at the top level.
- `CardTitle` renders an `<h3>` (`src/components/ui/card.tsx:36-44`), so `getByRole('heading', { name })` targets card titles — used already at `position-detail.spec.ts:113,133,146`.
- Test that pins the readiness picker's accessible name (must be updated): `position-detail.spec.ts:315` — `page.getByLabel('Strategy', { exact: true }).click()`. Other-spec `getByRole('combobox')` uses are all scoped (`form.getByRole(...)` / `.first()`) — `order-form.spec.ts:48`, `orders.spec.ts:152`, `account-selector.spec.ts:18` — and target other pages, not this one.
- Readiness tests whose premise flips once a watchlist binding pre-selects the strategy: `position-detail.spec.ts:292-303` ("prompts to pick a strategy when none is threaded") and `:305-319` ("readiness picker excludes non-live strategies") both call `watchlist(page, 'AAPL', 'strat-live-001')` (helper default binds `strat-live-001`, `:497-501`) then assert the empty "Select a strategy" prompt — under the new derivation `effective = picked ?? url ?? bound ?? ''` a bound symbol resolves and now evaluates.
- Fixtures reused (C-12, no new fixture in this step): `STRATEGY_DEF_LIVE` (`strat-live-001`, `liveEnabled:true`) and `STRATEGY_DEF_INACTIVE` (`strat-live-002`, `liveEnabled:false`) — `e2e/fixtures/strategies.ts:53-65`; `watchlist()` / `readinessCard()` helpers in the spec (`:495-529`).

**TDD**: `red-green required`

**Instructions**:
1. **Create `src/components/insights/StrategyPicker.tsx`** (co-located with `SignalReadiness`, since it shares
   the `analysisClient`-coupled `useStrategyDefinitions` — NOT `components/shared/`, per design's layering
   decision). `'use client'`. Props: `{ value: string; onChange: (id: string) => void; ariaLabel: string }`.
   Body mirrors `SignalReadiness.tsx:28,32,67-78` exactly: `const { data: defs } = useStrategyDefinitions(false);`
   → `const strategies = useMemo(() => (defs?.definitions ?? []).filter((s) => s.liveEnabled), [defs]);` →
   `<Select value={value} onValueChange={onChange}>` with `<SelectTrigger className="h-8 w-56" aria-label={ariaLabel}>`,
   `<SelectValue placeholder="Select a strategy…" />`, and a `SelectItem` per strategy
   (`value={s.strategyId}`, text `{s.displayName || s.strategyId}`). Do not re-declare a second strategy-list source.
2. **Page-level selection state (`page.tsx`)**. Add `const [pickedStrategyId, setPickedStrategyId] = useState<string>()`
   (default `undefined`). Read the URL seed via `useSearchParams()` and derive — no effect, no `seededRef`:
   `const urlStrategy = searchParams?.get('strategy') ?? '';`
   `const effectiveStrategyId = pickedStrategyId ?? (urlStrategy || boundStrategyId || '');`
   (precedence: picker choice → `?strategy=` → watchlist binding → empty). Add a single change handler shared
   by all three pickers that sets state AND mirrors to the URL without a Next navigation, preserving the
   `#section` hash (mirror `SymbolSectionNav.tsx:104-106`):
   `const handleStrategyChange = (id: string) => { setPickedStrategyId(id); const u = new URL(window.location.href); u.searchParams.set('strategy', id); window.history.replaceState(null, '', u.pathname + u.search + u.hash); };`
3. **Suspense boundary for `useSearchParams` (R2)**. Because the top-level page component now reads
   `useSearchParams()`, wrap the search-params-reading render in a `Suspense` boundary to avoid the Next 15
   static-prerender CSR-bailout build error (see `services/xstockstrat-ui/CLAUDE.md` § Frontend gotchas —
   Suspense; design §1). Rename the current default-export body to an inner component (e.g. `PositionDetailInner`)
   and make the default export render `<Suspense fallback={<div className="p-4 sm:p-6"><Skeleton className="h-16 w-full" /></div>}><PositionDetailInner /></Suspense>`. `Skeleton` and `Suspense` are already imported (`page.tsx:2,47`).
4. **Drop `owningStrategy` as a resolution source, keep it for display**. Change `page.tsx:304`
   `BacktestsSection ... strategyId={boundStrategyId || owningStrategy}` → `strategyId={effectiveStrategyId}` and add
   `onStrategyChange={handleStrategyChange}`. Change `page.tsx:360` `IndicatorSection ... strategyId={boundStrategyId || owningStrategy}`
   → `strategyId={effectiveStrategyId}` and add `onStrategyChange={handleStrategyChange}`. **Leave the `owningStrategy`
   useMemo (`:86-92`) and its display uses (subtitle `:612`, "Why it's held" `:729-748`) untouched** — they move with
   `PositionBody` in Step 3. Verify no other resolution site reads `owningStrategy`: `grep -n "owningStrategy" page.tsx`
   should show only the `useMemo`, the `PositionBody` prop pass (`:243`), and the display uses — no remaining
   `|| owningStrategy` resolution expression.
5. **Wire the picker into `BacktestsSection`**. It takes `strategyId` (`page.tsx:901`); add an `onStrategyChange: (id: string) => void`
   prop. Render `<StrategyPicker value={strategyId} onChange={onStrategyChange} ariaLabel="Strategy for Backtests" />`
   in the card header on **both** the no-strategy branch (reshape `:912-926` so its `CardHeader` carries the picker
   beside the "Backtests" title) and the resolved branch (`:951-957`, add the picker beside the title). The empty
   branch keeps its "No strategy resolves for {symbol} …" copy (P-03) but now also shows the picker so the user can
   select from the default-empty state.
6. **Wire the picker into `IndicatorSection`** (`page.tsx:1016`). Add an `onStrategyChange` prop. Give the section a
   stable `Card` shell with a `CardHeader` carrying the "Indicators" title + `<StrategyPicker value={strategyId} onChange={onStrategyChange} ariaLabel="Strategy for Indicators" />`
   on **every** branch (loading skeleton `:1038-1039`, empty `:1041-1056`, and the success branch that currently
   returns bare `<IndicatorPanels .../>` at `:1060` — wrap `IndicatorPanels` in the same `Card`/`CardContent` so the
   header+picker persist). Preserve the existing `data-testid`s (`indicator-panels-loading`, `indicator-panels-empty`,
   `indicator-panels`) and the RPC gate (`activeStrategyId = strategyId && hasComponents ? strategyId : ''`, `:1030`).
7. **Make `SignalReadiness` controlled** (`SignalReadiness.tsx`). Change the signature to
   `export function SignalReadiness({ symbol, strategyId, onStrategyChange }: { symbol: string; strategyId: string; onStrategyChange: (id: string) => void })`.
   Remove `useSearchParams` (`:27`) and the internal `useState(searchParams?.get('strategy') ?? '')` (`:34`); use the
   `strategyId` prop everywhere the local `strategyId` was used (`:41-60,82,143`). Replace the inline `<Select>`
   (`:67-78`) with `<StrategyPicker value={strategyId} onChange={onStrategyChange} ariaLabel="Strategy for Why this fired" />`.
   Keep all other behavior (isHeld/rule trace, track record) unchanged.
8. **Feed the controlled `SignalReadiness` from the page**: at `page.tsx:285` change
   `<SignalReadiness symbol={symbol} />` → `<SignalReadiness symbol={symbol} strategyId={effectiveStrategyId} onStrategyChange={handleStrategyChange} />`.
9. **Distinct accessible names** across the three pickers are `"Strategy for Indicators"`, `"Strategy for Backtests"`,
   `"Strategy for Why this fired"` (step 5/6/7) so the synced pickers never collide on `getByLabel('Strategy')`.
10. **e2e (RED-first)** in `position-detail.spec.ts`:
    - Update `:315` `page.getByLabel('Strategy', { exact: true })` → `page.getByLabel('Strategy for Why this fired', { exact: true })`, and change that test to seed an **empty** binding so the prompt still shows: `watchlist(page, 'AAPL', '')` (bind with empty strategyId → `effectiveStrategyId=''` → the "Select a strategy" prompt renders and the picker is empty). Keep its assertions that "Live Test Strategy" is an option and "Inactive Strategy" is not.
    - Update `:292-303` ("prompts to pick a strategy when none is threaded") to `watchlist(page, 'AAPL', '')` so no binding resolves and the empty prompt still asserts (a bound symbol now evaluates — accepted behavior change, design §4).
    - **AC-5 (sync)** — new test: `watchlist(page, 'AAPL', '')` (present but unbound so all three pickers show, empty), go to `/trader/positions/AAPL`, open the Indicators picker (`getByLabel('Strategy for Indicators', { exact: true })`), pick "Live Test Strategy", then assert the Backtests panel now shows the resolved strategy id (`strat-live-001`, from the Backtests header meta at `page.tsx:955`) and the readiness card (`readinessCard(page)`) no longer shows "Select a strategy to evaluate". Assert the URL reflects `strategy=strat-live-001` (`await expect(page).toHaveURL(/strategy=strat-live-001/)`).
    - **AC-6 (`?strategy=` pre-select)** — new test: go to `/trader/positions/AMZN?strategy=strat-live-001` (AMZN non-watchlisted, unheld → `getPosition` NotFound is fine). Assert the Backtests panel keys on `strat-live-001` (its header meta shows `strat-live-001`, NOT "No strategy resolves for AMZN"), and the Indicators panel is not the "No strategy resolves for AMZN" empty state (getStrategy(`strat-live-001`) returns components → `indicator-panels` renders). (Readiness stays watchlist-gated, so it is legitimately absent for AMZN — do not assert it.)
    - Leave `:258-290`, `:351-365`, `:367-381` as-is (they thread `?strategy=` explicitly, so `effectiveStrategyId` still resolves the same value; `getByText('Live Test Strategy').first()` at `:280` still holds).

**Verification**:
```
cd services/xstockstrat-ui
# RED capture happens in the execute loop before implementation. After implementation:
pnpm lint
pnpm build          # R2: MUST NOT emit "useSearchParams() should be wrapped in a suspense boundary"
pnpm exec playwright test e2e/trader/position-detail.spec.ts
# R1 — full-suite collision sweep + broad pass (fails.md 2026-08-09): the collision can surface on a DIFFERENT spec
grep -rn "getByLabel('Strategy')\|getByRole('combobox')" e2e/    # confirm no UNSCOPED page-level 'Strategy' locator remains on this page's specs
pnpm test:e2e       # broad pass — no getByLabel/combobox ambiguity regressions elsewhere
# Confirm owningStrategy is no longer a resolution source:
grep -n "owningStrategy" src/app/trader/positions/\[symbol\]/page.tsx   # only useMemo + PositionBody prop + display uses; no "|| owningStrategy"
```
Pass condition: `pnpm build` clean (no CSR-bailout error), `position-detail.spec.ts` green including the new
AC-5/AC-6 tests and the updated readiness tests, the broad `pnpm test:e2e` green, and no unscoped
`getByLabel('Strategy')` locator collision.

---

### Step 2 — service: Research section — tabbed opportunities panel group + always-on Fundamentals

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx` — modify
- `services/xstockstrat-ui/e2e/fixtures/opportunities.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify
- `services/xstockstrat-ui/e2e/trader/position-detail.spec.ts` — modify

**Reviewers**: `xstockstrat-ui` (service owner) — Trading UI correctness, analytics display accuracy, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI, no direct DB access

**Codebase Evidence**:
- Current Research render (`page.tsx:380-393`): watchlisted → `<SymbolPanelGroup panels={researchPanels} ariaLabel="Research panels" />`; else a `div` with `symbolOpportunities.map((o) => <OpportunitySection key={o.opportunityKey} opportunity={o} symbol={symbol} />)` **stacked vertically** + `<SymbolScreening symbol={symbol} />`.
- `researchPanels` (`page.tsx:274-296`): `[Opportunity (single tie-broken `opportunity`), Why this fired (`SignalReadiness`), Fundamentals (`FundamentalsSection`), Mute (`MuteForStrategy`)]`.
- `symbolOpportunities` = all opps for this symbol (`page.tsx:146-149`, from `useOpportunities(0)` at `:145`); the single tie-broken `opportunity` at `:150-154`. `OpportunitySection` keys/labels: card title is always literal "Opportunity" (`page.tsx:807`), strategy shown in metaBits (`:801`); component at `page.tsx:778-843`.
- `SymbolPanelGroup` behavior: 0 panels → null; **1 panel → renders bare** (no tab bar); ≥2 → desktop columns / mobile `ToggleGroup` tab bar labeled by each panel's `label`, all panels stay mounted (`SymbolPanelGroup.tsx:36-37,43-77`). Its tab items are `role="radio"` (not `tab`) — `SymbolPanelGroup.tsx:20-24`.
- `FundamentalsSection` (`page.tsx:848-896`): symbol-level, self-contained error/no-data state (P-03) at `:878-882`; currently rendered only inside `researchPanels` (watchlisted branch).
- Mock serves one opportunity row per symbol: `OPPORTUNITIES` (`e2e/fixtures/opportunities.ts:10-94`) has a single row per symbol; `mock-backend.ts:612-617` returns `OPPORTUNITIES.filter((o) => o.muted || o.conviction >= min)`. **FR-1 (tab multiple opportunities) is untestable without a multi-opportunity symbol** — must be added (recon Risk).
- `STRATEGY_DEF_LIVE` (`strat-live-001`) and `STRATEGY_DEF_DENY` (`strat-001`) are both `liveEnabled:true` (`e2e/fixtures/strategies.ts:53,68`) — two live strategies exist for a multi-opportunity symbol to legitimately carry.
- INVENTORY Opportunity-queue row: `e2e/fixtures/INVENTORY.md:23`.
- Existing Research-branch e2e: watchlisted Opportunity+Readiness `:100-121`; non-watchlisted live-opportunity Opportunity-visible-but-Readiness-hidden `:123-137`; Fundamentals watchlisted-with-data `:139-153` and no-data `:155-168`; non-watchlisted Screening `:170-195`. `:136` asserts "Why this fired" **hidden** for a non-watchlisted symbol (readiness stays watchlist-gated).

**TDD**: `red-green required`

**Instructions**:
1. **Tab all opportunities as one panel group in both branches**. Build an `opportunityPanels: SymbolPanel[]`
   from `symbolOpportunities.map((o) => ({ id: o.opportunityKey, label: o.strategyId || o.symbol, node: <OpportunitySection opportunity={o} symbol={symbol} /> }))`.
   Render `<SymbolPanelGroup panels={opportunityPanels} ariaLabel="Opportunities" />` — with 1 opportunity it
   renders the single card bare (keeping `getByRole('heading', { name: 'Opportunity' })` green for AAPL); with ≥2
   it tabs (mobile) / columns (desktop), one `OpportunitySection` per strategy.
2. **Restructure the `#research` section** (`page.tsx:380-393`) to:
   - always render the `opportunityPanels` group (step 1) and the always-on `<FundamentalsSection symbol={symbol} />` (FR-5);
   - **watchlisted branch**: additionally render the controlled `<SignalReadiness symbol={symbol} strategyId={effectiveStrategyId} onStrategyChange={handleStrategyChange} />` (inside the existing `Suspense`) and `<MuteForStrategy symbol={symbol} />`;
   - **non-watchlisted branch**: additionally render `<SymbolScreening symbol={symbol} />`;
   - keep the `watchlistsLoading` skeleton guard (`page.tsx:381-382`) so neither side flashes.
   Choose the grouping so "Why this fired" + "Mute" remain **watchlist-gated** (design §2; `position-detail.spec.ts:136` asserts they are hidden for a non-watchlisted symbol). Remove the now-unused single tie-broken `opportunity` memo consumer inside Research if it is no longer referenced (leave the `opportunity` memo itself only if still used elsewhere — `grep -n "opportunity\b" page.tsx` to confirm before deleting; if unused after this step, remove it and its `useMemo` at `:150-154`).
3. **Multi-opportunity fixture (C-12)**. In `e2e/fixtures/opportunities.ts`, append two rows for one
   non-watchlisted symbol (use `AMZN`) carrying two DISTINCT `liveEnabled` strategies — e.g. `strategyId: 'strat-live-001'`
   and `strategyId: 'strat-001'` — each a full `Opportunity` shape matching the existing rows (`action`, `conviction`
   (≥ the 0 floor), `passingConditions`/`totalConditions`, `thesis`, `source`, `validUntil: VALID_UNTIL`, distinct
   `opportunityKey` e.g. `u1|AMZN|strat-live-001` and `u1|AMZN|strat-001`, `provenance`). These serve unchanged through
   `mock-backend.ts:617`.
4. **INVENTORY row (C-12, same step)**. Update the Opportunity-queue row (`INVENTORY.md:23`) to note the AMZN
   multi-opportunity rows (a non-watchlisted symbol carrying ≥2 live-strategy opportunities, feature 145) and their
   consuming spec.
5. **e2e (RED-first)**:
   - **AC-1 (tabbed group)** — new test: go to `/trader/positions/AMZN` (non-watchlisted). Assert the Research
     section shows two Opportunity cards (`await expect(page.getByRole('heading', { name: 'Opportunity' })).toHaveCount(2)`
     at the default desktop viewport — both rendered as columns), and both strategy ids appear in the meta lines
     (`strat-live-001` / `strat-001`). Optionally at a mobile viewport (`setViewportSize({ width: 390 })`) assert the
     `Opportunities` radiogroup exposes both strategy-labelled radios.
   - **AC-4 (Fundamentals always-on)** — new/updated test: go to `/trader/positions/AAPL` **without** watchlisting it
     (non-watchlisted branch) and assert `getByRole('heading', { name: 'Fundamentals' })` is visible and shows AAPL data
     (`FUNDAMENTALS_AAPL` — P/E `31.40`), proving Fundamentals is no longer watchlist-gated. Keep the existing
     watchlisted-with-data and no-data Fundamentals tests (`:139-168`) green.
   - Confirm `:123-137` (non-watchlisted live-opportunity: Opportunity visible, "Why this fired" `toHaveCount(0)`) still
     passes with the restructured branches.

**Verification**:
```
cd services/xstockstrat-ui
pnpm lint
pnpm exec playwright test e2e/trader/position-detail.spec.ts
# C-12 fixture-import + inventory:
grep -n "from '../fixtures'\|from './fixtures'\|OPPORTUNITIES" e2e/trader/position-detail.spec.ts e2e/mock-backend.ts
grep -n "AMZN\|145" e2e/fixtures/INVENTORY.md    # confirm the multi-opportunity row was catalogued
```
Pass condition: `position-detail.spec.ts` green including the AC-1 (two Opportunity cards for AMZN) and AC-4
(Fundamentals renders for a non-watchlisted symbol) tests; existing watchlisted/non-watchlisted and Fundamentals
tests still green; `INVENTORY.md` updated in this commit alongside the fixture.

---

### Step 3 — service: Trade section — Position / Risk & exit panel split; remove Manage + Broker

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx` — modify
- `services/xstockstrat-ui/e2e/trader/position-detail.spec.ts` — modify

**Reviewers**: `xstockstrat-ui` (service owner) — Trading UI correctness, analytics display accuracy, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI, no direct DB access

**Codebase Evidence**:
- `tradePanels` (`page.tsx:233-270`): held → `[position-stats (PositionBody), orders, place-order]`; unheld → `[orders, place-order]`. The `position-stats` panel wraps `<PositionBody position equity owningStrategy />` (`:239-245`).
- `PositionBody` (`page.tsx:568-773`): header (symbol/side/qty/price/day-change/weight + Unrealized + Open R) `:588-632`; the `lg:grid-cols-[1fr_320px]` 2-column grid `:634`; left stat-tile grid `:637-654`; right sidebar Cards — **Risk & exit** `:659-703`, **Manage** `:705-727`, **Why it's held** `:729-749`, **Broker** `:751-768`. Subtitle "· owned by {owningStrategy}" `:612`.
- Manage panel's five buttons all deep-link `/trader?symbol=…` (`:715,722`) — duplicate of the on-page "Place order" `OrderForm` panel (`page.tsx:255-268`) → remove (FR-3). Broker panel (`:751-768`): account id already in the subtitle (`:610`), "See all positions" reachable via the breadcrumb "Exposure" (`page.tsx:318-321`) → remove (FR-4).
- `Row` helper (used by the Risk & exit `dl` and Broker) is defined at `page.tsx:1113-1128` and used inside `PositionBody` — keep it (still used by Risk & exit).
- `SymbolPanelGroup` renders a mobile tab bar (labels = panel `label`) once panels ≥ 2 (`SymbolPanelGroup.tsx:36-37,43-77`) → each new panel label becomes a `role="radio"` tab (hidden `md:hidden`, present in DOM).
- Trade-panels membership e2e (must update): `position-detail.spec.ts:471-492` asserts the `radiogroup name="Trade panels"` radios are exactly `['Position', 'Orders & fills', 'Place order']` (`:482-483`).
- Tests using a **bare, unscoped** `getByText('Risk & exit')`: `:29`, `:66`, `:86` (held/`toHaveCount(0)`), `:132`. Today "Risk & exit" appears once (a `CardTitle` inside the single `position-stats` node). After the split it becomes its own panel `label` → a second occurrence (the mobile radio tab) will exist in the DOM, making an unscoped `getByText('Risk & exit')` match 2 elements (strict-mode failure) at the desktop viewport. These must be scoped/counted.
- Held vs. unheld gate: `PositionBody` (and thus the Position/Risk&exit/Why-it's-held panels) render only when `position && position.symbol` (`page.tsx:234`); `:85-86` asserts "Risk & exit" `toHaveCount(0)` for the unheld ZZZZ — still correct after the split (panels only when held).

**TDD**: `red-green required`

**Instructions**:
1. **Split `PositionBody` into panel-shaped pieces**. Replace the single `position-stats` entry in `tradePanels`
   (`page.tsx:234-248`) with three entries, each still gated on `position && position.symbol`:
   - `{ id: 'position-stats', label: 'Position', node: <PositionPanel position equity owningStrategy /> }` — a `Card`
     containing the header (`:588-632`) + the stat-tile grid (`:637-654`);
   - `{ id: 'risk-exit', label: 'Risk & exit', node: <RiskExitPanel position /> }` — the existing Risk & exit `Card`
     (stop meter + risk/exit `dl`, `:659-703`) moved out of the sidebar verbatim;
   - `{ id: 'why-held', label: "Why it's held", node: … }` — the existing "Why it's held" `Card` (`:729-749`), still
     gated on `owningStrategy` (kept per design — its `owningStrategy` **display** value survives Step 1's
     resolution-source drop).
   Resulting held `tradePanels`: `[Position, Risk & exit, Why it's held, Orders & fills, Place order]`; unheld:
   `[Orders & fills, Place order]` (unchanged).
2. **Remove Manage (`:705-727`) and Broker (`:751-768`)** entirely. **Drop the `lg:grid-cols-[1fr_320px]` grid
   wrapper (`:634`)** and its left/right column `div`s — the stat grid and the Risk & exit / Why-it's-held cards are
   now sibling panels in the Trade `SymbolPanelGroup`, not a 2-column sidebar. Refactor `PositionBody` into the small
   panel components named in step 1 (Position header+stats, Risk & exit, Why it's held) so each is a self-contained
   `Card`; keep the `Row` helper (`:1113-1128`), `openR`/`fmtR`, `StatTile`, `Eyebrow` usages. **Keep the subtitle
   "· owned by {owningStrategy}" (`:612`)** in the Position panel (design's retained `owningStrategy` display; the
   Broker disclaimer at `:761-763` is dropped, per FR-4 — design chose not to fold it into a footnote).
3. Confirm no dangling references: `grep -n "Manage\|Broker\|1fr_320px" page.tsx` returns nothing in this page after
   the edit (the only remaining "Manage"/"Broker" occurrences, if any, must be unrelated); `grep -n "owningStrategy" page.tsx`
   still shows the memo + the Position-panel prop + display uses (no resolution expression — parity with Step 1).
4. **e2e (RED-first)**:
   - Update the Trade-panels membership assertion (`:482-483`) to the new set: `['Position', 'Risk & exit', "Why it's held", 'Orders & fills', 'Place order']`
     (the mobile-viewport test at `:471-492`). "Why it's held" renders only when `owningStrategy` is non-empty — AAPL's
     fixture orders must carry a `strategyId` for it to show; if AAPL has no owning strategy in the mock, assert the
     four always-present held panels (`Position`, `Risk & exit`, `Orders & fills`, `Place order`) and gate the
     "Why it's held" assertion on a fixture that has an owning strategy (confirm via the orders fixture before asserting).
   - Fix the unscoped `getByText('Risk & exit')` collisions introduced by the new panel label: at `:29`, `:66`, `:132`
     scope to the visible card title, not the hidden mobile tab — use `.first()` is insufficient (order not guaranteed);
     prefer `page.getByRole('radio', { name: 'Risk & exit' })` for the tab vs. a content-scoped title locator. Simplest
     robust fix: assert the panel's presence via a stable in-card text (e.g. `getByText('no stop set')` / factor `'Tech'`
     / flag `'Stop near'` already asserted at `:30-31,51`) OR change `getByText('Risk & exit')` to
     `getByText('Risk & exit').first()` only where a single visible instance is intended AND add a
     `nav`/card scoping. Keep `:85-86` (`toHaveCount(0)` for unheld ZZZZ) — still correct.
   - Verify Manage/Broker removal: add assertions that the page has no "Add"/"Trim"/"Move stop"/"Open order ticket"
     buttons and no "Broker" heading for a held symbol (`await expect(page.getByRole('button', { name: 'Open order ticket' })).toHaveCount(0)`; `await expect(page.getByText('Broker')).toHaveCount(0)`).

**Verification**:
```
cd services/xstockstrat-ui
pnpm lint
pnpm exec playwright test e2e/trader/position-detail.spec.ts
grep -n "Manage\|Open order ticket\|Broker\|lg:grid-cols-\[1fr_320px\]" src/app/trader/positions/\[symbol\]/page.tsx   # expect no hits
```
Pass condition: `position-detail.spec.ts` green including the updated Trade-panels membership (Position + Risk & exit
+ Why it's held + Orders & fills + Place order), the Manage/Broker-removal assertions, and no unscoped
`getByText('Risk & exit')` strict-mode failure; the removed panels and 2-column grid are gone from `page.tsx`.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
