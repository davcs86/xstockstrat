# Implementation Spec: shadcn-table-actions-responsive

**Status**: `pending`
**Created**: 2026-08-09
**Feature**: `docs/roadmap/features/124-shadcn-table-actions-responsive/feature.md`
**Total Steps**: 24
**Feature Branch**: `feature/shadcn-table-actions-responsive`

---

## Execution Summary

All 24 steps touch only `xstockstrat-ui` (frontend-only, no proto/migration/config). The order
follows `design.md`'s "Chosen Approach" sequencing: primitive vendoring first (Steps 1-2), then the
independent-site FRs in ascending risk/overlap order (FR-2, FR-5, FR-7+8, FR-6, FR-9), then the two
larger structural FRs (FR-11 Sidebar, FR-10 breadcrumb removal+`PageBreadcrumb`), then the
route-sweep/audit FRs that must run against *final* markup (FR-3, FR-4), and a closing full-suite
gate. FR-6 (Step 11) intentionally runs before Steps 19-20 (FR-10) because both touch
`market/[symbol]/page.tsx`, `positions/[symbol]/page.tsx`, `orders/[id]/page.tsx` — running FR-6 first
means FR-10's citations are grounded on settled content (design.md's "hot-file" note). Every
`service` step is paired with an immediately-following `test` step per Constitution **C-08**; `xstockstrat-ui`
carries no numeric coverage threshold, so pairing is satisfied by Playwright e2e (and, where a step
touches `src/lib/**`, `pnpm test:unit`) plus the `pnpm run lint` gate.

## Step Dependencies

- Step 3 (FR-2 DropdownMenu conversions) requires Step 1 (FR-1 `dropdown-menu.tsx` vendored) — hard.
- Step 17 (FR-11b Sidebar wiring) requires Step 15 (FR-11a `sidebar.tsx` + byproducts vendored) — hard.
- Steps 19-20 (FR-10) and Step 17 (FR-11b) both edit `PlatformHeader.tsx`'s shared top-of-file import
  block (`:13-35`) — soft ordering (either runs first per design.md; this spec runs FR-11 before
  FR-10, so Step 19 inherits the import-block cleanup after Step 17's edits land).
- Step 11 (FR-6 Eyebrow, touches `market/[symbol]/page.tsx`, `positions/[symbol]/page.tsx`,
  `orders/[id]/page.tsx`) must run **before** Step 20 (FR-10 adds `PageBreadcrumb` to those same three
  files) — Step 20 must re-ground its line citations fresh against Step 11's output, not this spec's
  pre-Step-11 numbers (design.md Open Risk, "cross-FR hot-file churn").
- Step 21 (FR-10 e2e: `breadcrumb.spec.ts` + `nav-reachability.spec.ts` restructure) requires Steps
  19-20 (FR-10 markup) to exist.
- Step 22 (FR-3: extend `mobile-overflow.spec.ts` `ROUTES`) intentionally runs after every markup step
  (1-21) so it measures **final**, post-conversion widths, not pre-conversion ones (design.md Step 9).
- Step 23 (FR-4: horizontal-overflow audit) likewise runs after all markup steps, for the same reason,
  and also after Step 22 so the audit can reuse the just-extended route list.
- Step 24 (closing gate) requires every prior step green.

---

### Step 1 — service: Vendor `dropdown-menu.tsx` (FR-1)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/ui/dropdown-menu.tsx` — create (CLI-generated)
- Any other `src/components/ui/*.tsx` file the CLI reports as changed by the install — modify (reconcile)

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness, Connect-RPC call safety, no secret values rendered in UI

**Codebase Evidence**:
- Confirmed via `Glob src/components/ui/dropdown-menu.tsx` → 0 hits (file does not exist today; 34 other
  primitives exist, e.g. `badge.tsx`, `alert-dialog.tsx`, `table.tsx`).
- `services/xstockstrat-ui/components.json:1-25` — `"style": "radix-rhea"`, CLI-vendored convention;
  preset id `bLTl5gh6` is the `apply --preset` argument (not stored verbatim in `components.json`).
- Reconciliation convention: `services/xstockstrat-ui/CLAUDE.md` § Styling — "`apply --preset`
  overwrites every listed primitive file wholesale... always re-run the reconciliation step... after."
  Mechanical guards: `src/components/ui/button.test.ts` (asserts `buttonVariants({variant:'buy'})`
  contains `bg-buy`, `sell` contains `bg-sell`), `src/components/ui/badge.test.ts` (asserts
  `buy`/`sell`/`paper` variants render their color tokens) — both read directly, confirmed unchanged by
  this step's install (dropdown-menu has no documented registry dependency on `button`/`badge`).

**TDD**: `N/A (primitive vendoring — no application behavior yet; Step 3 is the code-bearing consumer)`

**Instructions**:
1. `cd services/xstockstrat-ui && npx shadcn@latest add dropdown-menu` (uses `components.json`'s
   existing `style`/`baseColor`/alias config; no `--preset` flag needed for a single new primitive add
   — `apply --preset` is only for a full preset re-sync).
2. Run `git status --short src/components/ui/` and record every file the install touched or created.
3. If any file besides `dropdown-menu.tsx` was modified (a registry dependency), diff it against its
   pre-install content and re-apply any `// app-specific` marked block the diff removed (per
   `services/xstockstrat-ui/CLAUDE.md` § Styling), same reconciliation step AC-1 requires.
4. Before Step 3 wires any call site, read the generated `dropdown-menu.tsx`'s
   `DropdownMenuTrigger`/`DropdownMenuContent`/`DropdownMenuItem` exports directly to confirm the
   trigger composition API (`asChild` vs. a `render` prop) — do not assume from a sibling primitive.
   `fails.md` 2026-08-09 ("shadcn-migration-medium-confidence — execute Step 17") is the exact prior
   mistake this guards against: a not-yet-installed primitive's polymorphic API was assumed from
   `combobox.tsx` (Base UI, `render`-prop) when the actual installed package (classic Radix,
   `asChild`) differed, and this codebase already mixes both primitive families
   (`navigation-menu.tsx`, `select.tsx`, `dialog.tsx` = classic Radix/`asChild`; `combobox.tsx`,
   `input-group.tsx` = Base UI/`render`).

**Verification**:
```bash
cd services/xstockstrat-ui
test -f src/components/ui/dropdown-menu.tsx && echo "dropdown-menu.tsx created"
git status --short src/components/ui/
```

---

### Step 2 — test: Verify reconciliation guards pass unchanged (FR-1 / AC-1)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/ui/button.test.ts` — verify only (no edit expected)
- `services/xstockstrat-ui/src/components/ui/badge.test.ts` — verify only (no edit expected)

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness

**Codebase Evidence**:
- `src/components/ui/button.test.ts:1-15` (full file read) — asserts `buttonVariants({variant:'buy'})`
  contains `bg-buy`, `{variant:'sell'}` contains `bg-sell`.
- `src/components/ui/badge.test.ts:1-19` (full file read) — asserts `buy`/`sell`/`paper` badge variants
  render `bg-buy/20`/`bg-sell/20`/`bg-paper/20`.

**TDD**: `N/A (mechanical regression guard, pre-existing tests — this step proves they still pass, not new red/green)`

**Instructions**: Run the existing vitest suite scoped to these two files; no code edits are expected
in this step. If either test fails, Step 1's reconciliation missed a file — return to Step 1, not
this step, to fix it (this step only verifies).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run test:unit -- button.test.ts badge.test.ts
pnpm run lint
```

---

### Step 3 — service: Convert 4 Actions columns to `DropdownMenu` (FR-2)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/trader/OrdersTable.tsx` — modify (lines 124-160)
- `services/xstockstrat-ui/src/app/config-ui/sources/page.tsx` — modify (lines 338-352)
- `services/xstockstrat-ui/src/app/config-ui/[namespace]/NamespaceEditor.tsx` — modify (lines 228-273)
- `services/xstockstrat-ui/src/app/insights/strategies/page.tsx` — modify (lines 207-247, `StrategyRow`)

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness, config mutation safety

**Codebase Evidence**:
- `OrdersTable.tsx:124-160` (read in full) — a `TableCell` with an inline `Button` ("Edit",
  `onClick={() => setEditing(order)}`) and a full `AlertDialog`/`AlertDialogTrigger`/
  `AlertDialogContent`/`AlertDialogAction`/`AlertDialogCancel` composition (Cancel, genuinely
  `AlertDialog`-gated — `onClick={() => cancelOrder({orderId: order.orderId})}` on
  `AlertDialogAction`). Header cell "Actions" at line 85.
- `config-ui/sources/page.tsx:338-352` — a flex div with two `Button`s: `onClick={() => handleToggle(src)}`
  (Disable/Enable) and `onClick={() => openEdit(src)}` (Edit). Header cell "Actions" at line 303.
- `config-ui/[namespace]/NamespaceEditor.tsx:228-273` — conditional inline `Button`s: when
  `editingKey !== k.key`, an "Edit" button (`onClick` sets `editingKey`/`editValue`/`editReason`);
  when `editingKey === k.key`, "Save" (`onClick={() => handleSave(k.key)}`, `disabled` on
  `saving || (!!validationError) || !isNativeEnv`) + "Cancel" (`onClick` clears `editingKey`). Header
  cell "Actions" at line 182.
- `insights/strategies/page.tsx:207-247` (`StrategyRow`) — **corrects the product-spec/design.md
  citation**: as of this session's direct read, the Deactivate action is a genuine
  `AlertDialog`/`AlertDialogTrigger`/`AlertDialogContent`/`AlertDialogDescription`/`AlertDialogAction`/
  `AlertDialogCancel` composition (`:214-236`), **not** `window.confirm(...)` as `recon.md`/`design.md`
  stated — the codebase drifted again after those artifacts were written (a further sibling-feature
  merge landed `AlertDialog` here since 121/122/123's PR #917). Edit is a plain `Button`
  (`onClick={onEdit}`, `:210-212`). Both actions render only `isAdmin ? (...) : <Link>Open →</Link>`
  (`:208-246`) — the whole Actions cell, not just the buttons, is admin-gated; header cell
  `{isAdmin ? 'Actions' : ''}` at line 129.

**TDD**: `red-green required`

**Instructions**:
1. For each of the 4 sites, replace the inline `Button`(s) — and, for `OrdersTable.tsx` and
   `insights/strategies/page.tsx`, the `AlertDialog` composition that already gates the destructive
   action — with a single `DropdownMenu` trigger: a small icon-only `Button` (`variant="ghost"`,
   `size="icon"`, an ellipsis/kebab icon matching this file's existing icon-import convention —
   `@phosphor-icons/react` in `OrdersTable.tsx`'s sibling files, `lucide-react` elsewhere per each
   file's existing imports) wrapped in `DropdownMenuTrigger asChild` (pending Step 1's confirmed
   trigger API), with a `DropdownMenuContent` holding one `DropdownMenuItem` per existing action.
2. Preserve every action's exact existing handler/behavior verbatim — do not rewrite `onClick`
   bodies, `disabled` conditions, or mutation calls, only their JSX container.
3. For `OrdersTable.tsx`'s Cancel and `insights/strategies/page.tsx`'s Deactivate: keep the
   `AlertDialog` composition **as the destructive item's own gate** — a `DropdownMenuItem` cannot
   itself open an `AlertDialog` as a nested trigger inside a menu without the menu closing first and
   swallowing the dialog's open state (a documented Radix composition footgun: `DropdownMenu` closes
   on any item interaction before the nested `AlertDialogTrigger`'s click can propagate). Use the
   established Radix-safe pattern: give the `DropdownMenuItem` an `onSelect={(e) => e.preventDefault()}`
   plus a controlled `open`/`onOpenChange` on the `AlertDialog` triggered by that item's `onClick`, OR
   render the `AlertDialog`/`AlertDialogTrigger` pair outside the `DropdownMenu` (sibling in the same
   `TableCell`) with the `AlertDialogTrigger` visually hidden and opened programmatically from the
   `DropdownMenuItem`'s `onSelect`. Verify against the CLI-generated `dropdown-menu.tsx`'s own
   composition docs/example (if the CLI emits a JSDoc/example block) before choosing; if genuinely
   ambiguous, surface it as a deviation rather than guessing (Constitution P-03).
4. `insights/strategies/page.tsx`: keep the outer `isAdmin ? (...) : <Link>` gate unchanged — only the
   admin branch's two-button JSX becomes the `DropdownMenu`.
5. `authorized-apps/page.tsx`'s single-action Disconnect (`src/app/accounts/authorized-apps/page.tsx:152-181`,
   already `AlertDialog`-gated) is **explicitly out of scope** for this step — design.md's Rejected
   Alternatives: a menu around one item adds a click for no grouping benefit (resolves the
   product-spec's Open Question).

**Verification**: Update the e2e specs covering these 4 sites for the new trigger interaction (open
the kebab menu, then click the item) — selector changes only, never a behavior assertion change:
```bash
cd services/xstockstrat-ui && pnpm test:e2e -g "order|config-ui/sources|namespace|strateg"
pnpm run lint
```

---

### Step 4 — test: e2e coverage for the 4 DropdownMenu conversions (FR-2 / AC-2)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/trader/orders.spec.ts` — modify (`OrdersTable.tsx`'s Edit/Cancel;
  confirmed via `grep -l "cancel-\|edit-" e2e/trader/*.spec.ts`)
- `services/xstockstrat-ui/e2e/config-ui/sources.spec.ts` — modify (Disable/Enable/Edit, confirmed via
  `Edit`/`Enable` button-role assertions at `:193,238`)
- `services/xstockstrat-ui/e2e/config-ui/value-persists-after-save.spec.ts` — modify
  (`NamespaceEditor`'s Edit/Save flow, confirmed via `Edit`/`Save` button-role assertions at `:34-70`)
- `services/xstockstrat-ui/e2e/insights/strategy-authoring.spec.ts` — modify (strategies list
  Edit/Deactivate, confirmed via `grep -l "Deactivate\|StrategyRow" e2e/insights/*.spec.ts`)

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness, config mutation safety

**Codebase Evidence**: Existing `data-testid` attributes already on the action `Button`s
(`OrdersTable.tsx:132` `edit-${order.orderId}`, `:143` `cancel-${order.orderId}`, `:149`
`cancel-${order.orderId}-dismiss`, `:154` `cancel-${order.orderId}-confirm`) — these stay on the
`DropdownMenuItem`/`AlertDialogAction` elements per Step 3 Instruction 2 (verbatim handler
preservation includes the `data-testid`), so most existing e2e assertions should need only an
inserted "open the menu" click before the existing item click, not a full rewrite.

**TDD**: `red-green required` — before Step 3's markup change, run the affected specs and confirm
they fail against the new (menu-gated) DOM per Step 3 (red); after adding the "open menu" click, confirm
green.

**Instructions**: For each affected spec, add a `page.getByRole('button', { name: /actions|more|⋯/i })...click()`
(or equivalent, matching whatever accessible name Step 3's trigger button ends up with)
immediately before each existing item-click assertion. Do not change what is asserted about the
resulting behavior (order edited, source disabled, config saved, strategy deactivated) — only the
click path to reach it.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:e2e -g "order|config-ui/sources|namespace|strateg"
```

---

### Step 5 — service: Keyboard-accessible clickable rows (FR-5)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/insights/strategies/[id]/page.tsx` — modify (lines 490-506, Past Runs row)
- `services/xstockstrat-ui/src/components/trader/LiveStrategiesPanel.tsx` — modify (lines 46-51, TableRow)
- `services/xstockstrat-ui/src/app/insights/formulas/page.tsx` — modify (lines 115-119, TableRow)

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness

**Codebase Evidence**:
- `strategies/[id]/page.tsx:490-506` (read in full) — the Past Runs `TableRow` already carries
  `role="button"`, `tabIndex={0}`, `aria-selected={selectedRunId === run.backtestId}`,
  `onClick={() => setSelectedRunId(run.backtestId)}`, and `onKeyDown={(e) => { if (e.key === 'Enter' ||
  e.key === ' ') { e.preventDefault(); setSelectedRunId(run.backtestId); } }}` — this is the
  reference pattern per design.md, not a site needing conversion. (`design.md`'s "strip the redundant
  `role="button"`/`tabIndex`/`onKeyDown`" language from the recon's pre-merge read is **superseded**:
  a fresh direct read this session found the row's `TableRow` already correct and non-redundant — the
  `role`/`tabIndex`/`onKeyDown` triple is the row's *only* a11y mechanism, `TableRow` itself adds none
  of it. No change needed at this site; keep it as the reference for the other two.)
- `LiveStrategiesPanel.tsx:47-51` (read in full) — `<TableRow key={s.strategyId} className="cursor-pointer"
  onClick={() => setSelectedId(s.strategyId)}>` — mouse-only, no `role`/`tabIndex`/`onKeyDown`.
- `formulas/page.tsx:115-119` (read in full) — `<TableRow key={f.formulaId} className="cursor-pointer"
  onClick={() => router.push(...)}>` — mouse-only, same gap.

**TDD**: `red-green required`

**Instructions**:
1. `strategies/[id]/page.tsx`: no code change (Codebase Evidence above supersedes the design's
   planned removal) — note this explicitly in this step's Deviation Log entry at execute time so the
   "no capability regresses" acceptance criterion (AC-5) is traceable to a verified reason, not a
   skipped step.
2. `LiveStrategiesPanel.tsx:47-51`: add `role="button"`, `tabIndex={0}`, and an `onKeyDown` handler
   that calls `setSelectedId(s.strategyId)` on `Enter`/`Space` (mirroring `strategies/[id]/page.tsx`'s
   pattern verbatim, including `e.preventDefault()`).
3. `formulas/page.tsx:115-119`: add the same triple, calling `router.push(`/insights/formulas/${f.formulaId}`)`
   on `Enter`/`Space`.
4. Neither site currently sets `aria-selected` (neither has a "selected row" concept — `formulas/page.tsx`
   navigates away, `LiveStrategiesPanel.tsx` opens an inline `Collapsible`) — do not add `aria-selected`
   where there's no selection state to reflect; only add the activation triple.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:e2e -g "live.strateg|formulas"
pnpm run lint
```

---

### Step 6 — test: Keyboard-activation e2e for the 2 newly-accessible rows (FR-5 / AC-5)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/trader/live-strategies.spec.ts` — modify (add keyboard-activation case)
- `services/xstockstrat-ui/e2e/insights/formulas.spec.ts` — modify (add keyboard-activation case)

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness

**Codebase Evidence**: `e2e/fixtures/strategies.ts` `STRATEGY_DEF_LIVE` (id `strat-live-001`, per
`INVENTORY.md`) already backs `live-strategies.spec.ts`'s existing assertions; `e2e/fixtures/formulas.ts`
`FORMULA_RSI` (id `f-rsi`) already backs `formulas.spec.ts` — reuse both (C-12), no new fixture needed.

**TDD**: `red-green required` — run each spec's new case against pre-Step-5 markup first (fails: no
`role="button"`/keyboard handler present), then against Step 5's change (passes).

**Instructions**: Add one case per file: focus the row via `Tab` (or `.focus()`), press `Enter`
(and/or `Space`), and assert the same post-click outcome the existing mouse-click case already
asserts (row opens the alert feed / navigates to the formula detail page).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:e2e -g "live.strateg|formulas"
pnpm run lint
```

---

### Step 7 — service: `Badge`-driven `StrategyWizard` pill + 2 source pills (FR-7)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/insights/StrategyWizard.tsx` — modify (lines 214-233, inner per-step pill)
- `services/xstockstrat-ui/src/app/insights/opportunities/page.tsx` — modify (line 347-351, source pill)
- `services/xstockstrat-ui/src/app/insights/market/[symbol]/page.tsx` — modify (lines 146-150, source pill)

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness

**Codebase Evidence**:
- `StrategyWizard.tsx:210-234` (read in full) — a `QuestionnaireProgress` wrapper (landed by sibling
  feature 123, unchanged by this step) contains a `STEPS.map` rendering a `<span
  className={cn('rounded-full px-3 py-1', n === step ? 'bg-primary text-primary-foreground' : n <
  step ? 'bg-secondary text-foreground' : 'bg-secondary/40 text-muted-foreground')}>` — 3-state
  hand-rolled badge-color logic (current, completed, upcoming). Confirms design.md's "123 only touched
  the outer `<ol>` wrapper; the inner pill is untouched" finding.
- `src/components/ui/badge.tsx:7-33` (`badgeVariants`, read in full) — variants: `default` (bg-primary/
  primary-foreground — matches the current-step state exactly), `secondary` (bg-secondary/
  secondary-foreground — matches the completed state's `bg-secondary text-foreground`; `text-foreground`
  vs. `secondary-foreground` is a close, acceptable match, not byte-identical). **No existing variant
  matches the upcoming state** (`bg-secondary/40 text-muted-foreground`, a dimmed/40%-opacity
  treatment) — per FR-7's own "adding a variant if the existing set doesn't cover a case" allowance,
  either add a new `cva` variant (e.g. `muted`) or compose `variant="secondary"` with an
  `className="opacity-40 text-muted-foreground"` override (`cn()` merges through `Badge`'s own
  `className` prop, confirmed at `badge.tsx:47`). Prefer the `className`-override composition (no new
  `cva` key, smaller diff) unless a second consumer of the same "upcoming/dimmed" treatment appears
  elsewhere (in which case promote to a real variant — DRY guard rail).
- `opportunities/page.tsx:347-351` (read in full) — `{o.source && <span className="rounded-full
  border border-border px-2 py-0.5 text-[11px] text-muted-foreground">{o.source}</span>}`.
- `market/[symbol]/page.tsx:146-150` (read in full) — identical className string, same conditional
  shape (`{opportunity?.source && <span ...>{opportunity.source}</span>}`).
- `badgeVariants` `outline` variant (`badge.tsx:16`): `'border-border text-foreground [a]:hover:bg-muted
  ...'` — closest existing match (border-border matches exactly; `text-foreground` vs. the site's
  `text-muted-foreground` is the one visual difference — acceptable per design.md's "outline variant
  fits the source-pill sites," or pass `className="text-muted-foreground"` alongside `variant="outline"`
  to preserve the exact original color).

**TDD**: `red-green required`

**Instructions**:
1. `StrategyWizard.tsx`: replace the `<span className={cn(...)}>` with `<Badge variant={n === step ?
   'default' : n < step ? 'secondary' : 'secondary'} className={n > step ? 'opacity-40' : undefined}>`
   (or equivalent — the exact prop shape is an implementation choice; the requirement is that all 3
   visual states survive unchanged and no new `cva` variant is added unless a second real consumer of
   the "upcoming" treatment is found during this step).
2. `opportunities/page.tsx:347-351` and `market/[symbol]/page.tsx:146-150`: replace the raw `<span
   className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">` with
   `<Badge variant="outline" className="text-[11px] text-muted-foreground">{source}</Badge>` (keep the
   `text-[11px]` override — `Badge`'s base class sets `text-xs`, which is visually different from the
   original `text-[11px]`; preserve the original size to avoid an unintended visual change).
3. `AlertStream.tsx`'s unread-count pill: **no change** — already `Badge`-driven (`AlertStream.tsx:50-55`,
   confirmed by direct read this session: `<Badge variant={hasHighSeverity ? 'destructive' : 'default'}
   className="absolute -top-1 -right-1 ...">`) — matches design.md's "already done, dropped from scope."

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:e2e -g "strategy-authoring|opportunities|market"
pnpm run lint
```

---

### Step 8 — test: Verify unchanged visible behavior for FR-7 sites (AC-7)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/insights/strategy-authoring.spec.ts` — verify (existing coverage of the wizard step indicator, if any)
- `services/xstockstrat-ui/e2e/insights/opportunities.spec.ts` — verify (source pill rendering)

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness

**Codebase Evidence**: `e2e/fixtures/opportunities.ts` `OPPORTUNITIES` rows carry a `source` field
(per `INVENTORY.md`) already exercised by `opportunities.spec.ts` — reuse, no new fixture.

**TDD**: `N/A (no new user-facing behavior — this step is a visual-parity verification pass, not a new assertion)`

**Instructions**: Run existing coverage for both files; if neither spec currently asserts on the
step-indicator pill's or source pill's rendered classes/text (likely, since these are cosmetic), add
one assertion per site confirming the visible text (`o.source`, the step number) is still present
and correctly associated with the active/completed/upcoming state — a minimal addition, not a new
coverage feature.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:e2e -g "strategy-authoring|opportunities"
```

---

### Step 9 — service: Fold "All sources" into the `ToggleGroup` styling (FR-8)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/insights/opportunities/page.tsx` — modify (lines 188-200)

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness

**Codebase Evidence**:
- `opportunities/page.tsx:188-216` (read in full) — the per-source pills are already `ToggleGroup
  type="multiple"`/`ToggleGroupItem` (`:201-216`, confirmed landed by sibling feature 121/122/123).
  The "All sources" control (`:189-200`) is a separate raw `<button type="button" onClick={() =>
  setActiveSources([])} className={cn('rounded-full border px-3 py-1 text-xs transition-colors',
  activeSources.length === 0 ? 'border-primary bg-primary/20 text-foreground' : 'border-border
  text-muted-foreground hover:text-foreground')}>All sources</button>` sitting outside the
  `ToggleGroup`.
- `src/components/ui/toggle.tsx:9-11` (`toggleVariants` base class, read in full) — the shared base
  class string includes `aria-pressed:bg-muted` unconditionally (applies regardless of `variant`).
  `outline` variant (`:15`): `'border border-input bg-transparent hover:bg-muted'` — confirmed **no**
  `data-[state=on]` selector anywhere in the `outline` variant definition (validates design.md's
  rejection of a `data-state`-based approach as verifiably broken for this variant).

**TDD**: `red-green required`

**Instructions**: Replace the raw `<button>` with the `ui/toggle.tsx` `Toggle` component (not
`ToggleGroupItem` — "All sources" is a standalone control outside the multi-select group, clearing it
rather than toggling membership in it): `<Toggle variant="outline" size="sm" aria-pressed={activeSources.length
=== 0} onClick={() => setActiveSources([])} className="rounded-full border px-3 py-1 text-xs">All
sources</Toggle>`, relying on the base class's `aria-pressed:bg-muted` for the active-state styling
(matches the original `border-primary bg-primary/20 text-foreground` intent closely enough via the
shared `aria-pressed` mechanism — verify visually/via e2e that the "all sources active" state is
still visually distinguishable after the swap; if `bg-muted` alone reads as too subtle versus the
original `bg-primary/20`, layer an explicit `aria-pressed:border-primary aria-pressed:bg-primary/20
aria-pressed:text-foreground` into the `className` override rather than accepting a visual regression).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:e2e -g "opportunities"
pnpm run lint
```

---

### Step 10 — test: e2e for the "All sources" toggle (FR-8 / AC-7)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/insights/opportunities.spec.ts` — modify

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness

**Codebase Evidence**: Same `OPPORTUNITIES` fixture as Step 8.

**TDD**: `red-green required` — assert `aria-pressed="true"` on the control when `activeSources` is
empty and `false` once a source chip is selected; run against pre-Step-9 markup first (fails: no
`aria-pressed` on a plain `<button>` styled only via a manual `cn()` ternary — Playwright's
`toHaveAttribute('aria-pressed', ...)` finds nothing to assert against a control that never sets it),
then against Step 9's change (passes).

**Instructions**: Add a case toggling a source chip on, confirming "All sources" becomes
`aria-pressed="false"`, then clicking "All sources" and confirming it returns to `aria-pressed="true"`
and the chip's own `data-state` returns to `off`.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:e2e -g "opportunities"
```

---

### Step 11 — service: Shared `Eyebrow` component + 14-site conversion (FR-6)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/shared/Eyebrow.tsx` — create
- `services/xstockstrat-ui/src/app/insights/market/[symbol]/page.tsx` — modify (line 29)
- `services/xstockstrat-ui/src/app/trader/positions/page.tsx` — modify (lines 522, 539)
- `services/xstockstrat-ui/src/app/trader/orders/[id]/page.tsx` — modify (line 172)
- `services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx` — modify (lines 250, 261, 406, 452, 477, 498)
- `services/xstockstrat-ui/src/app/trader/portfolio/page.tsx` — modify (lines 148, 227)
- `services/xstockstrat-ui/src/components/insights/SignalReadiness.tsx` — modify (line 110)
- `services/xstockstrat-ui/src/components/shared/StatTile.tsx` — modify (line 21)

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness

**Scope note**: this step touches 8 files (1 create + 7 modify), above the impl-spec criteria's
5-file split-consideration threshold. Not split: all 8 changes are one atomic unit — a single shared
literal replaced by a single new component across every one of its call sites — splitting by file
would leave the literal partially eliminated mid-feature with no independent value at the split
point, unlike a step that bundles genuinely separable concerns.

**Codebase Evidence**:
- Grep this session (`Grep 'font-mono text-\[9px\] font-semibold uppercase tracking-\[0\.13em\]
  text-muted-foreground' src`) confirms **exactly 14 occurrences across these 7 files**, at the exact
  lines listed above — matches `design.md`'s corrected "14 occurrences across 7 files" tally (not the
  product-spec's original "9 files" claim).
- Per-site wrapping tag varies: `<div>` at `market/[symbol]/page.tsx:29`,
  `positions/[symbol]/page.tsx:250,261`; `<p className="mb-2 ...">` at `SignalReadiness.tsx:110`,
  `positions/page.tsx:522,539`, `portfolio/page.tsx:148`; `<CardTitle className="...">` at
  `positions/[symbol]/page.tsx:406,452,477,498`, `orders/[id]/page.tsx:172`; `<dt className="...">` at
  `portfolio/page.tsx:227`. Three of the `<p>` sites carry an extra `mb-2` margin class alongside the
  shared literal (`SignalReadiness.tsx:110`, `positions/page.tsx:522,539`).
- `src/components/ui/card.tsx:36-44` (`CardTitle`, read in full) — renders `<h3 data-slot="card-title"
  className={cn('font-heading text-base font-medium', className)} {...props} />`. The 4 `CardTitle`
  sites already pass their `className` straight to `CardTitle`, and `cn()` (tailwind-merge) lets the
  passed classes win over the conflicting defaults (`font-mono` over `font-heading`, `text-[9px]` over
  `text-base`, `font-semibold` over `font-medium`) — confirmed no other selector in the codebase keys
  off `data-slot="card-title"` for anything but`CardHeader`'s own `has-data-[slot=card-action]`
  grid-column rule (`card.tsx:28`, unrelated to `card-title`), so `CardTitle`'s own tag/slot can stay
  unchanged; only its `className` content changes.
- `src/components/shared/StatTile.tsx:1-39` (read in full) — the file's own export convention
  (named function export, `cn()` import from `'../ui/utils'`, typed props object) is the sibling
  pattern `recon.md`'s "Patterns to REUSE" cites for `Eyebrow`'s home.

**TDD**: `red-green required`

**Instructions**:
1. Create `src/components/shared/Eyebrow.tsx`: a component accepting `{ as?: 'div' | 'p' | 'dt' | 'span';
   className?: string; children: React.ReactNode }` (default `as: 'div'`), rendering the chosen tag
   with `className={cn('font-mono text-[9px] font-semibold uppercase tracking-[0.13em]
   text-muted-foreground', className)}` and forwarding `children` — mirroring `StatTile.tsx`'s
   `cn()`-merge convention (`StatTile.tsx:24-32`). Use a small `as`-keyed element-tag switch (or a
   `React.createElement(as, ...)` call) rather than duplicating the JSX per tag.
2. For the 4 `CardTitle` sites, replace `<CardTitle className="font-mono text-[9px] ...">{text}</CardTitle>`
   with `<CardTitle><Eyebrow as="span">{text}</Eyebrow></CardTitle>` — this keeps `CardTitle`'s own
   `h3`/`data-slot="card-title"` semantics intact (its own default className reapplies, e.g.
   `font-heading text-base font-medium`) while the nested `Eyebrow` span's own explicit
   `font-mono`/`text-[9px]`/etc. override the inherited font styling for its own inline content
   (CSS specificity: an element's own `className` always wins for properties it sets, regardless of
   inherited values from an ancestor). Verify visually (or via a snapshot-style e2e check) that the
   rendered text is pixel-identical to the pre-change `CardTitle`-only version, since this is the one
   site shape where the eyebrow styling moves from the wrapper to a nested child rather than being the
   wrapper's own className.
3. For the remaining 10 sites (`div`/`p`/`dt`), replace the wrapper entirely with `<Eyebrow as="div">`
   / `<Eyebrow as="p" className="mb-2">` (for the 3 sites carrying the extra margin) / `<Eyebrow as="dt">`,
   preserving each site's extra class exactly.
4. Remove now-unused imports if any file's only use of a local className string was this literal
   (none of the 7 files import a shared constant for it today — confirmed inline literals only, so no
   dead import risk here).

**Verification**:
```bash
cd services/xstockstrat-ui
grep -rn "font-mono text-\[9px\] font-semibold uppercase tracking-\[0\.13em\] text-muted-foreground" src \
  | grep -v "components/shared/Eyebrow.tsx" && echo "FAIL: literal still present outside Eyebrow.tsx" || echo "OK: zero remaining literal sites"
pnpm run lint
```

---

### Step 12 — test: Verify Eyebrow conversion is visually inert (FR-6 / AC-6)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/insights/signal-detail.spec.ts` — verify (`market/[symbol]/page.tsx`)
- `services/xstockstrat-ui/e2e/trader/positions.spec.ts` — verify (`positions/page.tsx`)
- `services/xstockstrat-ui/e2e/trader/position-detail.spec.ts` — verify (`positions/[symbol]/page.tsx`)
- `services/xstockstrat-ui/e2e/trader/portfolio.spec.ts` — verify (`portfolio/page.tsx`)
- `services/xstockstrat-ui/e2e/trader/order-intent.spec.ts` — verify (`orders/[id]/page.tsx`)
- `services/xstockstrat-ui/e2e/trader/order-ticket.spec.ts` — verify (`orders/[id]/page.tsx`)

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness

**Codebase Evidence**: The 7 touched files (`market/[symbol]`, `positions/page.tsx`,
`positions/[symbol]`, `portfolio/page.tsx`, `orders/[id]`, plus the shared `SignalReadiness.tsx`/
`StatTile.tsx` components rendered on several of these pages) are exercised by the 6 specs above —
confirmed via `grep -l "goto.*trader/orders/\|goto.*positions\|goto.*market"` against each file's
`page.goto(...)` calls this session. This is a pure text/label-preservation change (the eyebrow label
text itself is unchanged, only its wrapping markup), so no new assertions are required; this step's
job is running the existing suites and confirming zero regressions.

**TDD**: `N/A (no new behavior — regression-only verification)`

**Instructions**: Run the full existing e2e coverage for the 7 touched pages; a failure here means
Step 11's markup change altered visible text or broke a selector that was scoped to the old wrapper
tag (e.g. a `getByRole('heading', ...)` that expected an `h3` where a `div`/`p`/`dt` now sits, or vice
versa for the `CardTitle` sites) — fix in Step 11, not here.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:e2e -g "position|portfolio|order|market"
```

---

### Step 13 — service: FR-9 cosmetic fixes (green token + chart-height audit)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/accounts/authorized-apps/page.tsx` — modify (lines 204-205)
- `services/xstockstrat-ui/src/components/trader/ChartPanel.tsx` — verify / conditionally modify (line 157)
- `services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx` — verify / conditionally modify (line 317)
- `services/xstockstrat-ui/src/app/insights/market/[symbol]/page.tsx` — verify / conditionally modify (line 200)

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness

**Codebase Evidence**:
- `authorized-apps/page.tsx:200-211` (read in full) — the Reachable branch: `<span
  className="inline-flex items-center gap-1 text-sm text-green-600"><span className="h-2 w-2
  rounded-full bg-green-600" /> Reachable</span>` at lines 204-205 (line numbers shifted from the
  product-spec's original `174-175` claim, per `design.md`'s corrected citation — sibling feature 121's
  `Table`+`AlertDialog` conversion of this file added ~29 lines above them; confirmed by this session's
  direct read). The Unreachable branch (`:207-211`) already uses `text-destructive`/`bg-destructive`,
  not green — unaffected.
- `market/[symbol]/page.tsx:138` — `text-buy`/`text-destructive` already used for the identical
  positive/negative price-change meaning this fix's target token maps onto (`change >= 0 ? 'text-buy' :
  'text-destructive'`), confirming `text-buy`/`bg-buy` are this app's established semantic tokens for
  "positive/success," not an invented substitution.
- `ChartPanel.tsx:29` (`useCandlestickChart(320)`) + `:157` (`style={{ height: 320 }}`) — same
  numeric literal `320` feeds both the DOM container height and the `lightweight-charts`
  `createChart({ height })` call (via the hook).
- `positions/[symbol]/page.tsx:70` (`useCandlestickChart(260)`) + `:317` (`style={{ height: 260 }}`) —
  same coupling, `260`.
- `market/[symbol]/page.tsx:45` (`useCandlestickChart(480)`) + `:200` (`style={{ height: 480 }}`) —
  same coupling, `480`.

**TDD**: `red-green required (green-token fix only)` / `N/A (chart-height sites are audit-then-conditional, not a predetermined change)`

**Instructions**:
1. `authorized-apps/page.tsx:204-205`: replace `text-green-600` → `text-buy`, `bg-green-600` →
   `bg-buy` (2 literal token swaps, no structural change).
2. For each of the 3 chart-height sites: per FR-9's own qualifier, a Tailwind-class conversion is
   **only** safe if it can stay the single source of truth for both the DOM height and the
   `useCandlestickChart(N)` argument without introducing a runtime `clientHeight` read. All 3 sites
   pass the *same* numeric literal to both the JSX `style={{height: N}}` and the hook call
   (`useCandlestickChart(N)`, itself feeding `lightweight-charts`' `createChart({height})`) — a bare
   Tailwind height class (`h-80` etc.) on the `div` would decouple that literal from the hook's own
   argument (two independent places to keep in sync instead of one shared `N`), which is exactly the
   drift FR-9 says not to risk. Per the FR's own instruction, **leave all 3 sites unchanged** and
   record this determination (with the `useCandlestickChart(N)` coupling evidence above) in
   `context.md` at execute time — this is a documented "no code change" outcome, not a skipped step
   (design.md Open Risk: "may net to zero code changes... acceptable, not incomplete work").

**Verification**:
```bash
cd services/xstockstrat-ui
grep -n "text-green-600\|bg-green-600" src/app/accounts/authorized-apps/page.tsx && echo "FAIL: green literal still present" || echo "OK: green token replaced"
pnpm test:e2e -g "authorized-apps"
pnpm run lint
```

---

### Step 14 — test: Verify FR-9 fixes (AC-8)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/accounts/authorized-apps.spec.ts` — verify (Reachable status still renders correctly)

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness

**Codebase Evidence**: Existing spec already exercises the Reachable/Unreachable status render (per
`INVENTORY.md`'s OAuth authorized-apps entry, `e2e/mock-backend.ts` `listAuthorizedApps`/agent-health).

**TDD**: `N/A (token-only visual change with no new behavior; the chart-height sites have no code change per Step 13)`

**Instructions**: Run the existing authorized-apps e2e spec; confirm the Reachable state's visible
text/status dot still renders (color is not directly assertable by Playwright without a computed-style
check, so this step's gate is functional-render parity, not pixel color — acceptable, since the
literal token swap is verified structurally by Step 13's grep). Confirm `context.md` carries the
chart-height "no change, here's why" entry per Step 13 Instruction 2 before this step is marked done
— this satisfies AC-8's "any site left unchanged is documented with why" requirement.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:e2e -g "authorized-apps"
grep -n "chart-height\|useCandlestickChart" ../../docs/roadmap/features/124-shadcn-table-actions-responsive/context.md
```

---

### Step 15 — service: Vendor `sidebar.tsx` + registry byproducts (FR-11a)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/ui/sidebar.tsx` — create
- `services/xstockstrat-ui/src/components/ui/tooltip.tsx` — create (registry dependency, net-new)
- `services/xstockstrat-ui/src/hooks/use-mobile.ts` (or wherever the CLI places it — confirm at execute time) — create (registry dependency, net-new)
- `services/xstockstrat-ui/src/components/ui/{button,separator,sheet,skeleton}.tsx` — verify / reconcile (existing registry dependencies)

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness

**Scope note**: this step touches 7 files, above the 5-file split-consideration threshold. Not split:
one CLI install (`npx shadcn add sidebar`) inherently produces this file set as a single atomic
operation — `sidebar.tsx`/`tooltip.tsx`/the `use-mobile` hook are all created by the same command, and
`button.tsx`/`separator.tsx`/`sheet.tsx`/`skeleton.tsx` are reconciled as a direct consequence of that
one command's registry-dependency resolution, not independently choosable work.

**Codebase Evidence**:
- `Glob src/components/ui/sidebar.tsx`, `tooltip.tsx` → 0 hits each (confirmed absent); `Glob
  **/use-mobile*` → 0 hits (confirmed absent) — matches `recon.md`'s ADDENDUM verification.
- `ls src/components/ui/` (this session) confirms `button.tsx`, `separator.tsx`, `sheet.tsx`,
  `skeleton.tsx`, `input.tsx` all already exist (vendored by feature 120) — these are `sidebar`'s
  documented registry dependencies per `design.md`'s live `ui.shadcn.com/r/styles/new-york-v4/
  sidebar.json` verification (`registryDependencies`: `button`, `separator`, `sheet`, `tooltip`,
  `input`, `use-mobile`, `skeleton`).
- `WebFetch` this session against `ui.shadcn.com/docs/components/sidebar` confirms the exported
  symbol set: `SidebarProvider`, `Sidebar`, `SidebarHeader`, `SidebarFooter`, `SidebarContent`,
  `SidebarGroup`, `SidebarGroupLabel`, `SidebarGroupAction`, `SidebarGroupContent`, `SidebarMenu`,
  `SidebarMenuItem`, `SidebarMenuButton`, `SidebarMenuAction`, `SidebarMenuSub*`, `SidebarMenuBadge`,
  `SidebarMenuSkeleton`, `SidebarTrigger`, `SidebarRail`, `SidebarInset`, and a `useSidebar()` hook
  exposing `openMobile`/`setOpenMobile`/`toggleSidebar`. `SidebarMenuButton`/`SidebarMenuItem` use the
  `asChild` prop for wrapping a `Link` (classic Radix-style composition, consistent with this file's
  own existing `NavigationMenuLink asChild` pattern at `PlatformHeader.tsx:199-213` — not the Base UI
  `render`-prop family).
- `src/components/ui/button.tsx:25-26` — confirmed still carries the `buy`/`sell` app-specific
  variants (grep at recon time; re-verify with `git diff` after this step's install, same
  reconciliation check as Step 1).

**TDD**: `N/A (primitive vendoring — Step 17 is the code-bearing consumer)`

**Instructions**:
1. `cd services/xstockstrat-ui && npx shadcn@latest add sidebar`.
2. Run `git status --short src/components/ui/ src/hooks/` and record every file created/touched.
3. Diff `button.tsx`, `separator.tsx`, `sheet.tsx`, `skeleton.tsx` against their pre-install content;
   re-apply any `// app-specific` block a registry-dependency overwrite removed (same reconciliation
   step as Step 1 — `button.tsx`'s `buy`/`sell` variants are the one confirmed customization among
   these 4 files; `separator.tsx`/`sheet.tsx`/`skeleton.tsx` carry no known app-specific markers per
   this session's file listing, but check anyway).
4. Read the generated `sidebar.tsx`'s `SidebarProvider`/`Sidebar`/`SidebarTrigger` implementation to
   confirm the exact `collapsible="offcanvas"` prop contract and `useSidebar()` shape before Step 17
   wires them — do not carry this step's `WebFetch`-sourced names forward as gospel; the installed
   file is the ground truth (same "verify the actual installed source, not docs/assumption" discipline
   as Step 1 Instruction 4 / the `fails.md` 2026-08-09 lesson).

**Verification**:
```bash
cd services/xstockstrat-ui
test -f src/components/ui/sidebar.tsx && test -f src/components/ui/tooltip.tsx && echo "sidebar + tooltip created"
git status --short src/components/ui/ src/hooks/
```

---

### Step 16 — test: Verify FR-11a reconciliation guards pass unchanged (AC-11)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/ui/button.test.ts` — verify only
- `services/xstockstrat-ui/src/components/ui/badge.test.ts` — verify only

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness

**Codebase Evidence**: Same guard files as Step 2; re-run here because `sidebar`'s install may touch
`button.tsx` again (a second registry-dependency overwrite risk, distinct from Step 1's
`dropdown-menu` install).

**TDD**: `N/A (mechanical regression guard)`

**Instructions**: Run the same two test files; a failure here means Step 15's reconciliation missed
`button.tsx`'s `buy`/`sell` variants.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run test:unit -- button.test.ts badge.test.ts
pnpm run lint
```

---

### Step 17 — service: Replace mobile `Sheet`+`Accordion` with `Sidebar collapsible="offcanvas"` (FR-11b)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/shared/PlatformHeader.tsx` — modify (Row 1, lines 220-281 + import block lines 13-29)

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness

**Codebase Evidence**:
- `PlatformHeader.tsx:220-281` (read in full, this session) — the current mobile menu: `<Sheet>` /
  `<SheetTrigger asChild><Button variant="ghost" size="icon" className="sm:hidden">` (icon-only
  trigger, `:224-229`) / `<SheetContent side="left">` / `<SheetHeader><SheetTitle>` (`:231-236`) /
  `<nav aria-label="Mobile">` wrapping `<Accordion type="single" collapsible value={expanded}
  onValueChange={(v) => setExpanded(v ?? '')}>` (`:238-243`) over `NAV_GROUPS.map`, each
  `AccordionItem`/`AccordionTrigger`/`AccordionContent` rendering `visibleItems(group.items).map`
  as a `SheetClose asChild`-wrapped `Link` (`:258-271`).
- `PlatformHeaderInner`'s state: `const [expanded, setExpanded] = React.useState<string>(activeGroup.key)`
  (`:165`) — defaults the expanded group to the active route's group; `visibleItems` (`:167`) filters
  out `adminOnly` items for non-admins (the `Backfills` entry, per `navGroups.tsx:57`).
- `ui/collapsible.tsx:1-22` (read in full) — already vendored (feature 121/122), exports
  `Collapsible`/`CollapsibleTrigger`/`CollapsibleContent` thinly wrapping `radix-ui`'s
  `Collapsible.Root`/`CollapsibleTrigger`/`CollapsibleContent` — reusable for the single-open-group
  requirement without a new primitive.
- `NAV_GROUPS` (`navGroups.tsx:33-84`, read in full) — 5 groups (`decide`/`discover`/`engine`/`book`/`settings`);
  `engine`'s `Backfills` item alone carries `adminOnly: true` (`:57`).

**TDD**: `red-green required`

**Instructions**:
1. Replace the import block's `Sheet`/`SheetClose`/`SheetContent`/`SheetHeader`/`SheetTitle`/
   `SheetTrigger` import (`:13-20`) and `Accordion`/`AccordionItem`/`AccordionTrigger`/`AccordionContent`
   import (`:22`) with the Step 15-vendored `Sidebar` family imports (`SidebarProvider`, `Sidebar`,
   `SidebarTrigger`, `SidebarHeader`, `SidebarContent`, `SidebarGroup`, `SidebarGroupContent`,
   `SidebarMenu`, `SidebarMenuItem`, `SidebarMenuButton`) plus the already-imported
   `Collapsible`/`CollapsibleTrigger`/`CollapsibleContent` from `../ui/collapsible` (new import — not
   currently imported in this file).
2. Wrap the JSX both the mobile trigger and the offcanvas panel live in with `<SidebarProvider>` —
   scope it as narrowly as correctness allows (around `PlatformHeaderInner`'s returned tree, or around
   just the trigger+`Sidebar` pair if `SidebarProvider`'s own wrapper element would otherwise disturb
   Row 1's flex layout — confirm by reading the Step-15-generated `sidebar.tsx`'s `SidebarProvider`
   implementation for its wrapper markup before deciding scope, per Step 15 Instruction 4).
3. Replace the `<Sheet><SheetTrigger asChild><Button ... className="sm:hidden">` trigger with
   `<SidebarTrigger className="sm:hidden" />` (or wrap a `Button`-styled trigger in `SidebarTrigger asChild`
   if the generated component needs the icon/styling supplied externally — confirm against the
   generated file) — keep the trigger's visibility gated by the same pure-CSS `sm:hidden` class the
   current trigger uses (never dependent on `useIsMobile()`'s client-only resolution), per design.md's
   named SSR mitigation.
4. Replace `<SheetContent side="left">` → `<Sidebar side="left" collapsible="offcanvas">`;
   `<SheetHeader><SheetTitle>` → `<SidebarHeader>` (same Lightning-icon + "xstockstrat" content);
   `<nav aria-label="Mobile">` + the `Accordion` → `<SidebarContent>` wrapping, for each `NAV_GROUPS`
   entry, a `<SidebarGroup>` whose header/label is wrapped in a `<Collapsible open={expanded ===
   group.key} onOpenChange={(open) => setExpanded(open ? group.key : '')}>` (reusing the existing
   `expanded`/`setExpanded` state verbatim, `:165` — do not introduce new state) with
   `<CollapsibleTrigger>` rendering the group icon/label and `<CollapsibleContent>` wrapping a
   `<SidebarGroupContent><SidebarMenu>` of `<SidebarMenuItem><SidebarMenuButton asChild>` items, one
   per `visibleItems(group.items)` entry (preserving the `adminOnly` filter verbatim, `:167` — the
   admin-only `Backfills` entry must not leak).
5. Wire close-on-navigate via `useSidebar()`'s `setOpenMobile(false)` called from each nav `Link`'s
   `onClick` (mirroring the current `SheetClose asChild` auto-close behavior — confirm the exact
   `useSidebar()` return shape against the Step-15-generated file, per its Instruction 4).
6. Preserve the current active-route highlighting (`isItemActive(pathname, sub)` ternary,
   `PlatformHeader.tsx:264-266`) on each `SidebarMenuButton`'s active/current styling.

**Verification**: New e2e coverage (Step 18) must be green; also confirm no remaining `Sheet`/`Accordion`
import in this file (the shared import-block cleanup Step Dependencies calls out):
```bash
cd services/xstockstrat-ui
grep -n "'../ui/sheet'\|'../ui/accordion'" src/components/shared/PlatformHeader.tsx && echo "review: Sheet/Accordion import still present — confirm intentional (e.g. AlertStream still uses Sheet elsewhere, this file's own import may be fully removable)" || echo "OK: Sheet/Accordion imports removed from PlatformHeader.tsx"
pnpm run lint
```

---

### Step 18 — test: New e2e coverage for the mobile `Sidebar` (FR-11 / AC-11)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/mobile-sidebar.spec.ts` — create

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness

**Codebase Evidence**:
- `e2e/mobile.spec.ts:1-58` (read in full) — confirmed this file only tests `BottomTabBar`
  (`getByTestId('mobile-tab-bar')`), never the hamburger/`Sheet` menu — no existing coverage to update,
  this step adds net-new coverage, matching design.md's finding.
- `e2e/helpers/auth.ts` `addAuthCookie`/`addAdminCookie` (per `INVENTORY.md`) — reuse for the
  admin/non-admin sessions this spec needs (C-12; no new fixture).
- `navGroups.tsx:57` — `Backfills` is the one `adminOnly` item; the non-admin assertion targets it by
  name.

**TDD**: `red-green required` — write this spec, run it against pre-Step-17 markup first (fails: no
`SidebarTrigger`/`Sidebar` DOM present, only `Sheet`), then against Step 17's change (passes).

**Instructions**: At a 390×844 viewport (matching `mobile.spec.ts`'s convention), cover: (1) the
trigger opens the offcanvas panel and every non-admin-visible `NAV_GROUPS` item is reachable by label;
(2) a non-admin session's panel never renders "Backfills" (`addAuthCookie`, not `addAdminCookie`); (3)
an admin session's panel does render "Backfills" (`addAdminCookie`); (4) clicking a nav link navigates
and closes the panel (assert the panel is no longer visible after navigation); (5) only one group's
items are expanded/visible at a time (single-open-group — expand a second group, confirm the first
collapses); (6) active-route highlighting — the current route's group/item carries its active styling
class/attribute.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:e2e -g "mobile-sidebar"
```

---

### Step 19 — service: Remove `PlatformHeader`'s shared `Breadcrumb` + add `PageBreadcrumb` component (FR-10a)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/shared/PageBreadcrumb.tsx` — create
- `services/xstockstrat-ui/src/components/shared/PlatformHeader.tsx` — modify (remove lines 286-303, Row 2 Breadcrumb block + orphaned Separator; import block)
- `services/xstockstrat-ui/e2e/nav-reachability.spec.ts` — modify (lines 69-71, restructure to `aria-current`)

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness

**Codebase Evidence**:
- `PlatformHeader.tsx:284-328` (read in full, this session — line numbers confirmed current, matching
  `design.md`'s post-merge citations exactly): Row 2's `<Breadcrumb aria-label="Breadcrumb"
  className="text-xs shrink-0">` block spans `:286-302`; a `<Separator orientation="vertical"
  className="h-4 mx-1" />` immediately follows at `:303`; then the `Section` `NavigationMenu`
  (`:304-327`) renders `activeItems` as `NavigationMenuLink asChild` `Link`s with `aria-current={isItemActive(...)
  ? 'page' : undefined}` already set (`:314`).
- `PlatformHeader.tsx:199-201` — the `Primary` `NavigationMenu`'s group-tab links already set
  `aria-current={isActive ? 'page' : undefined}` too — both `Primary` and `Section` nav links already
  carry the `aria-current="page"` marker on their active entries, independent of the `Breadcrumb`
  block being removed.
- `e2e/nav-reachability.spec.ts:53-75` (read in full) — the single test asserts, per `GROUPS` route
  (15 total across 5 tabs): `primary.getByRole('link', {name: group.tab}).click()`,
  `section.getByRole('link', {name: item.label}).click()`, URL match, then
  `expect(page.getByLabel('Breadcrumb')).toContainText(item.label)` and `...toContainText(group.tab)`
  (`:70-71`) — this is the load-bearing assertion FR-10 must replace.
- `NamespaceEditor.tsx:131-149` (read in full) — the established page-level pattern: a `<Breadcrumb
  aria-label="Namespace path">` with an inline comment explaining the deliberate `aria-label`
  distinctness from the shell's own `"Breadcrumb"` landmark, avoiding the exact `getByLabel`
  substring-collision `fails.md` 2026-08-09 documents.
- `config-ui/audit/page.tsx:31-41` (read in full) — the second existing precedent, `aria-label="Audit
  log path"`.

**TDD**: `red-green required`

**Instructions**:
1. Create `src/components/shared/PageBreadcrumb.tsx`: `interface PageBreadcrumbProps { ariaLabel:
   string; items: { label: string; href?: string }[] }` (no default for `ariaLabel` — the
   collision-avoidance mechanism itself, per design.md). Render `<Breadcrumb aria-label={ariaLabel}>
   <BreadcrumbList>` mapping `items`, inserting a `<BreadcrumbSeparator />` between entries; an item
   with `href` renders `<BreadcrumbLink href={href}>{label}</BreadcrumbLink>`, the last item (or any
   item without `href`) renders `<BreadcrumbPage>{label}</BreadcrumbPage>` — generalizing
   `NamespaceEditor.tsx:137-149`'s exact structure into a reusable shape.
2. In `PlatformHeader.tsx`: delete the entire `<Breadcrumb aria-label="Breadcrumb" ...>...</Breadcrumb>`
   block (`:286-302`) and the immediately-following `<Separator orientation="vertical" className="h-4
   mx-1" />` (`:303`) — do **not** replace them with anything; Row 2 becomes just the `Section`
   `NavigationMenu` (`:304-327`, unchanged). Remove the now-dead `Breadcrumb`/`BreadcrumbList`/
   `BreadcrumbItem`/`BreadcrumbPage`/`BreadcrumbSeparator` import (`:23-29`) from this file's import
   block — check first whether Step 17 already touched/removed a different import in the same block
   (Step Dependencies: whichever of Steps 17/19 runs second inherits the cleanup) and merge cleanly
   rather than reintroducing a stale import list.
3. In `e2e/nav-reachability.spec.ts`, replace the two `getByLabel('Breadcrumb')` assertions (`:70-71`)
   with `aria-current="page"` checks against the just-clicked links: after `primary...click()`, assert
   `primary.getByRole('link', {name: group.tab, exact: true})` has `aria-current="page"`; after
   `section...click()`, assert `section.getByRole('link', {name: item.label, exact: true})` has
   `aria-current="page"`. This preserves the "reflects the active screen" guarantee for all 15
   `GROUPS` routes via the mechanism already present at `PlatformHeader.tsx:199-201,314` (nothing new
   to wire — the markers already exist), matching design.md's resolution of the Round 4 adversary
   objection.

**Verification**:
```bash
cd services/xstockstrat-ui
grep -n "aria-label=\"Breadcrumb\"" src/components/shared/PlatformHeader.tsx && echo "FAIL: shared Breadcrumb still present" || echo "OK: shared Breadcrumb removed"
pnpm test:e2e -g "nav-reachability"
pnpm run lint
```

---

### Step 20 — service: Migrate 2 existing + add 6 new `PageBreadcrumb` sites (FR-10b)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/config-ui/[namespace]/NamespaceEditor.tsx` — modify (migrate lines 131-149 onto `PageBreadcrumb`)
- `services/xstockstrat-ui/src/app/config-ui/audit/page.tsx` — modify (migrate lines 31-41 onto `PageBreadcrumb`)
- `services/xstockstrat-ui/src/app/insights/strategies/[id]/page.tsx` — modify (add, near line 130)
- `services/xstockstrat-ui/src/app/insights/strategies/[id]/edit/page.tsx` — modify (add, near line 18)
- `services/xstockstrat-ui/src/app/insights/formulas/[id]/page.tsx` — modify (add, near line 50)
- `services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx` — modify (add, near line 135)
- `services/xstockstrat-ui/src/app/insights/market/[symbol]/page.tsx` — modify (add, near line 116)
- `services/xstockstrat-ui/src/app/trader/orders/[id]/page.tsx` — modify (add, near line 74)

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness

**Scope note**: this step touches 8 files, above the 5-file split-consideration threshold. Not split:
all 8 are one atomic component rollout — `PageBreadcrumb` only satisfies AC-9's "every new/migrated
site checked together" requirement (see Step 21) if every site lands before the collision test runs;
splitting across steps would leave some sites' collision-safety unverified mid-feature with no
independent value at the split point.

**Codebase Evidence**:
- `NamespaceEditor.tsx:131-149` and `config-ui/audit/page.tsx:29-41` (both read in full) — the two
  existing hand-rolled instances Step 19's `PageBreadcrumb` component generalizes; migrate each to
  `<PageBreadcrumb ariaLabel="Namespace path" items={[{label: '← namespaces', href: \`/config-ui?env=${env}&mode=${mode}\`}, {label: namespace}]} />`
  and `<PageBreadcrumb ariaLabel="Audit log path" items={[{label: '← namespaces', href: '/config-ui'}, {label: 'Audit Log'}]} />`
  respectively (preserving each site's exact link target and terminal-crumb text; `NamespaceEditor.tsx`
  additionally keeps its adjacent env/mode `Badge`s, `:150-157`, untouched — only the `Breadcrumb`
  JSX is replaced).
- `strategies/[id]/page.tsx:128-132` (read in full, per Step 5/11 grounding above — re-confirm fresh
  at execute time per this feature's own hot-file note, since Steps 6/9/11 may have shifted lines) —
  currently just `<h1 className="text-xl font-bold tracking-tight font-mono">{id}</h1>`, no
  breadcrumb; add `<PageBreadcrumb ariaLabel="Strategy path" items={[{label: 'Strategies', href:
  '/insights/strategies'}, {label: id}]} />` immediately above it.
- `strategies/[id]/edit/page.tsx:1-39` (read in full) — `<h1>Edit Strategy</h1>` at `:19`, no
  breadcrumb; add `<PageBreadcrumb ariaLabel="Strategy path" items={[{label: 'Strategies', href:
  '/insights/strategies'}, {label: id, href: \`/insights/strategies/${id}\`}, {label: 'Edit'}]} />`.
- `formulas/[id]/page.tsx:1-60` (read in full, first 60 lines) — no breadcrumb present on any of the
  loading/not-found/loaded branches; add `<PageBreadcrumb ariaLabel="Formula path" items={[{label:
  'Formulas', href: '/insights/formulas'}, {label: formula.name}]} />` on the loaded branch (`:48+`) —
  the loading/not-found branches (`:29-46`) render before `formula` exists, so their crumb should use
  `id` as a fallback label or omit the terminal crumb until the formula loads (a judgment call — prefer
  omitting the `PageBreadcrumb` entirely on those two branches over showing a raw id, since `id` alone
  isn't the display convention this app uses elsewhere).
- `positions/[symbol]/page.tsx:132-142` (read in full) — currently a `Button asChild` "← Exposure"
  back-link (`:136-141`), not a `Breadcrumb`; add `<PageBreadcrumb ariaLabel="Position path"
  items={[{label: 'Exposure', href: '/trader/positions'}, {label: symbol}]} />` — decide whether to
  keep the existing "← Exposure" `Button` alongside the new breadcrumb (redundant back-navigation) or
  replace it; per FR-10's own framing ("move... into each page's own layout"), replacing the ad hoc
  back-button with the breadcrumb's own first-item link is the more consistent outcome, but the
  back-button may carry `min-h-[44px]`-class mobile-tap-target intent the breadcrumb link doesn't —
  verify against `docs/patterns/nextjs-frontends.md`'s mobile tap-target guidance (if any) before
  removing it; if uncertain, keep both rather than regressing mobile usability, and note the decision
  in `context.md`.
- `market/[symbol]/page.tsx:113-125` (read in full) — currently a `Button variant="ghost" asChild`
  "← Queue" link (`:120-125`), same shape/decision as `positions/[symbol]/page.tsx` above; add
  `<PageBreadcrumb ariaLabel="Signal path" items={[{label: 'Opportunities', href:
  '/insights/opportunities'}, {label: symbol}]} />` with the same keep-or-replace judgment call.
- `orders/[id]/page.tsx:71-77` (read in full) — currently `<BackToDashboardButton />` (a shared
  component, not inline markup) at `:75`; add `<PageBreadcrumb ariaLabel="Order path" items={[{label:
  'Orders', href: '/trader/orders'}, {label: order.orderId}]} />` — `BackToDashboardButton` likely
  navigates to `/trader` (the dashboard), not `/trader/orders` (the orders list), so it is not
  redundant with this new breadcrumb's first link and should stay unless a direct read of
  `BackToDashboardButton.tsx` at execute time shows otherwise.

**TDD**: `red-green required`

**Instructions**: For each of the 8 sites, either migrate the existing hand-rolled `Breadcrumb` (2
sites) or add a new `PageBreadcrumb` (6 sites) per the evidence above. Re-read each target file
immediately before editing (per this feature's own "hot-file churn" note — Steps 6/9/11 may have
shifted these exact line numbers) rather than trusting this step's citations verbatim. Every
`ariaLabel` must be distinct from `"Breadcrumb"` (the now-removed shell landmark no longer exists, but
distinctness from every *other* new `PageBreadcrumb` instance and from any real nav `Link`'s
accessible name on the same page still matters — see Step 21's collision test).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint
NEXT_DISABLE_STANDALONE=1 pnpm build
```

---

### Step 21 — test: `breadcrumb.spec.ts` collision coverage for all 8 sites + full-suite gate (FR-10 / AC-9)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/breadcrumb.spec.ts` — create

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness

**Codebase Evidence**:
- `fails.md` 2026-08-09 ("shadcn-migration-high-confidence") — the two prior collision classes this
  test must prove absent for **every** site, not one representative case: (1) a case-insensitive
  `aria-label` substring match between a page-level `Breadcrumb`'s label and another labeled region on
  the same page; (2) `BreadcrumbPage`'s built-in `role="link" aria-current="page"`
  (`ui/breadcrumb.tsx:54-64`) colliding with a real, working nav `Link` of the same accessible name
  elsewhere on the page under `getByRole('link', ...)`.
- The `/config-ui/audit` site is the recon's own cited "genuine, already-present near-collision": the
  Settings group's real `Section` nav link "Audit log" (`navGroups.tsx:79`) vs. the migrated page's own
  terminal crumb "Audit Log" (capitalization differs but `getByRole`'s accessible-name matching is not
  case-sensitive by default) — the deliberately-constructed collision scenario design.md calls for.
- `e2e/helpers/auth.ts` `addAdminCookie` (reused, C-12 — `/insights/backfills`-adjacent routes and the
  Settings-group sites need admin visibility for some of the 8 pages' surrounding nav).

**TDD**: `red-green required` — write the collision assertions against Step 19/20's actual markup;
each of the 8 sites gets at minimum: (a) `getByLabel(exact ariaLabel)` resolves to exactly one element
(no case-insensitive substring collision with `"Section"`/`"Primary"`/another `PageBreadcrumb`'s label
on the same page), and (b) `getByRole('link', {name: <terminal crumb label>, exact: true})` resolves
to at most the breadcrumb's own link if any (never colliding with an unrelated nav `Link` of the same
name).

**Instructions**: One test block per of the 8 `PageBreadcrumb` sites (2 migrated + 6 new), each
navigating to the page and running the (a)/(b) assertions above. Include the `/config-ui/audit`
"Audit Log" vs. "Audit log" near-collision as an explicit named case, not folded into the generic
loop, since it's the one collision the recon found already-present rather than hypothetical. After
this spec passes standalone, run the **full** Playwright suite (chromium) once, per this feature's own
Known Trap: both prior `fails.md` collisions were caught only by a later step's full-suite run, never
the wiring step's own targeted spec — this step is the mandated full-suite gate that catches any
collision `breadcrumb.spec.ts`'s own scope didn't anticipate.

**Verification**:
```bash
cd services/xstockstrat-ui
pnpm test:e2e -g "breadcrumb"
pnpm test:e2e   # full suite, chromium — the mandated closing gate for this FR
```

---

### Step 22 — test: Extend `mobile-overflow.spec.ts` route sweep (FR-3 / AC-3)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/mobile-overflow.spec.ts` — modify (lines 12-27, `ROUTES`)

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness

**Codebase Evidence**:
- `mobile-overflow.spec.ts:12-27` (read in full) — current `ROUTES` has exactly 14 entries; confirmed
  gaps per FR-3 and this session's fixture check: `/accounts/authorized-apps`, `/insights/formulas`
  (no id needed — the list page itself, matching the existing `/insights/strategies` no-id pattern at
  `:17`), `/config-ui/audit`, `/config-ui/platform` (the `[namespace]` route — `platform` confirmed as
  the namespace value `e2e/fixtures/configKeys.ts:20` uses), `/trader/positions/AAPL` (confirmed via
  `e2e/fixtures/positions.ts` `POSITION_AAPL`, per `INVENTORY.md`).
- This step intentionally runs after every markup step (1-21) so it measures final, post-conversion
  widths — per design.md Step 9 and the ledger's `insights.md` 2026-08-06 "matches the handoff" trap
  (an eyeballed/pre-final check misses real overflow regressions).

**TDD**: `red-green required` — run each new route entry against the tree *before* this step's
addition first is not meaningful here (the routes aren't in `ROUTES` yet, so there's nothing to run);
instead, red-before-green means: add the 5 entries, run the spec, and confirm each new test actually
executes and reports a real (not vacuously-passing) overflow measurement — if a route 404s or the auth
cookie is wrong, the test would report `overflow ≤ 1` for a blank/error page, a false pass. Verify each
new route renders real content (a heading, a table, etc.) via a quick manual/scripted check before
trusting a green result.

**Instructions**: Add the 5 route entries to `ROUTES` (`/config-ui/audit` and `/config-ui/platform`
need `admin: true`? — check: `audit` is in the Settings group with no `adminOnly` marker in
`navGroups.tsx:79`, so `admin` is not required; same for `platform` (a regular namespace, not
admin-gated) — use `addAuthCookie`, matching the existing `/config-ui`/`/config-ui/sources` entries'
non-admin treatment).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:e2e -g "no horizontal overflow"
```

---

### Step 23 — test: Horizontal-overflow audit + fix (FR-4 / AC-4)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/mobile-overflow.spec.ts` — verify / extend (add a wide-content or tablet-width case per table found needing one)
- Any of the 11 table-bearing pages listed in Codebase Evidence below, found by this step's own audit
  (Instruction 1) to defeat `overflow-x-auto` — modify (conditionally)

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness

**Scope note**: the second `**Files**` entry above is a placeholder, not an exact path — this is an
investigative step by nature (FR-4's own Open Question: "which table, if any, actually overflows" is
not knowable before the audit runs). Mitigated by enumerating the full closed candidate set (the 11
pages below) rather than leaving it open-ended, and by Instruction 3's explicit "any table found...
must be fixed... in the same step" requirement, so a real finding cannot be silently deferred.

**Codebase Evidence**:
- `src/components/ui/table.tsx:7-17` (read in full) — `Table`'s own wrapper: `<div
  data-slot="table-container" className="relative w-full overflow-x-auto"><table
  className={cn('w-full caption-bottom text-sm', className)} ...>` — the built-in horizontal-scroll
  mechanism FR-4 audits. Root-cause class per `insights.md` 2026-08-06: a flex/grid ancestor missing
  `min-w-0` can silently defeat `overflow-x-auto` (a flex/grid item's default `min-width: auto`
  prevents it from shrinking below its content's intrinsic width, so the overflow never reaches the
  `Table`'s own wrapper).
- Table-bearing pages in scope (every page touched by FR-2/FR-5's `Table`-based conversions plus every
  pre-existing `Table` consumer): `OrdersTable.tsx`, `config-ui/sources/page.tsx`,
  `NamespaceEditor.tsx`, `insights/strategies/page.tsx`, `insights/strategies/[id]/page.tsx` (Past
  Runs), `insights/screener/page.tsx`, `insights/formulas/page.tsx`, `LiveStrategiesPanel.tsx`,
  `config-ui/audit/page.tsx`, `authorized-apps/page.tsx`, `positions/[symbol]/page.tsx` (Orders & fills).
- The 390px phone-frame check (Step 22, `mobile-overflow.spec.ts`) already exercises real fixture data
  (`ORDERS`, `CONFIG_KEY_FIXTURES`, `STRATEGY_DEF_*`, etc.) at every route, but does not specifically
  construct a *wide-content* worst case (a long formula/strategy display name, many columns, or a
  narrower-than-phone tablet width) per FR-4's own requirement to go beyond the single 390px fixture.

**TDD**: `N/A (investigative audit — the "test" step here is the audit process itself and any
resulting fix's own red/green pair)`

**Instructions**:
1. For each table-bearing page listed above, check whether its nearest ancestor of the `Table`
   component is a flex or grid container without `min-w-0` (or `min-width: 0`) — grep each page's
   JSX for `flex`/`grid` classes on the `Table`'s parent chain and confirm `min-w-0` is present
   wherever a flex/grid ancestor exists between the `Table` and the page's outer scrollable region.
2. For at least one page with genuinely wide content (e.g. `config-ui/audit/page.tsx`'s 7-column
   table with a `Reason` column, or `insights/screener/page.tsx`'s widest results table), add a
   tablet-width (e.g. 768px) Playwright viewport case to `mobile-overflow.spec.ts` (or a new adjacent
   spec) asserting `overflow ≤ 1` there too — the concrete "wide content" scenario this FR's own Open
   Question deferred to spec time, now grounded against each table's real column set rather than an
   invented worst case.
3. Any table found to defeat `overflow-x-auto` (an actual regression, not merely "could be tighter")
   must be fixed — most likely by adding `min-w-0` to the offending flex/grid ancestor — and the fix
   covered by extending the same new assertion, not just noted.
4. Record every table checked, the scenario used, and whether a fix was needed in `context.md` per
   AC-4's explicit requirement — this record is itself part of the acceptance criterion, not optional
   bookkeeping.

**Verification**:
```bash
cd services/xstockstrat-ui
pnpm test:e2e -g "no horizontal overflow|tablet"
pnpm run lint
grep -n "FR-4\|horizontal-overflow audit" ../../docs/roadmap/features/124-shadcn-table-actions-responsive/context.md
```

---

### Step 24 — docs: Closing gate

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- None (verification-only step; no new files)

**Reviewers**: none

**Codebase Evidence**: N/A — this step is the feature's own closing gate per `design.md`'s "Chosen
Approach" item 11 and AC-10.

**TDD**: `N/A (verification-only)`

**Instructions**: Run the full lint, build, and e2e suite one final time against the fully-merged
tree (all 23 prior steps landed); confirm `context.md` carries both the FR-4 audit record (Step 23)
and the FR-9 chart-height determination (Step 13/14) before declaring the feature `code-completed`.

**Verification**:
```bash
cd services/xstockstrat-ui
pnpm run lint
NEXT_DISABLE_STANDALONE=1 pnpm build
pnpm test:e2e
```

---

## Deviation Log

### Step 3 — NamespaceEditor.tsx scope narrowing (user-directed)
**Disposition**: resolved via `AskUserQuestion` before implementation (not a silent deviation).
`NamespaceEditor.tsx` is not a pure read-only Actions column like the other 3 FR-2 sites — its
Save/Cancel pair appears alongside actively-edited `Input` fields (`autoFocus`), on a config-mutation
critical path. Converting Save/Cancel into `DropdownMenu` items would hide the primary save action
behind an extra click on every edit. User chose: convert only the read-only Edit trigger to
`DropdownMenu`; Save/Cancel stay direct inline `Button`s once a row enters edit mode. `AC-2`'s
"preserve every action's exact existing behavior" is satisfied for Edit (now menu-gated, matching the
other 3 sites) and literally unchanged for Save/Cancel (untouched markup).

### Step 2 — process-only deviation
**Disposition**: minor, non-blocking. Steps 1 and 2's `**Status**` flips were both made before Step
1's commit (rather than one status edit per commit), so Step 2's status change rode along in Step 1's
commit instead of getting its own. No code/verification impact — Step 2 did no file changes besides
the status flip, and its own commit correctly reported "nothing to commit" as a result. Being more
careful from Step 3 onward: flip a step's status immediately before that step's own commit, not in
advance.

### Step 9 — mechanism deviation from design.md (grounded at implementation time)
**Disposition**: resolved by re-grounding against current code; no behavior/visual regression.
`design.md`'s Round 3 plan (and this step's own **Instructions**, written from that plan) called for
swapping the raw `<button>` for `ui/toggle.tsx`'s `Toggle` component, relying on `toggleVariants`'
`aria-pressed:bg-muted` base class for active-state styling. At implementation time, re-reading the
**current** `ToggleGroupItem` call site (`opportunities/page.tsx:201-216`, confirmed landed by sibling
features 121/122/123 after design.md's Round 3 was written) showed it does **not** use the `Toggle`
primitive's own `data-[state=on]`/`aria-pressed` variant mechanism at all — both it and "All sources"
already share one identical manual `cn()` literal
(`'rounded-full border px-3 py-1 text-xs transition-colors', <active> ? 'border-primary bg-primary/20
text-foreground' : 'border-border text-muted-foreground hover:text-foreground'`). Swapping only "All
sources" to `Toggle`'s own `aria-pressed:bg-muted` styling would have made the two pills' active-state
look diverge (`bg-muted` vs `bg-primary/20`) for the first time, despite `design.md` explicitly wanting
them "verify visually ... still visually distinguishable ... matches the original ... intent closely
enough."
**What shipped instead**: extracted the identical literal into one local helper,
`sourceFilterPillClass(active: boolean): string`, called by both "All sources" and `ToggleGroupItem`
(DRY guard rail — same literal, now one home), and added `aria-pressed={activeSources.length === 0}`
directly to the "All sources" `<button>` (no primitive swap needed — `aria-pressed` is a plain HTML
attribute). This satisfies FR-8/AC-7's actual requirement (`aria-pressed` exposed, folds into the same
visual styling as the `ToggleGroup` pills) while keeping the already-working, already-shared visual
mechanism unchanged instead of introducing a second one. TDD: Step 10's e2e test was confirmed RED
against pre-Step-9 markup (`toHaveAttribute('aria-pressed', 'true')` found nothing — the button never
set the attribute), then GREEN after this change; full `opportunities.spec.ts` (13/13) and `pnpm lint`
both clean.

### Step 17 — `SidebarProvider`'s default wrapper sizing broke Row 1's flex layout (found via failing e2e, not by inspection)
**Disposition**: resolved by an explicit `className` override; no design.md mechanism deviation —
the vendored primitive itself needed defensive scoping design.md couldn't have specified (it doesn't
inspect `SidebarProvider`'s literal className string).
`SidebarProvider`'s generated wrapper `<div>` (`sidebar.tsx:128-147`) carries
`"group/sidebar-wrapper flex min-h-svh w-full has-data-[variant=inset]:bg-sidebar"` — sized for its
intended use as the app's page-level root, not for being nested inline inside Row 1's own
`<div className="flex items-center gap-2 ml-auto">`. Wiring it in as originally planned (no override)
passed `pnpm build`/`pnpm lint` cleanly but broke Step 18's own new e2e coverage: Playwright reported
the "Open menu" trigger button as "outside of the viewport" — `min-h-svh` (100% of the small viewport
height) on a `<div>` nested mid-header stretched that flex item far taller than Row 1's `h-[49px]`,
pushing the trigger button below the visible fold. **Fix**: `<SidebarProvider defaultOpen={false}
className="w-auto min-h-0">` — `cn()`'s tailwind-merge resolves the conflicting `min-h-*`/`w-*` groups
in the passed `className`'s favor over the component's own base classes, neutralizing the page-root
sizing while keeping `SidebarProvider`'s actual job (mounting `SidebarContext`) intact. Caught by
running Step 18's e2e against the real implementation (not just `build`/`lint`, which are blind to
runtime layout) — reinforces why the TDD gate requires an actual browser run, not just a type-check,
for layout-sensitive vendored-primitive wiring.

### Step 21 — mobile `Sidebar`'s desktop DOM footprint collided with Row 2's real nav (found via Step 21's own new e2e, not anticipated by design.md)
**Disposition**: resolved with a CSS `display:none` wrapper; a genuine accessibility-tree defect
introduced by Step 17 (FR-11b), discovered only once Step 21's collision coverage (FR-10, written
against `design.md`'s pre-FR-11 analysis) exercised a page whose active nav group happened to be
expanded by default in the mobile sidebar.
`Sidebar`'s desktop/non-mobile branch (`sidebar.tsx:207-249`, `isMobile===false`) is `fixed`-positioned
and pushed off-screen via a negative `left` offset when collapsed (`data-collapsible="offcanvas"`) —
**not** `display:none`. Combined with Radix `Collapsible.Content` keeping closed-group content mounted
in the DOM, and `expanded` defaulting to the current route's active group (`PlatformHeader.tsx`'s
existing `React.useState<string>(activeGroup.key)`), landing directly on `/config-ui/audit` left the
mobile sidebar's Settings group content — including its own "Audit log" `SidebarMenuButton` link —
fully mounted and role/label-queryable at the **default desktop viewport**, even though visually
off-screen. Step 21's own `breadcrumb.spec.ts` collision test caught this directly: `getByRole('link',
{name: 'Audit log', exact: true})` resolved to **2** elements (Row 2's real `Section` nav link + the
off-screen mobile sidebar's own copy) instead of the expected 1 — a genuine duplicate-interactive-
content a11y defect (off-screen but focusable/queryable), not a false positive in the test.
**Fix**: wrapped the entire `SidebarProvider`/`MobileNavTrigger`/`Sidebar` subtree in a
`<div className="sm:hidden">` (`PlatformHeader.tsx`) — `display:none` removes the whole subtree from
both the visual and accessibility trees at `sm:`+ widths, not just repositioning it. The individual
`sm:hidden` previously only on `MobileNavTrigger` was removed as redundant. Re-verified: the full
`breadcrumb.spec.ts` (10/10) and the mandated full-suite gate (Step 21's own instruction) both green
after the fix.

### Step 21 (continued) — the full-suite gate itself caught a second, pre-existing latent defect
**Disposition**: fixed in the test, not the feature code — a genuine test-quality gap the `sm:hidden`
fix above exposed, not a regression it caused.
Before the `sm:hidden` fix, the mobile sidebar's off-screen desktop copy was positioned out of the
viewport but **not** `display:none` — Playwright's `toBeVisible()` does not check viewport position,
only CSS `display`/`visibility` and a non-empty bounding box, so that off-screen element still counted
as "visible." `e2e/trader/positions-reconciliation.spec.ts`'s `getByText('Exposure').first()` therefore
silently matched the sidebar's own "Exposure" nav link (which sits earlier in DOM order than the
page's real `<h1>Exposure</h1>`, since `PlatformHeader` renders before `<main>`) and reported it as
visible — the test was passing without exercising what it claimed to. Once `sm:hidden` correctly hid
that duplicate, `.first()` still resolved to the same (now genuinely hidden) element and the test
failed for the first time — surfacing the pre-existing fragility rather than introducing a new one.
**Fix**: `getByText('Exposure').first()` → `getByRole('heading', {name: 'Exposure'})`, matching the
already-correct convention `positions.spec.ts:37` uses for the identical heading. Re-ran the full
suite: **all green**.
