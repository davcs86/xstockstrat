# Implementation Spec: symbol-page-section-nav

**Status**: `pending`
**Created**: 2026-08-16
**Feature**: `docs/roadmap/features/139-symbol-page-section-nav/feature.md`
**Total Steps**: 3
**Feature Branch**: `feature/symbol-page-section-nav`

---

## Execution Summary

UI-only feature on `xstockstrat-ui` (no proto/config/DB/env/port surface). It groups the existing
stacked sections of `/trader/positions/[symbol]` behind a **sticky segmented anchor-nav** — the
all-sections-stay-mounted approach the approved `design.md` chose over Tabs/Accordion, which keeps
`position-detail.spec.ts` green (all 20 section assertions still see every section on one
`page.goto`), incurs zero fetch-lifecycle change (FR-7), and preserves the `?strategy=` seed (FR-5).

Order: **Step 1** creates the new presentational component `SymbolSectionNav.tsx` (plus the
co-located sticky-offset constants and group model — the single source of truth so `top` and
`scroll-margin` cannot drift); **Step 2** wires it into `page.tsx`, wrapping each existing section
run in `<section id=…>` and rendering the nav after the `<h1>` (zero JSX reorder, all gating
preserved — FR-3); **Step 3** covers it with e2e (nav interaction, `#hash` deep-link, `?strategy=`
non-regression, scroll-spy active flip), keeping `mobile-overflow.spec.ts` green, run at a **broader
`-g` scope** to catch role/label collisions that surface on sibling specs (`fails.md` 2026-08-09).

**Consumer surface (C-14):** the product spec names exactly one — **UI `/trader`**, the existing
`/trader/positions/[symbol]` route. It is already registered and reachable (feature 096/125), so no
`NAV_GROUPS`/`PLATFORM_SUBNAV` entry or nav-reachability test is owed (C-10(a) already satisfied —
this reorganizes an existing route, it adds no new one). Steps 1–3 land the change on that surface.
No backend step exists because there is no backend change.

**No trading-domain step constraints apply:** this is presentation over existing sections; no
`OrderType`/`BrokerType`/`OrderStatus`/`TRADING_MODE`/order-routing logic is touched (the trade
widget and orders card are moved into a `<section>` wrapper unchanged).

## Step Dependencies

- **Step 2 requires Step 1**: `page.tsx` imports `SymbolSectionNav` and the `SECTION_SCROLL_MT`
  constant from the module Step 1 creates; the nav cannot render without it.
- **Step 3 requires Steps 1 + 2**: the e2e nav-interaction / deep-link / scroll-spy assertions are
  meaningful only once the component exists (Step 1) and is wired into the page (Step 2). The new
  assertions are authored **red-first** — run against the pre-Step-1/2 tree they fail (no
  `getByRole('navigation',{name:'Symbol navigation'})` exists); they pass only after Steps 1+2.
  `/sdd-execute`'s TDD gate captures the failing run before the implementation steps and the passing
  run after (frontend has no per-file coverage threshold — `pnpm test:e2e` is the gate; see
  `reference/spec-template.md` coverage table, `xstockstrat-ui` row = n/a).
- No deferred consumer surface — FR-5 deep-link is implemented in this spec, not deferred, so no
  named follow-up feature is required (C-14).

---

### Step 1 — service: Create the `SymbolSectionNav` presentational component + sticky-offset constants

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/trader/SymbolSectionNav.tsx` — create

**Reviewers**: `xstockstrat-ui` (service owner) — Trading UI correctness, Connect-RPC call safety, no secret values rendered in UI, no direct DB access

**Codebase Evidence**:
- New filename is free: `grep`/`ls services/xstockstrat-ui/src/components/trader/` → **no**
  `SymbolSectionNav.tsx` (confirmed absent; none of the existing `components/trader/*` collide —
  recon:51).
- shadcn primitive exists: `services/xstockstrat-ui/src/components/ui/toggle-group.tsx` exports
  `ToggleGroup` and `ToggleGroupItem` (`export { ToggleGroup, ToggleGroupItem };` at file end);
  `ToggleGroupItem` renders `radix-ui`'s `ToggleGroup.Item` as a `<button>` carrying
  `data-slot="toggle-group-item"` + `data-state` (`toggle-group.tsx` item body) — **not**
  `role="tab"`, sidestepping the `fails.md` 2026-08-09 tab-collision (recon Risk 2).
- Rendered role is a plain **button**: the existing `ToggleGroup` exemplar in
  `src/app/insights/opportunities/page.tsx:212` is located in e2e via
  `page.getByRole('button', { name: 'marketwatch' })`
  (`e2e/insights/opportunities.spec.ts:84,137,139`) — confirms `getByRole('button', …)` addresses a
  `ToggleGroupItem`, validating this feature's locator plan.
- No shared header-height token exists to reuse: the real header
  (`src/components/shared/PlatformHeader.tsx`) is `sticky top-0 z-40`, Row1 `h-[49px]` always +
  Row2 `h-9`/36px `hidden sm:flex` (`PlatformHeader.tsx:205-207,346`), and its Row-2 cross-page
  sub-nav already uses `aria-label="Section"` (`PlatformHeader.tsx:348`) — so this new same-page nav
  must use a **distinct** label (recon Risk 3; asserted elsewhere via
  `getByRole('navigation',{name:'Section'})`).
- `cn` helper: `import { cn } from '@/components/ui/utils'` (the alias used by every regenerated
  `components/ui/*` file — service `CLAUDE.md` § Styling, `vitest.config.ts` `@`→`./src`).

**TDD**: `red-green required` — code-bearing; its behavior is exercised by the Step 3 e2e (frontend
has no unit-test layer for components — `vitest` is logic-only `src/lib/**`; service `CLAUDE.md`
§ Testing). The Step 3 nav/deep-link/scroll-spy assertions are the red-before-green proof.

**Instructions**:
Create `SymbolSectionNav.tsx` as a `'use client'` presentational component following `design.md`
§ Chosen Approach exactly. Export, from this single module (so the sticky `top` and section
`scroll-margin` share one source of truth and cannot drift):

1. `export const STICKY_NAV_TOP = 'top-[49px] sm:top-[85px]'` — nav sits directly **below** the
   real header (49px Row1 only below `sm`; 85px = 49 + 36 Row2 at `sm`+).
2. `export const SECTION_SCROLL_MT = 'scroll-mt-[93px] sm:scroll-mt-[129px]'` — (49+44) / (85+44),
   accounting for the header offset + the `h-11` (44px) nav bar; consumed by `page.tsx` section
   wrappers in Step 2.
3. A `SymbolGroup` type: `{ id: string; label: string }` and the component
   `SymbolSectionNav({ groups }: { groups: SymbolGroup[] })`.

Component markup (the invariants that keep `position:sticky` intact and the 390px overflow guard
green — a scroll container must live on a **descendant** of the sticky element, and the `-mx`
negative bleed must exactly cancel the parent `p-4 sm:p-6`):

```tsx
<nav
  aria-label="Symbol navigation"
  className={cn(
    'sticky z-40 -mx-4 border-b bg-background/95 backdrop-blur-sm sm:-mx-6',
    STICKY_NAV_TOP,
  )}
>
  <div className="min-w-0 overflow-x-auto px-4 sm:px-6">
    <ToggleGroup type="single" value={active} onValueChange={onValueChange} className="h-11 py-1">
      {groups.map((g) => (
        <ToggleGroupItem key={g.id} value={g.id}>{g.label}</ToggleGroupItem>
      ))}
    </ToggleGroup>
  </div>
</nav>
```

- `aria-label="Symbol navigation"` is deliberate — it avoids the substring "Section" so a
  case-insensitive-substring `getByRole('navigation',{name:'Section'})` cannot collide with the
  header Row-2 nav (`PlatformHeader.tsx:348`). Do not rename it to contain "Section".
- `z-40` matches the header so the header's `backdrop-blur` stacking context cannot occlude the nav.

Behavior — two effects + the click handler (all reads of `window.location.hash` happen **inside**
an effect, never during render, to avoid an SSR/hydration mismatch):

- **Mount effect**: read `window.location.hash`; if its id is a known `groups[].id`, set `active`
  and `document.getElementById(id)?.scrollIntoView()`.
- **Scroll-spy `IntersectionObserver`** (this is what makes FR-2's "active group must be visually
  indicated" true under free scroll — a click-only active state was rejected in `design.md`):
  observe each `document.getElementById(g.id)` with
  `rootMargin: '-93px 0px -55% 0px'` below `sm` / `'-129px 0px -55% 0px'` at `sm`+ (top inset = the
  header+nav offset; read the breakpoint once via `window.matchMedia('(min-width: 640px)')`),
  `threshold: 0`; on intersection pick the **topmost** intersecting section and set `active`.
  Disconnect on cleanup.
- **`onValueChange(id)`**: ignore an empty value (ToggleGroup deselect is a harmless no-op since
  `value` is controlled); otherwise set `active`, `document.getElementById(id)?.scrollIntoView({
  behavior: 'smooth' })`, and `history.replaceState(null, '', \`#${id}\`)` — a **bare relative
  hash** (never `${pathname}#${id}`), which leaves `?strategy=` in the query string untouched (FR-5)
  and triggers no Next App-Router navigation/refetch.

Address the three `design.md` Open Risks at this step (they are wiring-time tuning, not design
forks): tune the `-55%` bottom `rootMargin` inset empirically so a short/empty `Coverage` section
still activates; accept the ≤1px `scroll-mt` border-b under-shoot as cosmetic (or add the 1px); and
either re-subscribe the observer on an `sm`-breakpoint change or note the stale-offset limitation in
a code comment — decide here and record the choice in the Deviation Log.

No new outbound gRPC call is introduced (this is a pure presentational component reading DOM +
`window.history`) — the header-propagation constraint (§B) does not apply.

**Verification**:
```bash
cd services/xstockstrat-ui
grep -n "aria-label=\"Symbol navigation\"" src/components/trader/SymbolSectionNav.tsx    # nav label (collision-safe)
grep -n "STICKY_NAV_TOP\|SECTION_SCROLL_MT\|ToggleGroup" src/components/trader/SymbolSectionNav.tsx  # exports + primitive
grep -n "history.replaceState(null, '', \`#" src/components/trader/SymbolSectionNav.tsx   # bare relative hash (no pathname)
pnpm run lint          # next lint — must pass
pnpm run build         # tsc + Next build — component compiles
```
Confirm: nav uses `aria-label="Symbol navigation"` (not "Section"); `STICKY_NAV_TOP` and
`SECTION_SCROLL_MT` are exported from this module; the click handler writes a **bare** `#${id}` hash
(no `pathname`); lint and build pass clean.

---

### Step 2 — service: Wire `SymbolSectionNav` into the Symbol page and wrap sections in anchored `<section>`s

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx` — modify

**Reviewers**: `xstockstrat-ui` (service owner) — Trading UI correctness, analytics display accuracy, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI

**Codebase Evidence** (all `path:line` in `src/app/trader/positions/[symbol]/page.tsx`, verified):
- Section wrapper + gating: `:215` `<div className="p-4 sm:p-6 space-y-4">` (the stack); the
  `-mx-4 sm:-mx-6` nav bleed in Step 1 exactly cancels this `p-4 sm:p-6`, so the nav box equals the
  parent border-box (no 390px overflow). Gating state at `:210-211`
  (`genuineError`, `positionNotFound = !isLoading && !genuineError && !position?.symbol`).
- Anchor point: `:226` `<h1 className="font-mono text-2xl …">{symbol}</h1>` — the nav renders
  **immediately after** this (conventional breadcrumb→title→jump-nav grammar; a nav-above-title
  placement was rejected in `design.md` because the breadcrumb/title would scroll under the sticky
  bar). Loading skeleton `:228-233` (`isLoading`), genuine-error `:234-236` (`genuineError`).
- Sections in DOM order (nav order = DOM order — **zero JSX reorder**):
  - **Overview** `#overview` — `<SymbolPriceChart …>` `:240-248` + `<IndicatorSection …>` `:252-257`
  - **Trade** `#trade` — `<SymbolOrdersCard …>` `:259` + inline Trade `<Card>`/`<OrderForm>` `:261-270`
  - **Research** `#research` — the whole watchlist-conditional block `:275-289`
    (`watchlistsLoading` Skeleton `:275-276`; `isSymbolWatchlisted` → `OpportunitySection` `:279` +
    `<Suspense><SignalReadiness/></Suspense>` `:280-282` + `FundamentalsSection` `:283` +
    `MuteForStrategy` `:285`; else → `<SymbolScreening>` `:288`) — wrapped as **one** section so
    FR-3's watchlist split is preserved byte-for-byte.
  - **Backtests** `#backtests` — `<BacktestsSection …>` `:293`
  - **Coverage** `#coverage` — `<BackfillSection …>` `:296`
  - **Position** `#position` — `<PositionBody …>` `:298-303`; the `positionNotFound` `<CardNotice>`
    `:305-311` stays **unwrapped** (no id, no nav item).
- Section components are defined **locally** in this same file (`SymbolPriceChart` `:322`,
  `PositionBody` `:473`, `BacktestsSection` `:806`, `IndicatorSection` `:921`, `BackfillSection`
  `:971`), so wiring adds only two imports: `SymbolSectionNav` + `cn`.
- `cn` is **not** currently imported in `page.tsx` (`grep -n "import { cn }" page.tsx` → no match) —
  the import `import { cn } from '@/components/ui/utils'` must be **added** in this step.
- `?strategy=` seed lives in `src/components/insights/SignalReadiness.tsx:34`
  (`useState(searchParams?.get('strategy') ?? '')`, `useSearchParams` at `:27`), read on mount — it
  is **not** threaded through `page.tsx`; keeping `SignalReadiness` mounted (all-sections-mounted)
  and mutating only the `#hash` (Step 1) preserves it with no prop change (recon:28, Risk 5).

**TDD**: `red-green required` — code-bearing; verified together with Step 1 by the Step 3 e2e (the
`page.goto('/trader/positions/AAPL')` nav-interaction and deep-link assertions fail before this
wiring lands and pass after).

**Instructions**:
1. Add imports near the existing `@/components/trader/*` import block (`:6,:28,:29,:50`):
   `import { SymbolSectionNav, SECTION_SCROLL_MT } from '@/components/trader/SymbolSectionNav';`
   and `import { cn } from '@/components/ui/utils';`.
2. Wrap each consecutive section run in `<section id=… className={cn('space-y-4', SECTION_SCROLL_MT)}>`
   — **do not reorder** any JSX; only wrap the existing runs, preserving every gating expression
   verbatim (FR-3). Use the six ids `overview` / `trade` / `research` / `backtests` / `coverage` /
   `position`, mapped to the DOM runs listed in Codebase Evidence. Wrap the whole `:275-289`
   watchlist-conditional expression (both the `isSymbolWatchlisted` branch and the `SymbolScreening`
   else-branch) inside the single `#research` `<section>` so the split logic is untouched.
3. Leave the `positionNotFound` `<CardNotice>` (`:305-311`) **outside** any `<section>` — no id, no
   nav item (it is the not-held notice, not a navigable group).
4. Build the `groups` array in render order, appending **Position only when `position?.symbol`**:
   ```tsx
   const sectionGroups = [
     { id: 'overview', label: 'Overview' },
     { id: 'trade', label: 'Trade' },
     { id: 'research', label: 'Research' },
     { id: 'backtests', label: 'Backtests' },
     { id: 'coverage', label: 'Coverage' },
     ...(position?.symbol ? [{ id: 'position', label: 'Position' }] : []),
   ];
   ```
5. Render `<SymbolSectionNav groups={sectionGroups} />` **immediately after** the `<h1>` (`:226`),
   gated on `!isLoading && !genuineError` so it never points at absent anchors:
   `{!isLoading && !genuineError && <SymbolSectionNav groups={sectionGroups} />}`.

No new outbound gRPC call is introduced (§B header-propagation N/A). No env var / port is added, so
`docker-compose.yml` / `.do/app*.yaml` are **not** touched.

**Verification**:
```bash
cd services/xstockstrat-ui
grep -n "SymbolSectionNav\|SECTION_SCROLL_MT\|import { cn }" src/app/trader/positions/\[symbol\]/page.tsx  # imports + render
grep -n "<section id=" src/app/trader/positions/\[symbol\]/page.tsx   # six anchored sections (overview/trade/research/backtests/coverage/position)
pnpm run lint          # next lint — must pass
pnpm run build         # tsc + Next build — page compiles with the new imports
```
Confirm: the nav renders once, after `<h1>`, gated on `!isLoading && !genuineError`; exactly six
`<section id=…>` wrappers exist (the sixth, `#position`, inside the `position?.symbol` branch); the
`positionNotFound` notice is unwrapped; no JSX section was reordered; lint + build pass.

---

### Step 3 — test: e2e for nav interaction, `#hash` deep-link, `?strategy=` non-regression, and scroll-spy

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/trader/position-detail.spec.ts` — modify (add nav-interaction cases;
  existing 20 section assertions stay **unchanged** — all sections remain mounted)
- `services/xstockstrat-ui/e2e/trader/symbol-section-nav.spec.ts` — create (deep-link + `?strategy=`
  non-regression + scroll-spy)

**Reviewers**: `xstockstrat-ui` (service owner) — Trading UI correctness, analytics display accuracy, no secret values rendered in UI

**Codebase Evidence**:
- Existing suite to keep green: `e2e/trader/position-detail.spec.ts` uses
  `import { addAuthCookie } from '../helpers/auth'` and `await page.goto('/trader/positions/AAPL')`
  (`:1-2,:13-19`); it asserts multiple sections visible on one `page.goto` (e.g. `getByText('AAPL')`,
  `getByText('+$100.00')`, `getByText('Open R')`, `getByText('Risk & exit')`,
  `getByText('Orders & fills · AAPL')`) — all still visible because the anchor-nav keeps every
  section mounted (recon Risk 1; the reason Tabs/Accordion were rejected).
- Mobile guard to keep green: `e2e/mobile-overflow.spec.ts` runs at `viewport {width:390,height:844}`
  (`:10`) and asserts `document.documentElement.scrollWidth - clientWidth <= 1` (`:42`) for
  `{ path: '/trader/positions/AAPL' }` (`:34,:47`) — **no edit** needed; the Step 1 `-mx` bleed +
  descendant `overflow-x-auto` keep it green. Verify it still passes.
- Fixtures (C-12 — reuse the inventory, no inline domain literals): `e2e/fixtures/` holds
  `positions.ts` (`POSITION_AAPL`/`positionForSymbol` — AAPL held, `unrealizedPnl 100.0`, stop),
  `orders.ts`, `opportunities.ts` (`symbolReadiness`), `fundamentals.ts`, `backfillJobs.ts`,
  `indicatorSeries.ts`, `screenResults.ts`; auth via `e2e/helpers/auth.ts` `addAuthCookie`
  (`e2e/fixtures/INVENTORY.md` catalogs them). No **new** domain object is introduced by this
  feature, so **no new fixture module / INVENTORY row is added** — the new specs reuse the existing
  AAPL fixtures the mock backend already serves (§B C-12: reuse, don't inline; nav interaction is a
  scenario one-off requiring no domain literal).
- Locator plan (collision-safe): `getByRole('navigation', { name: 'Symbol navigation' })` for the
  nav landmark, then `getByRole('button', { name: 'Overview' | 'Trade' | 'Research' | 'Backtests' |
  'Coverage' | 'Position' })` for the chips — the `getByRole('button', …)`→`ToggleGroupItem` binding
  is proven by `e2e/insights/opportunities.spec.ts:84,137,139`. The `'Symbol navigation'` label does
  not substring-collide with the header's `aria-label="Section"` (recon Risk 3).

**TDD**: `red-green required` — authored **red-first**: run against the pre-Step-1/2 tree the new
assertions fail (no `getByRole('navigation',{name:'Symbol navigation'})` element exists); they pass
only after Steps 1+2. `/sdd-execute` captures the failing run before Steps 1/2 and the passing run
after. `xstockstrat-ui` has **no coverage threshold** (`reference/spec-template.md` table —
`xstockstrat-ui` row = n/a; service `CLAUDE.md` § Testing: e2e is the gate, component behavior is
Playwright-covered, `vitest` is `src/lib`-only). `pnpm test:e2e` is the pass condition.

**Instructions**:
1. In `position-detail.spec.ts`, **leave the existing 20 section assertions unchanged** (they prove
   FR-3 / AC-2: every section's content still renders exactly as feature 125). Add nav-interaction
   case(s) after `addAuthCookie` + `goto('/trader/positions/AAPL')`:
   - the nav landmark is present:
     `await expect(page.getByRole('navigation', { name: 'Symbol navigation' })).toBeVisible();`
   - clicking a chip scrolls its section into view and marks the chip active — e.g. click
     `getByRole('button', { name: 'Backtests' })`, then assert the `#backtests` section content
     (reuse an existing Backtests assertion already in the file) is in view and the button reflects
     the active `data-state=on` / `aria-pressed` state.
   - the **Position** chip appears for the held symbol AAPL (`getByRole('button', { name: 'Position'
     })` visible) — and add a MSFT-style / unheld case asserting the Position chip is **absent** when
     no position is held (reuse the existing "no resting stop" / unheld fixture the file already
     drives).
2. Create `symbol-section-nav.spec.ts` covering the three design test-plan cases (import
   `addAuthCookie` from `../helpers/auth`, reuse the AAPL fixtures — no inline domain data):
   - **Deep-link on load**: `page.goto('/trader/positions/AAPL#backtests')` → after load, the
     `#backtests` section is scrolled into view and the `Backtests` chip is active (mount effect
     honors the inbound hash).
   - **`?strategy=` non-regression (AC-4)**:
     `page.goto('/trader/positions/AAPL?strategy=<id>#overview')` → the readiness strategy is still
     seeded from `?strategy=` (assert the `SignalReadiness` strategy-seeded state the way the
     existing readiness spec does — the bare `#hash` from the nav must not disturb the query string).
     Then click another chip and assert `?strategy=<id>` is **still** present in `page.url()` after
     the `history.replaceState` hash mutation.
   - **Scroll-spy active flip**: scroll the page (or `section.scrollIntoView`) so a lower section
     (e.g. `#coverage`) crosses the observer threshold, and assert the active chip flips to that
     group without a click (proves FR-2 under free scroll).
3. All domain data comes from existing fixtures / the mock backend (C-12); `?strategy=<id>` and the
   `#hash` are scenario one-offs (not domain literals), so they stay inline — no fixture module or
   `INVENTORY.md` change.

**Verification**:
```bash
cd services/xstockstrat-ui
# Import hygiene (C-12): specs pull auth + fixtures from the canonical homes, no inline domain literals
grep -n "helpers/auth\|from '../fixtures'\|from '../../fixtures'" e2e/trader/symbol-section-nav.spec.ts e2e/trader/position-detail.spec.ts

pnpm run lint                                             # next lint — must pass (§B lint gate)

# Targeted specs — the new/updated nav behavior
pnpm test:e2e -- -g "Symbol navigation|section nav|Single Position page"

# BROADER scope at the wiring step (fails.md 2026-08-09): role/label collisions surface on a
# SIBLING spec, not the changed component's own narrow run. Run the trader + insights suites and
# the mobile guard together.
pnpm test:e2e -- e2e/trader e2e/insights e2e/mobile-overflow.spec.ts
```
Confirm: the two targeted specs pass; `mobile-overflow.spec.ts` stays green for
`/trader/positions/AAPL` at 390px; the broader trader+insights run shows **no** new
`getByRole`/`getByLabel` ambiguity (the `'Symbol navigation'` vs `'Section'` label split and the
`ToggleGroupItem`-as-`button` role hold); lint passes.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
