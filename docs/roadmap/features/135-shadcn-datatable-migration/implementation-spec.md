# Implementation Spec: shadcn-datatable-migration

**Status**: `in-progress`
**Created**: 2026-08-15
**Feature**: `docs/roadmap/features/135-shadcn-datatable-migration/feature.md`
**Total Steps**: 33
**Feature Branch**: `feature/shadcn-datatable-migration`

---

## Execution Summary

Build one shared `@tanstack/react-table`-backed `DataTable` composite
(`services/xstockstrat-ui/src/components/ui/data-table.tsx`) that wraps the existing pure-styling
`Table` primitives, ships sorting + the `isInteractiveTarget`-guarded `onRowClick` mechanism from the
start (Steps 1–2), then migrates all 15 inventoried table sites in the order recon recommended:
`/config-ui` (rows 12–14, Steps 3–8) → `/insights` (rows 8–11, Steps 9–16) → `/accounts` (row 15,
Steps 17–18) → `/trader` (rows 1, 4–7, Steps 19–28) → the isolated high-risk 19-column Exposure table
(row 2, Steps 29–30) → the design-excepted 3-column fill-lineage Sheet table (row 3, Steps 31–32,
which needs bespoke Sheet-interaction overflow test code the generic `mobile-overflow.spec.ts` sweep
cannot reach). Step 33 is the closing full-suite regression sweep (AC-6). Every `service` step is
paired with an immediately-following `test` step per **C-08**; every migrated route's FR-5 overflow
assertion is verified via the already-existing `mobile-overflow.spec.ts` `ROUTES` entry for that route
(confirmed: 14 of 15 routes already have an entry — only the bare `/trader` dashboard route, added in
Step 25, is a genuine `ROUTES` gap). No proto, migration, or config-key steps — this is a client-side
presentation-only feature (product-spec Out of Scope) affecting only `xstockstrat-ui`.

**Trading-domain step constraints (`reference/step-constraints.md` §A) do not apply**: no step adds or
changes `PlaceOrder`/order-type dispatch/fill-processing logic. Steps touching `OrdersTable.tsx`,
`OrderBook.tsx`, and the `/trader/positions/[symbol]` orders sub-table reuse the existing
`OrderSideCell`/`OrderStatusCell`/`OrderSymbolCell`/`OrderSideBadge`/`OrderStatusBadge` renderers
verbatim as `DataTable` cell functions — order/fill/broker-type logic is unchanged, only the table
chrome around it.

## Step Dependencies

- Steps 3–32 (every table migration) require Steps 1–2: the `DataTable` composite (with `onRowClick` +
  `isInteractiveTarget` guarding both `click` and `keydown`, per design.md) must exist and be unit-tested
  before any table consumes it.
- Step 23 (OrdersTable.tsx) requires wrapping `merged = orders.map(...)` in `useMemo` before it becomes
  the composite's `data` prop (design.md, citing ledger `fails.md` 2026-08-08 TanStack identity bug) —
  the composite itself has no special-casing for this; it is a per-call-site requirement documented in
  the composite's own doc comment (Step 1) and applied at Step 23.
- Step 25 adds the bare `/trader` route to `mobile-overflow.spec.ts` `ROUTES`; Step 28 (OrderBook.tsx,
  which also renders at bare `/trader`) reuses that same `ROUTES` entry rather than adding a second one.
- Step 29 (row 2, Exposure table) keeps its existing server-side keyset Prev/Next pagination
  (`positions/page.tsx:425-449`) outside the composite untouched; the composite's own `enablePagination`
  is `false` for this table (sort-only) to avoid two unsynchronized pagination controls on one dataset.
- Step 31 (row 3) is a **design-level exception**, not a literal FR-3 exemption: it migrates to the
  composite (sort baseline only, no pagination/filter/column-visibility) with a stacked-layout
  responsive strategy given its nested-`Sheet` context, recorded as its own disposition distinct from
  "migrated (standard)".
- Step 33 (full regression sweep, AC-6) requires all of Steps 1–32 complete.

---

### Step 1 — service: build the shared `DataTable` composite

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/ui/data-table.tsx` — create
- `services/xstockstrat-ui/package.json` — modify (add `@tanstack/react-table` dependency)

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness, analytics display accuracy,
config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values
rendered in UI, no direct DB access (except audit log)

**Codebase Evidence**:
- Confirmed via `Read services/xstockstrat-ui/package.json`: `@tanstack/react-query` (`^5.62.0`) and
  `@tanstack/react-virtual` (`^3.10.0`) are present; `@tanstack/react-table` is absent
  (repo-wide grep in recon.md confirmed zero hits outside this feature's own docs).
- Reuse target: `services/xstockstrat-ui/src/components/ui/table.tsx:1-89` — the pure-styling
  `Table`/`TableHeader`/`TableBody`/`TableRow`/`TableHead`/`TableCell` primitives. `Table` (`:7-17`)
  already self-wraps in `<div data-slot="table-container" className="relative w-full overflow-x-auto">`
  — the composite must render through these primitives unchanged, not re-style.
- `components.json:13-19` — `"aliases": { "ui": "@/components/ui", ... }`, style `radix-rhea`; the new
  file lands under the existing `ui` alias with no config changes, consistent with how every other
  primitive in `src/components/ui/` is imported (e.g. `@/components/ui/table`, confirmed in
  `src/app/config-ui/sources/page.tsx:19-25`, `src/app/trader/positions/page.tsx:35-42`).
- Pattern reference for a Radix-adjacent, duck-typed-parameter unit test:
  `services/xstockstrat-ui/src/components/ui/button.test.ts:1-16` — plain `describe`/`it` over a
  pure exported function, no jsdom.
- `services/xstockstrat-ui/vitest.config.ts:8-19` — `environment: 'node'`, `include: ['src/**/*.test.ts']`,
  `resolve.alias: { '@': './src' }` — confirms a node-environment `data-table.test.ts` beside the
  composite will be picked up with no new test dependency.

**TDD**: `red-green required`

**Instructions**:
1. Add the dependency: `cd services/xstockstrat-ui && pnpm add @tanstack/react-table@^8` (resolves the
   current 8.x line, matching the caret-range convention already used for every other dependency in
   `package.json`, e.g. `"@tanstack/react-query": "^5.62.0"`).
2. Create `services/xstockstrat-ui/src/components/ui/data-table.tsx` (`'use client'`) exporting:
   - `isInteractiveTarget(target: { closest(selectors: string): Element | null }): boolean` — returns
     `!!target.closest('a, button, [role="button"], [data-row-click-ignore]')`. Typed as the minimal
     duck-typed interface (not the full DOM `Element`/`EventTarget`), per design.md's "Row-click
     interaction safety" section, so it is independently unit-testable under the node-environment
     Vitest config with no `jsdom`.
   - `DataTable<TData, TValue>({ columns, data, onRowClick, enablePagination, pageSize, emptyMessage,
     getRowId, rowClassName }: DataTableProps<TData, TValue>)` — a generic component using
     `useReactTable` (`getCoreRowModel`, `getSortedRowModel`, and conditionally
     `getPaginationRowModel`/`initialState.pagination.pageSize` only when `enablePagination` is true),
     local `sorting` state (`useState<SortingState>`), rendering through the `Table`/`TableHeader`/
     `TableBody`/`TableRow`/`TableHead`/`TableCell` primitives from `./table` via `flexRender`.
   - Column defs carry a `meta: { className?: string }` (TanStack `ColumnMeta` augmentation) forwarded
     into `TableHead`/`TableCell`'s existing `className` prop (`cn(className, ...)`-driven per
     `table.tsx:60-67,69-77`) — this is how a per-table responsive breakpoint class (e.g.
     `"hidden md:table-cell"`) carries through unchanged; no new JS breakpoint hook.
   - Sortable headers render a clickable header (via `header.column.getToggleSortingHandler()`) with a
     sort-direction indicator only for columns where `header.column.getCanSort()` is true; a column
     opts out of sorting via `enableSorting: false` in its `ColumnDef` (used by every plain Actions
     column across the 15 migration steps).
   - When `onRowClick` is provided: the row gets `role="button"`, `tabIndex={0}`, an `onClick` handler
     that calls `isInteractiveTarget(e.target as unknown as { closest(s: string): Element | null })`
     and only invokes `onRowClick(row.original)` when it returns `false`, **and** an identically-guarded
     `onKeyDown` handler for `Enter`/`Space` (`e.preventDefault()` before calling `onRowClick`) — per
     design.md, a click-only guard still double-fires on keyboard activation of a nested `<button>`
     because a `keydown` on the button bubbles to the row before the button's own synthesized click.
   - Zero-row state renders `emptyMessage` (default `'No results.'`) in a single full-width `TableCell`
     (`colSpan={columns.length}`).
   - When `enablePagination` is true, render Previous/Next `Button`s (`variant="outline"`, `size="sm"`)
     driven by `table.previousPage()`/`table.nextPage()`, disabled via
     `!table.getCanPreviousPage()`/`!table.getCanNextPage()`.
   - Add a doc comment on the exported `DataTable` component stating the memoization requirement:
     "`data` must be a referentially-stable array (wrap in `useMemo` if computed inline every render) —
     TanStack Table's internal row-model state can reset unexpectedly on an unstable data reference
     (see ledger `fails.md` 2026-08-08)." This applies to all 15 future call sites, enforced concretely
     at Step 23 (`OrdersTable.tsx`'s `merged = orders.map(...)`).

**Verification**:
```
cd services/xstockstrat-ui && pnpm run lint
grep -n "@tanstack/react-table" package.json
grep -n "export function isInteractiveTarget\|export function DataTable" src/components/ui/data-table.tsx
```

---

### Step 2 — test: unit-test the `DataTable` composite's `isInteractiveTarget` guard

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/ui/data-table.test.ts` — create

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness, analytics display accuracy,
config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values
rendered in UI, no direct DB access (except audit log)

**Codebase Evidence**:
- Pattern: `services/xstockstrat-ui/src/components/ui/button.test.ts:1-16` — `describe`/`it` over a
  pure exported function using plain object literals, no component mount.
- `services/xstockstrat-ui/vitest.config.ts:24-33` — coverage is scoped to `src/lib/**` with
  `all: false`; a new `src/components/ui/data-table.test.ts` file is picked up by `include:
  ['src/**/*.test.ts']` (`:20`) for test execution but does not affect (or count toward) the `src/lib`
  coverage threshold — run it for correctness, not for coverage-gate purposes.

**TDD**: `red-green required`

**Instructions**:
Write `describe('isInteractiveTarget', ...)` asserting all four branches from design.md, using plain
object literals implementing the duck-typed `{ closest(selectors: string): Element | null }` interface
(no `jsdom`):
1. a target whose `.closest(...)` call (given the exact selector string the guard passes) returns a
   truthy stub `<a>`-shaped object → `true`.
2. same, returning a truthy stub `<button>`-shaped object → `true`.
3. same, returning a truthy stub `[role="button"]`-shaped object → `true`.
4. same, returning a truthy stub `[data-row-click-ignore]`-shaped object → `true`.
5. a target whose `.closest(...)` returns `null` for every call → `false`.
Each case should construct `{ closest: (selectors: string) => selectors.includes('<token>') ? ({} as
Element) : null }` (or equivalent) so the test proves the guard passes the right selector string, not
just that it returns whatever the stub always returns.

**Verification**:
```
cd services/xstockstrat-ui && pnpm run test:unit -- data-table.test.ts
```
Confirm 5/5 assertions pass (red before Step 1's `isInteractiveTarget` exists — the test must be
written to fail with "Cannot find module" / `isInteractiveTarget is not a function` against the
pre-Step-1 tree, then pass after).

---

### Step 3 — service: migrate `/config-ui/sources` (row 12) to `DataTable`

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/config-ui/sources/page.tsx` — modify

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness, analytics display accuracy,
config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values
rendered in UI, no direct DB access (except audit log)

**Codebase Evidence**:
- Confirmed via `Read`: `Table` at `sources/page.tsx:299`, 8 columns (Slug, Display Name, Source Type,
  Active, Health, Fed, Weight, Actions), dynamic/unbounded row count, Edit/Disable/Enable via
  `DropdownMenu` at `:345-364` (feature 124's established Actions-cell pattern — reuse verbatim as the
  composite's Actions column `cell`, `enableSorting: false`).
- Imports already alias-based: `import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell
  } from '@/components/ui/table';` (`:18-25`), `DropdownMenu*` from `@/components/ui/dropdown-menu`
  (`:12-17`) — the migration only swaps the `<Table>...</Table>` JSX block for `<DataTable columns={...}
  data={sources} />`; no import-path changes needed for the row-action primitives.
- FR-3 verdict (recon.md row 12): FAIL (cols, rows, not read-only) — this table is a mandatory
  `DataTable` migration, no exemption.
- Existing `sources.length === 0` empty-state row (`:314-320`) maps to the composite's built-in
  `emptyMessage` prop ("No sources registered yet.").

**TDD**: `red-green required`

**Instructions**:
1. Define a `ColumnDef<SignalSource>[]` array (module scope or `useMemo`'d if it captures
   component-scoped closures like `handleToggle`/`openEdit`/`saving`/`weights`) covering the 8 existing
   columns 1:1 — `Slug` (`accessorKey: 'slug'`), `Display Name`, `Source Type` (custom `cell` rendering
   the existing mediated-type `Badge`), `Active` (custom `cell` rendering the existing status `Badge`),
   `Health` (custom `cell` rendering `<EnumBadge render={SOURCE_HEALTH[src.health]} />`, `title={
   src.lastError}`), `Fed`, `Weight`, and an `id: 'actions'` column (`enableSorting: false`) whose
   `cell` renders the existing `DropdownMenu` block (`:346-364`) unchanged, receiving `row.original` as
   `src`.
2. Replace the `<Table>...</Table>` JSX (`:299-369`) with `<DataTable columns={columns} data={sources}
   emptyMessage="No sources registered yet." />`. Sorting is the only baseline capability enabled
   (`enablePagination` omitted/false — unbounded-but-typically-small operator-configured list, no
   existing pagination to preserve or conflict with).
3. Responsive strategy (FR-4): keep the existing horizontal-scroll fallback (`Table`'s own
   `overflow-x-auto` wrapper, unchanged) — 8 columns of short operator-facing values do not warrant
   column-hiding or a stacked layout. Record disposition: **migrated to `DataTable`; responsive
   strategy (a) horizontal-scroll container (existing `Table` wrapper, unchanged)**.

**Verification**:
```
cd services/xstockstrat-ui && pnpm run lint
grep -n "DataTable" src/app/config-ui/sources/page.tsx
grep -n "@tanstack/react-table" src/app/config-ui/sources/page.tsx  # expect NO direct import — only via DataTable
```

---

### Step 4 — test: verify `/config-ui/sources` migration preserves behavior

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/config-ui/sources.spec.ts` — modify (only if an assertion targets
  removed/renamed markup; otherwise no change needed — see Instructions)

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness, analytics display accuracy,
config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values
rendered in UI, no direct DB access (except admin log)

**Codebase Evidence**:
- Existing coverage: `services/xstockstrat-ui/e2e/config-ui/sources.spec.ts` exercises this page today
  against the mock backend (`e2e/mock-backend.ts`'s signal-source handlers) — confirmed present via
  `find e2e -name "*.spec.ts"`.
- `services/xstockstrat-ui/e2e/mobile-overflow.spec.ts:20` already lists `{ path: '/config-ui/sources'
  }` in `ROUTES` — **no `ROUTES` change needed**; the existing 390px assertion now exercises the
  migrated `DataTable` markup directly.
- C-12: no new fixtures needed — `sources.spec.ts` already sources signal-source domain data from
  `e2e/mock-backend.ts`'s `listSignalSources`/`manageSignalSource` handlers (per
  `e2e/fixtures/INVENTORY.md` "Not yet centralized" table, "Signal sources" row).

**TDD**: `red-green required`

**Instructions**:
1. Run `sources.spec.ts` against the pre-Step-3 tree to record the current pass baseline (there should
   be no pre-existing failures to compare against — this is a **behavior-preservation** paired test,
   not a new-feature test; "red" here means running it against the Step-3 code before the fix to any
   locator break the migration introduces, then confirming the same assertions pass unchanged after).
2. Re-run `sources.spec.ts` after Step 3. If any assertion locates markup by DOM structure that
   `DataTable` legitimately changes (e.g. a `<table>` wrapper depth), update the locator to match the
   new structure — do **not** change the assertion's expected *content* (AC-5: pre-migration
   user-visible fields/actions must be unchanged).
3. Add the lint step per `reference/step-constraints.md` §B.

**Verification**:
```
cd services/xstockstrat-ui && pnpm run lint
cd services/xstockstrat-ui && pnpm exec playwright test e2e/config-ui/sources.spec.ts --project=chromium --no-deps
cd services/xstockstrat-ui && pnpm exec playwright test e2e/mobile-overflow.spec.ts --project=chromium --no-deps -g "config-ui/sources"
```

---

### Step 5 — service: migrate `/config-ui/[namespace]` `NamespaceEditor` (row 13) to `DataTable`

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/config-ui/[namespace]/NamespaceEditor.tsx` — modify

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness, analytics display accuracy,
config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values
rendered in UI, no direct DB access (except audit log)

**Codebase Evidence**:
- Confirmed via `Read`: `Table` at `NamespaceEditor.tsx:166`, 4 columns (Key, Value, Description,
  Actions), per-namespace row count, inline Edit/Save via `DropdownMenu` (`:221-239` shown, continues)
  — design.md flags this as a distinct **"stateful/conditional cell content"** pattern (both the Value
  cell `:179-213` and the Actions cell `:218+` swap their rendered content based on shared local
  `editingKey`/`editValue`/`editReason` state), not a plain DropdownMenu-cell instance.
- FR-3 verdict (recon.md row 13): FAIL (rows, not read-only) — mandatory migration, no exemption.
- Column widths are currently fixed inline (`w-[220px]`, `w-[200px]`, `w-[120px]` at `:169-172`) —
  carry these into each `ColumnDef`'s `meta.className` (TableHead) so the visual layout is unchanged.

**TDD**: `red-green required`

**Instructions**:
1. Define `columns: ColumnDef<ConfigKeyRow>[]` for Key (`meta: { className: 'w-[220px]' }`), Value
   (`meta: { className: 'w-[200px]' }`, `enableSorting: false` — its `cell` must read `editingKey`/
   `editValue`/`editReason`/`setEditValue`/`setEditReason`/`validationError` from the enclosing
   component's state via closure, since the value cell's rendered content is conditional on which row
   is being edited, not a pure function of the row's own data), Description (`meta: { className:
   'hidden md:table-cell' }`), and Actions (`id: 'actions'`, `meta: { className: 'w-[120px]' }`,
   `enableSorting: false`, `cell` reading the same `editingKey` closure state to decide whether to show
   the `DropdownMenu` or the Save/Cancel affordance the current conditional edit-mode UI shows).
2. Because both the Value and Actions cells depend on component-level `editingKey` state (not just
   `row.original`), define `columns` via `useMemo` with `editingKey`/`editValue`/`editReason`/
   `validationError`/`saving` (and their setters) in the dependency array, so the column defs
   re-render when edit state changes — a plain module-scope array cannot close over this state.
3. Replace the `<Table>...</Table>` JSX (`:166-` through its closing tag) with `<DataTable
   columns={columns} data={keys} />`. Sorting only (no pagination — per-namespace key count is small
   and operator-curated).
4. Responsive strategy (FR-4): keep the existing horizontal-scroll fallback; the `Description` column
   already hides below `md:` (`:171`) — carry that `meta.className` through unchanged. Record
   disposition: **migrated to `DataTable`; responsive strategy (b) column priority (existing `hidden
   md:table-cell` on Description, carried through via `meta.className`)**.

**Verification**:
```
cd services/xstockstrat-ui && pnpm run lint
grep -n "DataTable" src/app/config-ui/\[namespace\]/NamespaceEditor.tsx
```

---

### Step 6 — test: verify `NamespaceEditor` migration preserves the SetConfig edit flow

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/config-ui/value-persists-after-save.spec.ts` — modify (if locators break)

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness, analytics display accuracy,
config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values
rendered in UI, no direct DB access (except audit log)

**Codebase Evidence**:
- Confirmed via grep: `value-persists-after-save.spec.ts` waits on
  `r.url().includes('/SetConfig') && r.status() === 200` (`:43,73,95`) and exercises
  `NamespaceEditor.handleSave`'s reason-required gate (`:39`) — this is the paired regression test for
  the stateful edit-cell pattern Step 5 restructures into `DataTable` column defs.
- `env-gate.spec.ts` and `reason-capture.spec.ts` also exercise this page (per earlier `grep -rln` over
  `e2e/config-ui/*.spec.ts`) — run the full `config-ui/` directory, not just one file, since Step 5
  touches shared edit-state wiring all three specs may assert against.
- `mobile-overflow.spec.ts:32` already lists `{ path: '/config-ui/platform' }` — **no `ROUTES` change
  needed** (a `platform` namespace routes to this same `[namespace]/page.tsx` → `NamespaceEditor`).

**TDD**: `red-green required`

**Instructions**:
1. Re-run `value-persists-after-save.spec.ts`, `env-gate.spec.ts`, and `reason-capture.spec.ts` after
   Step 5. Fix any locator broken by the `DataTable` DOM restructuring; do not change asserted
   SetConfig payload content or the reason-required gate's behavior (AC-5).
2. Confirm the edit-in-place UX (click Actions → Edit → inline `Input`s appear in the Value cell →
   Save calls `SetConfig`) still works identically — this is the one migrated table where the
   composite's column-def `cell` closes over component state rather than being a pure function of
   `row.original`; explicitly assert the Save flow still round-trips through the same DropdownMenu
   Actions cell.

**Verification**:
```
cd services/xstockstrat-ui && pnpm run lint
cd services/xstockstrat-ui && pnpm exec playwright test e2e/config-ui/value-persists-after-save.spec.ts e2e/config-ui/env-gate.spec.ts e2e/config-ui/reason-capture.spec.ts --project=chromium --no-deps
cd services/xstockstrat-ui && pnpm exec playwright test e2e/mobile-overflow.spec.ts --project=chromium --no-deps -g "config-ui/platform"
```

---

### Step 7 — service: migrate `/config-ui/audit` (row 14) to `DataTable`

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/config-ui/audit/page.tsx` — modify

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness, analytics display accuracy,
config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values
rendered in UI, no direct DB access (except audit log)

**Codebase Evidence**:
- Confirmed via `Read`: `Table` at `audit/page.tsx:32`, 7 columns (When, Namespace/Key, Old Value, New
  Value, By, Env/Mode, Reason), server `LIMIT 50` (per recon.md), read-only — no actions column, no
  `DropdownMenu` import.
- FR-3 verdict (recon.md row 14): FAIL (cols, rows) — 7 columns exceeds the ≤4 threshold; mandatory
  migration despite being read-only.
- This is the **DB-backed** route (`src/app/config-ui/api/audit/route.ts`, per `CLAUDE.md` § Database)
  — Step 7 touches only the presentation component (`audit/page.tsx`), not the API route or the `pg.Pool`.

**TDD**: `red-green required`

**Instructions**:
1. Define `columns: ColumnDef<AuditEntry>[]` for the 7 existing columns 1:1, carrying forward the
   existing `meta.className` breakpoint set unchanged: When (`w-[120px]`), Namespace/Key, Old Value
   (`hidden sm:table-cell w-[120px]`), New Value (`w-[120px]`), By (`hidden md:table-cell w-[100px]`),
   Env/Mode (`hidden lg:table-cell w-[120px]`, custom `cell` rendering both `Badge`s), Reason (`hidden
   xl:table-cell`). All columns sortable except none needs `enableSorting: false` (no Actions column on
   this read-only table).
2. Replace the `<Table>...</Table>` JSX (`:32-88`) with `<DataTable columns={columns} data={entries}
   emptyMessage="No audit entries yet" />`. Sorting only (no pagination — the API already caps at 50
   rows server-side; no client filter/column-visibility — this is a low-interaction read-only log).
3. Responsive strategy (FR-4): keep the existing column-priority hiding (`hidden sm:/md:/lg:/xl:` on 4
   of 7 columns already establishes graceful narrowing) — carry through via `meta.className`, unchanged.
   Record disposition: **migrated to `DataTable`; responsive strategy (b) column priority (existing
   4-tier `hidden` breakpoint set, carried through via `meta.className`)**.

**Verification**:
```
cd services/xstockstrat-ui && pnpm run lint
grep -n "DataTable" src/app/config-ui/audit/page.tsx
```

---

### Step 8 — test: add coverage for `/config-ui/audit` table content and sorting

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/config-ui/audit.spec.ts` — create

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness, analytics display accuracy,
config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values
rendered in UI, no direct DB access (except audit log)

**Codebase Evidence**:
- Confirmed via grep across `e2e/`: the only existing coverage touching `/config-ui/audit` is
  `mobile-overflow.spec.ts:31` (390px overflow only), `nav-reachability.spec.ts` (nav-link reachability
  only), and `breadcrumb.spec.ts` (breadcrumb only) — **no spec asserts the audit table's row content**
  today. This is a genuine coverage gap Step 5's sort-baseline addition needs a paired test for
  (C-08), not an existing spec to extend.
- `useAuditLog` hook: `src/app/config-ui/hooks/useAuditLog.ts` (imported at `audit/page.tsx:15`) — the
  new spec must stub its backing route (`GET /config-ui/api/audit`, per `CLAUDE.md` § Database) via
  `page.route()`, following the same `page.route()` interception pattern used by sibling config-ui
  specs (e.g. `value-persists-after-save.spec.ts`'s `page.route()`/response-waiting pattern).
- C-12: no existing fixture module for audit-log rows (confirmed absent from `INVENTORY.md`'s
  "Canonical fixtures" table) — this spec is the **first** consumer, so an inline literal in the new
  spec file is compliant per C-12's "stays inline until a second consumer appears" rule; do not create
  a fixture module speculatively.

**TDD**: `red-green required`

**Instructions**:
1. Create `e2e/config-ui/audit.spec.ts`: authenticate via `addAuthCookie` (`e2e/helpers/auth.ts`), stub
   the audit route with 2–3 inline rows covering distinct namespace/key/old/new/by/env/reason values,
   `page.goto('/config-ui/audit')`, and assert: (a) all 7 header labels render, (b) each row's
   namespace/key/old-value/new-value/by/env/mode/reason text is visible (AC-5 field-parity check
   against the pre-migration set enumerated in Step 7's Codebase Evidence), (c) clicking a sortable
   header (e.g. "When") re-orders the rendered rows (baseline sort capability from Step 1/7).
2. Write this test to fail first against the pre-Step-7 tree (the sort-header click assertion has no
   pre-migration equivalent to satisfy — the plain `Table` has no sort affordance) — this is the
   red-before-green proof for the new sort capability.

**Verification**:
```
cd services/xstockstrat-ui && pnpm run lint
cd services/xstockstrat-ui && pnpm exec playwright test e2e/config-ui/audit.spec.ts --project=chromium --no-deps
```

---

### Step 9 — service: migrate `/insights/screener` results table (row 8) to `DataTable`

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/insights/screener/page.tsx` — modify

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness, analytics display accuracy,
config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values
rendered in UI, no direct DB access (except audit log)

**Codebase Evidence**:
- Confirmed via `Read`: `Table className="min-w-[640px]" data-testid="screen-results"` at
  `screener/page.tsx:543`, 10 columns (Rank, Symbol, Score, P/E, RSI, ATR, Rev growth, Held, Passed,
  Status), unbounded row count, no row actions. This is the exact table the ledger's `fails.md`
  2026-08-06 known-trap regression originally shipped on (product-spec's "Known trap") — the existing
  `min-w-[640px]` + `Table`'s own `overflow-x-auto` wrapper is the fix already in place; the migration
  must not regress it.
- `data-testid="screen-results"` and `data-testid="result-row"` (`:566`) are read by
  `e2e/insights/screener.spec.ts` — these testids must be preserved on the migrated markup (AC-5).
- FR-3 verdict (recon.md row 8): FAIL (cols, rows) — mandatory migration.

**TDD**: `red-green required`

**Instructions**:
1. Define `columns: ColumnDef<ScreenResult>[]` for the 10 columns, preserving: the `Rank` column's
   `i + 1` index-based value (use TanStack's row index via `cell: ({ row }) => row.index + 1`, not a
   data field), the `Score` cell's colored-dot + `scoreColor(r.score)` rendering (`:569-580`), the
   `ATR` header's `title="ATR is a close-only approximation (not exact)"` tooltip (`:552-557`), the
   `Held` `Badge`, `Passed` ✓/— glyph, and the `Status` cell's conditional `ScreenResultStatus.
   INSUFFICIENT_DATA` branch (`:598+`, continues past the read window — re-read the full cell before
   porting it verbatim).
2. Preserve `data-testid="screen-results"` on the `DataTable`'s root/`Table` element and
   `data-testid="result-row"` on each `TableRow` (pass through a `rowClassName`/row-props mechanism, or
   extend `DataTableProps` with an optional `getRowProps?: (row: TData) => React.HTMLAttributes<HTMLTableRowElement>`
   if the composite doesn't already support per-row `data-testid` — confirm against Step 1's actual
   shipped API and note any composite extension needed here in the Deviation Log).
3. Replace the `<Table className="min-w-[640px]" data-testid="screen-results">...</Table>` block
   (`:543-` through its close) with `<DataTable columns={columns} data={results}
   tableClassName="min-w-[640px]" />` (or equivalent prop carrying the existing `min-w-[640px]`
   forward — the composite must expose a way to set this on the underlying `<table>`).
   Sorting only (no pagination — this is a one-shot scan result set the user reviews in full, not a
   paged browse).
4. Responsive strategy (FR-4): keep the existing (a) horizontal-scroll container (`min-w-[640px]` +
   `Table`'s `overflow-x-auto`) — this is the exact mechanism the known-trap regression fix relies on;
   do not replace it with column-hiding. Record disposition: **migrated to `DataTable`; responsive
   strategy (a) horizontal-scroll container (existing `min-w-[640px]`, carried through)**.

**Verification**:
```
cd services/xstockstrat-ui && pnpm run lint
grep -n "DataTable" src/app/insights/screener/page.tsx
grep -n 'data-testid="screen-results"\|data-testid="result-row"' src/app/insights/screener/page.tsx
```

---

### Step 10 — test: verify `/insights/screener` migration preserves the known-trap fix + behavior

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/insights/screener.spec.ts` — modify (if locators break)

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness, analytics display accuracy,
config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values
rendered in UI, no direct DB access (except audit log)

**Codebase Evidence**:
- `services/xstockstrat-ui/e2e/insights/screener.spec.ts` — existing suite (feature 118 background
  data-readiness polling) using `e2e/fixtures/screenResults.ts` (`fundamentalsPendingRow`,
  `barsInsufficientRow`, `resolvedRow` per `INVENTORY.md`) — reuse these fixtures unchanged (C-12).
- `mobile-overflow.spec.ts:16` already lists `{ path: '/insights/screener' }` — **no `ROUTES` change
  needed**; this is the literal regression-guard route for the product-spec's Known Trap, so its
  continued pass is the direct proof this migration does not reintroduce the 2026-08-06 overflow bug.

**TDD**: `red-green required`

**Instructions**:
1. Re-run `screener.spec.ts` after Step 9. Fix any locator broken by the `DataTable` restructuring;
   preserve all `data-testid="screen-results"`/`"result-row"` assertions and the polling-status text
   assertions unchanged (AC-5).
2. Explicitly re-run `mobile-overflow.spec.ts -g "insights/screener"` and confirm `overflow <= 1` at
   390px — this is the direct regression-guard proof for the product-spec's Known Trap.

**Verification**:
```
cd services/xstockstrat-ui && pnpm run lint
cd services/xstockstrat-ui && pnpm exec playwright test e2e/insights/screener.spec.ts --project=chromium --no-deps
cd services/xstockstrat-ui && pnpm exec playwright test e2e/mobile-overflow.spec.ts --project=chromium --no-deps -g "insights/screener"
```

---

### Step 11 — service: migrate `/insights/strategies` list table (row 9) to `DataTable`

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/insights/strategies/page.tsx` — modify

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness, analytics display accuracy,
config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values
rendered in UI, no direct DB access (except audit log)

**Codebase Evidence**:
- Confirmed via `Read`: `Table` at `strategies/page.tsx:124`, 9 columns (Strategy, State, Signals 30d,
  Taken, Hit rate, Expectancy, Max DD, Score, Actions), unbounded row count, Edit/Deactivate via
  `DropdownMenu`+`AlertDialog` (feature 124 pattern). Each row is its own `StrategyRow` component
  (`:161-` — a `<TableRow>` rendered per-strategy that itself calls `useStrategyAnalytics(d.strategyId)`,
  a **per-row hook call**), not inline JSX in the `.map()`.
- FR-3 verdict (recon.md row 9): FAIL (cols, rows) — mandatory migration.
- Because `StrategyRow` calls a hook per row, the `DataTable`'s column `cell` renderers must delegate to
  small per-cell components that each read `row.original` and call `useStrategyAnalytics` themselves
  (React hooks are legal inside any component, including one rendered from a `cell` callback) — do
  **not** try to hoist `useStrategyAnalytics` above the row loop; that changes which strategy's
  analytics each render fetches.

**TDD**: `red-green required`

**Instructions**:
1. Define `columns: ColumnDef<StrategyDefinition>[]` for the 9 columns. Because `Signals 30d`/`Taken`/
   `Hit rate`/`Expectancy`/`Max DD`/`Score` all depend on `useStrategyAnalytics(d.strategyId)`
   (currently called once in `StrategyRow` and read by 6 cells), either (a) keep a small
   `StrategyAnalyticsCells` wrapper component that calls the hook once and renders all 6 cells' worth of
   `<td>`s via a `colSpan`-free multi-`cell` pattern is not expressible in a single `ColumnDef` — instead,
   call `useStrategyAnalytics(d.strategyId)` independently in **each** of the 6 cell components (React
   Query dedupes identical concurrent queries by key, so 6 independent calls with the same
   `strategyId` cost one network round-trip, not six) — simpler and matches TanStack's column-per-cell
   model without inventing a non-standard multi-cell renderer.
2. Preserve: the `Strategy` cell's `Link` to `/insights/strategies/${d.strategyId}`, the `State`
   `Badge`'s 3-way variant logic (`:178-179`), the `Score` cell's `scoreColor` styling, and the
   `Actions` column (`enableSorting: false`) rendering the existing Edit/Deactivate `DropdownMenu`+
   `AlertDialog` (header text is conditionally empty for non-admins: `{isAdmin ? 'Actions' : ''}` at
   `:135` — carry this through as the column's `header` value).
3. Replace the `<Table>...</Table>` JSX (`:124-151`) with `<DataTable columns={columns}
   data={definitions} />`. Sorting only (no pagination — this is an operator-curated strategy roster,
   not a large scannable list).
4. Responsive strategy (FR-4): keep the existing column-priority hiding (`hidden sm:/md:/lg:` on 3 of 9
   columns, `:129-133`) via `meta.className`, unchanged. Record disposition: **migrated to `DataTable`;
   responsive strategy (b) column priority (existing 3-tier `hidden` breakpoint set)**.

**Verification**:
```
cd services/xstockstrat-ui && pnpm run lint
grep -n "DataTable" src/app/insights/strategies/page.tsx
```

---

### Step 12 — test: verify `/insights/strategies` migration preserves Edit/Deactivate flow

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/insights/strategy-authoring.spec.ts` — modify (if locators break)

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness, analytics display accuracy,
config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values
rendered in UI, no direct DB access (except audit log)

**Codebase Evidence**:
- Confirmed via grep: `strategy-authoring.spec.ts` exercises `/insights/strategies` at 10+ call sites
  including `test('strategies list Actions menu: Deactivate requires confirmation then calls
  ManageStrategy (FR-2)', ...)` (`:108-118`) — this is the direct paired regression test for Step 11's
  Actions column.
- `mobile-overflow.spec.ts:17` already lists `{ path: '/insights/strategies' }` — **no `ROUTES` change
  needed**.

**TDD**: `red-green required`

**Instructions**:
1. Re-run `strategy-authoring.spec.ts` after Step 11. Fix any locator broken by the `DataTable`
   restructuring; the Deactivate confirmation-dialog flow (`getByRole('menuitem', { name: 'Deactivate'
   })` → `getByText(/Deactivate strategy/)`) must still resolve unchanged.
2. Confirm each of the 6 per-cell `useStrategyAnalytics` calls (Step 11, Instruction 1) still renders
   the same Signals/Taken/Hit-rate/Expectancy/Max-DD/Score values as before — spot-check via an
   existing assertion on one of those columns' rendered text.

**Verification**:
```
cd services/xstockstrat-ui && pnpm run lint
cd services/xstockstrat-ui && pnpm exec playwright test e2e/insights/strategy-authoring.spec.ts --project=chromium --no-deps
cd services/xstockstrat-ui && pnpm exec playwright test e2e/mobile-overflow.spec.ts --project=chromium --no-deps -g "insights/strategies\$"
```

---

### Step 13 — service: migrate `/insights/strategies/[id]` Past Runs table (row 10) to `DataTable`

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/insights/strategies/[id]/page.tsx` — modify

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness, analytics display accuracy,
config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values
rendered in UI, no direct DB access (except audit log)

**Codebase Evidence**:
- Confirmed via `Read`: `Table className="w-full text-sm"` at `strategies/[id]/page.tsx:481`, 7
  columns (When, Symbols, Range, Return, Sharpe, Trades, Run score), unbounded row count, row selection
  (not mutation) — each `TableRow` (`:495-512`) has `role="button"`, `tabIndex={0}`, `aria-selected`,
  `onClick={() => setSelectedRunId(run.backtestId)}`, and an `onKeyDown` guard for Enter/Space that
  already exists — this is one of the composite's `onRowClick` sites (design.md).
- `data-testid="past-runs"` (container, `:476`) and `data-testid="past-run-row"` (`:497`) are read by
  `e2e/insights/backtest-coverage.spec.ts` (`:125,159,191,207` — confirmed via grep) — must be preserved
  (AC-5).
- FR-3 verdict (recon.md row 10): FAIL (cols) — mandatory migration.

**TDD**: `red-green required`

**Instructions**:
1. Define `columns: ColumnDef<BacktestRun>[]` for the 7 columns, preserving the existing date/range
   formatting helpers (`timestampToDate`) and the legacy-row `'—'` fallback for `rangeStart`/`rangeEnd`
   (`:519-527`).
2. Replace the manual `role="button"`/`onClick`/`onKeyDown` wiring on each `TableRow` (`:495-512`) with
   the composite's built-in `onRowClick={(run) => setSelectedRunId(run.backtestId)}` — this is exactly
   the mechanism Step 1 built for this table (design.md: "row 10... has existing `role="button"`/
   keyboard row-activation the round-1 composite design never accounted for"). Preserve `aria-selected`
   and the `bg-secondary` selected-row styling via `rowClassName={(run) => cn(selectedRunId ===
   run.backtestId && 'bg-secondary')}` (or the composite's equivalent per-row class hook).
3. Preserve `data-testid="past-runs"` on the container and `data-testid="past-run-row"` on each row
   (same testid-passthrough note as Step 9, Instruction 2).
4. Replace the `<Table className="w-full text-sm">...</Table>` block (`:481-` through close) with
   `<DataTable columns={columns} data={pastRuns} onRowClick={(run) =>
   setSelectedRunId(run.backtestId)} />`. Sorting only (no pagination — a strategy's run history is
   typically short and reviewed in full).
5. Responsive strategy (FR-4): keep the existing horizontal-scroll fallback (no column-hiding classes
   exist on this table today). Record disposition: **migrated to `DataTable`; responsive strategy (a)
   horizontal-scroll container (existing `Table` wrapper, unchanged)**.

**Verification**:
```
cd services/xstockstrat-ui && pnpm run lint
grep -n "DataTable\|onRowClick" src/app/insights/strategies/\[id\]/page.tsx
```

---

### Step 14 — test: verify `/insights/strategies/[id]` Past Runs migration preserves row-select

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/insights/backtest-coverage.spec.ts` — modify (if locators break)

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness, analytics display accuracy,
config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values
rendered in UI, no direct DB access (except audit log)

**Codebase Evidence**:
- Confirmed via grep: `backtest-coverage.spec.ts:124-125,159,166,191,197,207` asserts
  `getByTestId('past-runs')`/`getByTestId('past-run-row')` content including exact metric text
  (`'15.00%'`, `'MSFT'`, `'-3.00%'`) — this is the direct AC-5 field-parity regression test.
- `mobile-overflow.spec.ts:18` already lists `{ path: '/insights/strategies/strat-high-001' }` —
  **no `ROUTES` change needed**.

**TDD**: `red-green required`

**Instructions**:
1. Re-run `backtest-coverage.spec.ts` after Step 13. Fix any locator broken by the `DataTable`
   restructuring; the row-select behavior (clicking a past-run row loads its diagnostics/equity curve)
   must still work via the composite's `onRowClick`, and keyboard activation (Enter/Space) must
   continue to work via the composite's built-in `onKeyDown` guard (replacing the manual one removed in
   Step 13) — add an explicit keyboard-activation assertion if none exists today, since Step 13 is the
   first table where the composite's own keydown guard (not a hand-rolled one) is load-bearing.

**Verification**:
```
cd services/xstockstrat-ui && pnpm run lint
cd services/xstockstrat-ui && pnpm exec playwright test e2e/insights/backtest-coverage.spec.ts --project=chromium --no-deps
cd services/xstockstrat-ui && pnpm exec playwright test e2e/mobile-overflow.spec.ts --project=chromium --no-deps -g "strat-high-001"
```

---

### Step 15 — service: migrate `/insights/formulas` list table (row 11) to `DataTable`

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/insights/formulas/page.tsx` — modify

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness, analytics display accuracy,
config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values
rendered in UI, no direct DB access (except audit log)

**Codebase Evidence**:
- Confirmed via `Read`: `Table` at `formulas/page.tsx:104`, 4 columns (Name, Visibility, Author,
  Created), `pageSize 50` (per recon.md), no actions — each `TableRow` (`:115-127`) has
  `role="button"`, `tabIndex={0}`, `onClick={() => router.push(...)}`, matching `onKeyDown` guard —
  another `onRowClick` composite site.
- Existing zero-results row (`:147-154`, `colSpan={4}`) already distinguishes "no formulas yet" vs "no
  formulas match your search" — preserve both messages via the composite's `emptyMessage` (compute the
  message string before passing it, since it depends on `formulas.length === 0` vs `filtered.length ===
  0`).
- FR-3 verdict (recon.md row 11): FAIL (rows — cols at the ≤4 boundary but not static/bounded, and the
  `pageSize 50` server cap means real row counts commonly exceed 10) — mandatory migration.

**TDD**: `red-green required`

**Instructions**:
1. Define `columns: ColumnDef<FormulaDefinition>[]` for the 4 columns, preserving the `Name` cell's
   two-line name+description rendering (`:128-135`), the `Visibility` `Badge`, and the `formatDate`
   helper on `Created`.
2. Replace the manual `role="button"`/`onClick`/`onKeyDown` wiring (`:115-126`) with the composite's
   `onRowClick={(f) => router.push(`/insights/formulas/${f.formulaId}`)}`.
3. Replace the `<Table>...</Table>` JSX (`:104-` through its zero-results branch) with `<DataTable
   columns={columns} data={filtered} onRowClick={(f) => router.push(...)} emptyMessage={formulas.length
   === 0 ? 'No formulas yet. Click New Formula to create one.' : 'No formulas match your search.'} />`.
   Enable pagination (`enablePagination`, `pageSize={50}`) matching the existing server `pageSize 50` —
   per design.md's Open Risk on rows 6–7's pagination default, this table's existing server cap of 50
   is itself the signal that client pagination is warranted here (distinct from row 9's small curated
   roster, which stays sort-only).
4. Responsive strategy (FR-4): 4 columns is narrow enough that no column-hiding exists today; keep the
   existing horizontal-scroll fallback. Record disposition: **migrated to `DataTable`; responsive
   strategy (a) horizontal-scroll container (existing `Table` wrapper, unchanged); pagination enabled
   (pageSize 50, matching existing server cap)**.

**Verification**:
```
cd services/xstockstrat-ui && pnpm run lint
grep -n "DataTable\|onRowClick\|enablePagination" src/app/insights/formulas/page.tsx
```

---

### Step 16 — test: verify `/insights/formulas` migration preserves row-navigate + search/filter

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/insights/formulas.spec.ts` — modify (if locators break)

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness, analytics display accuracy,
config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values
rendered in UI, no direct DB access (except audit log)

**Codebase Evidence**:
- `services/xstockstrat-ui/e2e/insights/formulas.spec.ts` — existing suite, uses `FORMULA_RSI`,
  `FORMULA_MACD`, `FORMULAS` from `e2e/fixtures/formulas.ts` (per `INVENTORY.md`) — reuse unchanged
  (C-12). Also `FORMULA_DELETED` is consumed by the sibling `formula-deletion.spec.ts` (086) — not this
  page's table directly, but confirm no shared-mock regression.
- `mobile-overflow.spec.ts:30` already lists `{ path: '/insights/formulas' }` — **no `ROUTES` change
  needed**.

**TDD**: `red-green required`

**Instructions**:
1. Re-run `formulas.spec.ts` after Step 15. Fix any locator broken by the `DataTable` restructuring;
   the row-click-to-navigate behavior, the Visibility filter `Select`, and both zero-results message
   variants must be unchanged (AC-5).
2. Add or confirm an assertion that the new client pagination (Step 15, `pageSize={50}`) does not
   truncate the list at fewer than 50 rows for a fixture set smaller than 50 — the existing `FORMULAS`
   fixture set size should be checked against the new page-size default to confirm no visible-row
   regression for the current fixture count.

**Verification**:
```
cd services/xstockstrat-ui && pnpm run lint
cd services/xstockstrat-ui && pnpm exec playwright test e2e/insights/formulas.spec.ts --project=chromium --no-deps
cd services/xstockstrat-ui && pnpm exec playwright test e2e/mobile-overflow.spec.ts --project=chromium --no-deps -g "insights/formulas"
```

---

### Step 17 — service: migrate `/accounts/authorized-apps` table (row 15) to `DataTable`

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/accounts/authorized-apps/page.tsx` — modify

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness, analytics display accuracy,
config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values
rendered in UI, no direct DB access (except audit log)

**Codebase Evidence**:
- Confirmed via `Read`: `Table` at `authorized-apps/page.tsx:134`, 5 columns (App, Client ID,
  Authorized, Last refreshed, Actions), dynamic row count, Revoke via `AlertDialog` (`:152-180`, no
  `DropdownMenu` — a direct destructive-action `Button` per row, distinct from the 6
  `DropdownMenu`-pattern sites).
- FR-3 verdict (recon.md row 15): FAIL (cols, not read-only) — mandatory migration.

**TDD**: `red-green required`

**Instructions**:
1. Define `columns: ColumnDef<AuthorizedApp>[]` for the 5 columns, preserving the `formatDate` helper
   on Authorized/Last refreshed, and an `id: 'actions'` column (`enableSorting: false`) whose `cell`
   renders the existing per-row `AlertDialog` (Disconnect confirmation) unchanged, keyed off
   `revoking === app.clientId` for the pending-state label/disabled logic.
2. Replace the `<Table>...</Table>` JSX (`:134-185`) with `<DataTable columns={columns} data={apps}
   />`. Sorting only (no pagination — a user's own authorized-app list is small by construction).
3. Responsive strategy (FR-4): 5 columns inside a `max-w-4xl` container (`:110`) — keep the existing
   horizontal-scroll fallback. Record disposition: **migrated to `DataTable`; responsive strategy (a)
   horizontal-scroll container (existing `Table` wrapper, unchanged)**.

**Verification**:
```
cd services/xstockstrat-ui && pnpm run lint
grep -n "DataTable" src/app/accounts/authorized-apps/page.tsx
```

---

### Step 18 — test: verify `/accounts/authorized-apps` migration preserves the Revoke flow

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/accounts/authorized-apps.spec.ts` — modify (if locators break)

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness, analytics display accuracy,
config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values
rendered in UI, no direct DB access (except audit log)

**Codebase Evidence**:
- `services/xstockstrat-ui/e2e/accounts/authorized-apps.spec.ts` — existing suite (feature 124 already
  added this route to `mobile-overflow.spec.ts`'s `ROUTES` — `mobile-overflow.spec.ts:29` — confirmed,
  **no `ROUTES` change needed**).
- C-12: authorized-apps domain data is currently sourced from `e2e/mock-backend.ts`'s
  `listAuthorizedApps` handler (per `INVENTORY.md` "Not yet centralized" table) — reuse unchanged, this
  step does not add a second inline consumer.

**TDD**: `red-green required`

**Instructions**:
1. Re-run `authorized-apps.spec.ts` after Step 17. Fix any locator broken by the `DataTable`
   restructuring; the Disconnect `AlertDialog` confirm/cancel flow and the pending-state label
   (`'Disconnecting…'`) must be unchanged (AC-5).

**Verification**:
```
cd services/xstockstrat-ui && pnpm run lint
cd services/xstockstrat-ui && pnpm exec playwright test e2e/accounts/authorized-apps.spec.ts --project=chromium --no-deps
cd services/xstockstrat-ui && pnpm exec playwright test e2e/mobile-overflow.spec.ts --project=chromium --no-deps -g "authorized-apps"
```

---

### Step 19 — service: migrate `/trader/portfolio` broker-reported positions table (row 1) to `DataTable`

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/trader/portfolio/page.tsx` — modify

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness, analytics display accuracy,
config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values
rendered in UI, no direct DB access (except audit log)

**Codebase Evidence**:
- Confirmed via `Read`: `Table` at `portfolio/page.tsx:155`, 7 columns (Symbol, Account, Qty, Avg cost,
  Mkt value, Unrealized, Day P&L), dynamic/unbounded row count, no actions — Symbol cell is a `Link` to
  `/trader/positions/${symbol}` (`:172-177`), not a row-level click.
- FR-3 verdict (recon.md row 1): FAIL (cols) — mandatory migration.

**TDD**: `red-green required`

**Instructions**:
1. Define `columns: ColumnDef<Position>[]` for the 7 columns, preserving the `Symbol` cell's `Link`
   (no `onRowClick` needed on this table — the existing navigation is a plain in-cell link, not a
   row-click), the `accountName(p.accountId)` helper, and the `pnlClass`-driven conditional styling on
   Unrealized/Day P&L.
2. Replace the `<Table>...</Table>` JSX (`:155-` through close) with `<DataTable columns={columns}
   data={positions} />`. Sorting only (no pagination — this is a per-account, typically-small position
   list, distinct from row 2's platform-wide Exposure table).
3. Responsive strategy (FR-4): keep the existing column-priority hiding (`hidden sm:/md:` on 3 of 7
   columns, `:159-164`) via `meta.className`, unchanged. Record disposition: **migrated to `DataTable`;
   responsive strategy (b) column priority (existing 2-tier `hidden` breakpoint set)**.

**Verification**:
```
cd services/xstockstrat-ui && pnpm run lint
grep -n "DataTable" src/app/trader/portfolio/page.tsx
```

---

### Step 20 — test: verify `/trader/portfolio` migration preserves behavior

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/trader/portfolio.spec.ts` — modify (if locators break)

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness, analytics display accuracy,
config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values
rendered in UI, no direct DB access (except audit log)

**Codebase Evidence**:
- `services/xstockstrat-ui/e2e/trader/portfolio.spec.ts` — existing suite, uses `POSITION_AAPL`/
  `POSITION_MSFT`/`POSITIONS` from `e2e/fixtures/positions.ts` (C-12, per `INVENTORY.md`).
- `mobile-overflow.spec.ts:22` already lists `{ path: '/trader/portfolio' }` — **no `ROUTES` change
  needed**.

**TDD**: `red-green required`

**Instructions**:
1. Re-run `portfolio.spec.ts` after Step 19. Fix any locator broken by the `DataTable` restructuring;
   Symbol-link navigation and all 7 columns' rendered values must be unchanged (AC-5).

**Verification**:
```
cd services/xstockstrat-ui && pnpm run lint
cd services/xstockstrat-ui && pnpm exec playwright test e2e/trader/portfolio.spec.ts --project=chromium --no-deps
cd services/xstockstrat-ui && pnpm exec playwright test e2e/mobile-overflow.spec.ts --project=chromium --no-deps -g "trader/portfolio"
```

---

### Step 21 — service: migrate `/trader/positions/[symbol]` orders sub-table (row 4) to `DataTable`

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx` — modify

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness, analytics display accuracy,
config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values
rendered in UI, no direct DB access (except audit log)

**Codebase Evidence** _(re-spec'd 2026-08-16 — feature 125 "unified Symbol page" landed in main-dev
between /sdd-spec and /sdd-execute and hoisted this table into its own component; see `## Re-spec Log`
below)_:
- Confirmed via `Read`: the orders sub-table now lives in a standalone `SymbolOrdersCard({ symbol,
  orders, working })` function component (`positions/[symbol]/page.tsx:391-465`), invoked
  unconditionally at `:260` (`<SymbolOrdersCard symbol={symbol} orders={orders} working={working} />`)
  — it renders for every symbol, not only when a position is held (feature 125's "hoisted to page
  level" change; see the component's own doc comment at `:389-390`). The table itself is unchanged:
  `<Table>` at `:417`, still 8 columns in the same order (Side `:420`, Type `:421`, Qty `:422`, Filled
  `:423`, Avg fill `:424`, Status `:425`, Origin `:426`, Open `:427`), dynamic row count, no mutation
  actions (a `View →` link button per row).
- `SymbolOrdersCard` wraps the table in `orders.length === 0 ? <EmptyState title="No orders for this
  symbol" description="Orders you place for this position will appear here, traced to their origin
  signal." /> : <Table>...</Table>` (`:411-461`) — this conditional pre-dates and is **unrelated to**
  the `DataTable` migration; leave it as-is and only replace the inner `<Table>...</Table>` block, not
  the surrounding `EmptyState` branch (the composite's own `emptyMessage` prop is a single string in a
  `TableCell`, not a match for this richer title+description empty state).
- **Dead-class disposition (design.md Open Risk) — still holds**: `TableRow` at `:432` carries
  `className="cursor-pointer"` with **zero click handler wired anywhere** — confirmed by reading the
  full row block (`:431-458`), only the `View →` `Link` button (`:452-456`) is clickable, the row
  itself is not. Per design.md's default recommendation, carry the stray class forward unchanged
  (matches current visual state — a dead affordance, not a new one) rather than dropping it as
  unrelated cleanup; record this explicitly rather than silently resolving it either way.
- FR-3 verdict (recon.md row 4): FAIL (cols) — mandatory migration.
- Reuses `OrderSideBadge` (`:434`), `TYPE_LABEL[OrderType[o.orderType]]` (`:437`), `formatOrderPrice`
  (`:444`), `OrderStatusBadge` (`:447`), and the `o.strategyId || 'Manual'` Origin fallback (`:450`) —
  order/fill display logic is unchanged, only the table chrome (per Execution Summary's trading-domain
  note). These imports live at `page.tsx:33-38` (unchanged).

**TDD**: `red-green required`

**Instructions**:
1. Inside `SymbolOrdersCard` (`:391-465`), define `columns: ColumnDef<Order>[]` for the 8 columns,
   reusing `OrderSideBadge`, `TYPE_LABEL[OrderType[o.orderType]]`, `formatOrderPrice`, `OrderStatusBadge`,
   and the `o.strategyId || 'Manual'` Origin fallback verbatim as cell renderers. `Open` column
   (`id: 'open'`, `enableSorting: false`) renders the existing `View →` `Button`+`Link`. A module-scope
   array is sufficient — `SymbolOrdersCard`'s columns depend only on props/module-level helpers, no
   enclosing-component state to close over.
2. **Do not** wire `onRowClick` on this table — no click handler exists today; carry the
   `cursor-pointer` class forward via `rowClassName={() => 'cursor-pointer'}` on the `DataTable` (or
   directly on each row via the composite's row-class mechanism), unchanged from the pre-migration
   visual state. Record disposition explicitly: **migrated to `DataTable`; `cursor-pointer` class
   carried forward unchanged (pre-existing dead affordance, not new — no click handler added)**.
3. Replace the `<Table>...</Table>` JSX (`:417-460`) with `<DataTable columns={columns} data={orders}
   rowClassName={() => 'cursor-pointer'} />`, leaving the `orders.length === 0 ? <EmptyState ... /> : `
   wrapper at `:411` unchanged. Sorting only (no pagination — a single position's order history is
   typically short).
4. Responsive strategy (FR-4): keep the existing column-priority hiding (`hidden sm:table-cell` on
   Filled `:423`, `hidden md:table-cell` on Origin `:426`) via `meta.className`, unchanged. Record
   disposition: **migrated to `DataTable`; responsive strategy (b) column priority (existing 2-tier
   `hidden` breakpoint set)**.

**Verification**:
```
cd services/xstockstrat-ui && pnpm run lint
grep -n "DataTable" src/app/trader/positions/\[symbol\]/page.tsx
```

---

### Step 22 — test: verify `/trader/positions/[symbol]` migration preserves behavior

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/trader/position-detail.spec.ts` — modify (if locators break)

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness, analytics display accuracy,
config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values
rendered in UI, no direct DB access (except audit log)

**Codebase Evidence** _(re-spec'd 2026-08-16 — see `## Re-spec Log` below)_:
- `services/xstockstrat-ui/e2e/trader/position-detail.spec.ts` is now a 351-line, 5-test suite covering
  the full unified Symbol page (feature 125) — not solely the orders table. The two tests that exercise
  `SymbolOrdersCard` (Step 21) directly: `'renders the risk-framed header, stat grid, risk sidebar and
  orders table'` asserts `getByText('Orders & fills · AAPL')` visible (`:40`, for a held position), and
  `'an unheld symbol still renders the chart, orders and trade sections (feature 125)'` asserts
  `getByText('Orders & fills · ZZZZ')` visible (`:82`, for a position-less symbol — proving
  `SymbolOrdersCard`'s unconditional rendering). Neither test asserts individual order-row column
  content by locator today — Step 21's 8-column table content itself has no dedicated per-column
  assertion in this file to preserve beyond these two "card renders" checks; the mock backend's order
  fixtures back both.
- `mobile-overflow.spec.ts:34` (drifted from `:33`, feature 125 removed the `/insights/market/[symbol]`
  entry ahead of it) still lists `{ path: '/trader/positions/AAPL' }` — **no `ROUTES` change needed**.

**TDD**: `red-green required`

**Instructions**:
1. Re-run the full `position-detail.spec.ts` suite (all 5 tests, not just the two above — Step 21 only
   touches `SymbolOrdersCard`'s internals, but a full-file re-run catches any DOM-structure locator break
   elsewhere in the file too) after Step 21. Fix any locator broken by the `DataTable` restructuring;
   the `'Orders & fills · AAPL'` (`:40`) and `'Orders & fills · ZZZZ'` (`:82`) card-title assertions, and
   the `View →` link's target, must be unchanged (AC-5).
2. Confirm no test asserts the row itself is clickable (there is no such handler pre- or
   post-migration) — if one exists, it was already asserting dead behavior; do not add new
   click-to-navigate coverage here (out of scope — the dead class is carried forward, not activated).
3. Do not expand this step to add coverage for the rest of `position-detail.spec.ts`'s FR-6/7/9/10/11
   sections (price chart, trade widget, backtests, backfill, indicators) — those are feature 125's
   scope, already covered by its own tests; this step's scope is limited to the orders sub-table.

**Verification**:
```
cd services/xstockstrat-ui && pnpm run lint
cd services/xstockstrat-ui && pnpm exec playwright test e2e/trader/position-detail.spec.ts --project=chromium --no-deps
cd services/xstockstrat-ui && pnpm exec playwright test e2e/mobile-overflow.spec.ts --project=chromium --no-deps -g "trader/positions/AAPL"
```

---

### Step 23 — service: migrate `OrdersTable.tsx` (row 5, `/trader/orders`) to `DataTable`

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/trader/OrdersTable.tsx` — modify

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness, analytics display accuracy,
config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values
rendered in UI, no direct DB access (except audit log)

**Codebase Evidence**:
- Confirmed via `Read`: `Table` at `OrdersTable.tsx:79`, 10 columns (Symbol, Side, Type, Qty, Filled,
  Avg Price, Status, From signal, Placed, Actions), `pageSize 50` + live `useOrderUpdates()` merge,
  Edit/Cancel via `DropdownMenu`+`AlertDialog` (`:132-164`).
- **`useMemo` requirement (design.md, Step Dependencies)**: `const merged = orders.map((o) =>
  liveUpdates[o.orderId] ?? o);` at `:69` is recomputed inline on every render — must be wrapped in
  `useMemo(() => orders.map((o) => liveUpdates[o.orderId] ?? o), [orders, liveUpdates])` before
  becoming the `DataTable`'s `data` prop, per the composite's own doc comment (Step 1) and ledger
  `fails.md` 2026-08-08 (TanStack Table requires a referentially-stable `data` array).
- Import already has `import { useState } from 'react';` at `:2` — add `useMemo` to this import.
- FR-3 verdict (recon.md row 5): FAIL (cols, rows) — mandatory migration.

**TDD**: `red-green required`

**Instructions**:
1. Change `import { useState } from 'react';` (`:2`) to `import { useMemo, useState } from 'react';`.
2. Wrap `merged` (`:69`) in `useMemo`: `const merged = useMemo(() => orders.map((o) => liveUpdates[
   o.orderId] ?? o), [orders, liveUpdates]);`.
3. Define `columns: ColumnDef<Order>[]` for the 10 columns, reusing `OrderSymbolCell`, `OrderSideCell`,
   `TYPE_LABEL[typeName]`, `formatUsd`, `OrderStatusCell`, the strategyId Link/Manual fallback
   (`:115-126`), `placedLabel(order.createdAt)`, and the `Actions` column's existing
   `DropdownMenu`+`AlertDialog` Edit/Cancel flow (`:132-164`, gated by `TERMINAL.has(order.status)`)
   verbatim. Preserve `data-testid={`order-row-${order.orderId}`}` on each row and
   `data-testid={`actions-${order.orderId}`}`/`data-testid={`edit-${order.orderId}`}`/
   `data-testid={`cancel-${order.orderId}`}` on the Actions cell's controls (same testid-passthrough
   note as Step 9).
4. Replace the `<Table>...</Table>` JSX (`:79-170`) with `<DataTable columns={columns} data={merged}
   />`. Sorting only (no pagination — this table already has its own server `pageSize 50` and live
   updates; adding client pagination on top would paginate a data set that's already changing under the
   user in real time, an unnecessary interaction — sort is sufficient).
5. Responsive strategy (FR-4): keep the existing column-priority hiding (`hidden sm:/md:/lg:` on 3 of 10
   columns, `:84,87,90,91`) via `meta.className`, unchanged — this is the table `mobile-overflow.spec.ts`'s
   dedicated 1280px `lg:`-grid-split block (`:78-93`) already regression-guards. Record disposition:
   **migrated to `DataTable`; responsive strategy (b) column priority (existing 3-tier `hidden`
   breakpoint set, including the `lg:` tier the 1280px CI-only regression test specifically covers)**.

**Verification**:
```
cd services/xstockstrat-ui && pnpm run lint
grep -n "useMemo" src/components/trader/OrdersTable.tsx
grep -n "DataTable" src/components/trader/OrdersTable.tsx
```

---

### Step 24 — test: verify `OrdersTable.tsx` migration preserves Edit/Cancel + the 1280px regression guard

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/trader/orders.spec.ts` — modify (if locators break)
- `services/xstockstrat-ui/e2e/trader/order-parity.spec.ts` — modify (if locators break)

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness, analytics display accuracy,
config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values
rendered in UI, no direct DB access (except audit log)

**Codebase Evidence**:
- `orders.spec.ts`/`order-parity.spec.ts` — existing suites per `INVENTORY.md`'s "Not yet centralized"
  table ("Orders (scenario overrides)" — bespoke `page.route()` sets, each single-site; the shared mock
  set lives in `e2e/fixtures/orders.ts`, `ORDER_FILLED`/`ORDER_WORKING`/`ORDER_UNKNOWN_INTENT`/`ORDERS`).
- `mobile-overflow.spec.ts:23` already lists `{ path: '/trader/orders' }` (390px), **and** the dedicated
  1280px block at `:78-93` specifically targets this route/table — **no `ROUTES` change needed**, both
  existing checks apply directly.

**TDD**: `red-green required`

**Instructions**:
1. Re-run `orders.spec.ts` and `order-parity.spec.ts` after Step 23. Fix any locator broken by the
   `DataTable` restructuring; the Edit/Cancel `DropdownMenu` flow, live-update merge behavior, and all
   10 columns' rendered values must be unchanged (AC-5).
2. Explicitly re-run the 1280px `mobile-overflow.spec.ts` block (`-g "1280px"`) — this is the direct
   regression-guard for the `lg:`-grid-split overflow edge case feature 124 already fixed; the `useMemo`
   fix (Instruction 2 of Step 23) must not be skipped or this test can flake from unstable row-model
   resets under live-update churn.

**Verification**:
```
cd services/xstockstrat-ui && pnpm run lint
cd services/xstockstrat-ui && pnpm exec playwright test e2e/trader/orders.spec.ts e2e/trader/order-parity.spec.ts --project=chromium --no-deps
cd services/xstockstrat-ui && pnpm exec playwright test e2e/mobile-overflow.spec.ts --project=chromium --no-deps -g "trader/orders|1280px"
```

---

### Step 25 — service: migrate `LiveStrategiesPanel.tsx` (row 6, bare `/trader`) to `DataTable`

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/trader/LiveStrategiesPanel.tsx` — modify
- `services/xstockstrat-ui/e2e/mobile-overflow.spec.ts` — modify (add bare `/trader` to `ROUTES`)

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness, analytics display accuracy,
config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values
rendered in UI, no direct DB access (except audit log)

**Codebase Evidence**:
- Confirmed via `Read`: `Table` at `LiveStrategiesPanel.tsx:36`, 3–4 columns (Strategy, Status, Live,
  conditional Action), unbounded row count, admin Enable/Disable `Button` (not `DropdownMenu`).
- **Keyboard double-fire bug (design.md, the decisive round-3/4 finding)**: `TableRow` (`:47-59`)
  already has `role="button"`, `tabIndex={0}`, `onClick={() => setSelectedId(s.strategyId)}`, and an
  `onKeyDown` guard for Enter/Space — **but** the nested Enable/Disable `Button` (`:73-87`) only calls
  `e.stopPropagation()` in its `onClick` (`:78`), not in any `onKeyDown` — a keyboard user pressing
  Enter on that button today double-fires both the button's `setLive.mutate` action **and** the row's
  `setSelectedId`. This is the concrete bug design.md's `isInteractiveTarget`-on-both-`click`-and-
  `keydown` mechanism exists to fix.
- FR-3 verdict (recon.md row 6): FAIL (rows, not read-only when admin) — mandatory migration.
- Confirmed via grep: `mobile-overflow.spec.ts` `ROUTES` has **no bare `/trader` entry** — `OrderBook`
  (Step 27) also renders at this route (`src/app/trader/page.tsx`), so this step's `ROUTES` addition
  covers both.

**TDD**: `red-green required`

**Instructions**:
1. Define `columns: ColumnDef<StrategyDefinition>[]` for Strategy, Status (`Badge`), Live (`Badge`),
   and a conditional Action column present only `if (isAdmin)` (build the `columns` array conditionally
   — TanStack accepts a plain array, so `isAdmin ? [...base, actionColumn] : base` is sufficient, no
   composite change needed). The Action `cell` renders the existing Enable/Disable `Button`
   (`:73-87`) unchanged.
2. Replace the manual `role="button"`/`onClick`/`onKeyDown` row wiring (`:47-59`) with the composite's
   `onRowClick={(s) => setSelectedId(s.strategyId)}` — this **replaces** the bug in Instruction "Codebase
   Evidence" above: the composite's shared `isInteractiveTarget` guard runs in both `onClick` and
   `onKeyDown` before invoking `onRowClick`, so a keyboard Enter on the Enable/Disable `<button>` now
   correctly fires *only* the button's own handler (native `<button>` branch of `isInteractiveTarget`)
   and never also calls `setSelectedId`. This is a genuine, intentional bug fix — record it as such in
   the Deviation Log, not silently.
3. Replace the `<Table>...</Table>` JSX (`:36-93`) with `<DataTable columns={columns}
   data={strategies} onRowClick={(s) => setSelectedId(s.strategyId)} />`. Sorting only (no
   pagination — unbounded but typically small operator-facing panel).
4. Responsive strategy (FR-4): no column-hiding exists today (only 3–4 narrow columns); keep the
   existing horizontal-scroll fallback. Record disposition: **migrated to `DataTable`; responsive
   strategy (a) horizontal-scroll container (existing `Table` wrapper, unchanged); keyboard
   double-fire bug (Enable/Disable button + row-select) fixed as a byproduct of the composite's shared
   guard**.
5. Add `{ path: '/trader' }` to `mobile-overflow.spec.ts`'s `ROUTES` array (`e2e/mobile-overflow.spec.ts:12-34`)
   — the FR-5 gap recon and design.md both flagged: `OrderBook`/`LiveStrategiesPanel` render at the bare
   `/trader` dashboard route, which has never been in this sweep.

**Verification**:
```
cd services/xstockstrat-ui && pnpm run lint
grep -n "DataTable\|onRowClick" src/components/trader/LiveStrategiesPanel.tsx
grep -n "{ path: '/trader' }" e2e/mobile-overflow.spec.ts
```

---

### Step 26 — test: verify `LiveStrategiesPanel.tsx` migration fixes the keyboard double-fire + covers bare `/trader`

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/trader/live-strategies.spec.ts` — modify

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness, analytics display accuracy,
config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values
rendered in UI, no direct DB access (except audit log)

**Codebase Evidence**:
- `services/xstockstrat-ui/e2e/trader/live-strategies.spec.ts` — existing suite, `page.goto('/trader')`
  at `:106` (confirmed via grep), uses `STRATEGY_DEF_LIVE`/`STRATEGY_DEF_INACTIVE`/
  `STRATEGY_DEFINITIONS` from `e2e/fixtures/strategies.ts` (C-12, per `INVENTORY.md`), asserts
  `strat-live-001`.

**TDD**: `red-green required`

**Instructions**:
1. Re-run `live-strategies.spec.ts` after Step 25. Fix any locator broken by the `DataTable`
   restructuring; the row-select-opens-alert-feed behavior and admin Enable/Disable mutation must be
   unchanged (AC-5).
2. Add a new assertion proving the keyboard double-fire fix (Step 25, Instruction 2): as an admin user,
   focus the Enable/Disable button for a row via keyboard and press Enter/Space; assert `setLive.mutate`
   fires (the button's own action) **and** the strategy-alert-feed `Collapsible` does **not** open (the
   row's `onRowClick` must not also fire). Write this to fail first against the pre-Step-25 tree (it
   should fail because today's `stopPropagation`-only guard does not cover `keydown`) — this is the
   TDD proof for the fix.
3. Confirm the new bare-`/trader` `mobile-overflow.spec.ts` `ROUTES` entry (Step 25) passes at 390px.

**Verification**:
```
cd services/xstockstrat-ui && pnpm run lint
cd services/xstockstrat-ui && pnpm exec playwright test e2e/trader/live-strategies.spec.ts --project=chromium --no-deps
cd services/xstockstrat-ui && pnpm exec playwright test e2e/mobile-overflow.spec.ts --project=chromium --no-deps -g "^no horizontal overflow at 390px — /trader\$"
```

---

### Step 27 — service: migrate `OrderBook.tsx` (row 7, bare `/trader`) to `DataTable`

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/trader/OrderBook.tsx` — modify

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness, analytics display accuracy,
config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values
rendered in UI, no direct DB access (except audit log)

**Codebase Evidence**:
- Confirmed via `Read`: `Table` at `OrderBook.tsx:28`, 6 columns (Symbol, Side, Qty, Filled, Avg Price,
  Status), `pageSize 50` (via `useOrders`, same hook `OrdersTable.tsx` consumes).
- **Dead-class disposition (design.md Open Risk)**: `TableRow` at `:41` carries `className=
  "cursor-pointer hover:bg-accent/40"` with **zero click handler wired anywhere** — confirmed by
  reading the full component (`:39-54`), no `onClick` exists on the row or any cell. Per design.md's
  default recommendation, carry the stray classes forward unchanged (matches current visual state).
- Confirmed via `Read src/components/trader/OrderBook.tsx:15` and the recon note "row 7 renders the
  user's own order list via the same `useOrders` hook as row 5, not a price ladder" — sort stays
  enabled (design.md round 2 resolution); this is not a market-depth/price-ladder widget despite the
  component name.
- FR-3 verdict (recon.md row 7): FAIL (cols) — mandatory migration.

**TDD**: `red-green required`

**Instructions**:
1. Define `columns: ColumnDef<Order>[]` for the 6 columns, reusing `OrderSymbolCell`, `OrderSideCell`,
   `formatUsd`, and `OrderStatusCell` verbatim.
2. **Do not** wire `onRowClick` — no click handler exists today; carry `"cursor-pointer
   hover:bg-accent/40"` forward via `rowClassName={() => 'cursor-pointer hover:bg-accent/40'}`,
   unchanged from the pre-migration visual state. Record disposition explicitly: **migrated to
   `DataTable`; `cursor-pointer hover:bg-accent/40` classes carried forward unchanged (pre-existing
   dead affordance, not new)**.
3. Replace the `<Table>...</Table>` JSX (`:28-55`) with `<DataTable columns={columns} data={data.orders}
   rowClassName={() => 'cursor-pointer hover:bg-accent/40'} />`. Sorting only (no pagination — this
   panel already caps at `pageSize 50` server-side and is a compact dashboard widget, not a browse
   surface).
4. Responsive strategy (FR-4): keep the existing column-priority hiding (`hidden sm:table-cell` on Avg
   Price, `:35`) via `meta.className`, unchanged. Record disposition: **migrated to `DataTable`;
   responsive strategy (b) column priority (existing single `hidden sm:table-cell`)**.

**Verification**:
```
cd services/xstockstrat-ui && pnpm run lint
grep -n "DataTable" src/components/trader/OrderBook.tsx
```

---

### Step 28 — test: verify `OrderBook.tsx` migration preserves behavior

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/trader/api-smoke.spec.ts` — modify (if locators break; data-contract
  assertions only, per its existing scope)
- `services/xstockstrat-ui/e2e/trader/live-strategies.spec.ts` — modify (add an `OrderBook` row-content
  assertion at the shared `/trader` route, since no dedicated spec asserts this table's rendered rows
  today — see Codebase Evidence)

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness, analytics display accuracy,
config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values
rendered in UI, no direct DB access (except audit log)

**Codebase Evidence**:
- Confirmed via grep: `e2e/trader/api-smoke.spec.ts:16-33` covers `OrderBook.tsx`'s
  `TradingService/ListOrders` **data contract** only (fetch/response shape), not the rendered table's
  visible content — this is the only existing spec that names `OrderBook`. No spec was found asserting
  the table's column headers or row text directly.
- `live-strategies.spec.ts:106` already navigates to `/trader` (the same route `OrderBook` renders on,
  alongside `LiveStrategiesPanel`) — adding a row-content assertion there avoids a third spec file
  navigating to the same route.
- The bare-`/trader` `mobile-overflow.spec.ts` `ROUTES` entry added in Step 25 already covers this
  table's overflow behavior — **no `ROUTES` change needed** in this step.

**TDD**: `red-green required`

**Instructions**:
1. Re-run `api-smoke.spec.ts` after Step 27 — confirm the `ListOrders` data-contract assertions are
   unaffected by the presentation-layer change (they should be, since Step 27 does not touch the
   `useOrders` hook or its RPC call).
2. In `live-strategies.spec.ts` (which already loads `/trader`), add an assertion that the OrderBook
   card renders its 6 column headers and at least one order row's Symbol/Side/Status text — this closes
   the coverage gap identified in Codebase Evidence and is the AC-5 field-parity proof for this table.
   Write it to fail first against the pre-Step-27 tree only in the sense that it is new coverage (the
   underlying markup already renders this content pre-migration; the test is new, not a regression
   fixture — note this distinction in the Deviation Log rather than forcing an artificial red).

**Verification**:
```
cd services/xstockstrat-ui && pnpm run lint
cd services/xstockstrat-ui && pnpm exec playwright test e2e/trader/api-smoke.spec.ts e2e/trader/live-strategies.spec.ts --project=chromium --no-deps
```

---

### Step 29 — service: migrate `/trader/positions` Exposure table (row 2, 19 cols) to `DataTable`

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/trader/positions/page.tsx` — modify

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness, analytics display accuracy,
config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values
rendered in UI, no direct DB access (except audit log)

**Codebase Evidence**:
- Confirmed via `Read`: `Table` at `positions/page.tsx:304`, **19** columns (Asset, Side, Qty, Price,
  Avg Entry, Cost Basis, Market Value, Today's P/L($), Today's P/L(%), Total P/L($), Total P/L(%),
  Weight, Open R, Risk at stop, Exit rule, Factor, Stop dist, Flag, and a `sr-only`-labeled but
  visibly-rendered "Trade" column — `:307-328`, design.md's corrected count, not recon's original
  18-count), dynamic/unbounded row count, keyset-paginated + client filters, no in-table action menu
  (a Quick-trade `Button`/`Link` per row, `:406-418`).
- **`onRowClick` site**: `TableRow` (`:333-337`) has `onClick={() => setSelected(p)}` and
  `className="cursor-pointer"` — **no existing keyboard activation** (mouse-only today). The composite
  adding `onKeyDown` here is an intentional, recorded accessibility improvement (design.md), not scope
  creep.
- Two existing `stopPropagation()` calls inside the row must be preserved verbatim as-is, since they
  guard nested interactive elements the row's `onClick` would otherwise also fire on: the Symbol
  `Link`'s `onClick={(e) => e.stopPropagation()}` (`:344`) and the Trade `Button`'s
  `onClick={(e) => e.stopPropagation()}` (`:414`) — **do not remove these**; the composite's
  `isInteractiveTarget` guard is a *belt-and-suspenders* addition on top (it independently blocks the
  row handler from firing for any `<a>`/`<button>` target, whether or not the element's own handler
  also calls `stopPropagation`), not a replacement requiring their removal.
- **Existing 3-tier CSS breakpoint disclosure** (`hidden sm:/md:/lg:table-cell` at `:311-327`,
  established by feature 083) — carry through unchanged via `meta.className` (design.md: rejected the
  alternative `useIsMobile()` JS hook specifically to preserve this working mechanism).
- **Existing server-side keyset Prev/Next pagination** (`:425-449`) — stays **outside** the `DataTable`,
  untouched; the composite's own `enablePagination` must be `false` for this table (design.md: avoid
  two unsynchronized pagination controls on one dataset).
- FR-3 verdict (recon.md row 2): FAIL (cols, rows) — the single highest-risk migration in the inventory
  per recon's Recommended Scope.

**TDD**: `red-green required`

**Instructions**:
1. Define `columns: ColumnDef<Position>[]` for all 19 columns, each carrying its existing
   `meta.className` breakpoint class (`hidden sm:/md:/lg:table-cell` per column, `:311-327`) unchanged,
   preserving every cell's existing formatting helper (`fmtUsd`, `fmtSignedUsd`, `fmtPct`, `fmtR`,
   `pnlClass`, `weight(p)`, `openR(p)`, `EnumBadge`/`POSITION_RISK_FLAG`) and the Symbol `Link` +
   Trade-button cells' existing `stopPropagation` handlers unchanged (Codebase Evidence above).
2. Replace the `<Table>...</Table>` JSX (`:304-422`) with `<DataTable columns={columns}
   data={positions} onRowClick={(p) => setSelected(p)} enablePagination={false} />` — explicitly pass
   `enablePagination={false}` (or simply omit it, matching the composite's default) so no client
   pagination UI renders alongside the existing server-side Prev/Next block (`:425-449`, left
   unchanged, outside the `DataTable`).
3. Responsive strategy (FR-4): keep the existing (b) column-priority CSS 3-tier disclosure, carried
   through via `meta.className`, unchanged. Record disposition: **migrated to `DataTable`; responsive
   strategy (b) column priority (existing 3-tier `hidden sm:/md:/lg:table-cell` breakpoint set,
   feature 083, carried through unchanged); sorting + `onRowClick` (with new keyboard-activation
   support) enabled; client pagination explicitly disabled (existing server-side keyset pagination
   stays outside the composite)**.

**Verification**:
```
cd services/xstockstrat-ui && pnpm run lint
grep -n "DataTable\|onRowClick\|enablePagination" src/app/trader/positions/page.tsx
```

---

### Step 30 — test: verify the Exposure table migration preserves behavior + adds keyboard row-activation

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/trader/positions.spec.ts` — modify
- `services/xstockstrat-ui/e2e/trader/valuation-parity.spec.ts` — modify (if locators break)
- `services/xstockstrat-ui/e2e/trader/positions-reconciliation.spec.ts` — modify (if locators break)

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness, analytics display accuracy,
config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values
rendered in UI, no direct DB access (except audit log)

**Codebase Evidence**:
- `positions.spec.ts`/`valuation-parity.spec.ts`/`positions-reconciliation.spec.ts` — existing suites
  per `INVENTORY.md`, using `POSITION_AAPL` (`stopOrderId`/`takeProfitOrderId` set), `POSITION_MSFT`
  (both omitted, exercises the em-dash fallback), `POSITIONS`, `positionForSymbol` from
  `e2e/fixtures/positions.ts` (C-12) plus `BROKER_ACCOUNTS`' spread-override `halted`/`haltReason`/
  `haltSource` fields (feature 102).
- `mobile-overflow.spec.ts:21` already lists `{ path: '/trader/positions' }` — **no `ROUTES` change
  needed**; this route also has the existing server-side keyset pagination the migration must not
  disturb (Step 29).

**TDD**: `red-green required`

**Instructions**:
1. Re-run all three specs after Step 29. Fix any locator broken by the `DataTable` restructuring; all
   19 columns' rendered values, the click-opens-Sheet behavior, the Symbol-link and Trade-button
   stopPropagation exemptions, and the existing server-side Prev/Next pagination must all be unchanged
   (AC-5) — explicitly assert Prev/Next still works and that no second (client) pagination control
   appears.
2. Add a new keyboard-activation assertion: focus a position row via keyboard, press Enter/Space,
   assert the detail `Sheet` opens (mirroring the mouse-click assertion these specs already have) — this
   is new coverage for the intentional accessibility improvement (Step 29), write it to demonstrate the
   new capability, not a regression.
3. Add or confirm an assertion that pressing Enter/Space while focused on the Symbol link or Trade
   button does **not** also open the Sheet (the composite's `isInteractiveTarget` guard covering
   `keydown`) — this is the row-2-specific instance of the same class of bug Step 25/26 fixed and
   tested for `LiveStrategiesPanel`.

**Verification**:
```
cd services/xstockstrat-ui && pnpm run lint
cd services/xstockstrat-ui && pnpm exec playwright test e2e/trader/positions.spec.ts e2e/trader/valuation-parity.spec.ts e2e/trader/positions-reconciliation.spec.ts --project=chromium --no-deps
cd services/xstockstrat-ui && pnpm exec playwright test e2e/mobile-overflow.spec.ts --project=chromium --no-deps -g "trader/positions\$"
```

---

### Step 31 — service: migrate the nested-Sheet fill-lineage table (row 3) to `DataTable` (design exception)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/trader/positions/page.tsx` — modify

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness, analytics display accuracy,
config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values
rendered in UI, no direct DB access (except audit log)

**Codebase Evidence**:
- Confirmed via `Read`: `Table` at `positions/page.tsx:578` (inside the position-detail `Sheet`,
  `:460-610`), 3 columns (Order, Qty, Fill price), row count driven by `lineage.data` (order.filled
  ledger events for the selected position, `usePositionLineage`) — not provably ≤10, dynamic.
- **Design-level exception (design.md, not a literal FR-3 exemption)**: fails FR-3's literal "bounded
  ≤10 rows" test, but a full sort/filter/pagination composite is disproportionate to a single-position
  drill-down list inside an already-narrow `Sheet`. Disposition: migrates to the composite for
  markup/behavior consistency, with pagination, filtering, and column-visibility all left off (sort
  baseline only), and a **stacked** responsive treatment given the nested-`Sheet` context — record this
  as its own explicit line in the disposition table, distinct from both "migrated (standard)" and a
  literal FR-3 exemption.

**TDD**: `red-green required`

**Instructions**:
1. Define `columns: ColumnDef<LineageEntry>[]` for Order (`String(p.order_id ?? '—')`), Qty
   (`String(p.qty ?? '—')`), and Fill price (`fmtUsd(Number(p.fill_price ?? 0))`), each carrying the
   existing `text-xs` styling via `meta.className`.
2. Replace the `<Table>...</Table>` JSX (`:578-604`) with `<DataTable columns={columns}
   data={lineage.data ?? []} enablePagination={false} />`. Sorting only, no pagination, no filter, no
   column-visibility toggle (design exception).
3. Responsive strategy (FR-4c, stacked layout): since the `Sheet` panel is already narrow by
   construction (mobile: full-width; desktop: a fixed side-panel width, per `sheet.tsx`'s existing
   sizing), and this table has only 3 short numeric/id columns, apply a `meta.className` on each column
   that switches from the default row layout to a stacked (definition-list-like) presentation below a
   breakpoint if the 3 columns do not already fit the `Sheet`'s narrowest width without truncation —
   verify visually (or via a Playwright screenshot/bounding-box check in Step 32) whether the existing
   `Sheet` width at 390px actually requires this; if the 3 short columns already fit without truncation
   at the narrowest tested `Sheet` width, the disposition may record "stacked layout evaluated, not
   needed in practice — 3 short columns already fit the Sheet's minimum width" instead of forcing an
   unnecessary CSS change. Record whichever outcome is actually verified, not assumed.

**Verification**:
```
cd services/xstockstrat-ui && pnpm run lint
grep -n "DataTable" src/app/trader/positions/page.tsx
```

---

### Step 32 — test: bespoke Sheet-interaction overflow test for the fill-lineage table (row 3)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/trader/positions.spec.ts` — modify (add a Sheet-open-then-measure
  overflow assertion; `mobile-overflow.spec.ts` itself is not touched — see Codebase Evidence)

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness, analytics display accuracy,
config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values
rendered in UI, no direct DB access (except audit log)

**Codebase Evidence**:
- Confirmed via `Read services/xstockstrat-ui/e2e/mobile-overflow.spec.ts`: the generic sweep's
  `horizontalOverflow` helper (`:36-40`) runs immediately after `page.goto` + a network-idle wait — it
  never clicks anything, so it structurally cannot open the position-detail `Sheet` this table lives
  inside (design.md's explicit call-out: "FR-5's automated no-overflow check for row 3 needs bespoke
  interaction-triggering test code"). This step's test therefore lives beside the existing
  `positions.spec.ts` row-click-opens-Sheet assertions, not in `mobile-overflow.spec.ts`.
- No existing spec asserts the fill-lineage table's content today (confirmed via grep — "lineage" has
  zero matches anywhere under `e2e/`) — this is genuinely new coverage, not a preserved-behavior check.

**TDD**: `red-green required`

**Instructions**:
1. In `positions.spec.ts` (or a new `positions-lineage-overflow` test block within it), at the 390px
   phone-frame viewport (`test.use({ viewport: { width: 390, height: 844 } })`, matching
   `mobile-overflow.spec.ts:10`'s convention): navigate to `/trader/positions`, click a position row to
   open the detail `Sheet`, wait for the "Fill lineage" section to render (`lineage.data.length > 0`
   fixture data required — extend the lineage mock/fixture if the current one returns zero rows), then
   assert `document.documentElement.scrollWidth - document.documentElement.clientWidth <= 1` — the same
   assertion shape as `mobile-overflow.spec.ts:36-40,53-57`, applied after the interaction the generic
   sweep cannot perform.
2. Write this test to fail first if Step 31's stacked-layout decision (if applied) is skipped or wrong
   — i.e. construct the lineage fixture with a case where the 3 columns' content is wide enough to
   plausibly overflow the Sheet at 390px (e.g. a long `order_id`), so the test has real teeth rather than
   passing vacuously on short/empty content.

**Verification**:
```
cd services/xstockstrat-ui && pnpm run lint
cd services/xstockstrat-ui && pnpm exec playwright test e2e/trader/positions.spec.ts --project=chromium --no-deps -g "lineage"
```

---

### Step 33 — test: full `xstockstrat-ui` regression sweep (AC-6)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- None (verification-only step; no files modified unless the full-suite run surfaces a cross-step
  regression, in which case the fix lands in the offending step's already-listed files per F-08/F-09
  and is recorded in the Deviation Log, not as a new untracked file here)

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness, analytics display accuracy,
config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values
rendered in UI, no direct DB access (except audit log)

**Codebase Evidence**:
- Product-spec AC-6: "Full `xstockstrat-ui` Playwright + Vitest suites pass (exit code 0) after
  migration." AC-2: "zero files under `services/xstockstrat-ui/src` import `@tanstack/react-table`
  directly outside that one composite and its own test file" — mechanically checkable via grep.
- `services/xstockstrat-ui/CLAUDE.md` § Testing: `pnpm run test:unit` / `pnpm run test:coverage`
  (vitest), `pnpm test:e2e` (Playwright, full suite). CI runs chromium only, sharded — this step runs
  the full local equivalent.

**TDD**: `N/A (verification-only step, no new code)`

**Instructions**:
1. Run the full Vitest unit suite and confirm the `src/lib/**` coverage threshold (40% lines/functions/
   statements, `vitest.config.ts:34-38`) still passes — the new `data-table.test.ts` (Step 2) is outside
   the coverage-scoped `src/lib/**` path and does not affect this gate either way.
2. Run the full Playwright e2e suite (all specs, not just the ones touched per-step) — this is the
   AC-6 gate and also the concrete check for the ledger `fails.md` 2026-08-09 `shadcn-migration-high-
   confidence` lesson (a shared-primitive collision surfacing only on an *unrelated* spec, caught only
   by a broader run, not a single step's narrowly-scoped `-g` run).
3. Run the AC-2 mechanical check: confirm the only two files importing `@tanstack/react-table` are
   `src/components/ui/data-table.tsx` and `src/components/ui/data-table.test.ts`.
4. Confirm every one of the 15 FR-1 inventory entries has an explicit recorded disposition across Steps
   3–32 (AC-3) — cross-check against the inventory table in `recon.md`'s "Full Table Inventory" section;
   every row must map to exactly one step pair above.
5. Confirm every one of the 15 tables' route is covered by `mobile-overflow.spec.ts` `ROUTES` (14
   pre-existing + the bare `/trader` addition from Step 25) or, for row 3, the bespoke Sheet-interaction
   test from Step 32 (AC-4) — zero migrated routes absent without a documented reason.

**Verification**:
```
cd services/xstockstrat-ui && pnpm run lint
cd services/xstockstrat-ui && pnpm run test:coverage
cd services/xstockstrat-ui && pnpm test:e2e
grep -rln "@tanstack/react-table" src/ | sort
# expect exactly: src/components/ui/data-table.test.ts, src/components/ui/data-table.tsx
```

---

## Re-spec Log

_Populated by /sdd-execute's sequential-mode re-spec gate (§5.3) before the step loop begins — the
sole sanctioned edit to step bodies outside step-status flips._

### 2026-08-16 — Steps 21–22 re-spec'd (feature 125 merged ahead of execution)

Between `/sdd-spec` (2026-08-15) and this execution session, **feature 125** ("unified Symbol page")
merged into `main-dev` and rewrote `services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx`
(795-line diff) — the exact file Steps 21–22 target. Three parallel `codebase-discovery` recon agents
re-verified all 15 table sites' Codebase Evidence against the post-125 codebase:

- **13 of 15 sites (Steps 1–20, 23–32) held with no re-spec needed** — either exact-line CONFIRMED or a
  trivial line-number drift with unchanged structure (e.g. `/config-ui/sources` Table moved 299→330 due
  to an unrelated feature 134 change; `/insights/screener` Table moved 543→480). Phase 1 Discovery's own
  fresh `Read` of each target file (HARD CONSTRAINT: "read each target file fully before editing")
  resolves these without a spec edit — the step bodies' *structural* claims (column sets, cell logic,
  test fixtures) all still hold.
- **Steps 21–22 (row 4, `/trader/positions/[symbol]` orders sub-table) needed a real re-spec**: feature
  125 hoisted the table into a new standalone `SymbolOrdersCard` component (`page.tsx:391-465`), now
  invoked unconditionally for every symbol (not just held positions). The table's own content (8
  columns, cell renderers, the dead `cursor-pointer` class) is byte-identical in substance — only its
  structural home moved. Re-spec'd both steps' Codebase Evidence and Instructions to the new line
  numbers/component context; the migration approach itself (define `ColumnDef`s, replace `<Table>` with
  `<DataTable>`, no `onRowClick`, carry `cursor-pointer` forward) is unchanged. Step 22 additionally
  corrected: `position-detail.spec.ts` grew from a narrow orders-table spec to a 351-line, 5-test
  unified-page suite (feature 125's own tests) — re-pointed its evidence at the two tests that actually
  assert `SymbolOrdersCard`'s rendering (`:40`, `:82`) and added an explicit out-of-scope note so this
  step doesn't balloon into covering feature 125's other sections.
- Also noted, not re-spec'd (pre-existing, unrelated to feature 125): Step 6's evidence cites a third
  `/SetConfig` wait at `value-persists-after-save.spec.ts:95` that doesn't exist (file is 84 lines, only
  2 waits at `:43,73`) — a citation inaccuracy predating this session. Does not block Step 6 (its
  Instructions don't depend on that specific line). Left as-is per "targeted, minimal" re-spec scope;
  Phase 1 discovery will simply not find a third assertion to preserve, which is not a blocker.

Full agent findings recorded in `context.md` § Session 2026-08-16.

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

### Deviation: Step 9 — migrate `/insights/screener` results table to `DataTable`
**Spec said**: "pass through a `rowClassName`/row-props mechanism, or extend `DataTableProps` with an
optional `getRowProps?: (row: TData) => React.HTMLAttributes<HTMLTableRowElement>` if the composite
doesn't already support per-row `data-testid` — confirm against Step 1's actual shipped API and note
any composite extension needed here."
**Actual**: Step 1's shipped composite did not support per-row or root-table `data-testid` passthrough.
Per the `/sdd-review impl-spec` unresolved warning (Steps 9/13/23 all anticipated this same gap) and a
sequential-mode blocker (`AskUserQuestion`, user selected the recommended "fix now" option), extended
`services/xstockstrat-ui/src/components/ui/data-table.tsx` (outside Step 9's original `**Files**`
section) with two new optional `DataTableProps` fields: `tableTestId?: string` (rendered as
`data-testid` on the root `<Table>`) and `getRowProps?: (row: TData) =>
React.HTMLAttributes<HTMLTableRowElement>` (spread onto each `<TableRow>`, merged after
`rowClassName`). Used both in Step 9 (`tableTestId="screen-results"`,
`getRowProps={() => ({ 'data-testid': 'result-row', className: 'border-b' })}`).
**Reason**: A composite extension needed by 3 separate steps (9, 13, 23) is a one-time, narrow,
mechanical addition — not a design fork — so fixing it once now (rather than deferring or dropping the
testids) avoids re-deciding the same gap twice more and avoids rewriting existing e2e locators that
depend on these testids. **Side effect**: Step 9's own `**Verification**` grep
(`grep -n 'data-testid="screen-results"\|data-testid="result-row"'`) no longer matches literal source
text, since both testids are now indirected through composite props rather than hardcoded JSX
attributes — the actual rendered DOM still carries both attributes (confirmed via
`e2e/insights/screener.spec.ts`'s `getByTestId('screen-results'|'result-row')` assertions, all passing).
**Disposition**: composite extension, staged under Step 9 (`data-table.tsx` added to its effective file
set) with this Deviation Log entry as the F-08 exception record.
