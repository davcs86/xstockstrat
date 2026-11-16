# Design: fix-row-menu-stays-open

**Created**: 2026-11-16
**Rounds**: 3 (quick, extended twice by the operator; termination: approved)
**Approved by**: user @ 2026-11-16 (round-3 gate, context.md)
**Grounded in**: recon.md
**Debate register**: debate.md

---

## Chosen Approach

Consumer surface (C-14): browser UI only — the row-actions menus on `/trader/orders`,
`/trader/accounts`, `/accounts/authorized-apps`, `/config-ui/templates` and `/insights/strategies`.
All paths below are under `services/xstockstrat-ui/`.

1. **Close on select (D-1).** In `src/components/shared/RowActionsMenu.tsx` a confirm item stops
   calling `preventDefault` (recon.md § Codebase Map, `:90-100`), so Radix closes the menu through
   its normal closing state and the sibling `AlertDialog` opens in the same update. Measured 4/4,
   mouse and keyboard (recon.md § Browser measurements, variant A). The "race" the `preventDefault`
   was added for could not be reproduced and no history records one (recon.md § History).
2. **Focus rule (D-2, D-6, D-11, D-12).** When the dialog closes — confirm or cancel — its content's
   `onCloseAutoFocus` prevents the Radix default and focuses the row's actions trigger when it is
   still in the document and enabled; otherwise the enclosing `<main>` captured at mount. A
   layout-effect cleanup moves focus to that `<main>` when the trigger is removed while it holds
   focus. Fallback focus uses `preventScroll`. The trigger is reached by a ref on
   `DropdownMenuTrigger`. The four segment `<main>` elements (recon.md § Codebase Map, page
   landmark) get `tabIndex={-1}` and no outline.
3. **Keyboard focus stays in the dialog (D-3, D-12, D-16).** A one-shot flag set by a confirm choice
   makes the closing menu skip its focus return to the trigger. This removes a focus-out/focus-in
   pair on the dialog's control on the keyboard path (recon.md § Browser measurements, addendum).
   The mouse path keeps one such pair toward the closing menu's content; focus never lands outside
   the dialog on either path.
4. **One home (D-4, D-15).** `src/components/trader/OrdersTable.tsx` and the strategies list
   (`src/app/insights/strategies/page.tsx`) adopt `RowActionsMenu` and delete their own menu and
   dialog. Operator-approved text: orders dialog "Cancel order" / "Cancel this {symbol} order?" /
   Dismiss–Confirm; strategies dialog title "Deactivate strategy" with its existing text; Confirm
   styled as destructive; triggers named "Actions for order {orderId}" and
   "Actions for {strategyId}"; `actions-<id>` test ids kept.
5. **Stable actions cell (D-5, D-10, D-14).** A rebuilt `columns` memo remounts every cell and would
   drop the pending dialog and the trigger. Orders: deps `[cancelOrder]`. Strategies: a module-level
   cell component with its own hooks. Authorized apps: a module-level cell with a local busy flag,
   page-level `revoking` removed. Config templates: `openEdit`/`retire` as `useCallback`s over a
   destructured `mutate`. Signal sources and accounts are not changed. The constraint is stated in a
   ≤2-line comment on `DataTable`'s `columns` prop and in the DataTable row of
   `docs/patterns/ui-ux-governance.md`.
6. **Tests (D-7, D-8, D-13, D-17, D-18).** Playwright only, on the existing per-table specs, with one
   shared "settled" helper (menu count including hidden elements, dialog count, computed
   `pointer-events` of `body`, `body > [aria-hidden="true"]` count). Waits are on the closing
   surface or a rendered outcome; no sleeps and no animation override. The two workaround blocks are
   removed. The D-3 guard test is keyboard-driven with a focus-event recorder and a positive
   "close-focus ran" signal; its evidence is a mutation run with the guard deleted.
7. **Docs (D-9).** The `RowActionsMenu` doc comment becomes a ≤2-line constraint; superseding
   entries are appended to the ledger for the two entries that tell authors to expect a mounted menu.
8. **Build order (D-19).** Five atomic steps: mechanism + shared-menu tables; stable cells for
   authorized apps and templates; orders adoption; strategies adoption; ledger.

## Rejected Alternatives

- `R-1` Open the dialog only after the menu has finished closing — ~100 ms blank, focus visits the trigger first, extra state.
- `R-2` `modal={false}` on the row menus — does not close the menu; changes outside-click and assistive-technology hiding for every row menu.
- `R-3` Keep `preventDefault` and control the menu's `open` state by hand — re-implements Radix's default at every site.
- `R-4` Keep the orders and strategies markup and share only a hook — needs a near-copy of `RowActionsMenu`; orders keeps a dialog with no title.
- `R-5` Fallback: leave focus on `<body>` — fails FR-3.
- `R-6` Fallback: the next row's trigger — may not exist; per-table code.
- `R-7` A `contentRef` branch in the unmount cleanup — the dialog's `onCloseAutoFocus` already fires on every unmount.
- `R-8` Fix the remount once in `DataTable` by calling function cells directly — breaks cells that use hooks.
- `R-9` Strategies: a context provider or DataTable `meta` prop — new plumbing; the module-level cell is smaller.
- `R-10` Find the trigger by overriding its `id`, via `aria-labelledby`, or with a wrapping `<span>` — breaks labelling / content is unmounted / extra DOM.
- `R-11` Remove the mouse-path focus pair with an item `onPointerLeave` override — intercepts Radix pointer handling for a pair a pointer user cannot perceive.
- `R-12` Settle the guard test with `requestAnimationFrame` → `setTimeout(0)` — scheduler-dependent, cannot prove the close-focus ran.
- `R-13` Assert only "no `focusout` toward the trigger" — misses a bounce to anywhere else.

## Open Risks

- [ ] The trigger ref reaches the DOM button only because the App Router runs Next's vendored React 19 (D-11); a change there fails the `@AC-3` tests loudly — watch at Step 1.
- [ ] The mouse path keeps one focus-out/focus-in pair inside the dialog while the menu closes (D-16); unguarded — reported at the integration PR.
- [ ] Strategies: Deactivate is disabled only on the row being deactivated, not on all rows, and the dialog buttons are no longer disabled while deactivating (O-10) — reported at the integration PR.
- [ ] The guard test listens for a Radix-internal event name (`focusScope.autoFocusOnUnmount`, D-17); a Radix upgrade that renames it fails the test by timeout, never silently — Step 1.
- [ ] `<main tabIndex={-1}>`: a mouse click on empty page area now focuses `<main>` (no outline); run `e2e/theme/theme-bundle.spec.ts` at Step 1.
- [ ] Side defects, out of scope, not filed: the "Edit keys" dialog opened from the row menu never receives focus; signal sources' Enable/Disable remounts its cell and drops focus to `<body>` (O-18) — reported at the integration PR.

## Constitution Rules Touched

- `C-10` — honored by: every table with a confirm row action is brought onto the one mechanism and each has a test (D-4, D-5, D-13).
- `C-12`/`C-13` — honored by: tests reuse `e2e/fixtures/*` and the auth helpers; no new inline domain fixture.
- `C-14` — honored by: the consumer surface is the five UI tables named above.
- `C-15` — honored by: `@AC-1..@AC-10`, every FR covered, each scenario mapped to a spec and labelled RED or guard (D-13, D-18).
- `C-16` — honored by: all existing guarantees PRESERVE; promotion plan approved in advance by the operator.
- `C-17` — honored by: reuse of `RowActionsMenu`, unique trigger names, dialogs gain accessible names, no colour literal.
- `C-18` — honored by: one mechanism in one component; no speculative option; the remount constraint documented in two places only.
- `P-04` — honored by: three recorded gates in context.md.
- `P-06` — honored by: RED-before-GREEN per step; the guard's mutation run (D-17).
- `F-04`, `F-05`, `F-08` — honored: evidence is from recon and source reads; steps are atomic units that pass their own verification.

## Business Rules Touched (C-16)

- PRESERVE `@AC-2`, `@AC-3`, `@AC-5`, `@AC-6` (`services/xstockstrat-ui/acceptance/ui-resume-halted-account.feature`) — not regressed by: Resume copy, visibility and confirm-before-call are untouched; only the menu close and focus change.
- PRESERVE `@AC-10`, `@AC-5`, `@AC-6` (`services/xstockstrat-ui/acceptance/fix-ui-trader-feedback.feature`) — not regressed by: errors still flow through the global mutation cache; the per-row strategies hook does not change that.
- PRESERVE `@AC-29` (`services/xstockstrat-ui/acceptance/seed-curated-templates.feature`) — not regressed by: template actions and their visibility are unchanged.
- PRESERVE `@AC-12` (`services/xstockstrat-ui/acceptance/fix-symbol-page-alerts-ui.feature`) — not regressed by: the menu closes through its closing state and stable cells let the dialog finish its closing animation.
- PRESERVE `@AC-11`, `@AC-12` (`services/xstockstrat-ui/acceptance/watchlist-opportunity-signal-cues.feature`) — not regressed by: the source filter is not touched.
- PRESERVE `@AC-15`, `@AC-23`, `@AC-26` (`docs/sdd/business-rules/platform.feature`) — not regressed by: UI-only change.
