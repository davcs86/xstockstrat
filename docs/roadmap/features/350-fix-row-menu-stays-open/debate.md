# Debate Register: fix-row-menu-stays-open

**State**: in-debate
**Mode**: quick
**Rounds run**: 1 (round numbers continue across runs; the mode's 2–5 / 1 bounds count this run only)

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-16 | /sdd-design | 9 | 7 | 9 | 11 | 0 | yes |

## Settled Decisions

<!-- Status: settled → superseded by D-m (only after a user-approved REOPEN) -->
| ID | Round | Decision | Evidence | Status |
|---|---|---|---|---|
| D-1 | 1 | Close on select: a confirm item no longer calls `preventDefault`; the same `onSelect` sets the pending action, so Radix closes the menu through its normal closing state and the sibling dialog opens in the same update. | recon.md § Browser measurements (variant A, 4/4); `@radix-ui/react-menu` `dist/index.mjs:381-387`; in-repo precedent `src/components/trader/accountShared.tsx:341` | settled |
| D-2 | 1 | Focus rule: when the dialog closes (confirm or cancel) its content's `onCloseAutoFocus` prevents the Radix default and focuses the row's actions trigger if it is still in the document, otherwise the enclosing `<main>` captured at mount. A layout-effect cleanup in the same component moves focus to that `<main>` when the trigger is removed while it holds focus. No `contentRef`. | `@radix-ui/react-dialog` `dist/index.mjs:154-157,226`; `@radix-ui/react-focus-scope` `dist/index.mjs:92-103`; recon.md § Browser measurements (A + focus rule) | settled |
| D-3 | 1 | While a confirm is pending, the closing menu does not return focus to the trigger (`DropdownMenuContent` `onCloseAutoFocus` prevented only when a confirm is pending). Guarded by a test that records `focusin` on the trigger while the dialog is present. | recon.md § Risks (focus transient); `@radix-ui/react-dropdown-menu` `dist/index.mjs:114-118` | settled |
| D-4 | 1 | The whole mechanism (D-1..D-3) lives only in `src/components/shared/RowActionsMenu.tsx`. `OrdersTable` and the strategies list adopt that component and delete their own menu + dialog markup. **Operator gate**: adoption and the dialog text it makes visible. | `OrdersTable.tsx:150-194,234-254`; `strategies/page.tsx:272-337`; `docs/roadmap/ledger/insights.md` 2026-09-05 | settled (pending operator gate) |
| D-5 | 1 | The actions cell must keep its component identity across the confirm flow on every table: a `columns` memo that rebuilds remounts every cell (TanStack `flexRender` renders a function `cell` as a component type), dropping the pending dialog and the trigger. Strategies and authorized apps are made stable (stable memo deps or a module-level cell — the spec picks the smaller change per site and proves it with a trigger-focus test); templates and orders are checked and pinned by tests. | `@tanstack/react-table` `build/lib/index.mjs:20-25`; `strategies/page.tsx:45,58,190`; `authorized-apps/page.tsx:73,143`; `OrdersTable.tsx:72,196` | settled |
| D-6 | 1 | Fallback target is the page's `<main>` content region; the four segment `<main>` elements get `tabIndex={-1}` and no focus outline. **Operator gate**: the fallback target. | `src/components/trader/AppShell.tsx:26`, `src/components/insights/AppShell.tsx:21`, `src/app/accounts/layout.tsx:26`, `src/app/config-ui/layout.tsx:14` | settled (pending operator gate) |
| D-7 | 1 | Tests are Playwright specs only, extend the existing per-table specs, and share one helper for the "settled" checks. "Menu not shown" uses a locator that includes hidden elements (`[role="menu"]`), "not hidden from assistive technology" is `body > [aria-hidden="true"]` count 0, pointer blocking is the computed `pointer-events` of `body`; dialog buttons are located by exact name inside the `alertdialog`. Waits are on the closing surface (count 0 / focus) — no sleeps, no animation override. Each scenario is labelled RED or guard after running it on today's code. | recon.md § Patterns to REUSE; `@radix-ui/react-dialog` `dist/index.mjs:143-146` (`hideOthers`) | settled |
| D-8 | 1 | The two workaround blocks are removed: `e2e/trader/orders.spec.ts` `@AC-10` keeps a real "no menu" assertion and clicks "Dismiss error" directly; `e2e/trader/account-resume.spec.ts` `@AC-3` drops its comment, dialog wait and Escape. Escapes that close a menu the test opened on purpose stay. | `e2e/trader/orders.spec.ts:219-226`; `e2e/trader/account-resume.spec.ts:78-85` | settled |
| D-9 | 1 | Docs: the `RowActionsMenu` doc comment is rewritten as a ≤2-line constraint and the "defer to the next tick" comment is deleted; the ledger gets appended superseding entries for `fails.md` 2026-09-16 and `insights.md` 2026-09-05 (their "stays mounted / Escape-reset" halves), never an in-place edit. | `RowActionsMenu.tsx:45-50,92-94`; recon.md § Risks | settled |

## Rejected Alternatives (locked)

<!-- Status: locked → reopened @ round N (user, context.md <ISO>) -->
| ID | Round | Alternative | Why rejected | Status |
|---|---|---|---|---|
| R-1 | 1 | Open the dialog only after the menu has finished closing (from the menu's `onCloseAutoFocus`). | ~100 ms with nothing on screen, focus visits the trigger first, and needs extra state because that callback also fires on Escape / outside click. Variant A already opened the dialog 4/4. | locked |
| R-2 | 1 | `modal={false}` on the row menus. | Does not close the menu by itself; changes outside-click and assistive-technology hiding for every row menu (FR-5). | locked |
| R-3 | 1 | Keep `preventDefault` and control the menu's `open` state by hand. | Re-implements Radix's default close at every site; orders has no per-row component to hold the state. | locked |
| R-4 | 1 | Keep the orders and strategies markup and share only a hook. | Orders has one table-level dialog and no per-row trigger ref, so it would need a near-copy of `RowActionsMenu` (DRY guard rail, C-18); orders would keep a dialog with no title or description (C-17). | locked |
| R-5 | 1 | Fallback: leave focus on `<body>` when the trigger has gone. | Fails FR-3 — a keyboard user restarts from the top of the page. | locked |
| R-6 | 1 | Fallback: the next row's actions trigger. | May not exist (last row removed); needs per-table code. | locked |
| R-7 | 1 | A `contentRef` branch in the unmount cleanup for "focus still inside the closing dialog". | `onCloseAutoFocus` fires on every dialog unmount, so D-2's connected-or-`<main>` rule covers it without a second ref. | locked |

## Objections

<!-- Status: open → closed @ round N (<how>) | waived @ round N (user) | reopened @ round N (user) -->
| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|
| O-1 | 1 | A rebuilt `columns` memo remounts every actions cell, so on strategies (deps rebuild every render) and authorized apps (`revoking` in deps) the confirm flow loses its dialog/trigger and FR-3 fails (FR-4, C-10). | yes | closed @ round 1 (D-5) |
| O-2 | 1 | Same remount unmounts the dialog without its closing animation — 339 `@AC-12` (C-16). | no | closed @ round 1 (D-5 keeps the cell mounted, so the dialog closes through its closing state) |
| O-3 | 1 | `@AC-1`'s "menu not shown" can pass on today's code: the open dialog marks the menu `aria-hidden` and role queries skip it; `getByRole('main')` count is not a valid assistive-technology check (P-06). | yes | closed @ round 1 (D-7) |
| O-4 | 1 | `@AC-6` strategies "confirms" may already pass today because the remount removes the stuck menu (P-06). | no | open — execution runs it on today's code and labels it RED or guard |
| O-5 | 1 | A new "Deactivate strategy" title duplicates the description's opening words and breaks `e2e/insights/strategy-authoring.spec.ts:123` (strict mode). | no | closed @ round 1 (D-7: locators scoped to the dialog; the spec is in the change list) |
| O-6 | 1 | Dropped test ids are also used by the "Edit is enabled…" test (`orders.spec.ts:174-184`); "Dismiss" without `exact` also matches "Dismiss error". | no | closed @ round 1 (D-7) |
| O-7 | 1 | Two premises were wrong: refs reach `Button`/`AlertDialogContent` only because the App Router runs Next's vendored React 19 (`ref` is a prop); and `onCloseAutoFocus` does fire when the dialog unmounts with the row. | no | closed @ round 1 (D-2 drops the `contentRef`; the React 19 dependency is recorded as an open risk) |
| O-8 | 1 | The menu-focus guard (D-3) had no test (C-18). | no | closed @ round 1 (D-3 `focusin` test) |
| O-9 | 1 | `tabIndex={-1}` on `<main>` may draw a focus ring around the page content (C-17). | no | closed @ round 1 (D-6) |
| O-10 | 1 | Strategies loses "buttons disabled while deactivating"; the shared dialog holds a stale action if the actions list changes while it is open. | no | open — accepted as a documented risk (the dialog closes at once on Confirm, so the double-submit window stays closed) |
| O-11 | 1 | `AccountRow` is used by both `AccountsModule` and `AccountManagementPanel`; if both mount on `/trader/accounts`, trigger names and the Tab target are ambiguous. | no | open — `/sdd-spec` discovery checks it |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|
