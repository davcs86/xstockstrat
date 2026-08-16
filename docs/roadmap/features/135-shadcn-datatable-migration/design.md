# Design: shadcn-datatable-migration

**Created**: 2026-08-15
**Rounds**: 5 (full debate — user opted past quick mode's 1-round minimum; termination: approved)
**Approved by**: user @ 2026-08-15
**Grounded in**: recon.md

---

## Chosen Approach

Build one shared `ui/data-table.tsx` composite under the existing shadcn alias
(`services/xstockstrat-ui/components.json`, `"ui": "@/components/ui"`, style `radix-rhea` —
`recon.md:26-28`), wrapping `@tanstack/react-table`'s headless table state around the existing
pure-styling `Table`/`TableHeader`/`TableBody`/`TableRow`/`TableHead`/`TableCell` primitives
(`services/xstockstrat-ui/src/components/ui/table.tsx:1-89`). The primitive's own
`<div data-slot="table-container" class="relative w-full overflow-x-auto">` wrapper (`table.tsx:8-16`)
is reused as-is — no new scroll container is written. The composite is column-def-driven per the
shadcn reference shape, ships sorting and pagination as baseline capabilities (product-spec FR-2),
and exposes per-table opt-in props for filtering, column-visibility, and pagination so a small
static table doesn't inherit chrome it doesn't need (product-spec FR-3).

**Consumer surface (C-14):** reaches the user through all four `xstockstrat-ui` segments —
`/trader`, `/insights`, `/config-ui`, `/accounts` — as an in-place upgrade to 15 already-reachable
routes; no new routes, no Agent tool surface. Every migrated table's sort/filter/pagination/
responsiveness improvement is directly visible to the trader/analyst using that route.

**Row-click interaction safety (composite build, step 1).** The composite exposes a raw
`onRowClick?: (row: TData) => void` prop applied at the `TableRow` level, used at 4 of the 15 sites
(row 2's Sheet-open, row 6's strategy-detail toggle, row 10's Past-Runs selection, row 11's
formula-navigate). To prevent a click/keydown on a nested interactive element (an Actions-column
`DropdownMenu` trigger, a link cell) from double-firing the row handler, a small exported helper,
`isInteractiveTarget(target)`, walks up via `.closest(...)` checking four selectors in order: native
`<a>`, native `<button>`, `[role="button"]`, and the escape-hatch attribute
`[data-row-click-ignore]`. The same guard runs in **both** the row's `onClick` and `onKeyDown`
(Enter/Space) handlers — an earlier round's fix that only guarded `click` was found to still
double-fire on keyboard activation (verified concretely against `LiveStrategiesPanel.tsx`'s
Enable/Disable button). The parameter is typed as a minimal duck-typed interface —
`{ closest(selectors: string): Element | null }` — instead of the full DOM `Element`/`EventTarget`
type, so the guard (and a co-located unit test, `ui/data-table.test.ts`, same pattern as
`ui/button.test.ts`) run under the existing node-environment Vitest config
(`vitest.config.ts:18-19`) with no jsdom dependency. The test asserts all four `isInteractiveTarget`
branches using plain object literals. Row 2 currently has no keyboard row-activation at all
(mouse-only `onClick`); the composite adding it is an intentional, recorded accessibility
improvement, not scope creep.

Responsive column handling is CSS-only: column defs carry a `meta.className` (e.g.
`"hidden md:table-cell"`) forwarded straight into `TableHead`/`TableCell`'s existing
`cn(className, ...)`-driven `className` prop (`table.tsx:56-67, 69-77`) — no JS breakpoint hook, no
hydration-dependent visibility state. Row 2 (the Exposure table, confirmed **19** columns —
recon.md's original 18-count missed the `sr-only`-labeled but visibly-rendered "Trade" column)
carries through its already-existing 3-tier `hidden sm:/md:/lg:table-cell` breakpoint classes
(`positions/page.tsx:311-327`, established by feature 083) unchanged via this mechanism; its
existing server-side keyset Prev/Next pagination stays outside the composite untouched, and the
composite's own client pagination is disabled for this table (sort-only) to avoid two
unsynchronized pagination controls on one dataset. Row-actions cells reuse feature 124's
`DropdownMenu` (+ `AlertDialog` for destructive actions) pattern already established at 6 of the 15
sites (`recon.md:79-82`) as the composite's Actions-column cell renderer; row 13
(`NamespaceEditor.tsx`) is recorded as a distinct "stateful/conditional cell content" pattern (its
Value **and** Actions cells both swap on shared local edit state) rather than a plain
DropdownMenu-cell instance — supportable by a TanStack `cell` renderer with no composite
architecture change, but scoped as its own case at `/sdd-spec` time.

Row 3 (`positions/page.tsx:578`, the 3-column nested-Sheet fill-lineage table) is granted a
**design-level exception**: although it fails FR-3's literal "bounded ≤10 rows" test, a full
sort/filter/pagination composite is disproportionate to a single-position drill-down list — it
migrates to the composite for markup/behavior consistency but with pagination, filtering, and
column-visibility all left off (sort baseline only, stacked-card layout given the nested-`Sheet`
context), and this disposition is recorded explicitly in `implementation-spec.md` (its own line,
distinct from "migrated" and from a literal FR-3 exemption) rather than silently exempted. FR-5's
automated no-overflow check for row 3 needs bespoke interaction-triggering test code (open the Sheet,
then measure) as an explicit `/trader`-step addition — the generic `mobile-overflow.spec.ts` sweep
(`page.goto → measure`, never clicks) cannot reach it.

`src/components/insights/BacktestDiagnostics.tsx` is explicitly excluded from the inventory: it
renders no `<table>` element and imports no `Table` primitive (a hand-rolled
`@tanstack/react-virtual` grid), placing it outside FR-1's literal scope per product-spec's own Out
of Scope clause.

Row 5's (`OrdersTable.tsx`) live-merged data array (`merged = orders.map(...)`, computed inline
every render) must be wrapped in `useMemo` before becoming the composite's `data` prop — TanStack
Table requires a stable data reference or internal row-model state can reset unexpectedly on every
unrelated re-render (this codebase has a near-identical TanStack-adjacent identity bug already on
record, ledger `fails.md` 2026-08-08). Documented as a requirement in the composite's own doc
comment, applying to all 15 call sites, not just row 5.

Migration proceeds per recon's Recommended Scope: composite build (step 1, includes `onRowClick` +
`isInteractiveTarget` + its unit test + the memoization doc-comment from the start, since row 10 in
step 3 needs `onRowClick` before row 2/6 in step 5) → `/config-ui` (step 2, rows 12–14) → `/insights`
(step 3, rows 8–11) → `/accounts` (step 4, row 15) → `/trader` (step 5, rows 1, 2, 4–7, with row 2
isolated as its own sub-step given its 19-column risk profile) → row 3 resolution → full regression
sweep (AC-6). `mobile-overflow.spec.ts` `ROUTES` additions + FR-5 assertions fold into each
per-segment step as its tables migrate — including the currently-uncovered bare `/trader` dashboard
route (rows 6–7 render there) — except row 3's bespoke Sheet-interaction test, called out explicitly.

## Rejected Alternatives

- **JS `useIsMobile()`-driven column visibility** — rejected in favor of CSS `meta.className`
  carry-through: a `matchMedia`-based hook introduces post-hydration visibility flicker and would
  collapse row 2's existing working 3-tier breakpoint disclosure into a single binary threshold,
  regressing behavior the codebase already has for free via Tailwind's own responsive classes.
- **Pagination always-on for every migrated table** — rejected in favor of per-table opt-in: FR-3
  explicitly requires justifying chrome by measured row/column counts ("a 5-row static table does
  not need pagination controls"); always-on also directly conflicted with row 2's existing working
  server-side keyset pagination (two unsynchronized pagination controls on one table).
- **Actions-cell-scoped `stopPropagation()`** (each Actions-column renderer manually calling
  `e.stopPropagation()` on click) — rejected in favor of a row-level `isInteractiveTarget` guard
  covering both `click` and `keydown`: per-cell guards must be re-applied at every Actions-column
  site, silently miss any non-Actions interactive cell (row 2's Symbol link, Trade button — neither
  is an Actions column), and (as originally scoped) only guarded the click path, missing keyboard
  double-fire entirely.
- **TanStack's built-in row-selection API** for row-click behavior — rejected in favor of a raw
  `onRowClick` prop: the inventory's actual row-interaction needs (row 3's Sheet drill-down, row
  10's single-row selection) are navigation/selection-of-one, not multi-select; wiring TanStack's
  selection state and a checkbox column would be unused scaffolding the task didn't ask for.
- **Auto-tagging the composite's own Actions-cell renderer** with a dedicated marker attribute —
  rejected: the Actions-column trigger is already a real `<button>` (feature 124's
  `DropdownMenuTrigger`), so the native `<button>` branch of `isInteractiveTarget` already covers it
  without a composite-specific special case; `data-row-click-ignore` is reserved for genuinely
  non-semantic future cell content the composite can't predict (e.g. a bare `<div onClick>`).

## Open Risks

- [ ] Row 3's design-level exception must be recorded as its own explicit disposition line in
  `implementation-spec.md` — distinct from both "migrated (standard)" and a literal FR-3 exemption —
  to be addressed at the `/trader` step (step 5/row-3-resolution).
- [ ] Rows 6–7's pagination default (sort-only, opt-out) is unconfirmed against real data volumes —
  `OrderBook.tsx` already runs `pageSize 50` but `LiveStrategiesPanel.tsx` is unbounded with no
  existing cap; `/sdd-spec` confirms the composite's default behavior for these two, escalating to
  pagination opt-in only if a measured count clearly exceeds ~50 — to be addressed at `/sdd-spec`
  time / the `/trader` step.
- [ ] Rows 4 (`positions/[symbol]/page.tsx:363`) and 7 (`OrderBook.tsx:41`) carry dead
  `cursor-pointer` CSS on their `TableRow` with no click handler wired anywhere today — `/sdd-spec`
  records for each whether the migration carries the stray class forward unchanged (default
  recommendation, matches current visual state) or drops it as unrelated cleanup — to be addressed
  at the `/trader` step.
- [ ] `mobile-overflow.spec.ts` does not yet cover the bare `/trader` dashboard route (rows 6–7
  render there) — the `ROUTES` extension must add this route explicitly, not just routes that
  already have entries — to be addressed at the `/trader` step (FR-5).
- [ ] Fixture coverage per C-12/C-13 — recon names reuse of existing per-table fixtures as the
  intended path but does not confirm every one of the 15 sites has a fixture adequate for the new
  sort/paginate/filter assertions the composite introduces (vs. only the pre-migration static-render
  assertions those fixtures were built for) — `/sdd-spec`/`/sdd-execute` checks each site's fixture
  against its new interaction surface and logs any net-new fixture in `INVENTORY.md` rather than
  adding inline literals — to be addressed per-step as each table migrates.
- [ ] AC-2's single-import-site constraint ("zero files import `@tanstack/react-table` directly
  outside that one composite and its own test file") has no automated CI enforcement named yet —
  worth a grep-based check or an ESLint `no-restricted-imports` rule at implementation time — to be
  addressed at the composite-build step (step 1).

## Constitution Rules Touched

- `C-01` — honored: every architectural claim across all 5 rounds is cited to `recon.md path:line`
  evidence, re-verified against live source at each round (e.g. the row-2 18→19 column recount, the
  row-4/row-7 dead-`cursor-pointer` discovery), never asserted from memory.
- `C-10` — honored: all 15 table sites across all 4 segments were inventoried exhaustively and each
  given an explicit disposition (migrate-standard / migrate-with-design-exception / excluded); no
  shared pattern (the `onRowClick` interaction) was left partially applied — the design corrected
  itself twice (2 sites → 4 sites) specifically to satisfy this.
- `C-12`/`C-13` — honored via the "Patterns to REUSE" fixture-reuse plan; **flagged as an Open Risk**
  pending per-site verification, not assumed clean.
- `C-14` — honored: consumer surface named explicitly (all 4 UI segments, no Agent tool involved,
  no new routes) in both `product-spec.md` and this design's Chosen Approach.
- `P-01` — honored: this skill (orchestrator) is the sole writer of `recon.md`/`design.md`/
  `feature.md`/`context.md`; all `design-proposer`/`design-adversary` subagents were read-only and
  advisory only.
- `P-02` — honored: proposer and adversary never exchanged raw output directly across all 5 rounds —
  the orchestrator synthesized each round's findings before passing state to the next agent.
- `P-03` — honored: two genuine gaps (the incomplete `onRowClick` site count; the click-only
  stopPropagation guard missing `keydown`) were surfaced and fixed explicitly across rounds, never
  silently patched over; `BacktestDiagnostics.tsx`'s exclusion and row 3's exception are both
  recorded, not silent.
- `P-04` — honored: the user was gated via `AskUserQuestion` after every round (1 through 5) before
  any further round or the final approval.
- `F-04` — honored: no path, symbol, or line was invented — the "Not found" items from recon
  (no raw `<table>`, no existing table library) carried forward unmodified; every new claim was
  independently re-verified against live source before being trusted (rounds 3–5).
- `F-11` — honored: zero Floor breaches were found or flagged by the adversary across all 5 rounds;
  nothing required a phase halt.
