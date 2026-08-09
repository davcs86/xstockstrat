# Product Spec: shadcn-table-actions-responsive

**Created**: 2026-08-09

---

## Problem Statement

Two loose ends from the 119–123 shadcn/ui migration series: (1) table "Actions" columns still render
multiple inline `<Button>`s side-by-side instead of the shadcn `DropdownMenu` primitive, which the
migration series never adopted or scoped; (2) the existing phone-viewport horizontal-overflow sweep
(`e2e/mobile-overflow.spec.ts`, added by feature 083 after a raw-`<table>` overflow bug shipped
undetected) does not cover every table-bearing route, so a future wide-table or long-content
regression on those routes would ship the same way that one did.

## User Story

As a user of the trader/insights/config-ui dashboards, I want table row actions grouped into a single,
consistent affordance and every data table to scroll horizontally within its own container rather than
break the page layout, so that dense tables stay usable and tidy on any screen width.

## Functional Requirements

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
- `src/app/accounts/authorized-apps/page.tsx` — Disconnect (behind an `AlertDialog`) — **single-action
  today; re-verify at `/sdd-design` time whether a lone action still warrants a `DropdownMenu` or
  should stay a direct button** (open question, not pre-decided here)
- `src/app/config-ui/sources/page.tsx` — Disable/Enable + Edit
- `src/app/config-ui/[namespace]/NamespaceEditor.tsx` — Edit, or Save + Cancel when a row is in edit
  mode
- `src/app/insights/strategies/page.tsx` — Edit + Deactivate (behind an `AlertDialog`), admin-only
  column

A single-action column should not be force-converted to a `DropdownMenu` merely for consistency — that
tradeoff (and the authorized-apps single-action case above) is a genuine design fork, left to
`/sdd-design` per this repo's Constitution "don't assume — ask, and surface tradeoffs."

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

## Out of Scope

- Any table `<table>` not already routed through `src/components/ui/table.tsx` (none exist — feature
  121 closed the last two raw-`<table>` holdouts; verified via a repo-wide `<table\b` grep outside that
  primitive file, zero matches).
- Sorting, filtering, pagination, or column-visibility toggles for any table — this feature only
  touches the Actions-column affordance and horizontal-scroll correctness.
- Any table on `/insights/watchlists`, `/insights/opportunities`, `/insights/backfills`,
  `/insights/screener`, `/trader/portfolio`, or `/trader/positions` beyond confirming they remain green
  under FR-3/FR-4 — those routes are already in the existing sweep and are not known to need an
  Actions-column change (no multi-button Actions column was found on them during story-writing).
- Non-table row-action UI (e.g. card-based lists, the opportunities queue) — FR-2 is scoped to
  `ui/table.tsx`-based Actions columns only.

## Affected Services

- `xstockstrat-ui` — all changes are frontend-only (new UI primitive, table/actions-column markup,
  e2e coverage)

## Consumer Surface(s)

- [x] **UI** — `xstockstrat-ui` segments `/trader`, `/insights`, `/config-ui`, `/accounts`: the
  `DropdownMenu`-based Actions columns (FR-2) and the horizontal-scroll audit (FR-3/FR-4) are visible
  directly on the affected pages' existing tables — no new route.
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
   the install (per the documented reconciliation step) is reconciled — mechanical regression guards
   (`button.test.ts`/`badge.test.ts`-style) still pass unchanged.
2. Every multi-action Actions column listed in FR-2 renders a single `DropdownMenu` trigger; each
   original action (including destructive `AlertDialog` confirms) is preserved and reachable through a
   `DropdownMenuItem`. Existing e2e coverage exercising these actions (`OrdersTable`, config sources,
   strategies list, authorized-apps, namespace editor) continues to pass — updated only for
   selector/interaction changes the `DropdownMenu` swap requires, never for behavior changes.
3. `e2e/mobile-overflow.spec.ts`'s `ROUTES` list includes every table-bearing route (FR-3's confirmed
   gap list at minimum) and the full spec passes (no horizontal overflow >1px at the 390px fixture).
4. FR-4's audit is recorded (which tables were checked, under what wide-content scenario, and whether
   any fix was needed) in the feature's `context.md`; any table found to overflow is fixed and covered
   by a new or extended assertion, not just noted.
5. `pnpm lint` and `NEXT_DISABLE_STANDALONE=1 pnpm build` stay clean throughout.

## Open Questions

- [ ] Should the single-action `authorized-apps` Disconnect button convert to a `DropdownMenu` for
  visual consistency with the other Actions columns, or stay a direct button since a menu adds a click
  for no grouping benefit when there is only one action? Left to `/sdd-design`.
- [ ] FR-4's audit needs a concrete "wide content" scenario per table (e.g. what mock/fixture data
  proves the overflow-x-auto wrapper actually engages) — `/sdd-design`'s recon phase should ground this
  against each table's real column set rather than inventing a synthetic worst case.
- **Known trap** (`docs/roadmap/ledger/insights.md`, 2026-08-08, feature 083): a "matches the handoff"
  visual sign-off based on content/screenshot comparison alone can miss this exact failure mode (raw
  overflow undetected until a scripted `scrollWidth <= clientWidth` sweep ran) — FR-3/FR-4's automated
  sweep is the actual gate; do not let `/sdd-execute` substitute an eyeballed check for it.
