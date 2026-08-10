# Recon: shadcn-sidebar-visual-rewrite

**Created**: 2026-08-10
**From**: product-spec.md
**Affected services**: `xstockstrat-ui`

---

## Objective

Rewrite the mobile offcanvas Sidebar's internal layout and interaction so its expandable groups
carry a chevron disclosure affordance (rotating on open/close) and their sub-items render via the
vendored-but-unused `SidebarMenuSub`/`SidebarMenuSubItem`/`SidebarMenuSubButton` primitives
(indented, visually distinct from top-level groups) instead of the current flat
`SidebarMenu`/`SidebarMenuItem` reuse — plus muted, non-interactive section-label grouping. Scope is
explicitly layout/interaction within the existing mobile-offcanvas surface, not visibility/placement
(desktop rail mode is out of scope).

## Codebase Map

- **`xstockstrat-ui`** (Next.js/TypeScript)
  - Vendored primitive: `services/xstockstrat-ui/src/components/ui/sidebar.tsx`
    - `useSidebar()` return shape — `sidebar.tsx:30-38` (`state`, `open`, `setOpen`, `openMobile`,
      `setOpenMobile`, `isMobile`, `toggleSidebar`)
    - `SidebarProvider` props — `sidebar.tsx:51-63`
    - `SidebarGroup` — `sidebar.tsx:364-373` (plain `<div data-slot="sidebar-group">`)
    - `SidebarGroupLabel` — `sidebar.tsx:375-393` (`asChild?: boolean`)
    - `SidebarGroupContent` — `sidebar.tsx:415-424`
    - `SidebarMenuButton` — `sidebar.tsx:470-518` (`isActive` → `data-active`, line 491;
      `tooltip` prop, lines 507-517); variant classes at `sidebar.tsx:449` already include
      `data-active:*` and `data-open:*` functional-variant families
    - `SidebarMenuSub` — `sidebar.tsx:593-605` (`<ul>`, `border-l border-sidebar-border` — the
      connecting-line rail is already styled, hidden when `collapsible=icon`)
    - `SidebarMenuSubItem` — `sidebar.tsx:607-616` (`<li>` wrapper only)
    - `SidebarMenuSubButton` — `sidebar.tsx:618-644` (renders `<a>` by default, `isActive` →
      `data-active`)
    - Full export list — `sidebar.tsx:646-671`
  - Mobile wiring: `services/xstockstrat-ui/src/components/shared/PlatformHeader.tsx`
    - Offcanvas mount — `PlatformHeader.tsx:266-316` (`sm:hidden` wrapper →
      `SidebarProvider defaultOpen={false} className="w-auto min-h-0"` →
      `Sidebar side="left" collapsible="offcanvas"`)
    - `MobileNavTrigger` — `PlatformHeader.tsx:149-157` (uses `useSidebar().toggleSidebar()`)
    - Single-open-group state — `PlatformHeader.tsx:196`
      (`const [expanded, setExpanded] = React.useState<string>(activeGroup.key)`)
    - Per-group render block — `PlatformHeader.tsx:276-311`
      (`NAV_GROUPS.map` → `SidebarGroup` → `Collapsible open={expanded === group.key}
      onOpenChange={...}` → `CollapsibleTrigger asChild` wrapping `SidebarMenuButton`
      (`282-293`) → `CollapsibleContent` wrapping `SidebarGroupContent` → `SidebarMenu` →
      `SidebarMenuItem` × sub-items → `MobileNavLink` (`294-308`))
    - `MobileNavLink` — `PlatformHeader.tsx:160-175` (`SidebarMenuButton asChild isActive={...}
      onClick={() => setOpenMobile(false)}`)
    - Pinned `Settings` item — no special-case branch; it is `NAV_GROUPS[4]` and flows through
      the identical `.map` (`navGroups.tsx:70-83`, `PlatformHeader.tsx:276-311`)
  - Nav data model: `services/xstockstrat-ui/src/components/shared/navGroups.tsx`
    - `SubNavItem { label; href; match?: 'exact'|'prefix' }` — `navGroups.tsx:10-15`
    - `NavItem extends SubNavItem { adminOnly?: boolean }` — `navGroups.tsx:17-20`
    - `NavGroup { key; label; icon: React.ReactNode; items: NavItem[] }` — `navGroups.tsx:22-27`
    - `NAV_GROUPS: NavGroup[]` — `navGroups.tsx:33-84`, 5 groups (`decide`/`discover`/`engine`/
      `book`/`settings`), flat `items` array per group — no existing sub-category/label field
  - e2e coverage: `services/xstockstrat-ui/e2e/mobile-sidebar.spec.ts`
    - `'trigger opens the panel and every non-admin-visible group/item is reachable'` (`:23-56`)
    - `'non-admin session never renders Backfills'` / `'admin session renders Backfills'` (`:58-75`)
    - `'clicking a nav link navigates and closes the panel'` (`:77-86`)
    - `'only one group is expanded at a time'` (`:88-100`)
    - `'the active route highlights its group and item'` (`:102-113`) — asserts the active group
      **button** `toHaveClass(/bg-accent/)` and the active **link** `toHaveAttribute('data-active',
      'true')`

## Patterns to REUSE

- **Sub-item nesting** → the vendored-but-unused `SidebarMenuSub`/`SidebarMenuSubItem`/
  `SidebarMenuSubButton` at `sidebar.tsx:593-644` — already styled with a connecting-line rail
  (`border-l border-sidebar-border`), just never wired into `PlatformHeader.tsx`'s render loop.
  This is the entire point of the feature: swap `SidebarMenu`/`SidebarMenuItem` for
  `SidebarMenuSub`/`SidebarMenuSubItem` inside `CollapsibleContent` (`PlatformHeader.tsx:294-308`).
- **Rotating chevron affordance** → the idiomatic pattern already lives at
  `services/xstockstrat-ui/src/components/ui/navigation-menu.tsx:74-77`: an icon with
  `transition duration-300` + `group-data-[state]-open/…:rotate-180`, driven by a `group` class on
  the trigger and Radix's own `data-state` attribute — no custom JS toggling needed. `sidebar.tsx`
  already has the same functional-variant family (`data-open:*` at `sidebar.tsx:449`), so a chevron
  dropped into `SidebarMenuButton`'s children can drive off `CollapsibleTrigger`'s own `data-state`
  the same way. **Do not** imitate `accordion.tsx:48-55`'s swap-two-icons pattern — it's a different
  idiom (two icons, `hidden`/visible toggle) and `navigation-menu.tsx` is the closer precedent for a
  single rotating icon.
- **Section-label grouping** → `SidebarGroupLabel` (`sidebar.tsx:375-393`) is vendored and unused —
  the primitive already exists for FR-3; no new component needed, only wiring + a content decision
  (Open Question, below).
- **Icon choice** → `PlatformHeader.tsx` already imports from `@phosphor-icons/react`
  (`PlatformHeader.tsx:6`), and `CaretRight`/`CaretDown` from that same package are already used
  elsewhere in this codebase (`src/components/mobile/SectionRenderer.tsx:3,73`) — same-library
  consistency with the rest of the header, rather than introducing `lucide-react` (present as a dep
  but never used for a chevron anywhere in `src/`) or `@tabler/icons-react` (used for chevrons in
  `ui/*` primitives like `dropdown-menu.tsx`/`select.tsx`/`accordion.tsx`, but not in this header).
  This choice belongs to the design debate, not asserted here as settled.
- **Keyboard accessibility** → nothing to add. Feature 124's "keyboard-accessible row" behavior is
  inherited for free from Radix `CollapsiblePrimitive.CollapsibleTrigger` rendering a native
  `<button>` (`ui/collapsible.tsx:9-13`) — there is no custom `onKeyDown`/`tabIndex` app code to
  preserve, just Radix's own semantics. `mobile-sidebar.spec.ts:16-17` already reads `aria-expanded`
  directly off that native button. As long as the chevron/`SidebarMenuSub` rewrite keeps
  `CollapsibleTrigger` as the interactive element, this requirement is satisfied by construction.
- **Test fixtures** → not applicable (Constitution C-12). Confirmed via
  `e2e/fixtures/INVENTORY.md:1-64` — no domain-data fixture concerns a nav/Sidebar visual
  structure; `mobile-sidebar.spec.ts` uses only `addAuthCookie`/`addAdminCookie`
  (`e2e/helpers/auth.ts:56,61`), which any updated/new assertions continue to use.

## Dependencies

- Proto/RPC: none
- Migration: none
- Config keys: none
- Inter-service edges: none — this is a self-contained `xstockstrat-ui` presentational change
- New env vars / ports: none

## Risks / Not-found

- **Not found**: any chevron/rotation code already inside `sidebar.tsx` itself — the vendored file
  has zero chevron icon usage today; the rotating-chevron idiom must be composed fresh from
  `navigation-menu.tsx`'s pattern plus whichever icon the design debate selects.
- **Not found**: any existing grouping/category/label concept in `NAV_GROUPS` beyond a flat
  `items` array per group — FR-3's section-label boundary (Open Question in product-spec.md) has
  no existing data-model precedent to lean on; the design debate must decide whether it's a new
  `navGroups.tsx` field or purely presentational in `PlatformHeader.tsx`.
- **Not found**: any custom keyboard-handling app code (`onKeyDown`/`tabIndex`/explicit `role`) in
  `PlatformHeader.tsx` — confirms FR-4 ("preserve the keyboard triple") is actually "don't break
  Radix's native button semantics," not "preserve custom app logic." Lowers implementation risk but
  the design should say so explicitly rather than leave it implied.
- **Existing e2e contract is a hard constraint, not just coverage to extend**:
  `mobile-sidebar.spec.ts:102-113` asserts the active group trigger `toHaveClass(/bg-accent/)` and
  the active link `toHaveAttribute('data-active', 'true')`. A rewrite that moves active-state
  styling to a different element, or renames the `bg-accent` class away, breaks this test in the
  same PR it's introduced in — the design must either preserve these exact assertion targets or
  explicitly plan their same-PR update (FR-5 already requires updating this spec; this is *why*).
- **Ledger trap** (`docs/roadmap/ledger/insights.md`, 2026-08-09 —
  `shadcn-table-actions-responsive — design`): mid-round decisions in this exact `sidebar.tsx`/
  `PlatformHeader.tsx` family must be written into this file (or `context.md`) before the next
  debate round spawns — a prior round in feature 124's design already produced one false-alarm
  regression finding purely from this gap. The adversary in Phase 1 reads only this file, never the
  session transcript.
- No `fails.md` entries matched this feature's scope (confirmed at `/sdd-story` time).

## Recommended Scope

Advisory only — not binding on `/sdd-spec`:

1. Choose and wire the chevron icon (design decision: `@phosphor-icons/react`'s `CaretRight`/
   `CaretDown`, matching `PlatformHeader.tsx`'s existing import, vs. another already-vendored
   family) into `CollapsibleTrigger`'s `SidebarMenuButton` child, driven by Radix's own
   `data-state` via the `navigation-menu.tsx:74-77` rotation idiom.
2. Swap `SidebarMenu`/`SidebarMenuItem` for `SidebarMenuSub`/`SidebarMenuSubItem`/
   `SidebarMenuSubButton` inside each group's `CollapsibleContent` (`PlatformHeader.tsx:294-308`),
   preserving `MobileNavLink`'s `isActive`/`onClick` behavior.
3. Add `SidebarGroupLabel` section-label wiring per the design's resolution of the Open Question
   (single label vs. a Decide/Discover/Engine/Book vs. pinned-Settings split).
4. Update `mobile-sidebar.spec.ts` in the same change: the active-group-trigger and active-link
   assertions (`:102-113`) need their targets re-verified against the new DOM, and new assertions
   for chevron `aria-expanded`/rotation state and `SidebarMenuSub` structure should be added per
   product-spec FR-5.
5. No new fixtures, no new config, no new proto, no new services touched.
