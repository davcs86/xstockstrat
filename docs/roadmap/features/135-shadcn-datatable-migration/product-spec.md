# Product Spec: shadcn-datatable-migration

**Created**: 2026-08-15

---

## Problem Statement

`xstockstrat-ui`'s tabular pages (Orders, Positions, Screener, Strategies, Formulas, Config Audit,
Config Sources, and others discovered during recon) render tabular data either as raw HTML
`<table>` markup or the shadcn `Table` primitive (`src/components/ui/table.tsx` — a thin styled
wrapper with no sort/filter/pagination/column-visibility logic). Users working with larger result
sets (screener results, order history, audit logs) have no way to sort, filter, or paginate
in-browser, and at least one table has already shipped a horizontal-overflow regression on narrow
viewports (see Known Trap below). This feature brings every table onto a single, consistent
`DataTable` composite and closes the responsive gap platform-wide.

## User Story

As a trader/analyst using any `xstockstrat-ui` segment (`/trader`, `/insights`, `/config-ui`), I
want every table to support consistent sorting/filtering/pagination where the data volume warrants
it, and to remain usable (no clipped columns, no broken layout) on narrow/mobile viewports, so that
I can work with tabular data without horizontal scrolling surprises or console-only workarounds.

## Functional Requirements

FR-1. Recon must enumerate **every** table-rendering call site in `services/xstockstrat-ui/src` —
  raw `<table>` elements, the shadcn `Table` primitive (`ui/table.tsx` consumers), and any other
  table library in use — producing an exhaustive migration inventory (file, route/segment, current
  implementation, approximate row/column count). Do not scope to a preset list; the actual list is
  a Phase-0 recon deliverable.

FR-2. Build one shared `DataTable` composite (`@tanstack/react-table` + the existing `Table`
  primitive, column-def-driven) that migrated tables consume, following the shadcn docs' reference
  shape. It must support sorting and pagination as baseline capabilities; column filtering and
  column-visibility toggles are added per-table only where the data justifies it (see FR-3).

FR-3. For each table in the FR-1 inventory, migrate it to the shared `DataTable` UNLESS it is a
  small, static, read-only lookup table (e.g. a namespace's key/value editor row list) where a full
  `DataTable` would be pure overhead — in which case it stays on the plain `Table` primitive and the
  decision + rationale is recorded in `context.md`. Every migrated table gets sort support at
  minimum; add filter/pagination/column-visibility per-table based on realistic row/column counts
  found in recon (a 5-row static table does not need pagination controls).

FR-4. Every table this feature touches (both migrated-to-`DataTable` and explicitly-left-on-`Table`
  per FR-3) must be horizontally responsive on narrow viewports. For each, recon/design must
  evaluate and pick the fitting strategy: (a) a horizontally scrollable container
  (`overflow-x-auto` wrapper) when the column set is wide and all columns are equally important,
  (b) column priority/hiding (drop or truncate lower-priority columns below a breakpoint), or (c) a
  stacked/card layout for narrow content. The choice and rationale per table is recorded in the
  implementation spec.

FR-5. Every table covered by this feature is asserted overflow-free on a narrow/mobile viewport by
  an automated check — reuse/extend the existing `services/xstockstrat-ui/e2e/mobile-overflow.spec.ts`
  sweep (see Known Trap) rather than a new one-off mechanism, unless recon finds it structurally
  cannot cover a given route.

## Out of Scope

- Introducing a *new* third-party table library other than `@tanstack/react-table` (the shadcn docs'
  own dependency) — no MUI/AG-Grid/etc.
- Server-side sorting/filtering/pagination (RPC-level query changes) — this feature is client-side
  presentation only, operating on data already fetched by existing calls.
- Redesigning table content/columns beyond what's needed for the migration and responsiveness fix
  (no new columns, no new data sources).
- Non-tabular list/card UI (e.g. a `<div>`-based row list that was never a `<table>`) — FR-1's
  inventory is scoped to actual table implementations only.

## Affected Services

- `xstockstrat-ui` — all table-rendering pages across the `/trader`, `/insights`, and `/config-ui`
  segments; adds `@tanstack/react-table` as a new frontend dependency.

## Consumer Surface(s)

- [x] **UI** — `xstockstrat-ui` segments: `/trader` (Orders, Positions, Order Book, and any other
  table found in recon), `/insights` (Screener results, Strategies list, Formulas list, and any
  other table found in recon), `/config-ui` (Sources, Audit log, Namespace editor, and any other
  table found in recon) — every migrated table is an in-place visual/interaction upgrade on an
  existing, already-reachable route; no new routes are added, so C-10 nav-reachability is
  unaffected.
- [ ] **Agent** — not applicable.
- [ ] **None** — not applicable.

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

- [x] No new config keys

## Database Changes

- [x] No schema changes

## Feature Workflow Notes

Branch to create: `feature/shadcn-datatable-migration` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking, UI-only change)

## Acceptance Criteria

1. Recon's table inventory (FR-1) is exhaustive and cited with `path:line` evidence for every hit —
   no table implementation left undiscovered.
2. A shared `DataTable` composite exists and is the single implementation every migrated table
   consumes (no per-page duplicate TanStack wiring).
3. Every table in the inventory is either migrated to `DataTable` or explicitly, individually
   justified as staying on the plain `Table` primitive per FR-3.
4. Every table in the inventory has a recorded, applied responsive strategy (FR-4) and passes an
   automated no-horizontal-overflow assertion (FR-5) on a narrow/mobile viewport.
5. Existing table functionality (row actions, links, existing data display) is preserved —
   no regression in what data a table shows or what a row's action buttons do.
6. Full `xstockstrat-ui` Playwright + Vitest suites pass after migration.

## Open Questions

- [ ] Recon should confirm the exact set of "small static lookup" tables that qualify for the FR-3
  exemption before implementation-spec is written — the product spec above names one example
  (`NamespaceEditor`-style key/value rows) but the full list is a recon deliverable, not assumed
  here.

**Known trap** (ledger `fails.md`, 2026-08-06, `083-ui-revamp-opportunities-first`): a prior
feature shipped a "fidelity matches handoff" sign-off via content-only review that missed the
Screener results table overflowing the phone viewport because it was a raw `<table>` instead of the
shared `Table` component (which wraps `overflow-auto`). The fix added
`services/xstockstrat-ui/e2e/mobile-overflow.spec.ts`, a scripted sweep, only after the fact. The
ledger's rule: a UI fidelity/responsiveness claim must be backed by an automated assertion added
**at the same step**, not deferred to a later sweep — this is why FR-5 requires the automated check
to land alongside each table's migration, not as a final catch-all pass.
