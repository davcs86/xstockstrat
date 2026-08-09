# Product Spec: shadcn-migration-medium-confidence

**Created**: 2026-08-08

---

## Problem Statement

The same full-codebase "Component Ledger" audit that produced the high-confidence migration
(`120-shadcn-migration-high-confidence`) also found 22 **medium-confidence** occurrences: shapes that
match a shadcn primitive less exactly (a `window.confirm()` browser dialog standing in for a themed
confirm, a checkbox styled/labeled as a toggle, a filter toolbar built twice independently) or where
the primitive itself is a looser fit (Navigation Menu for route-based nav). These are lower-certainty
than the high-confidence tier but still real, named duplication or gap patterns worth a dedicated pass.

## User Story

As an `xstockstrat-ui` developer, I want the medium-confidence duplicated/gap widgets replaced with
shared `ui/*` primitives (or, where the shape isn't a primitive gap, a shared non-primitive component),
so the remaining scattered reimplementations — five different `window.confirm()` destructive-confirms,
two independently-built filter toolbars, a checkbox that's actually a switch — converge on one
implementation each.

## Functional Requirements

FR-1. Add `src/components/ui/switch.tsx` (`npx shadcn@latest add switch` against the existing
`components.json` preset, per `services/xstockstrat-ui/CLAUDE.md` § Styling) and replace
`src/app/config-ui/sources/page.tsx:504-515` — a checkbox with `id="active-toggle"` and a boolean
"Active" label that the audit found reads as a switch, not a checkbox.

FR-2. Add `src/components/ui/slider.tsx` (`npx shadcn@latest add slider`) and replace
`src/app/insights/screener/page.tsx:396-405` — the factor-weight raw `<input type="range">`.

FR-3. Add `src/components/ui/collapsible.tsx` (`npx shadcn@latest add collapsible`) and replace
`src/components/trader/accountShared.tsx:116-167` (`EditCredentialsForm` — "Edit keys" expand/collapse).

FR-4. Extend `Alert Dialog` (added by `120-shadcn-migration-high-confidence`, FR-3) to the five
`window.confirm()` call sites this audit rated medium confidence: `src/app/insights/watchlists/page.tsx:75`
(delete watchlist); `src/app/insights/formulas/[id]/page.tsx:22` (delete formula);
`src/app/insights/strategies/page.tsx:53-57` (delete/deactivate strategy);
`src/app/insights/backfills/page.tsx:128` (cancel running backfill);
`src/app/accounts/authorized-apps/page.tsx:72` (revoke authorized app). **Depends on
`120-shadcn-migration-high-confidence` shipping `ui/alert-dialog.tsx` first** — see Open Questions.

FR-5. Extend `Tabs` (added by `120-shadcn-migration-high-confidence`, FR-1) to
`src/app/config-ui/page.tsx:60-120` (`EnvModeSwitcher` — two independent segmented switchers: env and
mode). Depends on `120-shadcn-migration-high-confidence`.

FR-6. Extend `Toggle Group` (added by `120-shadcn-migration-high-confidence`, FR-2) to
`src/app/insights/opportunities/page.tsx:189-216` (multi-select source-filter pills). Depends on
`120-shadcn-migration-high-confidence`.

FR-7. Extend `Alert` (added by `120-shadcn-migration-high-confidence`, FR-4) to
`src/components/insights/BacktestDiagnostics.tsx:98-105` (no-trade reason notice) and
`src/components/insights/StrategyWizard.tsx:306-319` (server-error banner with an inline "Go to Step"
action link). Depends on `120-shadcn-migration-high-confidence`.

FR-8. Extend `Checkbox` (added by `120-shadcn-migration-high-confidence`, FR-5) to
`src/app/insights/backfills/page.tsx:251-258` ("Overwrite existing bars" option). Depends on
`120-shadcn-migration-high-confidence`.

FR-9. Extend `Accordion` (added by `120-shadcn-migration-high-confidence`, FR-8) to
`src/components/trader/LiveStrategiesPanel.tsx:44-50,90-118` (row-click reveals a detail panel below
the table). Depends on `120-shadcn-migration-high-confidence`.

**Note on codebase state**: `119` is already taken on `main-dev` by an unrelated, separately-landed
feature, `119-shadcn-ui-migration` (the shadcn CLI infra adoption). Every bare "depends on" reference
above means this feature's own sibling, `120-shadcn-migration-high-confidence` — not `119` — and every
FR here was re-checked against post-119 `main-dev`; none of this feature's file:line citations fall in
the three files that migration touched (`ChartPanel.tsx`, `RuleEditor.tsx`, `ComponentEditor.tsx`).

FR-10. Switch `src/components/trader/AlertStream.tsx:46-58` (unread-count pill on the bell icon) and
`src/components/trader/AccountSelector.tsx:64-77` (destructive status dot) to the existing
`src/components/ui/badge.tsx` `Badge` component — no new primitive needed.

FR-11. Switch `src/app/insights/strategies/[id]/page.tsx:470-500` (selectable backtest-run rows) and
`src/app/insights/screener/page.tsx:~555-605` (screener results grid) to the existing
`src/components/ui/table.tsx` `Table`/`TableRow`/`TableCell` family, matching the pattern already used
by the sibling `src/app/insights/strategies/page.tsx` and `src/app/config-ui/audit/page.tsx` — no new
primitive needed. `insights/strategies/[id]/page.tsx`'s selectable-row interaction (`role="button"`,
`aria-selected`, keyboard handler) must be preserved on top of `TableRow`.

FR-12. Extract a single shared, non-primitive `src/components/shared/FilterToolbar.tsx` (search Input +
N Selects + active-filter count + "Clear filters") and replace the two independent hand-built copies:
`src/components/trader/AccountsModule.tsx:63-135` and `src/components/trader/OrderFilters.tsx:85-138`.
This is a DRY consolidation, not a shadcn primitive gap — shadcn's Data Table recipe does not ship a
standalone filter-toolbar component to import.

FR-13. Replace the hand-built nav rows in `src/components/shared/PlatformHeader.tsx:170-190,271-287`
(desktop Primary/Section navs) and `src/components/mobile/BottomTabBar.tsx:28-54` with a Radix
`Navigation Menu`-based `ui/navigation-menu.tsx`. The audit rated this medium confidence and noted
these are route-based navigation (not shadcn's dropdown-mega-menu use case), and `/sdd-design`'s
initial (self-run, not user-gated) recommendation was to keep the hand-built version as-is —
**resolved 2026-08-08 by a live user decision to replace** (see `design.md` § Round 3), overriding
that recommendation. `NavigationMenuLink` is usable standalone (no `Trigger`/`Content` dropdown
pairing needed) for this flat, route-based nav shape. The mobile Sheet nav
(`PlatformHeader.tsx:195-255`, disclosure/accordion behavior) is out of scope for this FR — only the
two desktop `<nav>` regions and `BottomTabBar.tsx`'s flat nav are replaced.

FR-14. Every new `ui/*` file added under this feature matches the **existing post-119 primitives'
actual output shape**: a plain function component (`function X({ className, ...props })`), `cva()` +
`cn()` from `ui/utils.ts`, `data-slot` props — **not** `React.forwardRef`/`displayName`. None of the
seven existing primitives use the `forwardRef` pattern (verified 2026-08-08 against
`ui/badge.tsx`, `ui/select.tsx`, `ui/sheet.tsx` — no `forwardRef`/`displayName` occurrences in any of
the three), and sibling `120-shadcn-migration-high-confidence`'s recon.md/product-spec.md FR-12
independently confirms the same shape. Any app-specific `cva` variant this feature's primitives need
(mirroring the `buy`/`sell`/`paper`/`live` pattern on `ui/badge.tsx:19-24`) is marked `// app-specific`
and covered by a `<name>.test.ts` asserting it survives a future `apply --preset` re-run, matching
`button.test.ts`/`badge.test.ts`.

## Out of Scope

- The 27 high-confidence occurrences — `120-shadcn-migration-high-confidence` (must ship first; see
  Open Questions on ordering).
- The 4 low-confidence occurrences — `shadcn-migration-low-confidence`.
- The 12 bespoke "no close match" widgets the audit found correctly-not-reinvented.
- Any visual/behavioral redesign beyond swapping the underlying markup or consolidating duplicated
  toolbar/table code — like-for-like substitution only.

## Affected Services

- `xstockstrat-ui` — all touched files live in this service (`src/components/{insights,mobile,shared,trader}/*`, `src/app/{insights,trader,config-ui,accounts}/**`); four new primitives (`switch`, `slider`, `collapsible`, optionally `navigation-menu`) plus one new shared non-primitive component (`FilterToolbar`).

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **UI** — `xstockstrat-ui` segments `/insights` (opportunities, backfills, watchlists, formulas/[id], strategies, strategies/[id], screener, BacktestDiagnostics, StrategyWizard), `/trader` (AlertStream, AccountSelector, AccountsModule, OrderFilters, LiveStrategiesPanel, accountShared), `/config-ui` (page.tsx EnvModeSwitcher, sources/page.tsx), `/accounts` (authorized-apps), plus shared nav (`PlatformHeader`, `BottomTabBar`). All like-for-like swaps or DRY consolidations inside already-shipped, already-reachable pages — no new routes.
- [ ] **Agent** — not applicable.
- [ ] **None**.

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

- [x] No new config keys

## Database Changes

- [x] No schema changes

## Feature Workflow Notes

Branch to create: `feature/shadcn-migration-medium-confidence` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking, UI-only change — `xstockstrat-ui` owner)
- [ ] 2 service owners + platform lead (breaking proto change) — not applicable
- [ ] DBA review + service owner (schema migration) — not applicable

## Acceptance Criteria

1. `src/components/ui/{switch,slider,collapsible}.tsx` exist (via the shadcn CLI against the existing
   preset, or hand-authored to the same shape as a fallback) and follow the conventions documented in
   `services/xstockstrat-ui/CLAUDE.md` § Styling; `ui/navigation-menu.tsx` exists only if FR-13's
   evaluation concludes replacement is warranted.
2. Every FR-1 through FR-12 file:line occurrence renders the corresponding primitive or shared
   component; replaced hand-rolled markup is deleted.
3. `window.confirm()` no longer appears in any of the five FR-4 call sites.
4. `AccountsModule.tsx` and `OrderFilters.tsx` both render `FilterToolbar` with no duplicated
   toolbar-composition JSX remaining in either file.
5. `pnpm lint` and `pnpm build` pass with no new errors; `pnpm test:e2e` passes for every spec covering
   a touched page/component, with assertions updated to the new markup's accessible roles/labels where
   the old ones (raw classNames, `window.confirm` interception) no longer apply.
6. `context.md` records the FR-13 keep-vs-replace decision for Navigation Menu and the rationale.

## Open Questions

- [x] **Merge order — confirmed, not yet registered centrally.** FR-4 through FR-9 consume primitives
  (`alert-dialog`, `tabs`, `toggle-group`, `alert`, `checkbox`, `accordion`) that
  `120-shadcn-migration-high-confidence` adds — this feature cannot land those steps until
  `120-shadcn-migration-high-confidence` merges (or `/sdd-spec` sequences its own local copy and
  reconciles at integration). This is now a **known, documented dependency** (design.md records the
  rationale; `docs/roadmap/features/merge-order.md` gets the actual blocking-dependency row added
  centrally, after all four sibling shadcn-migration features have run `/sdd-design` — see this
  feature's `context.md` for the exact recommended row text). FR-1/FR-2/FR-3/FR-10/FR-11/FR-12/FR-13
  have no such dependency and can land independently if the two features are reordered — confirmed by
  re-checking each of those seven FRs' file:line citations: none reference a primitive `120` adds.
  Note: `119` itself is already taken on `main-dev` by the unrelated `119-shadcn-ui-migration` — the
  dependency here is on `120`, not `119`.
- [x] **e2e window.confirm coverage — grepped 2026-08-08.** `grep -rn "window.confirm\|page.on('dialog'"
  services/xstockstrat-ui/e2e/` finds `page.on('dialog', ...)` interception at exactly 3 of the 5 FR-4
  call sites: `e2e/accounts/authorized-apps.spec.ts:61` (revoke authorized app),
  `e2e/insights/backfills.spec.ts:126` (cancel backfill), `e2e/insights/watchlists.spec.ts:51` (delete
  watchlist) — all three must be rewritten to interact with `AlertDialog` instead of intercepting the
  browser dialog. The other two FR-4 sites have **no existing e2e coverage** of the confirm flow at all:
  `formulas/[id]/page.tsx:22`'s delete (`e2e/insights/formulas.spec.ts` only asserts the Delete button
  is absent for read-only system formulas — `formulas.spec.ts:62` — it never exercises the delete path)
  and `strategies/page.tsx:53-57`'s deactivate (no `Deactivate`/`handleDeactivate` hit anywhere under
  `e2e/`). Those two are a pre-existing test gap, not a migration regression risk, and are out of this
  feature's scope to backfill (like-for-like substitution only, per Out of Scope) — noted here so
  `/sdd-execute` doesn't mistake "no e2e failure" for "no e2e coverage."
