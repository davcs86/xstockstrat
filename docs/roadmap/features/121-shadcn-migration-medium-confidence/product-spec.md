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

FR-13. Evaluate (not mandate) replacing the hand-built nav rows in
`src/components/shared/PlatformHeader.tsx:156-291` and `src/components/mobile/BottomTabBar.tsx:25-56`
with a Radix `Navigation Menu`-based `ui/navigation-menu.tsx`. The audit rated this medium confidence
and noted these are route-based navigation (not shadcn's dropdown-mega-menu use case) — arguably fine
as-is. `/sdd-design` should make the keep-vs-replace call explicitly and record the rationale in
`design.md` rather than defaulting to "replace everything."

FR-14. Every new `ui/*` file added under this feature follows the existing hand-authored conventions
in the repo (`cva` + the underlying `@radix-ui/react-*` primitive + `cn()` from `ui/utils.ts` +
`React.forwardRef` + `displayName`), matching `ui/badge.tsx`, `ui/select.tsx`, and `ui/sheet.tsx` in
style.

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

- [ ] **Merge order.** FR-4 through FR-9 consume primitives (`alert-dialog`, `tabs`, `toggle-group`,
  `alert`, `checkbox`, `accordion`) that `120-shadcn-migration-high-confidence` adds — this feature
  cannot land those steps until `120-shadcn-migration-high-confidence` merges (or `/sdd-spec` sequences
  its own local copy and reconciles at integration). Register this dependency in
  `docs/roadmap/features/merge-order.md` at `/sdd-spec` time. FR-1/FR-2/FR-3/FR-10/FR-11/FR-12/FR-13
  have no such dependency and could land independently if the two features are reordered.
  Note: `119` itself is already taken on `main-dev` by the unrelated `119-shadcn-ui-migration` — the
  dependency here is on `120`, not `119`.
- [ ] Per the same e2e-parity caution as `120-shadcn-migration-high-confidence`'s Open Questions (`docs/roadmap/ledger/fails.md`,
  2026-08-05 — align-frontend-e2e-bff-mocks — duplication), grep each touched file's `e2e/**/*.spec.ts`
  for assertions on `window.confirm` (Playwright's `page.on('dialog', ...)` handler) before migrating
  FR-4 — those five specs must be rewritten to interact with the new `AlertDialog` instead of
  intercepting the browser dialog.
