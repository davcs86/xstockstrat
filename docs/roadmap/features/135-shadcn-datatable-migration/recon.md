# Recon: shadcn-datatable-migration

**Created**: 2026-08-15
**From**: product-spec.md
**Affected services**: `xstockstrat-ui` (all four segments: `/trader`, `/insights`, `/config-ui`, `/accounts`)

---

## Objective

Migrate every table-rendering site in `xstockstrat-ui` — currently 100% on the shadcn `Table`
styling primitive, 0% on any sort/filter/pagination-capable pattern — onto one shared
`@tanstack/react-table`-backed `DataTable` composite, and give each migrated table an explicit,
recorded horizontal-responsiveness strategy, closing the gap that already shipped one overflow
regression (`fails.md`, 2026-08-06).

## Codebase Map

- **`xstockstrat-ui`** (Next.js 15 / TypeScript)
  - Table styling primitive: `services/xstockstrat-ui/src/components/ui/table.tsx:1-89` — pure
    styling (`Table`/`TableHeader`/`TableBody`/`TableFooter`/`TableRow`/`TableHead`/`TableCell`/
    `TableCaption`); self-wraps in `<div data-slot="table-container" class="relative w-full
    overflow-x-auto">` at `:8-16` — every table already gets a working horizontal-scroll fallback
    today, so FR-4's job is a DataTable-*pattern* upgrade (sort/filter/pagination/column-priority),
    not bolting on scroll containers that don't exist.
  - shadcn CLI config: `services/xstockstrat-ui/components.json` — `"aliases": {"ui":
    "@/components/ui", ...}`, style `radix-rhea`. No existing `data-table` entry — a new
    `ui/data-table.tsx` installs under the existing `ui` alias with no config changes.
  - E2E overflow guard: `services/xstockstrat-ui/e2e/mobile-overflow.spec.ts` (94 lines) — a static
    `ROUTES: {path, admin?}[]` array (`:12-34`) driving a generic, route-agnostic
    `scrollWidth - clientWidth <= 1` assertion at 390px (`:42-59`), plus a separate hard-coded
    1280px block currently scoped only to `/trader/orders` (`:78-93`). **Needs no code change** to
    cover new `DataTable` components — only `ROUTES` data additions for any route not already
    listed.
  - Package manifest: `services/xstockstrat-ui/package.json:21-58` — has `@tanstack/react-query`
    (`:38`) and `@tanstack/react-virtual` (`:39`); **no `@tanstack/react-table`** anywhere in the
    monorepo (repo-wide grep confirmed zero hits outside this feature's own docs).

## Full Table Inventory (FR-1) — 15 sites, all four segments

Every entry below was measured against FR-3's fixed exemption threshold (stays on plain `Table`
only if **all three**: row count static/bounded ≤10 AND column count ≤4 AND read-only).
**Result: all 15 fail the threshold** — every table in the inventory is a `DataTable` migration
candidate; see Risks below for what this implies.

| # | File | Segment | Cols | Rows | Existing mutation/actions | FR-3 verdict | Feature 124 touch |
|---|---|---|---|---|---|---|---|
| 1 | `src/app/trader/portfolio/page.tsx:155` | `/trader` | 7 | dynamic, unbounded | none | FAIL (cols) | not touched |
| 2 | `src/app/trader/positions/page.tsx:304` | `/trader` | 18 | dynamic, keyset-paginated + client filters | none in-table | FAIL (cols, rows) | not touched |
| 3 | `src/app/trader/positions/page.tsx:578` (Sheet fill-lineage) | `/trader` | 3 | dynamic, not provably ≤10 | none | borderline/FAIL (rows) | not touched |
| 4 | `src/app/trader/positions/[symbol]/page.tsx:348` | `/trader` | 8 | dynamic | none in-table | FAIL (cols) | overflow audit only (SAFE-BY-DESIGN, ancestor `min-w-0`) |
| 5 | `src/components/trader/OrdersTable.tsx:79` (at `/trader/orders`) | `/trader` | 10 | dynamic, pageSize 50 + live updates | Edit/Cancel `DropdownMenu` | FAIL (cols, rows) | Actions→`DropdownMenu`; page ancestor got `min-w-0` |
| 6 | `src/components/trader/LiveStrategiesPanel.tsx:36` (at `/trader` root) | `/trader` | 3–4 | dynamic, unbounded | admin Enable/Disable | FAIL (rows, not read-only when admin) | keyboard-activation added |
| 7 | `src/components/trader/OrderBook.tsx:28` (at `/trader` root) | `/trader` | 6 | dynamic, pageSize 50 | none | FAIL (cols) | not touched |
| 8 | `src/app/insights/screener/page.tsx:543` | `/insights` | 10 | dynamic, unbounded | none | FAIL (cols, rows) | overflow audit only (SAFE) |
| 9 | `src/app/insights/strategies/page.tsx:124` | `/insights` | 9 | dynamic, unbounded | Edit/Deactivate `DropdownMenu`+`AlertDialog` | FAIL (cols, rows) | Actions→`DropdownMenu`; overflow audit SAFE |
| 10 | `src/app/insights/strategies/[id]/page.tsx:481` (Past Runs) | `/insights` | 7 | dynamic, unbounded | row selection (not mutation) | FAIL (cols) | overflow audit SAFE-BY-DESIGN |
| 11 | `src/app/insights/formulas/page.tsx:104` | `/insights` | 4 | dynamic, pageSize 50 | none | FAIL (rows — cols at boundary) | keyboard-activation; overflow audit SAFE |
| 12 | `src/app/config-ui/sources/page.tsx:299` | `/config-ui` | 8 | dynamic, unbounded | Edit/Disable/Enable `DropdownMenu` | FAIL (cols, rows, not read-only) | Actions→`DropdownMenu` |
| 13 | `src/app/config-ui/[namespace]/NamespaceEditor.tsx:166` | `/config-ui` | 4 | dynamic, per-namespace | inline Edit/Save `DropdownMenu` | FAIL (rows, not read-only) | Actions→`DropdownMenu` |
| 14 | `src/app/config-ui/audit/page.tsx:32` | `/config-ui` | 7 | dynamic, server `LIMIT 50` | none (read-only) | FAIL (cols, rows) | not touched |
| 15 | `src/app/accounts/authorized-apps/page.tsx:134` | `/accounts` | 5 | dynamic | Revoke `AlertDialog` | FAIL (cols, not read-only) | not touched |

**Related but explicitly out of literal scope**: `src/components/insights/BacktestDiagnostics.tsx`
(rendered inside strategies/[id]/page.tsx) is a hand-rolled `div`-grid using
`@tanstack/react-virtual` (not `@tanstack/react-table`, not the shadcn `Table` primitive, no raw
`<table>`), already has its own `overflow-auto` container. Per product-spec's own Out of Scope
("Non-tabular list/card UI... FR-1's inventory is scoped to actual table implementations only"),
this does not meet FR-1's literal definition (no `<table>` element, no `Table` primitive import)
— flagged for the grilling round to confirm exclusion explicitly rather than have it silently
fall through FR-1's grep-based inventory.

## Patterns to REUSE

- **Table styling/overflow wrapper** → reuse `services/xstockstrat-ui/src/components/ui/table.tsx`
  (`Table`/`TableHeader`/`TableBody`/`TableRow`/`TableHead`/`TableCell`) as the DataTable
  composite's rendering layer — do not re-style; the new `ui/data-table.tsx` wraps this primitive
  with `@tanstack/react-table`'s headless table state, per shadcn's own documented pattern.
- **Row actions cell** → reuse the `DropdownMenu` (+ `AlertDialog` for destructive actions) pattern
  feature 124 already established at 6 of the 15 sites (`OrdersTable.tsx`, `strategies/page.tsx`,
  `sources/page.tsx`, `NamespaceEditor.tsx`) as the DataTable's Actions-column cell renderer —
  don't re-derive a different actions UI.
- **Ancestor overflow safety** → reuse feature 124's per-page `min-w-0` audit result
  (`docs/roadmap/features/124-shadcn-table-actions-responsive/context.md:659-694`) as a starting
  classification (SAFE vs needs-`min-w-0`) rather than re-auditing every flex/grid ancestor from
  scratch; re-verify only for the tables 124 didn't cover (rows 1, 2, 3, 6, 7, 14, 15 above).
- **Route-driven overflow assertion** → extend
  `services/xstockstrat-ui/e2e/mobile-overflow.spec.ts`'s existing `ROUTES` array (data-only
  change) rather than writing a new spec file (FR-5; ledger `fails.md` 2026-08-06 known trap).
- **shadcn component install path** → `npx shadcn@latest add data-table` (or hand-author following
  the shadcn docs reference) lands under the existing `ui` alias per `components.json` — no config
  changes needed.
- **Test-data inventory (C-12)** — any new/updated Playwright fixtures for migrated tables belong
  in `services/xstockstrat-ui/e2e/fixtures/` per the existing `INVENTORY.md` catalog convention;
  reuse existing per-table fixtures already backing rows 1–15 above (e.g. orders/positions fixtures
  already exist and back `e2e/trader/{orders,positions,portfolio}.spec.ts`) rather than declaring
  new inline literals.

## Dependencies

- Proto/RPC: none — this is a client-side presentation-only feature (per product-spec Out of Scope).
- Migration: none.
- Config keys: none.
- Inter-service edges: none new — DataTable operates on data already fetched by existing hooks
  (`useOrders`, `usePositions`, `useSignalSources`, `useAuditLog`, etc.).
- New frontend dependency: **`@tanstack/react-table`** — not currently installed anywhere in the
  monorepo; add to `services/xstockstrat-ui/package.json`. No new env vars, no new ports.

## Risks / Not-found

- **All 15 inventory entries fail the FR-3 exemption threshold.** The threshold (≤10 rows AND ≤4
  cols AND read-only) may end up applying to **zero** tables in this feature — worth confirming at
  the grilling round whether that's intended (product spec's user story does say "migrate every
  table") or whether the threshold should be revisited for genuinely small cases like row 3 (the
  3-column, single-position fill-lineage table nested in a `Sheet` drill-down) where a full
  `DataTable`'s sort/filter/pagination chrome may be visual overkill relative to its actual use.
- **Feature 124 baseline, not a redo.** 6 of 15 sites already had their Actions column converted to
  `DropdownMenu` and/or were overflow-audited by feature 124 (`code-completed`) — recon confirms
  the *current* (post-124) state above; do not re-derive from a pre-124 mental model (per the
  overlap scan already recorded in `context.md`).
- **Feature 125 (`unified-symbol-page`, `implementation-ready`, not yet executed)** may redirect
  `/insights/market/[symbol]`, but that route has no table today — confirmed zero overlap with this
  feature's inventory, no coordination needed unless 125's scope changes.
- **`mobile-overflow.spec.ts` does not cover the bare `/trader` dashboard route** — `OrderBook.tsx`
  and `LiveStrategiesPanel.tsx` (rows 6–7) render there and have never been exercised by the phone-
  frame or 1024px sweeps, only by their own feature specs. FR-5 will need this route added to
  `ROUTES`, not just the routes that already have entries.
- **`BacktestDiagnostics.tsx`** (see inventory table above) — a table-like virtualized grid outside
  FR-1's literal `<table>`/`Table`-primitive definition. Recommend explicit exclusion recorded in
  `design.md` rather than a silent gap.
- **Not found**: no raw HTML `<table>` element anywhere in `services/xstockstrat-ui/src` (100% of
  table rendering already goes through the shadcn `Table` primitive) — confirmed by all three
  segment discovery passes plus a whole-`src/` grep; no other table/grid library (`ag-grid`,
  `react-data-grid`, etc.) exists anywhere in the monorepo.

## Recommended Scope

Advisory step ordering for `/sdd-spec` (not binding):

1. Add `@tanstack/react-table` dependency; build the shared `ui/data-table.tsx` composite
   (sort + pagination baseline, column-def-driven, reusing the `Table` primitive + `DropdownMenu`
   actions-cell pattern) with its own unit test.
2. Migrate the `/config-ui` tables (rows 12–14) — smallest blast radius, 2 of 3 already
   Actions-converted by feature 124.
3. Migrate the `/insights` tables (rows 8–11) — 3 of 4 already overflow-audited SAFE by feature 124.
4. Migrate `/accounts` (row 15) — single small table, isolated segment.
5. Migrate the `/trader` tables (rows 1, 2, 4–7) — largest surface; row 2 (18-column Exposure
   table) is the single highest-risk migration in the inventory and may warrant its own step.
6. Resolve row 3 (nested Sheet fill-lineage table) per the grilling round's decision on whether it
   qualifies for a design-level exception rather than the FR-3 exemption as literally written.
7. Extend `mobile-overflow.spec.ts` `ROUTES` for every migrated route not already listed (notably
   the bare `/trader` dashboard) and verify FR-5's no-overflow assertion at 390px (and 1024px where
   feature 124 already established that check) for every migrated table.
8. Full `xstockstrat-ui` Playwright + Vitest regression sweep (AC-6).

Given the size (15 tables across 4 segments), `/sdd-spec` should expect this to span more steps
than the `feature-workflow.md` sequential-mode 5-step checkpoint cap comfortably covers — plan for
multiple checkpoint pauses, not a single sequential run.
