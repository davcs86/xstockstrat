# Product Spec: symbol-page-section-nav

**Created**: 2026-08-15

---

## Problem Statement

The unified Symbol page (`/trader/positions/[symbol]`, feature 125) has grown into a long single-column
stack of many sections — price chart, FR-6 indicator overlay panels, orders & fills, trade widget, the
watchlist-conditional block (Opportunity / Readiness / Fundamentals / Mute, or Screening), Backtests,
Backfill coverage, and the held-position body. Reaching a lower section means scrolling past everything
above it, on desktop and (worse) on mobile. A trader who wants, say, the Backtests or the indicator
panels has no way to jump straight there.

## User Story

As a trader on the unified Symbol page, I want the sections grouped behind a same-page navigation
pattern (tabs or an equivalent), so that I can jump straight to the group I care about without
scrolling through the whole page.

## Functional Requirements

FR-1. The Symbol page's sections are organized into a small set of **named groups** navigable
without a full-page scroll. Proposed rough grouping (final grouping decided at `/sdd-design`):
- **Overview / Chart** — price chart (+ its overlays) and the indicator overlay panels.
- **Research** — the watchlist-conditional block (Opportunity / Readiness / Fundamentals / Mute) or
  Screening for a non-watchlisted symbol.
- **Trade** — the trade widget (OrderForm) and orders & fills.
- **Backtests** — the Backtests section.
- **Coverage** — the Backfill coverage section.
- The held-position body (header stats + Risk/Manage/Why/Broker sidebar) is always-relevant framing —
  its placement (persistent header above the nav vs. its own group) is a design decision.

FR-2. Exactly one group's content is visible at a time (tabs/segmented), OR all groups remain in the
DOM with the nav scrolling to them (anchor-nav) — the **pattern is chosen at `/sdd-design`**. Whichever
pattern is chosen, the currently-active group must be visually indicated.

FR-3. **All existing per-section gating is preserved unchanged.** The FR-11 watchlist split (watchlisted
→ Opportunity/Readiness/Fundamentals/Mute vs. non-watchlisted → Screening), the not-found position
notice, and every section's own loading / error / no-data / empty states behave exactly as they do in
feature 125. Grouping is a presentation layer over the existing sections, not a rewrite of their logic.

FR-4. Works on **mobile** (below the Tailwind `sm` 640px breakpoint) alongside the fixed `BottomTabBar`,
with no horizontal page overflow (the existing `mobile-overflow.spec.ts` guard must stay green for
`/trader/positions/[symbol]`). The section-nav control must not visually collide with or duplicate the
`BottomTabBar`.

FR-5. **Deep-linking a group is considered.** An inbound URL should be able to select a group (e.g. via
a hash or query param), and the existing `?strategy=` inbound link (forwarded by the retired
Signal-detail redirect, feature 125 Step 22) must still land correctly — i.e. the readiness/opportunity
`?strategy=` seed keeps working regardless of which group is active by default. Whether a group is
encoded in the URL (and how) is a design decision; the non-regression of `?strategy=` is a requirement.

FR-6. **shadcn-first.** Built from primitive/composite shadcn components (e.g. `Tabs`/`TabsList`/
`TabsTrigger`/`TabsContent`, `ToggleGroup`, or the `ScrollArea`/anchored-nav primitives) — no custom
components. (Hard constraint carried from feature 125.)

FR-7. Data-fetching behavior is not regressed. If the chosen pattern unmounts inactive groups (tabs),
the design must decide whether hooks in an inactive group keep their queries alive or lazily
mount/unmount — and must avoid dropping in-flight mutations (e.g. a running backtest) or thrashing
polling queries. If the chosen pattern keeps all groups mounted (anchor-nav), no change to fetch
behavior is needed. This trade-off is a named `/sdd-design` decision.

## Out of Scope

- Changing what any section shows, or its data source, or its gating logic (feature 125 owns that).
- Any backend, proto, config, or DB change.
- Re-theming or restyling the sections themselves beyond wrapping them in the nav container.
- A user-customizable / reorderable section layout (persisted preferences) — a possible future feature,
  not this one.
- The `/insights` or `/config-ui` pages — this feature is scoped to the `/trader/positions/[symbol]`
  page only.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-ui` — the Symbol page (`src/app/trader/positions/[symbol]/page.tsx`) and any new
  presentational nav component under `src/components/trader/`. UI-only; no other service is touched.

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **UI** — `xstockstrat-ui` segment `/trader`: reorganizes the existing `/trader/positions/[symbol]`
  page's sections behind a same-page nav control. The route is already registered and reachable
  (feature 096/125); this feature changes only how its sections are presented, so no new
  `PLATFORM_SUBNAV` entry is required (C-10 already satisfied by the existing route).
- [ ] **Agent** — none.
- [ ] **None** — n/a (this is a UI presentation change).

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

- [x] No new config keys

## Database Changes

- [x] No schema changes

## Feature Workflow Notes

Branch to create: `feature/symbol-page-section-nav` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (`xstockstrat-ui`) — UI-only change, no proto/config/DB.
- [ ] 2 service owners + platform lead (breaking proto change) — n/a.
- [ ] DBA review + service owner (schema migration) — n/a.

**Merge-order dependency:** this feature reorganizes the exact page feature 125 (`unified-symbol-page`)
builds. It **depends on feature 125 landing first** (PR #958 → `main-dev`) and must be recorded in
`docs/roadmap/features/merge-order.md` after 125. Building it before 125 merges would conflict on
`src/app/trader/positions/[symbol]/page.tsx`.

## Acceptance Criteria

1. On `/trader/positions/[symbol]`, the page's sections are reachable via a same-page nav control
   (the chosen pattern) without scrolling the full page; the active group is visually indicated.
2. The FR-11 watchlist split still selects the correct Research content (watchlisted vs. Screening),
   and every section's loading/error/no-data/not-found state renders exactly as in feature 125 —
   proven by the existing `position-detail.spec.ts` assertions continuing to pass (updated only for
   the new nav interaction, not for changed section behavior).
3. On a 390px-wide mobile viewport, the nav control and all groups render with no horizontal page
   overflow (`mobile-overflow.spec.ts` stays green) and do not collide with the `BottomTabBar`.
4. An inbound `/trader/positions/AAPL?strategy=<id>` still seeds the readiness/opportunity strategy
   correctly regardless of the default active group (no `?strategy=` regression from the retired
   Signal-detail redirect).
5. If deep-linking a group is implemented, navigating to the group's URL/hash selects that group on
   load; if it is deliberately deferred, that deferral points at a named follow-up (C-14 override
   recorded in `context.md`).
6. Built from shadcn primitives/composites only — no custom components (verified the same way
   feature 125's shadcn-first constraint was: composition review + no new bespoke component files).

## Open Questions

- [ ] **Pattern choice** — tabs (`Tabs`, unmounts inactive content) vs. sticky segmented section-nav /
  anchor jump-links (`ToggleGroup` + scroll-to, all content mounted) vs. accordion. Each trades off
  fetch behavior (FR-7), deep-linking (FR-5), and mobile ergonomics (FR-4) differently. **To be
  resolved at `/sdd-design`.**
- [ ] **Held-position body placement** — persistent header above the nav (always visible) vs. its own
  group. Affects how "at a glance" the position P&L stays.
- [ ] **Fetch lifecycle under tabs** — if inactive groups unmount, do their hooks (polling positions,
  the indicator-series RPC, a running-backtest mutation) survive or restart? (FR-7.)
- [ ] **Known trap (Ledger `fails.md` 2026-08-09 `shadcn-migration-high-confidence`)** — shadcn
  primitives with built-in implicit roles/labels (e.g. `BreadcrumbPage`'s `role="link"`; and,
  directly relevant here, `Tabs` emit `role="tab"`/`role="tablist"`/`aria-selected`) collided with
  `getByRole`/`getByLabel` locators in a sibling spec, caught two steps later by full-suite
  verification rather than the wiring step's own run. If tabs are chosen, design the e2e locators
  (and check `nav-reachability.spec.ts` / any `getByRole('tab'|'navigation')`) up front, and run the
  broader suite at the wiring step, not just the targeted test.
