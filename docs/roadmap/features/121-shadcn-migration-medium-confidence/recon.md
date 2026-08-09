# Recon: shadcn-migration-medium-confidence

**Created**: 2026-08-08
**From**: product-spec.md
**Affected services**: `xstockstrat-ui`

**Method note**: no `Task` tool (subagent spawning) was available in this session. Discovery below
was performed directly (Read/Grep/Bash against the live repo) rather than via a spawned
`codebase-discovery` subagent, following the same checklist
(`.claude/skills/sdd-spec/reference/discovery-checklist.md`) the subagent would have used. All
citations are grounded `path:line` reads, not invented — the "Not found" discipline (F-04) is
preserved.

---

## Objective

Add three genuinely-new shadcn primitives (`switch`, `slider`, `collapsible`) plus optionally
`navigation-menu`, wire six already-shipped primitives from sibling `120` to eleven more call sites,
route two badge-shaped and two table-shaped occurrences onto existing `ui/badge.tsx`/`ui/table.tsx`,
and consolidate two independently-built filter toolbars into one shared `FilterToolbar` — closing the
22 medium-confidence occurrences from the shadcn/ui gap audit, all inside `xstockstrat-ui`.

## Codebase Map

- **`xstockstrat-ui`** (Next.js 15 / TS, `services/xstockstrat-ui/`)
  - Primitive convention (post-119, confirmed): plain function components, no `forwardRef`/
    `displayName` — `src/components/ui/badge.tsx:35` (`function Badge({ className, variant = 'default',
    asChild = false, ...props })`), `src/components/ui/select.tsx:9,27,53` (all `function X(...)`),
    `src/components/ui/sheet.tsx:10,42` (same). `components.json:3` pins preset style `radix-rhea`;
    package.json carries the unified `radix-ui@^1.6.7` package (covers `Switch`/`Slider`/`Collapsible`/
    `NavigationMenu` — no per-primitive `@radix-ui/react-*` install needed) plus `@base-ui/react@^1.7.0`
    (combobox only, not relevant here).
  - App-specific `cva` variant pattern: `src/components/ui/button.tsx:14-23` (`buy`/`sell`, marked
    `// app-specific`), `src/components/ui/badge.tsx:19-24` (`buy`/`sell`/`paper`/`live`/`warning`/
    `info`), each guarded by a regression test — `src/components/ui/badge.test.ts:1-19` asserts
    `badgeVariants({variant:'buy'})` still contains `bg-buy/20` etc.
  - Existing `Table` family: `src/components/ui/table.tsx:7-60` (`Table`/`TableHeader`/`TableBody`/
    `TableRow`/`TableHead`/`TableCell`, `data-slot` markers, no forwardRef). Live consumer pattern:
    `src/app/config-ui/audit/page.tsx:7,29-52` and `src/components/trader/LiveStrategiesPanel.tsx:35-72`
    (`TableRow onClick` for row-select, exactly the interaction FR-11 must preserve on
    `insights/strategies/[id]/page.tsx`'s selectable rows).
  - FR-1 target: `src/app/config-ui/sources/page.tsx:504-515` — `<input type="checkbox" id="active-toggle">`
    + `<label>Active</label>`, no shadcn primitive involved today.
  - FR-2 target: `src/app/insights/screener/page.tsx:396-405` — raw `<input type="range" aria-label="weight
    slider" min={0} max={1} step={0.05}>` alongside a numeric `<Input>` mirror of the same value.
  - FR-3 target: `src/components/trader/accountShared.tsx` `EditCredentialsForm` (116-167, not
    individually re-read this pass — product-spec's own citation, unchanged since `/sdd-story`).
  - FR-4 (five `window.confirm()` sites) — all five re-verified this session, exact wording:
    `src/app/insights/watchlists/page.tsx:75`, `src/app/insights/formulas/[id]/page.tsx:22`,
    `src/app/insights/strategies/page.tsx:53-57`, `src/app/insights/backfills/page.tsx:128`,
    `src/app/accounts/authorized-apps/page.tsx:72` — all identical shape:
    `if (!window.confirm('...')) return;` then a mutation call.
  - FR-10 targets: `src/components/trader/AlertStream.tsx:46-58` (hand-rolled `<span>` unread-count
    pill positioned `absolute -top-1 -right-1`, conditional destructive/primary color by
    `hasHighSeverity`) and `src/components/trader/AccountSelector.tsx:64-77` (hand-rolled `<span
    className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-destructive">` status dot, no
    text, positioned over the gear icon's `Link`).
  - FR-11 targets: `insights/strategies/[id]/page.tsx:470-500` (not re-read this session — unchanged
    per product-spec's own citation) and `insights/screener/page.tsx:~555-605` (approximate range, per
    product-spec's own `~` marker — needs a precise re-citation at `/sdd-spec` time).
  - FR-12 (`FilterToolbar`) sources — both fully re-read this session, and they are **not**
    byte-identical shapes: `src/components/trader/AccountsModule.tsx:55-135` wraps its toolbar in a
    `Card`/`CardHeader`/`CardContent`, puts the active-filter-count badge + conditional "Clear
    filters" `Button` (`activeFilterCount > 0 &&`) in the `CardHeader` row, and the actual controls
    (one `Input` with a `Search` icon + 3 `Select`s) in `CardContent` as a `flex flex-wrap` row.
    `src/components/trader/OrderFilters.tsx:85-138` wraps in its own `Card`/`CardContent`, uses a
    `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` layout with no search `Input` (symbol goes through
    a plain `Input` inside the grid, not a search-icon variant), 3 `Select`s + 2 date `Input`s, and an
    **unconditional** "Clear filters" button below the grid (no active-filter-count badge at all).
  - FR-13 targets — both fully re-read this session:
    - `src/components/shared/PlatformHeader.tsx:156-291` — three separate nav regions, all plain
      `<Link>` + `cn()` conditional classes, driven by the single `NAV_GROUPS` data model
      (`src/components/shared/navGroups.tsx`): (1) desktop row-1 group tabs (`:170-190`, `<nav
      aria-label="Primary">`, one `<Link>` per top-level group, no submenu/flyout — clicking navigates
      directly to `group.items[0].href`); (2) desktop row-2 breadcrumb + active-group's item links
      (`:260-288`, `<nav aria-label="Section">`, plain `<Link>`s, no nesting); (3) mobile `Sheet`
      (`:195-255`) with an expand/collapse `<button>` per group (`aria-expanded`, local `useState`) and
      `<Link>`s underneath — this is the one place with expand/collapse behavior already, and it is
      **not** a `NavigationMenu` shape either (it's accordion-like disclosure inside a `Sheet`, matching
      FR-3's own `collapsible` primitive far better than `navigation-menu`).
    - `src/components/mobile/BottomTabBar.tsx:25-56` — a single `<nav aria-label="Mobile primary">`
      with four `<Link>`s, no submenu, no expand/collapse.
    - `e2e/nav-reachability.spec.ts:1-40+` walks the rendered shell by role/label/text — `GROUPS` maps
      tab labels to expected sub-item hrefs and asserts the breadcrumb reflects the active screen
      (C-10(a) test, feature 083 Step 21). Any FR-13 rewrite must keep this spec passing without
      rewriting its selectors, since the spec's whole point is walking the *rendered* shell, not
      calling internals directly.
  - **FR-13 Round 3 addendum (2026-08-08) — user-directed override re-grounding.** The FR-13
    keep-as-is call below (§ Recommended Scope) was overridden by the user directly (not a design
    debate outcome) after this recon was first written; see `design.md` § Round 3. Re-verified this
    session against the live repo to ground the replacement plan:
    - `PlatformHeader.tsx` desktop row-1 group tabs — exact re-read range `:170-190`, `<nav
      aria-label="Primary" className="hidden sm:flex items-center gap-1 flex-1">`, one flat `<Link>`
      per `NAV_GROUPS` entry, `aria-current={isActive ? 'page' : undefined}` (`:177`) — zero
      dropdown/flyout/nesting.
    - `PlatformHeader.tsx` desktop row-2 breadcrumb + section links — the `<nav aria-label="Section"
      className="flex items-center gap-1 overflow-x-auto">` element itself is `:271-287`, nested
      inside the row-2 wrapper `<div>` at `:260-288`; the `aria-label="Breadcrumb"` `<span>` at `:261`
      is a **sibling** of this `<nav>`, not inside it, and is out of this feature's scope — sibling
      `120-shadcn-migration-high-confidence`'s FR-7 migrates that span to a Breadcrumb primitive.
      Active-state logic consumed by both regions: `isItemActive` (`:81-84`), `resolveActive`
      (`:87-95`).
    - `BottomTabBar.tsx` — whole file is 56 lines; the nav element itself is `:28-54`
      (`aria-label="Mobile primary"`, `data-testid="mobile-tab-bar"`), four `<Link>`s built from
      `TABS = NAV_GROUPS.slice(0, 4)` (`:8`), `isGroupActive` (`:10-18`) drives active styling.
    - Mobile `Sheet` disclosure (`PlatformHeader.tsx:195-255`) is confirmed **out of scope** for this
      replacement: it is accordion-like expand/collapse (`aria-expanded`, local `useState` at `:151`,
      `:214-230`), not a flat-link nav — structurally it doesn't match `NavigationMenu`'s flat-item
      shape, and sibling `120`'s FR-8 Accordion migration already targets this same `:209-253` range.
      Stays hand-built; not touched by FR-13.
    - `e2e/nav-reachability.spec.ts` full-file re-read: line 60 `page.getByRole('navigation', { name:
      'Primary' })`, line 61 `page.getByRole('navigation', { name: 'Section' })`, line 65
      `primary.getByRole('link', { name: group.tab, exact: true })`, line 67
      `section.getByRole('link', { name: item.label, exact: true })`, line 68
      `expect(page).toHaveURL(...)`, lines 70-71 `page.getByLabel('Breadcrumb')` (unrelated —
      don't break). The spec never touches the mobile `Sheet` or `BottomTabBar`.
    - **shadcn Navigation Menu API** (verified live against
      `https://ui.shadcn.com/r/styles/radix-rhea/navigation-menu.json` and the shadcn docs): 9 named
      exports — `NavigationMenu`, `NavigationMenuList`, `NavigationMenuItem`, `NavigationMenuContent`,
      `NavigationMenuTrigger`, `NavigationMenuLink`, `NavigationMenuIndicator`,
      `NavigationMenuViewport`, `navigationMenuTriggerStyle` (a `cva()` helper).
      `NavigationMenuLink` is documented as usable standalone inside a `NavigationMenuItem` with no
      paired `Trigger`/`Content` — the flat-nav pattern this migration needs:
      ```jsx
      <NavigationMenuItem>
        <NavigationMenuLink render={<Link href="/docs" />} className={navigationMenuTriggerStyle()}>
          Documentation
        </NavigationMenuLink>
      </NavigationMenuItem>
      ```
      The `render={<Link .../>}` prop is the documented pattern for delegating to a framework router
      link (confirmed by sibling feature 123's Combobox finding that this repo's `radix-rhea` style is
      Base-UI-backed for at least one primitive, `combobox.tsx:4` importing from `@base-ui/react` while
      `select.tsx:4`/`sheet.tsx:4` import from the unified `radix-ui` package) — **not independently
      confirmed for `navigation-menu.tsx` specifically this session**; `/sdd-execute` must verify the
      exact import source and prop name against the actual CLI-generated file (or shadcn's live
      registry JSON) before hand-authoring a fallback. `package.json` carries both `radix-ui@^1.6.7`
      and `@base-ui/react@^1.7.0` today, so either source is already a repo dependency — no new package
      install is implied either way.
  - FR-9 target `LiveStrategiesPanel.tsx:35-72` re-read this session: `TableRow onClick={() =>
    setSelectedId(...)}` selects a strategy; `{selectedId && <StrategyAlertFeed .../>}` renders **one
    shared panel below the whole table**, not per-row inline expansion — i.e. today's interaction is
    "select a row → a single external panel changes," not "each row expands in place." A literal
    `Accordion` (one `AccordionItem` per row, each with its own `AccordionContent`) is a different
    interaction model than what exists today. Flagged as an open risk for FR-9, which is out of this
    round's build order regardless (blocked on 120).

## Patterns to REUSE

- Switch (FR-1) → new `ui/switch.tsx`, same shape as `ui/badge.tsx:35` (plain function component,
  `cn()`, `data-slot`), built on `radix-ui`'s `Switch` (already a repo dependency, no new package).
- Slider (FR-2) → new `ui/slider.tsx`, same shape, built on `radix-ui`'s `Slider`.
- Collapsible (FR-3) → new `ui/collapsible.tsx`, same shape, built on `radix-ui`'s `Collapsible`.
- Badge reuse (FR-10) → `src/components/ui/badge.tsx` `Badge` + its existing `destructive`/`default`
  variants — no new variant needed for a plain unread-count/status-dot swap; `Badge`'s
  `overflow-hidden rounded-2xl` shape already matches a pill.
- Table reuse (FR-11) → `src/components/ui/table.tsx` family, exactly as already consumed by
  `config-ui/audit/page.tsx:29-52` and `LiveStrategiesPanel.tsx:35-64` (including the `TableRow
  onClick` row-select pattern FR-11 must preserve for `strategies/[id]/page.tsx`).
- App-specific `cva` variant regression guard (if any new primitive needs one) → mirror
  `badge.test.ts:1-19` / `button.test.ts` — plain Vitest assertions on the exported `cva` variants
  function, no DOM rendering (confirmed convention, matches sibling `120`'s recon.md finding).
- Navigation Menu (FR-13, Round 3 override) → new `ui/navigation-menu.tsx`, same post-119
  plain-function-component/`data-slot`/`cn()` shape as `ui/badge.tsx:35`/`ui/select.tsx:9,27,53`/
  `ui/sheet.tsx:10,42` — **no `React.forwardRef`/`displayName`**. `NavigationMenuLink` used standalone
  (no `Trigger`/`Content` pairing) inside `NavigationMenuItem`, with `navigationMenuTriggerStyle()`
  (the shadcn `cva()` helper) supplying the link's base classes and each call site's existing `cn(...)`
  active/inactive classes layered on top via `className` — see § Codebase Map's Round 3 addendum above
  for the full 9-export API and the standalone-`Link`-inside-`Item` pattern.
- Test-data inventory (C-12) → `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` already carries
  fixtures for every domain object these FRs' e2e specs touch: `accounts.ts` (FR-12 AccountsModule),
  `orders.ts` (FR-12 OrderFilters), `strategies.ts` (FR-4 deactivate, FR-9), watchlist/opportunity
  fixtures (FR-4 delete-watchlist). No new fixture module expected — confirm at `/sdd-spec` time
  whether any FR-4/FR-12 e2e rewrite needs a new scenario-only inline literal (stays inline per C-12
  unless it gets a second consumer).

## Dependencies

- Proto/RPC: none — every FR is a markup/component swap, no RPC shape changes.
- Migration: none.
- Config keys: none.
- Inter-service edges: none — this feature does not add or change any client call.
- New env vars / ports: none.
- **Cross-feature dependency (not a codebase dependency, a merge-order one)**: FR-4 through FR-9
  consume `ui/alert-dialog.tsx`, `ui/tabs.tsx`, `ui/toggle-group.tsx`, `ui/alert.tsx`,
  `ui/checkbox.tsx`, `ui/accordion.tsx` — none of which exist on `main-dev` yet
  (`ls src/components/ui/` this session confirms only `badge, button, card, combobox, input-group,
  input, select, separator, sheet, skeleton, table, textarea, utils` exist today). All six are added
  by sibling `120-shadcn-migration-high-confidence` (`spec-ready`, not yet merged). FR-1/FR-2/FR-3/
  FR-10/FR-11/FR-12/FR-13 depend on none of them and can build independently.

## Risks / Not-found

- **FR-11's `insights/screener/page.tsx:~555-605` range is approximate** (product-spec's own `~`
  marker) — not re-verified this session; `/sdd-spec` must re-grep the exact range before citing it in
  a step.
- **FR-9's row-click-to-external-panel interaction doesn't literally match `Accordion`'s per-item
  expand-in-place model** (see Codebase Map above) — carried forward as an open risk for whichever
  session specs/executes FR-9 (blocked on 120 regardless, so not this round's concern, but recorded
  here so it isn't lost).
- **FR-12's two toolbars are not byte-identical** — `AccountsModule.tsx` has a search `Input` +
  active-filter-count badge + `Card`/`CardHeader` wrapper; `OrderFilters.tsx` has no search input, no
  count badge, a grid layout, and an unconditional Clear button. A shared `FilterToolbar` needs a
  props surface flexible enough to cover both without becoming a kitchen-sink component — a design
  question, not a blocker (Constitution C-10 already requires "every instance updated," it doesn't
  mandate identical visual output).
- **No existing `ui/switch.tsx` / `ui/slider.tsx` / `ui/collapsible.tsx` / `ui/navigation-menu.tsx`
  anywhere in the repo** (grep for `ui/switch|ui/slider|ui/collapsible|ui/navigation-menu` returned
  zero hits in `src/`) — confirms these are genuinely new additions, not a rename/relocate.
- **`fails.md` trap applicable**: 2026-08-08 shadcn-ui-migration entry (Vitest `resolve.alias` for
  `@/*`) — already fixed in `vitest.config.ts` per that entry; any new `ui/*.test.ts` this feature
  adds should work out of the box, but worth a smoke check at execute time since it bit an unrelated
  test file (`copilot.test.ts`) once already.
- **This session ran without a `Task` tool** — recon was performed directly rather than via a
  spawned `codebase-discovery` subagent. Coverage should be equivalent (same checklist, same
  evidence discipline) but was not independently cross-checked by a second agent pass the way the
  skill's normal flow would.

## Recommended Scope

Two build tranches, matching product-spec's own Open Questions § Merge order:

1. **No cross-feature dependency** (can start immediately): FR-1 (Switch), FR-2 (Slider), FR-3
   (Collapsible), FR-10 (Badge reuse ×2), FR-11 (Table reuse ×2), FR-12 (FilterToolbar consolidation),
   FR-13 (nav — **REPLACE**, per Round 3 user-directed override; see § Codebase Map addendum above and
   `design.md` § Round 3).
2. **Blocked on `120-shadcn-migration-high-confidence` merging**: FR-4 (AlertDialog ×5), FR-5 (Tabs),
   FR-6 (ToggleGroup), FR-7 (Alert ×2), FR-8 (Checkbox), FR-9 (Accordion).

`/sdd-spec` should sequence tranche 1 as the concrete numbered steps for this pass and record
tranche 2 as spec'd-but-blocked (or defer specifying it in detail until 120 lands, per whichever the
approved design.md recommends).
