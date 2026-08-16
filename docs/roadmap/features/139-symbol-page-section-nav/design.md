# Design: symbol-page-section-nav

**Created**: 2026-08-16
**Rounds**: 2 (full; termination: approved)
**Approved by**: user delegation ("Let /sdd-design decide" the nav pattern) @ 2026-08-16, recorded in context.md
**Grounded in**: recon.md

---

## Chosen Approach

A **sticky segmented anchor-nav** — the all-sections-mounted option the product spec's FR-2 explicitly
sanctions — chosen over hiding patterns because it keeps `position-detail.spec.ts` green (recon Risk 1),
incurs zero fetch-lifecycle change (FR-7, recon Risk 4), and preserves the `?strategy=` seed (recon
Risk 5). Consumer surface: `xstockstrat-ui` `/trader` segment, the existing `/trader/positions/[symbol]`
route (already registered — no `NAV_GROUPS`/`PLATFORM_SUBNAV` entry needed; C-10(a) satisfied).

**New component** `src/components/trader/SymbolSectionNav.tsx` (fresh filename — recon:51) + a co-located
constants export that is the **single source of truth** for the sticky offsets (no shared header-height
token exists — grep found only inline `h-[49px]`/`h-9` in `PlatformHeader.tsx:207,346`):
- `STICKY_NAV_TOP = 'top-[49px] sm:top-[85px]'` — sits directly **below** the real header, which is
  `sticky top-0 z-40` and ~85px tall (Row1 `h-[49px]` always + Row2 `h-9`/36px `hidden sm:flex`,
  `PlatformHeader.tsx:205-207,346`); collapses to 49px below `sm`. Nav uses `z-40` (matches the header)
  so the header's `backdrop-blur` stacking context can't occlude it.
- Nav bar `h-11` (44px — ≥44px mobile tap target).
- `SECTION_SCROLL_MT = 'scroll-mt-[93px] sm:scroll-mt-[129px]'` (49+44 / 85+44), exported from the same
  module as `STICKY_NAV_TOP` so the sticky `top` and the section `scroll-margin` can never drift.

**Nav markup / nesting** (the invariants that keep `position:sticky` intact and the 390px guard green —
`mobile-overflow.spec.ts:34` asserts `scrollWidth-clientWidth<=1` on `/trader/positions/AAPL`):
`<nav aria-label="Symbol navigation" className="sticky z-40 -mx-4 border-b bg-background/95 backdrop-blur-sm sm:-mx-6 {STICKY_NAV_TOP}">`
→ inner `<div className="min-w-0 overflow-x-auto px-4 sm:px-6">` (the scroll container; overflow lives on
a **descendant** of the sticky element, so it does not create a scroll ancestor that would break sticky)
→ `<ToggleGroup type="single" value={active} onValueChange={…} className="h-11 py-1">` → one
`<ToggleGroupItem value={g.id}>{g.label}</ToggleGroupItem>` per group. `ToggleGroupItem` renders a
`<button>` with `data-state`/`aria-pressed` (`toggle-group.tsx:66`), **not** `role="tab"` — sidestepping
the recon Risk 2 / `fails.md` 2026-08-09 tab-collision. The `-mx-4 sm:-mx-6` bleed exactly cancels the
parent `p-4 sm:p-6` (`page.tsx:215`) so the nav box equals the parent border-box (no page overflow).
**`aria-label="Symbol navigation"`** deliberately avoids the substring "section" so Playwright's
case-insensitive-substring `getByRole('navigation',{name:…})` cannot collide with the header Row-2 nav's
`aria-label="Section"` (`PlatformHeader.tsx:348`) — the Round-2 fix to recon Risk 3.

**Behavior** — two effects + a click handler:
- On mount: honor an inbound `#hash` (read `window.location.hash` **inside the effect only** — never
  during render, to avoid an SSR/hydration mismatch): if its id is a known group, `scrollIntoView()` +
  set active.
- Scroll-spy `IntersectionObserver` (makes FR-2 true under free scroll): observes each section element
  with `rootMargin: '-{93|129}px 0px -55% 0px'` (top inset = the header+nav offset) `threshold: 0`,
  picks the topmost intersecting section → sets active.
- `onValueChange(id)`: ignore empty (ToggleGroup deselect is a harmless no-op since `value` is
  controlled), set active, `scrollIntoView({behavior:'smooth'})`, and
  `history.replaceState(null, '', `#${id}`)` — a **bare relative hash** (not `${pathname}#${id}`), which
  preserves `?strategy=` (read on mount in `SignalReadiness.tsx:27,34` via `useSearchParams`) and
  triggers no Next App-Router navigation/refetch.

**Page wiring** (`page.tsx`) — wrap each existing consecutive section run in
`<section id=… className={cn('space-y-4', SECTION_SCROLL_MT)}>` (zero JSX reorder — the sections are
already in DOM order; only their gating-preserving inner content is wrapped, FR-3), and render
`<SymbolSectionNav groups={…}>` **immediately after the `<h1>` title** (`page.tsx:226`, the conventional
breadcrumb→title→jump-nav grammar — the Round-2 placement fix), gated on `!isLoading && !genuineError`
(`page.tsx:210-211,228`) so it never points at absent anchors.

**Group → section mapping** (nav order = DOM order):
- **Overview** `#overview` — `SymbolPriceChart` (`:240`) + `IndicatorSection` (`:252`)
- **Trade** `#trade` — `SymbolOrdersCard` (`:259`) + inline Trade `Card`/`OrderForm` (`:261-270`)
- **Research** `#research` — the whole watchlist-conditional block (`:275-289`): Opportunity/Readiness/
  Fundamentals/Mute **or** Screening, wrapped as one section so FR-3's split is preserved byte-for-byte
- **Backtests** `#backtests` — `BacktestsSection` (`:293`)
- **Coverage** `#coverage` — `BackfillSection` (`:296`)
- **Position** `#position` — `PositionBody` (`:298`), its nav item appended **only when `position?.symbol`**;
  the `positionNotFound` `CardNotice` (`:305`) stays unwrapped (no id, no nav item).

**Test plan** (C-12/C-13): `position-detail.spec.ts`'s 20 section assertions pass **unchanged** (all
sections stay mounted) + add nav-interaction cases; a new spec covers deep-link `#backtests` on load,
`?strategy=…#overview` still seeding readiness (AC-4 non-regression), and the scroll-spy flipping the
active chip. Domain data from existing fixtures (`positionForSymbol`, `ORDERS`, `symbolReadiness`,
`backfillJob`, …; auth `addAuthCookie` — recon:44). Locate via
`getByRole('navigation',{name:'Symbol navigation'})` then `getByRole('button',{name:'Overview'|…})`.
Run a **broader `-g` scope** (trader + insights suites) at the wiring step (`fails.md` 2026-08-09 —
role/label collisions surface on a sibling spec, not the wiring step's own narrow run).

## Rejected Alternatives

- **shadcn `Tabs` (unmounts inactive content)** — rejected: breaks ~20 `position-detail.spec.ts`
  assertions that expect multiple sections visible on one `page.goto` (recon Risk 1), drops in-flight
  polling queries / a running-backtest mutation on unmount (FR-7, recon Risk 4), and `TabsTrigger`'s
  hardcoded `role="tab"` re-opens the `fails.md` 2026-08-09 collision (recon Risk 2).
- **Radix `Accordion` (collapses inactive groups)** — rejected: same hide-inactive problems as Tabs
  (Radix unmounts collapsed content), plus it changes the felt layout more than "jump to a group" asks.
- **Click-only active state (no scroll-spy)** — rejected: the active indicator goes stale the moment the
  user free-scrolls past the clicked group, so it does not satisfy FR-2 ("active group must be visually
  indicated"). The `IntersectionObserver` scroll-spy is the mechanism that makes FR-2 true.
- **Held-position body as a persistent header above the nav** — rejected: bloats the sticky region and
  enlarges the diff; since nothing is ever hidden, "at-a-glance P&L" costs only one tap/scroll, so a
  conditional "Position" group is sufficient.
- **URL query param for the active group** — rejected in favor of a `#hash`: a hash mutation via
  `replaceState` leaves `?strategy=` untouched by construction, guaranteeing FR-5 non-regression.
- **Nav as the first child of the section stack (above breadcrumb/title)** — rejected: the page's own
  breadcrumb + `<h1>` would scroll up and vanish under the sticky nav; placing it after `<h1>` matches
  conventional page grammar.

## Open Risks

- [ ] **Scroll-spy `rootMargin`/`threshold` tuning is empirical** — the "topmost intersecting" heuristic
  can lag or skip a short/empty section (e.g. an empty `BackfillSection`). Tune the `-55%` bottom inset
  during execution — to be addressed at the SymbolSectionNav wiring step + its e2e.
- [ ] **`scroll-mt` omits the nav's 1px `border-b`** — a jumped section lands ~1px under the bar; fold
  into the same empirical tuning above (cosmetic).
- [ ] **Scroll-spy `rootMargin` fixed at observer creation from a one-time `matchMedia` read** — a
  viewport resize across the `sm` breakpoint won't recreate the observer (stale 93-vs-129 offset).
  Either re-subscribe on breakpoint change or accept + note the limitation — decide at the wiring step.

## Constitution Rules Touched

- `C-10` — honored: reorganizes an **existing** registered route, adds no new page/route, so no shared-nav
  registration is owed; the `aria-label` was chosen to avoid the `getByRole` substring collision the
  ledger warns of (the C-10-adjacent completeness concern).
- `C-11` / `P-03` — honored: the genuine design forks (nav pattern, active-indication mechanism, nav
  placement, held-body placement, deep-link encoding) were surfaced and resolved in a 2-round debate with
  cited evidence, not silently guessed; the residual scroll-spy tuning is logged as an Open Risk, not
  buried.
- `C-12` / `C-13` — honored: the new/updated e2e sources all domain data from the existing
  `e2e/fixtures/` homes; no inline literals.
- `C-14` — honored: the consumer surface (`xstockstrat-ui` `/trader` symbol page) is named and earns its
  own implementation + test steps; FR-5 deep-link is implemented (not deferred), so no named-follow-up is
  required.
- `F-04` — honored: every cited path/symbol was found by the recon discovery pass; nothing invented (the
  absent `scroll-area.tsx` is explicitly avoided — native `scrollIntoView`, no `ScrollArea`).
- **Floor breaches: none** (UI-only — no migration/proto/config/branch/DB surface; the 93/129px layout
  constants are not `WatchConfig` business config, so F-07 is not implicated).
