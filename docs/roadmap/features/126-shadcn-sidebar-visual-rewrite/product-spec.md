# Product Spec: shadcn-sidebar-visual-rewrite

**Created**: 2026-08-10

---

## Problem Statement

Feature 124 (Step 15/17) vendored shadcn's `ui/sidebar.tsx` primitive family and wired it into
`PlatformHeader.tsx` as the mobile offcanvas nav menu, replacing the old `Sheet`+`Accordion`
implementation. But Step 17's actual wiring only used the flat `SidebarMenu`/`SidebarMenuItem`
primitives for both top-level groups and their sub-items — it never adopted the
`SidebarMenuSub`/`SidebarMenuSubItem`/`SidebarMenuSubButton` primitives that were vendored in the
same file but left unused. The result, confirmed against a side-by-side screen recording of our
live menu vs. shadcn's own reference example (`ui.shadcn.com/docs/components/sidebar`, Radix UI
tab): expandable groups (Decide/Discover/Engine/Book) render as plain full-width rounded pill
buttons with no chevron/disclosure affordance, and their sub-items (e.g. Watchlists/Screener under
Discover) render at the same visual weight and indentation as the group button itself, with no
nesting cue — a functionally correct but visually flat menu that doesn't match the
shadcn-idiomatic hierarchy the vendored primitives were built for.

**This feature is scoped to layout and interaction, not visibility.** Whether the Sidebar is
offcanvas (current, mobile-only) or persistently on-screen (a desktop "rail") is an orthogonal
question about *where/when* the panel is shown, and is explicitly not what this feature changes —
see Out of Scope. What's in scope is *how* the panel's own contents are arranged and behave once
it's open: the chevron disclosure affordance and its rotation on toggle, and the indented
`SidebarMenuSub` nesting for sub-items. Framing this as an "always visible" ask would be the wrong
read of the video comparison and of shadcn's reference example alike — its rail mode is one
configuration of the same underlying layout/interaction primitives this feature targets, not the
point of the comparison.

## User Story

As a mobile user of any `xstockstrat-ui` segment (`/trader`, `/insights`, `/config-ui`,
`/accounts`), I want the offcanvas nav menu's expandable groups and their sub-items to look and
behave like shadcn's own reference Sidebar — chevron indicators that show a group is expandable
and rotate on toggle, and indented sub-items with a visible nesting cue — so that the menu's
structure is legible at a glance instead of reading as one undifferentiated list of pills.

## Functional Requirements

FR-1. Each expandable group trigger (Decide, Discover, Engine, Book — the groups currently backed
by `Collapsible`/`CollapsibleTrigger` in `PlatformHeader.tsx`) must render a chevron/disclosure
icon that visually rotates (or otherwise changes) to reflect the group's current open/closed
state, matching shadcn's reference `SidebarMenuButton` + `ChevronRight`/`CollapsibleTrigger`
pattern.

FR-2. Sub-items within an expanded group must render via the vendored
`SidebarMenuSub`/`SidebarMenuSubItem`/`SidebarMenuSubButton` primitives (`ui/sidebar.tsx`,
currently unused) instead of the flat `SidebarMenu`/`SidebarMenuItem` list inside
`CollapsibleContent`, so they render indented under a connecting line and are visually distinct
from top-level group buttons.

FR-3. Top-level items must be grouped under muted, non-interactive section-label headers (shadcn's
`SidebarGroupLabel` pattern — e.g. its own reference example's "Platform"/"Projects"), replacing
the current unlabeled flat sequence of group buttons. The pinned `Settings` item's placement
relative to any such grouping is a design-time decision.

FR-4. The existing keyboard-accessible row behavior and single-open-group state established in
feature 124 (Step 16-ish keyboard triple, one-open-group-at-a-time `Collapsible` state) must be
preserved through the DOM restructuring.

FR-5. Existing e2e coverage of the mobile nav menu (whatever spec(s) feature 124 added/touched for
`PlatformHeader`'s offcanvas Sidebar) must be updated to assert the new structure (chevron
rotation state, `SidebarMenuSub` indentation/ARIA) rather than the flat structure it replaces —
not just left passing by accident.

## Out of Scope

- shadcn's reference example's organization/team switcher and user-account footer widgets — this
  Sidebar has neither concept; nothing in our platform maps to them today.
- Icon-collapse desktop "rail" mode — i.e. making the Sidebar persistently/always visible on
  desktop instead of mobile-offcanvas-only. This is excluded because it's a *visibility/placement*
  question (where the panel lives), not a *layout/interaction* one (how its contents are arranged
  and behave) — the actual subject of this feature. Our desktop nav is already a separate
  mechanism (`PlatformHeader`'s Row 1/Row 2 `NavigationMenu`), not this `Sidebar` — the vendored
  `Sidebar` stays mobile-offcanvas (`collapsible="offcanvas"`, wrapped `sm:hidden`) only. Confirm
  at design time whether any part of this rewrite should touch the desktop nav; the working
  assumption is no.
- A "More" overflow affordance for a long item list. The current item count (4 expandable groups +
  pinned Settings) doesn't yet justify one — flagged as an Open Question below rather than an FR,
  so design can confirm or drop it rather than build overflow handling for a list that doesn't
  overflow.

## Affected Services

- `xstockstrat-ui` — the only service touched; `PlatformHeader.tsx` (wiring) and `ui/sidebar.tsx`
  (vendored primitive, already contains the needed exports) both live here.

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **UI** — `xstockstrat-ui`: the shared mobile offcanvas nav menu (`PlatformHeader.tsx`'s Row 1
  hamburger `Sidebar`), reachable from every segment that mounts `PlatformHeader`: `/trader`,
  `/insights`, `/config-ui`, `/accounts`. No new route; this is a visual/structural rewrite of an
  existing, already-reachable control.
- [ ] **Agent** — not applicable.
- [ ] **None** — not applicable; see above.

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

- [x] No new config keys

## Database Changes

- [x] No schema changes

## Feature Workflow Notes

Branch to create: `feature/shadcn-sidebar-visual-rewrite` (branch from `main-dev`)

Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking, UI-only change — no proto/config/schema)

## Acceptance Criteria

1. Each expandable group trigger in the mobile offcanvas Sidebar shows a chevron that visibly
   rotates between its open and closed states.
2. Sub-items under an expanded group render via `SidebarMenuSub`/`SidebarMenuSubItem`/
   `SidebarMenuSubButton`, visually indented with a connecting-line cue distinct from top-level
   group buttons.
3. Top-level groups are presented under a muted, non-interactive section label (or labels),
   replacing the current unlabeled flat list.
4. The single-open-group behavior and the keyboard interaction triple established in feature 124
   still work unchanged after the DOM restructuring.
5. `pnpm lint` and `pnpm build` pass; the full `pnpm test:e2e` suite passes (no new
   `mobile-overflow.spec.ts` or nav-reachability regressions).
6. Existing/updated e2e coverage asserts the new chevron-rotation and sub-item-indentation
   structure, not just that links remain clickable.

## Open Questions

- [ ] Does the current 4-group + pinned-Settings item count justify a "More" overflow affordance,
  or is it out of scope until the nav model (`navGroups.tsx`) grows? Leaning out-of-scope per the
  Out of Scope section above — confirm at design time.
- [ ] Where does the muted section-label boundary fall — one label for all nav groups, or a split
  (e.g. separating the four `Decide/Discover/Engine/Book` groups from the pinned `Settings` item)?
  The nav model (`src/components/shared/navGroups.tsx`) doesn't currently carry a grouping concept
  beyond the flat `NAV_GROUPS` array — decide whether that model needs a new field or whether the
  section label is purely presentational in `PlatformHeader.tsx`.
- **Known trap** (`docs/roadmap/ledger/insights.md`, 2026-08-09 —
  `shadcn-table-actions-responsive — design`): a design decision reached verbally between debate
  rounds is not settled until it's written into `recon.md`/`context.md`/`design.md` — a later
  round's adversary (or `/sdd-spec`) only ever reads the durable artifacts, never the session
  transcript. This exact feature family (the vendored `sidebar.tsx`/`PlatformHeader.tsx` shell)
  already produced one false-alarm regression finding from this gap during feature 124's design.
  Any mechanism decided mid-round in this feature's `/sdd-design` (e.g. the section-label grouping
  answer above) must be written into `recon.md`/`context.md` before the next round spawns, not
  just carried forward in the orchestrator's own synthesis.
