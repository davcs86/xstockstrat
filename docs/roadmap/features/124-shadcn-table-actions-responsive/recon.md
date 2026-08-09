# Recon: shadcn-table-actions-responsive

**Created**: 2026-08-09
**From**: product-spec.md
**Affected services**: `xstockstrat-ui`

---

## Objective

Adopt shadcn `DropdownMenu` for every multi-action table Actions column, close remaining
`e2e/mobile-overflow.spec.ts` route/horizontal-scroll gaps, eliminate the last two raw `<table>`s and
several hand-rolled Badge/ToggleGroup-shaped elements, add a shared "eyebrow" label component, land two
small cosmetic fixes, and move the shared shell's generic breadcrumb into each page's own layout so it
reflects real page position. All changes are frontend-only in `xstockstrat-ui`.

## Codebase Map

- **`xstockstrat-ui`** (Next.js)
  - shadcn config: `services/xstockstrat-ui/components.json:3` — `"style": "radix-rhea"`, preset
    `bLTl5gh6`. 21 CLI-vendored primitives exist under `src/components/ui/`
    (`badge.tsx`, `alert-dialog.tsx`, `toggle-group.tsx`, `table.tsx`, `breadcrumb.tsx`, …).
    `dropdown-menu.tsx` does **not** exist (confirmed via glob, 0 hits) — FR-1 must add it.
  - Collateral-regeneration reconciliation convention: `services/xstockstrat-ui/CLAUDE.md:37-48` —
    `apply --preset` overwrites every listed primitive file wholesale; app-specific functional
    variants (`buy`/`sell`/`paper`/`live`/`warning`/`info` on `Badge`) must be hand-re-added post-regen,
    guarded by `button.test.ts`/`badge.test.ts`.
  - Actions-column sites (current code, post-feature-120-merge):
    - `src/components/trader/OrdersTable.tsx:124-160` — inline `Button` (Edit) + full
      `AlertDialog`/`AlertDialogTrigger`/`AlertDialogContent`/`AlertDialogAction`/`AlertDialogCancel`
      (Cancel) in a `TableCell`; header `Actions` at line 85.
    - `src/app/config-ui/sources/page.tsx:337-351` — two inline `Button`s (Disable/Enable, Edit) in a
      flex div; header `Actions` at line 302.
    - `src/app/config-ui/[namespace]/NamespaceEditor.tsx:228-273` — conditional inline `Button`s
      (Edit / Save+Cancel); header `Actions` at line 182.
    - `src/app/insights/strategies/page.tsx:206-226` (`StrategyRow`) — conditional inline `Button`s
      (Edit/Deactivate) vs. a plain `Link`; header `{isAdmin ? 'Actions' : ''}` at line 128. Deactivate
      uses **`window.confirm(...)`** (product-spec's "behind an `AlertDialog`" claim is **wrong** — no
      `AlertDialog` import in this file; only `OrdersTable.tsx`'s Cancel is genuinely `AlertDialog`-gated).
  - Raw `<table>` sites:
    - `src/app/insights/strategies/[id]/page.tsx:469-541` — raw `<table>`/`<thead>`/`<tbody>`, rows are
      `<tr role="button" tabIndex={0} aria-selected=... onClick=... onKeyDown=...>` (486-500).
    - `src/app/insights/screener/page.tsx:536-554+` — raw `<table data-testid="screen-results">`, rows
      `<tr data-testid="result-row">` (no click handler; plain display, 10 columns).
    - Target pattern (already `TableRow` + `onClick`, not hand-rolled `role="button"`):
      `src/components/trader/LiveStrategiesPanel.tsx:46-50`, `src/app/insights/formulas/page.tsx:115-118`.
  - e2e coverage:
    - `services/xstockstrat-ui/e2e/mobile-overflow.spec.ts:10,12-27` — 390×844 viewport; `ROUTES` has 14
      entries today. Missing per FR-3: `/accounts/authorized-apps`, `/insights/formulas`,
      `/config-ui/audit`, a `/config-ui/<namespace>` route, `/trader/positions/<symbol>`.
    - `services/xstockstrat-ui/e2e/nav-reachability.spec.ts:70-71` — asserts
      `getByLabel('Breadcrumb')` contains both `item.label` and `group.tab` for every route in `GROUPS`
      (lines 15-51) — this assertion is the load-bearing dependency FR-10 must restructure, not just
      relocate.
  - Eyebrow-label literal (`font-mono text-[9px] font-semibold uppercase tracking-[0.13em]
    text-muted-foreground`) — **verified 14 occurrences across 7 files** (product-spec's "9 files"
    claim is wrong):
    `src/app/insights/market/[symbol]/page.tsx:29` (1) ·
    `src/app/trader/positions/page.tsx:522,539` (2) ·
    `src/app/trader/orders/[id]/page.tsx:172` (1) ·
    `src/app/trader/positions/[symbol]/page.tsx:250,261,406,452,477,498` (**6**) ·
    `src/app/trader/portfolio/page.tsx:148,227` (2) ·
    `src/components/insights/SignalReadiness.tsx:110` (1) ·
    `src/components/shared/StatTile.tsx:21` (1).
  - Hand-rolled Badge/ToggleGroup sites:
    - `src/app/insights/opportunities/page.tsx:190-216` — hand-rolled `<button>` pills, `cn()` ternary
      toggle, multi-select (any subset of sources can be active simultaneously).
    - `src/app/insights/opportunities/page.tsx:348` and `src/app/insights/market/[symbol]/page.tsx:147`
      — identical hand-rolled source pill (`rounded-full border border-border px-2 py-0.5 text-[11px]
      text-muted-foreground`).
    - `src/components/insights/StrategyWizard.tsx:159-178` — hand-rolled `<ol>` step indicator,
      active/complete/upcoming color via `cn()` ternary.
    - `src/components/trader/AlertStream.tsx:50-57` — hand-rolled unread-count pill,
      destructive/primary color via `hasHighSeverity` (line 42).
    - Existing primitives: `src/components/ui/badge.tsx:7-33` (`badgeVariants` incl. app-specific
      `buy/sell/paper/live/warning/info`); `src/components/ui/toggle-group.tsx` (Radix-backed).
    - **`ToggleGroup type="multiple"` has zero precedent anywhere in `src/`** — both live usages
      (`src/app/insights/screener/page.tsx:350-362`, `src/components/trader/OrderForm.tsx:146-159`) are
      `type="single"`. FR-8's premise of "matching existing usage" is about the *component*, not an
      identical `type` — this will be the first `type="multiple"` usage in the codebase.
  - Cosmetic-fix sites:
    - `src/app/accounts/authorized-apps/page.tsx:174-175` — `text-green-600`/`bg-green-600` (Reachable
      branch only; the Unreachable branch already uses `text-destructive`/`bg-destructive`, not green —
      product-spec's `:175,179` citation is off by a few lines).
    - `src/components/trader/ChartPanel.tsx:157` (`style={{height:320}}`, fed by
      `useCandlestickChart(320)` at line 29), `src/app/trader/positions/[symbol]/page.tsx:317`
      (`height:260` / `useCandlestickChart(260)` at line 70), `src/app/insights/market/[symbol]/page.tsx:200`
      (`height:480` / `useCandlestickChart(480)` at line 45).
  - Breadcrumb / shell:
    - `src/components/shared/PlatformHeader.tsx:155-283` (`PlatformHeaderInner`) — `resolveActive(pathname)`
      derives `{ group: activeGroup, item: activeItem }` from `NAV_GROUPS`
      (`src/components/shared/navGroups.tsx`, single source of truth); falls back to `NAV_GROUPS[0]` for
      unmatched/dynamic routes.
    - Row 1 (`:166-263`): logo, `<nav aria-label="Primary">` desktop group-tab Links (`:178-197`),
      mobile `Sheet`+`Accordion` menu.
    - Row 2 (`:264-290`): `<Breadcrumb aria-label="Breadcrumb">` (`:265-282`) rendering
      `activeGroup.label` then, if `activeItem`, a separator + `activeItem.label` via `BreadcrumbPage`;
      immediately followed by `<nav aria-label="Section">` (`:284+`) rendering `activeItems` as Links.
    - 4 shell mount points: `src/components/trader/AppShell.tsx:17-27`,
      `src/components/insights/AppShell.tsx:20`, `src/app/config-ui/layout.tsx:13`,
      `src/app/accounts/layout.tsx:22` — all pass `segment`/`subNav`/`actions` to `<PlatformHeader>`.
    - `src/components/ui/breadcrumb.tsx:54-65` — `BreadcrumbPage` has built-in
      `role="link" aria-disabled="true" aria-current="page"`.
    - Page-level precedents (both already use a distinct `aria-label` deliberately to avoid
      `nav-reachability.spec.ts` `getByLabel('Breadcrumb')` collisions):
      `src/app/config-ui/[namespace]/NamespaceEditor.tsx:132-149` (`aria-label="Namespace path"`, comment
      explains the deliberate distinctness), `src/app/config-ui/audit/page.tsx:31,38`
      (`aria-label="Audit log path"`).
  - Test-data inventory (`services/xstockstrat-ui/e2e/fixtures/INVENTORY.md`): orders
    (`e2e/fixtures/orders.ts:25` — `ORDER_FILLED`/`ORDER_WORKING`/`ORDER_UNKNOWN_INTENT`/`ORDERS`),
    strategies (`e2e/fixtures/strategies.ts:16-17` — `STRATEGY_DEF_LIVE`/`STRATEGY_DEF_INACTIVE`/
    `STRATEGY_SCORE_*`), config keys/namespaces (`e2e/fixtures/configKeys.ts:26-27` —
    `CONFIG_KEY_FIXTURES`). Signal sources (config-ui/sources) are **not yet centralized** — inline in
    `e2e/mock-backend.ts:60`.

## Patterns to REUSE

- DropdownMenu Actions column → no existing example in this codebase (first use); follow shadcn's
  standard trigger-icon-button + `DropdownMenuContent`/`DropdownMenuItem` composition, preserving each
  action's existing handler/`AlertDialog` wiring verbatim.
- Raw-`<table>` → `Table` conversion → reuse `src/components/trader/LiveStrategiesPanel.tsx:46-50` and
  `src/app/insights/formulas/page.tsx:115-118`'s real `TableRow` + `onClick` (+ existing
  `role`/`aria-selected`/`onKeyDown` props copied verbatim onto `TableRow`, not re-derived) — the exact
  pattern `121`'s own Step 10 already uses for the identical site.
- Badge-shaped pill → real `Badge` → `src/components/ui/badge.tsx` `badgeVariants` (`outline` variant
  fits the source-pill sites; `default`/`destructive` fit AlertStream/step-indicator color logic).
- Multi-select filter pills → `ToggleGroup type="multiple"` → primitive exists
  (`src/components/ui/toggle-group.tsx`) even though no `type="multiple"` call site exists yet; the
  `type="single"` usages (`screener/page.tsx:350-362`, `OrderForm.tsx:146-159`) establish the
  `variant="outline"` styling convention to match, not the `type` value.
- Eyebrow label → new shared component (no existing one) — house it under `src/components/shared/`
  alongside `StatTile.tsx`, matching that file's export/prop-shape convention (one of its own 14 sites).
- Page-level breadcrumb → reuse `NamespaceEditor.tsx:132-149`'s established convention exactly: a
  distinct `aria-label`, deliberate to avoid `nav-reachability.spec.ts` collisions.
- e2e fixtures for new/updated specs → reuse `orders.ts`, `strategies.ts`, `configKeys.ts`; signal
  sources stay inline per the inventory's current (not-yet-centralized) state — do not invent a new
  fixture module unless a second consumer of an inline literal forces it (C-12).

## Dependencies

- Proto/RPC: none
- Migration: none
- Config keys: none
- Inter-service edges: none (frontend-only)
- New env vars / ports: none

## Risks / Not-found

- **Ledger trap (`fails.md` 2026-08-09, feature 120)**: `Breadcrumb`/`BreadcrumbPage` has twice collided
  with Playwright `getByRole`/`getByLabel` locators — a lowercase-default `aria-label` substring-matching
  the shell's own, and `BreadcrumbPage`'s built-in `role="link"` colliding with a same-named real nav
  `Link`. Each was caught only by a *later* step's full-suite run. FR-10 multiplies `Breadcrumb`
  instances from 1 shared to potentially many page-level ones — every new instance's `aria-label`
  distinctness and `role="link"` collision must be checked against the full e2e suite (a broader `-g`
  run, not just the changed spec) before a step is marked done.
- **Ledger trap (`fails.md`/`insights.md` 2026-08-06, feature 083)**: a "matches the handoff" visual
  sign-off can miss horizontal-overflow regressions entirely; FR-3/FR-4's automated sweep is the actual
  gate, not an eyeballed check.
- **Substantive overlap — CONFIRMED at implementation-spec level against sibling features 121 and 123
  (both `implementation-ready`, neither yet executed)**:
  - `121` Step 7 (`121:344-377`) already implements the **exact same Badge-driven fix** for
    `AlertStream.tsx`'s unread pill that 124's FR-7 proposes.
  - `121` Step 10 (`121:452-493`) already implements the **exact same `Table` conversion** for
    `strategies/[id]/page.tsx`'s Past Runs table that 124's FR-5 proposes — including reusing
    `LiveStrategiesPanel.tsx` as the pattern and preserving `role="button"`/`aria-selected`/`onClick`/
    `onKeyDown` verbatim.
  - `121` Step 11 (`121:497-539`) already implements the **exact same `Table` conversion** for
    `screener/page.tsx`'s results grid that 124's FR-5 proposes (also drops the redundant manual
    `overflow-x-auto` wrapper, since `Table` renders its own).
  - `123` Step 14 (`123:982-1069`) already plans to replace `StrategyWizard.tsx:159-178`'s step
    indicator with **`Questionnaire.Progress`** — not a Badge conversion. This directly conflicts with
    124's FR-7 Badge-driven plan for the same lines; the two approaches are architecturally
    incompatible on the same element.
  - **Correction to the earlier product-spec-level overlap scan**: `121`'s product-spec FR-6 ("Extend
    Toggle Group... to `opportunities/page.tsx:189-216`") has **no corresponding implementation-spec
    step** — grepped 0 hits for `opportunities`/`ToggleGroup` in `121`'s `implementation-spec.md`,
    `design.md`, and `context.md`. FR-6 appears to have been silently dropped between product-spec and
    implementation-spec with no recorded rationale (a gap in `121`, out of scope to fix here). This
    means 124's FR-8 (the same site) is **not** actually duplicate work — no conflict.
  - `121` Step 18 (`121:852-921`) migrates `PlatformHeader.tsx:170-190,271-287` onto `NavigationMenu` —
    line 271-287 sits inside/adjacent to the Row 2 breadcrumb block (`:264-283`) that 124's FR-10
    proposes to remove/restructure. Both features rewrite the same `PlatformHeaderInner` render
    function in overlapping regions — real merge-conflict and logical-conflict risk (121's step assumes
    the breadcrumb JSX is still there when it edits the surrounding `Section` nav; 124 wants to remove
    it), not just a same-file coincidence.
  - `120` (`code-completed`, merged to `main-dev` at `e4dbc0f`) already delivered the current
    `Breadcrumb`/`AlertDialog` primitives this recon read as "current code" — no forward risk from 120,
    it's already landed.
- Not found: no dedicated fixture module for config-ui signal sources (inline in `e2e/mock-backend.ts`
  today) — acceptable per C-12's "first consumer stays inline" rule, not a gap to fix.

## Recommended Scope

Given the confirmed overlaps above, the design phase (Phase 1) must decide, per FR, whether 124
executes the site itself, defers to the sibling feature, or requires an explicit sequencing dependency
— this is the primary open question, not a secondary risk note:

- FR-1 (DropdownMenu primitive), FR-2 (Actions-column conversions), FR-3 (mobile-overflow route
  additions), FR-4 (horizontal-scroll audit), FR-6 (eyebrow label), FR-9 (2 cosmetic fixes): no
  confirmed overlap — safe to scope into 124 as written (with FR-2's `strategies/page.tsx` Deactivate
  citation corrected to `window.confirm`, not `AlertDialog`).
- FR-5 (2 raw `<table>` sites), FR-7's `AlertStream.tsx` site: **already implemented by 121's spec** —
  candidates to drop from 124 and defer to 121, unless the design explicitly decides 124 should
  supersede and 121 should be trimmed instead (a cross-feature edit, needs its own sign-off).
- FR-7's `StrategyWizard.tsx` site: **architecturally conflicts with 123's spec** (Badge vs.
  `Questionnaire.Progress`) — drop from 124, defer entirely to 123.
- FR-8 (`opportunities/page.tsx` `ToggleGroup`): genuinely unclaimed — keep in 124, correct the
  "matches existing usage" citation to note this is the first `type="multiple"` call site.
- FR-10 (breadcrumb repositioning): real file-level conflict with 121's Step 18 `NavigationMenu`
  migration in the same render function — needs an explicit sequencing decision (124 after 121, or a
  design that's resilient to whichever lands first) before `/sdd-spec` can write concrete steps.
