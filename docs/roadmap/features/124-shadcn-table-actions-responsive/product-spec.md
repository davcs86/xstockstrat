# Product Spec: shadcn-table-actions-responsive

**Created**: 2026-08-09

---

## Problem Statement

Several loose ends remain after the 119–123 shadcn/ui migration series: table "Actions" columns still
render multiple inline `<Button>`s instead of a `DropdownMenu`; two tables slipped past feature 121's
Table consolidation and still use a raw `<table>`; a "matches the handoff" mobile-overflow sweep
(`e2e/mobile-overflow.spec.ts`) doesn't cover every table-bearing route; a handful of hand-rolled
elements (badge-shaped pills, a toggle-pill pair, a step indicator's badge-color logic) duplicate
existing `Badge`/`ToggleGroup` primitives instead of using them; a 14-site repeated Tailwind class
string has no shared component; and a few small cosmetic inconsistencies (static chart-height inline
styles, a raw color instead of this app's semantic token) remain. Separately, the shared shell's
`Breadcrumb` (`PlatformHeader.tsx`'s Row 2) is a single, generic nav-group-level breadcrumb shown
identically on every page — it should move into each page's own layout so it can reflect that page's
actual position (e.g. a specific strategy, namespace, or symbol), the way `NamespaceEditor.tsx` and
`config-ui/audit/page.tsx` already do for their own routes.

## User Story

As a user of the trader/insights/config-ui/accounts dashboards, I want table row actions grouped into
a single consistent affordance, every table to scroll horizontally within its own container, remaining
hand-rolled styling collapsed onto the shadcn primitives that already exist for it, and a breadcrumb
that reflects my actual position in the app rather than just the active nav group, so that the UI stays
consistent, dense tables stay usable at any width, and navigation context is accurate.

## Functional Requirements

### DropdownMenu adoption

FR-1. Add the shadcn `DropdownMenu` primitive (`npx shadcn@latest add dropdown-menu`) to
`src/components/ui/`, following this repo's established CLI-vendored pattern (`components.json`,
preset `bLTl5gh6`) and the collateral-regeneration reconciliation step documented in
`services/xstockstrat-ui/CLAUDE.md` § Styling (re-apply any app-specific functional-variant
customizations touched by the install).

FR-2. Convert every table "Actions" column that currently renders **2 or more** inline `<Button>`s
side-by-side onto a single `DropdownMenu` trigger (a kebab/"..." icon button) with `DropdownMenuItem`
entries for each existing action, preserving each action's exact behavior (including any
`AlertDialog`-gated destructive confirm). Confirmed present-day sites (verified 2026-08-09 against
`main-dev`):
- `src/components/trader/OrdersTable.tsx` — Edit + Cancel (Cancel behind an `AlertDialog`)
- `src/app/config-ui/sources/page.tsx` — Disable/Enable + Edit
- `src/app/config-ui/[namespace]/NamespaceEditor.tsx` — Edit, or Save + Cancel when a row is in edit
  mode
- `src/app/insights/strategies/page.tsx` — Edit + Deactivate (behind an `AlertDialog`), admin-only
  column

`src/app/accounts/authorized-apps/page.tsx`'s single-action Disconnect column is **explicitly excluded**
from this FR — see Open Questions.

### Table responsive audit

FR-3. Extend `e2e/mobile-overflow.spec.ts`'s route sweep to include every table-bearing route not
currently in its `ROUTES` list. Verified gaps as of 2026-08-09: `/accounts/authorized-apps`,
`/insights/formulas`, `/config-ui/audit`, `/config-ui/<namespace>` (`NamespaceEditor`),
`/trader/positions/<symbol>`. (`/trader/orders`, `/insights/strategies`, `/insights/strategies/<id>`,
`/insights/screener`, `/trader/positions`, `/trader/portfolio`, `/config-ui/sources` are already
covered.)

FR-4. Audit every table-bearing page for horizontal-scroll correctness beyond the single 390px phone
fixture FR-3 exercises: confirm the shadcn `Table` primitive's built-in `overflow-x-auto` wrapper
(`src/components/ui/table.tsx`'s `data-slot="table-container"` div) actually takes effect under a
realistic wide-content scenario for each table (e.g. a long formula/strategy display name, many
columns, or a narrow tablet-width viewport) rather than being silently defeated by a flex/grid
ancestor without `min-w-0` — the documented root cause class for this exact failure mode
(`docs/roadmap/ledger/insights.md` "matches the handoff" fidelity entry, 2026-08-08). Fix any table
found to still overflow the page body instead of scrolling internally.

### Custom CSS/styling reduction

FR-5. Eliminate the two raw `<table>` implementations that slipped past feature 121's Table
consolidation, routing both through `src/components/ui/table.tsx`'s `Table`/`TableHeader`/`TableBody`/
`TableRow`/`TableHead`/`TableCell` family — the exact pattern already used by
`src/components/trader/LiveStrategiesPanel.tsx` and `src/app/insights/formulas/page.tsx` for a
clickable row (real `TableRow` + `onClick`, not a hand-rolled `role="button"`/`tabIndex`/`onKeyDown`
div/tr):
- `src/app/insights/strategies/[id]/page.tsx:468-500` — "Past Runs" table, including its hand-rolled
  clickable-row a11y pattern
- `src/app/insights/screener/page.tsx:536-580` — screener results table

FR-6. Add a shared label component (e.g. `Eyebrow`/`SectionLabel`) for the section-kicker style
`font-mono text-[9px] font-semibold uppercase tracking-[0.13em] text-muted-foreground`, which repeats
verbatim in 14 places across 9 files (`trader/orders/[id]/page.tsx`, `trader/portfolio/page.tsx` ×2,
`trader/positions/[symbol]/page.tsx` ×5, `trader/positions/page.tsx` ×2,
`insights/market/[symbol]/page.tsx`, `components/shared/StatTile.tsx`,
`components/insights/SignalReadiness.tsx`), and convert every site to use it.

FR-7. Convert the hand-rolled `Badge`-outline-shaped pills and badge-color-logic sites onto the real
`Badge` component (adding a variant if the existing set doesn't cover a case):
- `src/app/insights/opportunities/page.tsx:348` and `src/app/insights/market/[symbol]/page.tsx:147` —
  identical hand-rolled "source" pill (`rounded-full border border-border px-2 py-0.5 text-[11px]
  text-muted-foreground`) → `Badge variant="outline"`
- `src/components/insights/StrategyWizard.tsx:159-177` — step-indicator `<li>`s reimplementing
  primary/secondary/muted badge-variant coloring → `Badge`-driven
- `src/components/trader/AlertStream.tsx:50-57` — unread-count badge reimplementing
  destructive/primary color logic → `Badge`-driven color, keeping the corner `absolute -top-1 -right-1`
  positioning (not a `Badge`-provided concern) as the wrapping element's own styling

FR-8. Convert `src/app/insights/opportunities/page.tsx:190-216`'s hand-rolled multi-select source
filter (two `<button>`s sharing an identical `cn('rounded-full border px-3 py-1 text-xs
transition-colors', ...)` pattern) onto `ToggleGroup type="multiple"`, matching the existing usage in
`src/app/insights/screener/page.tsx` and `src/components/trader/OrderForm.tsx`.

FR-9. Two small, low-risk cosmetic fixes:
- Replace `src/app/accounts/authorized-apps/page.tsx:175,179`'s raw `text-green-600`/`bg-green-600`
  ("Reachable" status dot) with this app's own semantic success token (`text-buy`/`bg-buy`, used for
  the same positive/success meaning elsewhere, e.g. `src/app/insights/market/[symbol]/page.tsx:138`).
- Convert the 3 static chart-container `style={{ height: N }}` literals
  (`src/components/trader/ChartPanel.tsx:157`, `src/app/trader/positions/[symbol]/page.tsx:317`,
  `src/app/insights/market/[symbol]/page.tsx:200`) to a Tailwind height class **only where doing so
  does not decouple the container's rendered height from the numeric value each site also passes into
  `useCandlestickChart(N)`** (which hands it straight to `lightweight-charts`' `createChart({ height
  })`) — if a Tailwind class can't stay the single source of truth for both the DOM height and the
  chart-lib call without introducing a runtime `clientHeight` read, leave the site as-is and note why
  in `context.md` rather than force a change that risks the two silently drifting apart.

### Breadcrumb repositioning

FR-10. Move the breadcrumb out of the shared shell (`src/components/shared/PlatformHeader.tsx`'s Row
2, currently rendering the generic `activeGroup.label` / `activeItem.label` pair identically on every
page) into each page's own layout, so it can reflect that page's actual position (e.g. a specific
strategy id, formula id, symbol, or config namespace) rather than only the active nav group/item —
following the pattern `src/app/config-ui/[namespace]/NamespaceEditor.tsx` and
`src/app/config-ui/audit/page.tsx` already established for their own routes (a page-level `Breadcrumb`
with a distinct `aria-label` from the shell's own "Breadcrumb" landmark). The exact mechanism (a shared
per-segment breadcrumb helper vs. each page owning its own trail; whether `PlatformHeader` keeps any
trace of a breadcrumb after this change; how the nav-group/item context is threaded to a page that
still wants it) is left to `/sdd-design` — see Open Questions.

## Out of Scope

- Sorting, filtering, pagination, or column-visibility toggles for any table.
- Any table on `/insights/watchlists`, `/insights/opportunities`, `/insights/backfills`,
  `/trader/portfolio`, or `/trader/positions` beyond confirming they remain green under FR-3/FR-4 —
  no multi-button Actions column or raw `<table>` was found on them during story-writing.
- Non-table row-action UI (e.g. card-based lists, the opportunities ranked queue itself) — FR-2 is
  scoped to `ui/table.tsx`-based Actions columns only.
- A `ui/tooltip.tsx` primitive — none exists today and the audit found nothing hand-rolling one, so
  there is no live gap to close.
- `globals.css` — audited and found clean (pure theme-token mapping, zero hand-written component
  rules); no changes needed.
- Any change to `Sheet`/`AlertDialog`/`Skeleton` usage — the audit found modal/overlay/loading
  placeholder consolidation already complete.

## Affected Services

- `xstockstrat-ui` — all changes are frontend-only (new UI primitive, table/actions-column/breadcrumb
  markup, shared-component extraction, e2e coverage)

## Consumer Surface(s)

- [x] **UI** — `xstockstrat-ui` segments `/trader`, `/insights`, `/config-ui`, `/accounts`: every FR
  above is visible directly on the affected pages' existing tables, badges, filters, and navigation
  chrome — no new route.
- [ ] **Agent**
- [ ] **None**

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

- [x] No new config keys

## Database Changes

- [x] No schema changes

## Feature Workflow Notes

Branch to create: `feature/shadcn-table-actions-responsive` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking, frontend-only change)

## Acceptance Criteria

1. `src/components/ui/dropdown-menu.tsx` exists (shadcn CLI-vendored) and any collateral file reset by
   the install is reconciled — mechanical regression guards (`button.test.ts`/`badge.test.ts`-style)
   still pass unchanged.
2. Every multi-action Actions column listed in FR-2 renders a single `DropdownMenu` trigger; each
   original action (including destructive `AlertDialog` confirms) is preserved and reachable. Existing
   e2e coverage exercising these actions continues to pass — updated only for selector/interaction
   changes the swap requires, never for behavior changes.
3. `e2e/mobile-overflow.spec.ts`'s `ROUTES` list includes every table-bearing route (FR-3's confirmed
   gap list at minimum) and the full spec passes.
4. FR-4's audit is recorded in `context.md` (which tables were checked, under what wide-content
   scenario, and whether any fix was needed); any table found to overflow is fixed and covered by a
   new or extended assertion, not just noted.
5. Zero raw `<table>` elements remain outside `src/components/ui/table.tsx` (`grep -rn "<table\b" src
   | grep -v components/ui/table.tsx` returns nothing) and the FR-5 sites' clickable-row behavior is
   unchanged (verified by existing/updated e2e).
6. The FR-6 shared label component exists and every one of the 14 cited sites uses it — a follow-up
   grep for the raw literal className string outside the new component returns nothing.
7. The FR-7/FR-8 sites render via `Badge`/`ToggleGroup` respectively, with unchanged visible behavior
   (verified by existing/updated e2e where coverage exists, or FR-4-style manual/scripted verification
   where it doesn't).
8. FR-9's two fixes land only where verified safe per FR-9's own qualifier; any site left unchanged is
   documented with why in `context.md`.
9. FR-10: `nav-reachability.spec.ts`'s "breadcrumb reflects the active screen" guarantee is preserved
   (via an updated assertion strategy against wherever the breadcrumb now lives) for every route in its
   existing `GROUPS` table; every page that previously had no breadcrumb at all does not regress (no
   requirement to retrofit one everywhere unless `/sdd-design` scopes that in); no `aria-label`/
   `role="link"` collision reintroduces the exact fails.md 2026-08-09 defect class.
10. `pnpm lint` and `NEXT_DISABLE_STANDALONE=1 pnpm build` stay clean throughout.

## Open Questions

- [ ] Should the single-action `authorized-apps` Disconnect button convert to a `DropdownMenu` for
  visual consistency, or stay a direct button since a menu adds a click for no grouping benefit when
  there is only one action? Left to `/sdd-design`.
- [ ] FR-4's audit needs a concrete "wide content" scenario per table — `/sdd-design`'s recon phase
  should ground this against each table's real column set rather than inventing a synthetic worst case.
- [ ] **FR-10's exact mechanism** is a genuine design fork, not pre-decided here: (a) does
  `PlatformHeader`'s Row 2 disappear entirely, shrink to just the active-group nav links (no
  breadcrumb), or keep a minimal group-level crumb alongside a new page-level one? (b) is the
  page-level breadcrumb a shared helper component each page configures with its own trail, or does
  each page hand-roll its own `Breadcrumb` (matching the existing `NamespaceEditor.tsx` precedent)?
  (c) which pages actually need a breadcrumb — only detail/drill-down routes with a real hierarchy
  (strategy id, symbol, namespace), or every route? (d) how does `e2e/nav-reachability.spec.ts`'s
  single combined "reachable + breadcrumb reflects screen" assertion get restructured once the
  breadcrumb is no longer one shared, uniformly-labeled shell element?
- **Known trap** (`docs/roadmap/ledger/fails.md`, 2026-08-09, feature 120): shadcn's `Breadcrumb`/
  `BreadcrumbPage` primitive has twice collided with `getByRole`/`getByLabel` Playwright locators in
  this codebase — `BreadcrumbPage`'s built-in `role="link"` colliding with a real nav `Link` of the
  same accessible name, and a default lowercase `aria-label="breadcrumb"` case-insensitively
  substring-matching the shell's own `aria-label="Breadcrumb"` landmark. FR-10 multiplies the number of
  `Breadcrumb` instances on the page at once (moving from 1 shared instance to potentially many
  page-level ones) — `/sdd-design` and `/sdd-spec` must treat every new page-level `Breadcrumb`'s
  `aria-label` distinctness and `role="link"` collision risk as a first-class design constraint, not an
  afterthought caught by a later step's full-suite run.
- **Known trap** (`docs/roadmap/ledger/insights.md`, 2026-08-08, feature 083): a "matches the handoff"
  visual sign-off based on content/screenshot comparison alone can miss horizontal-overflow regressions
  entirely — FR-3/FR-4's automated sweep is the actual gate; do not let `/sdd-execute` substitute an
  eyeballed check for it.
