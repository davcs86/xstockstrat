# Recon: watchlist-opportunity-signal-cues

**Created**: 2026-08-25
**From**: product-spec.md
**Affected services**: xstockstrat-ui

---

## Objective

Make readiness/queue states (firing / watching / quiet / no-data / in-queue) instantly
distinguishable via consistent color **+ icon** coding across the Watchlists readiness panel and the
Opportunities page (desktop cards + mobile), add a firing-row jump to the symbol's order/position
page, and fix three UX defects (Opportunities-origin breadcrumb, mobile Opportunities grouping/tags,
and Opportunities filter responsiveness). UI-only — no proto/config/DB change.

## Codebase Map

- **`xstockstrat-ui`** (Next.js / TypeScript)
  - Readiness panel (FR-1/FR-2 primary edit site): `src/components/insights/WatchlistReadiness.tsx`
    - `barVariant`/`stateLabel`/`blockingCondition`/`hasData` — `:38-60` (buy=firing, paper=partway, sell=none, muted=no-data)
    - per-row text + color-class selection — `:226-237`; `Progress variant={barVariant(r)}` — `:221-225`
    - `in queue` Badge (`variant="info"`, `data-testid="in-queue"`) — `:242-246`
    - bound-row branch `evaluatedRows.map(({binding, r}) …)` — `:208-261` (`r.symbol` `:218`, `binding.strategyId` `:253`); per-row control component `BindingRowControls` — `:72-126`
  - Parent wiring: `src/components/insights/WatchlistDetail.tsx:83` builds `inQueue` from `ListOpportunities`; passes `bindings=`/`inQueue=` to `WatchlistReadiness` — `:246-248`
  - Enum render maps: `src/lib/opportunityShared.tsx` — `SemanticRole`/`EnumRender` `:12-17`, `OPPORTUNITY_ACTION` `:20-25`, `CONDITION_STATE` `:28-33`, `EnumBadge` `:51-53`. **No icon in any map today** (label+role only).
  - Roll-up helpers: `src/lib/readinessRollup.ts` — `isFiring` `:11-13`, `rollupReadiness` `:34-54`, `ReadinessCounts` `:15-20`.
  - Primitives: `src/components/ui/badge.tsx` — `cva` variants (…buy/sell/paper/live/warning/info) `:11-27`, icon slot classes `has-data-[icon=…]` (caller passes the svg) `:8,44-49`; `src/components/ui/progress.tsx` — `variant` (default/buy/paper/sell/muted) `:13-26`.
  - Opportunities page (FR-4/FR-5): `src/app/insights/opportunities/page.tsx`
    - filter state `minConviction/activeSources/actionFilter/sortKey` — `:89-92`; `sources` useMemo from **unfiltered** `opportunities` — `:129-132`; `rows` filter useMemo — `:134-153`
    - source pills (`ToggleGroup`/`ToggleGroupItem`, `sourceFilterPillClass`) — `:249-267,51-58`; action + sort `Select` — `:269-289`; min-conviction slider (localStorage `opportunities.minConviction`) — `:33-35,100-115,291-305`
    - desktop `symbolGroups` grouping — `:192-200`; `SymbolGroupCard` — `:368-418`; `OpportunityRow` (strategyId `:452-454`, chips `:455-459`, expiry `:460-462`) — `:421-523`; `opportunityChips` — `:46-48`; `expiresLabel` — `:61-65`; `reviewHref` — `:172-175`
    - `mobileSections` (`rows.map → {kind:'signal',…}`) — `:179-188` (badge/conviction/readiness/caption/href/muted only; **no strategyId/chips/expiry**)
  - Mobile model/renderer (FR-4): `src/components/mobile/sections.ts:9-28` (`signal` kind fields), `src/components/mobile/SectionRenderer.tsx:55-138` (`signal` case) — **flat `sections.map` `:22-24`, no grouping/nesting**
  - Position detail (FR-3): `src/app/trader/positions/[symbol]/page.tsx` — `PageBreadcrumb` call (`items` Exposure→symbol) `:377-380`; reads `?strategy=` via `useSearchParams()` `:96,172-173`; **reads no `from`/origin param**
  - Breadcrumb primitive: `src/components/shared/PageBreadcrumb.tsx:11-48` (Radix `Breadcrumb`→`BreadcrumbLink`/`BreadcrumbPage`; `ariaLabel` has no default — deliberate collision guard)
  - Data hook (FR-5): `src/hooks/useOpportunities.ts` — `useOpportunities` queryKey `['opportunities', minConviction]`, **`refetchInterval: 15_000`**, no `staleTime` `:17-23`; `useSetOpportunityAction` invalidates `[['opportunities']]` `:38-43`
  - Icons: `@phosphor-icons/react` **`^2.1.7`** (`package.json:35`), already used in `SectionRenderer.tsx:3` (CaretRight, Warning), `CopilotRail.tsx:3`, `PlatformHeader.tsx:6` (List, Lightning, Sparkle, CaretRight), `navGroups.tsx:2` (Target, MagnifyingGlass, Gauge, BookOpen, GearSix), `accounts/profile/page.tsx:5`
  - Last migration: n/a (frontend; no DB schema)
  - Config-read pattern: n/a (no config keys)

## Patterns to REUSE

- **State → visual encoding** → extend the existing `EnumRender`/`SemanticRole` idea in
  `src/lib/opportunityShared.tsx:12-53` into a single source that maps each readiness/queue state to
  `{label, role, icon}`, consumed by both `WatchlistReadiness.tsx` and the opportunities/mobile
  renderers. Do **not** re-derive per component (DRY guard rail). `isFiring`/`barVariant`/
  `rollupReadiness` (`readinessRollup.ts`) stay the source of the *state*; the new map is the *render*.
- **Icon rendering inside a Badge** → `badge.tsx:8,44-49` already supports an icon slot; pass a
  Phosphor glyph as a child (as `SectionRenderer`/`PlatformHeader` already do).
- **Jump-to-detail link (FR-2)** → reuse the `reviewHref` pattern
  (`/trader/positions/${symbol}?strategy=${strategyId}`) from `opportunities/page.tsx:172-175`.
- **Breadcrumb (FR-3)** → reuse `PageBreadcrumb` (`PageBreadcrumb.tsx`); the first item's `href` is
  already parameterizable, so origin only needs to switch the first crumb.
- **Mobile parity (FR-4)** → reuse the shared `SectionRenderer` (feature 083 FR-16 mandates one shared
  mobile tree, no divergent components); extend the `signal` `Section` kind and/or add a grouped
  section kind rather than forking a mobile-only component.
- **Tests/fixtures (C-12/C-13)** → reuse `e2e/fixtures/opportunities.ts` (`OPPORTUNITIES`,
  `symbolReadiness`/`exitReadiness`) and `e2e/helpers/watchlistMock.ts`; catalog rows exist in
  `e2e/fixtures/INVENTORY.md:25-27`. Mock RPCs already in `e2e/mock-backend.ts`
  (`listOpportunities` `:630-637`, `evaluateReadiness` `:650-669`, watchlist bindings).

## Existing Business Rules (preserve / extend)

- No existing acceptance suite for `xstockstrat-ui` yet (`services/xstockstrat-ui/acceptance/` does not
  exist — no per-service UI business rules have been promoted).
- No relevant cross-cutting guarantee in `docs/sdd/business-rules/platform.feature` (its only scenario,
  `@AC-8` MCP_AGENT_SECRET absence, does not overlap this feature).
- ⇒ No C-16 regression risk. Feature 155's own `acceptance.feature` is the sole guard.

## Dependencies

- Proto/RPC: none (no `.proto` change; reads existing `ListOpportunities`/`EvaluateReadiness`).
- Migration: none.
- Config keys: none.
- Inter-service edges: none new (UI already calls analysis via its BFF).
- New env vars / ports: none.

## Risks / Not-found

- **FR-5 root cause unconfirmed.** Recon found **no staleness in the `sources` derivation** (it is
  built from unfiltered `opportunities`, `:129-132`) and `ToggleGroup` is plain controlled Radix. The
  one plausible real defect: `activeSources` is never reconciled against the current `sources`, and
  `useOpportunities` refetches every 15s (`useOpportunities.ts:17-23`); if a selected source vanishes
  from a later fetch, the (now hidden) pill's filter still applies → an empty list with **no visible
  active pill** ("stuck"). Must be reproduced before changing behavior; if not reproducible, record the
  finding (P-03). This is the FR-1 open question's sibling — carry into the debate.
- **Breadcrumb e2e collision (Ledger fails.md 2026-07-01).** `e2e/breadcrumb.spec.ts` asserts, on the
  position-detail page, `getByLabel('Position path', {exact:true})` **count 1** and
  `getByRole('link', {name:'AAPL', exact:true})` **count 1** (`:91-98,111-125`). An added
  "Opportunities" crumb is a *distinct* link name (safe), but the change must keep both exact-match
  counts at 1 and run a broader `-g` scope, not just the wiring step's own run.
- **FR-1 glyph choice** unresolved — pick Phosphor glyphs per state in the debate; icon must never be
  the sole differentiator (always icon **+** color **+** text).
- **FR-4 grouping mechanism** unresolved — extend `signal` + emit per-symbol headers vs. add a new
  `signalGroup` section kind. Design fork for the debate.

## Recommended Scope

Advisory step boundaries (input to `/sdd-spec`):
1. **Shared state→{label,role,icon} map** in `opportunityShared.tsx` (+ unit test) — the DRY core FR-1 builds on.
2. **Watchlists readiness panel** — apply icons to state labels + in-queue badge; add the firing-row jump action (FR-1/FR-2) + e2e.
3. **Opportunities desktop + mobile** — apply the shared cues; mobile grouping + missing tags (FR-1/FR-4) + e2e.
4. **Position-detail breadcrumb origin** (FR-3) — thread a `from=opportunities` marker from the Opportunities callers; e2e incl. the count-1 guard.
5. **Opportunities filter reconcile** (FR-5) — reproduce; prune `activeSources` to current `sources` if confirmed, else record finding; e2e.
