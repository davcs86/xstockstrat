# Recon: fix-row-menu-stays-open

**Created**: 2026-11-16
**From**: product-spec.md
**Tree**: feature/fix-row-menu-stays-open@689a6c73 ≡ origin/feature/fix-row-menu-stays-open (origin/main-dev@87c504bf merged)
**Affected services**: xstockstrat-ui

---

## Objective

A row-actions menu item that asks for confirmation keeps its menu open (and modal) behind and after
the confirmation dialog, so the page ignores the user's next click. The fix closes the menu when
the item is chosen, leaves the page interactive as soon as the dialog is resolved, and puts keyboard
focus back on the row's actions trigger (or a stated fallback when the row has gone) — the same way
on every table that has such an action.

## Codebase Map

- **`xstockstrat-ui`** (Next.js 15, React 18.3.1; all paths under `services/xstockstrat-ui/`)
  - Shared row menu: `src/components/shared/RowActionsMenu.tsx` — `RowAction` type `:23-43`; props
    `:51-64`; `pending` state `:65`; item `onSelect` with `e.preventDefault(); setPending(action)`
    `:90-100`; sibling `AlertDialog` controlled by `pending !== null` `:109-114`; confirm button
    `onClick` `:122-129`. One dialog per menu instance. The comments at `:48-49` ("survives the menu
    closing on select") and `:92-94` ("defer the open to the next tick") describe behaviour the code
    does not have.
  - Shared-menu call sites (4):
    - `src/components/trader/accountShared.tsx:338` — "Edit keys" (no confirm, opens a `FormDialog`),
      "Resume" (confirm; admin + halted only), "Remove" (confirm; the account then stops being
      active and the whole menu is no longer rendered).
    - `src/app/accounts/authorized-apps/page.tsx:119` — "Disconnect" (confirm; the row is removed).
    - `src/app/config-ui/templates/page.tsx:288` — "Edit", "Retire" (confirm).
    - `src/app/insights/signal-sources/page.tsx:454` — "Disable"/"Enable", "Edit" (no confirm).
  - Orders table (own menu and dialog, not the shared component):
    `src/components/trader/OrdersTable.tsx` — state `:62-64`; `columns` memoised with `[]` `:72,196`;
    actions cell `:150-194` (trigger `aria-label="Actions"`, `data-testid="actions-<id>"`; Edit via
    `onClick` → `EditOrderDialog`, a `Sheet`; Cancel via `onSelect` + `preventDefault` `:179-189`);
    one table-level `AlertDialog` `:234-254` with only two buttons (`cancel-<id>-dismiss` "Dismiss",
    `cancel-<id>-confirm` "Confirm") and **no title or description**. A cancelled order's row is
    **not** removed (`src/hooks/useCancelOrder.ts:9-13` invalidates and the stream updates the
    status); both items then become disabled, the trigger stays.
  - Strategies list (own menu and dialog): `src/app/insights/strategies/page.tsx` —
    `StrategyActionsCell` `:272-337`; Deactivate via `onSelect` + `preventDefault` `:303-312`;
    dialog `:316-334` (description only, no title; buttons disabled while `deactivating`). The row
    stays for an admin; the Deactivate item disappears.
  - Primitives: `src/components/ui/dropdown-menu.tsx:4` and `src/components/ui/alert-dialog.tsx:4`
    wrap the unified `radix-ui` package; both `Content` wrappers spread `...props`, so
    `onCloseAutoFocus` reaches Radix (`dropdown-menu.tsx:25-45`, `alert-dialog.tsx:39-60`). Close
    animation is 100 ms (`duration-100 … data-closed:animate-out`, `dropdown-menu.tsx:38`,
    `alert-dialog.tsx:31,53`). `src/components/shared/FormDialog.tsx:37-47` wraps `AlertDialog`.
    `@base-ui/react` is used only by `src/components/ui/combobox.tsx:4` — not involved.
  - Page landmark: every segment renders its pages inside one `<main>`
    (`src/components/trader/AppShell.tsx:26`, `src/components/insights/AppShell.tsx:21`,
    `src/app/accounts/layout.tsx:26`, `src/app/config-ui/layout.tsx:14`).
  - Global mutation error banner: `src/components/shared/MutationErrorFallback.tsx:28-36`
    (`aria-label="Dismiss error"`).
  - Installed versions (`pnpm-lock.yaml`): `radix-ui@1.6.7`, `@radix-ui/react-dropdown-menu@2.1.24`,
    `react-menu@2.1.24`, `react-alert-dialog@1.1.23`, `react-dialog@1.1.23`,
    `react-dismissable-layer@1.1.19`, `react-focus-scope@1.1.16`.
  - No migrations, config reads, proto or deployment wiring are involved.

### `onSelect` + `preventDefault` classification (every site in `src/`)

| Site | Class |
|---|---|
| `src/components/shared/RowActionsMenu.tsx:95` | same defect (confirm-dialog opener) |
| `src/components/trader/OrdersTable.tsx:183` | same defect (confirm-dialog opener) |
| `src/app/insights/strategies/page.tsx:307` | same defect (confirm-dialog opener) |
| `src/app/insights/opportunities/page.tsx:257` | deliberate keep-open (multi-select `DropdownMenuCheckboxItem`; in-code comment says so) — unchanged |

Every other `preventDefault` in `src/` is a form `onSubmit`, an `AlertDialogAction` `onClick`, or an
Enter `onKeyDown` — not a menu item. `src/app/config-ui/users/page.tsx:184-204` and
`src/app/config-ui/[namespace]/NamespaceEditor.tsx:164` open dialogs/forms from menu items without
`preventDefault` and are not affected.

### History of the `preventDefault`

- `OrdersTable` and strategies: commit `a2107eed` (feature 124, PR #919, 2026-08-09).
- Shared `RowActionsMenu`: commit `c2077ddd` (PR #977, 2026-08-17) — copied the same shape and added
  the "prevent the default select→close from racing the AlertDialog opening" comment.
- No test, ledger entry or doc records an observed failure that the `preventDefault` fixed. The
  ledger records only its consequences (`docs/roadmap/ledger/fails.md` 2026-09-16
  ui-resume-halted-account; `insights.md` 2026-09-05), i.e. the e2e workarounds.

### Radix behaviour read from the installed source

- Menu item select: `@radix-ui/react-menu` `dist/index.mjs:381-387` — if the `menu.itemSelect`
  event is `defaultPrevented` the menu stays open, otherwise `rootContext.onClose()`.
- Menu close returns focus to the menu trigger: `@radix-ui/react-dropdown-menu`
  `dist/index.mjs:114-118` (`onCloseAutoFocus` → `triggerRef.current?.focus()`).
- A modal dialog's close returns focus to **its own** `Dialog.Trigger`, and prevents the generic
  "previously focused element" fallback: `@radix-ui/react-dialog` `dist/index.mjs:154-157`. A dialog
  opened by state (no `Dialog.Trigger`) therefore drops focus to `<body>` on close unless the caller
  passes `onCloseAutoFocus`. That prop is the documented hook (Radix docs, Dialog/AlertDialog
  `Content` → `onCloseAutoFocus`, "Event handler called when focus moves to the trigger after
  closing. It can be prevented by calling `event.preventDefault`").
- The shadcn `radix` docs for `dropdown-menu`, `dialog` and `alert-dialog` (fetched 2026-11-16)
  contain no menu-opens-dialog recipe; `DropdownMenu.Root` documents `modal` (default `true`).

### Browser measurements (this session, headless Chromium, `pnpm dev`, `/trader/accounts`, "Remove" on the shared menu)

Sampled: `body.style.pointerEvents`, count of `[role=menu]` / `[role=alertdialog]`, count of
`body > [aria-hidden=true]`, `document.activeElement`; then one click on the other row's trigger.

| Variant | Mouse + keyboard, Cancel + Confirm (4 runs) |
|---|---|
| **Today's code** | Menu still open 1.5 s after the dialog closed; `pointer-events: none`; 3 siblings `aria-hidden`; focus on `<body>`; the click on another control is blocked. Same for keyboard. |
| **A — drop `preventDefault`** (menu closes, dialog opens in the same update) | Dialog opened 4/4 with focus on its Cancel button. Menu removed ~140 ms later (its close animation); the menu's focus-return to the trigger at that moment is reclaimed by the dialog's focus trap (focus stays on Cancel). After the dialog: no menu, `pointer-events` cleared, 0 `aria-hidden`, the next click works. **Focus ends on `<body>`.** |
| **A + focus rule** (`onCloseAutoFocus` on the dialog content focuses the menu trigger; a layout-effect cleanup moves focus to the enclosing `<main>` when the trigger is removed while focused) | As A, and focus is on the row's trigger after Cancel and after Confirm (4/4). With the row removed after Confirm: focus moved to `<main>`, and the next Tab landed on the first control inside the page content ("Add account"). |

Not measured: a variant that defers the dialog until the menu has finished closing, and
`modal={false}` on the menu. The orders table and the strategies list were read, not probed; their
RED tests in execution are the measurement.

## Patterns to REUSE

- Confirm-gated row action → the canonical `RowActionsMenu` (`src/components/shared/RowActionsMenu.tsx:51`);
  `docs/roadmap/ledger/insights.md` 2026-09-05 records it as the home for such actions (C-17).
- "Menu item opens a dialog and the menu closes" already exists without `preventDefault`:
  `src/components/trader/accountShared.tsx:341` ("Edit keys" → `FormDialog`),
  `src/app/config-ui/users/page.tsx:184-204`.
- Trigger test id / accessible name props already on the shared menu: `testId`, `triggerLabel`
  (`RowActionsMenu.tsx:53-63`).
- Tests (C-12): fixtures `BROKER_ACCOUNT_HALTED`, `BROKER_ACCOUNT_ALPACA` (`e2e/fixtures/accounts.ts`),
  `STRATEGY_DEF_LIVE` (`e2e/fixtures/strategies.ts`), `STRATEGY_TEMPLATE_MEANREV`
  (`e2e/fixtures/templates.ts`); auth helpers `addAuthCookie` / `addAdminCookie`
  (`e2e/helpers/auth.ts:83,88`). Orders in `e2e/trader/orders.spec.ts` are a bespoke inline
  `page.route()` set (INVENTORY.md `:100`); authorized apps are an inline array in
  `e2e/accounts/authorized-apps.spec.ts` plus `e2e/mock-backend.ts:312` (INVENTORY.md `:107`).
- Existing confirm-flow specs to extend rather than duplicate: `e2e/trader/orders.spec.ts:188-228`,
  `e2e/trader/account-resume.spec.ts:55-153`, `e2e/accounts/authorized-apps.spec.ts:90-93`,
  `e2e/insights/strategy-authoring.spec.ts:113-127`, `e2e/config-ui/templates.spec.ts:41-46`.

## Existing Business Rules (preserve / extend)

No CHANGE and no EXTEND — every existing guarantee stays true under the fix.

- **PRESERVE** `@AC-6` "Resume requires confirmation surfacing the halt reason" (`services/xstockstrat-ui/acceptance/ui-resume-halted-account.feature`, @feature-179) — the dialog shows the halt reason, no call runs before confirm, dismissing leaves the account halted.
- **PRESERVE** `@AC-3` "Resume clears the halt from the UI" (same file) — confirming calls `ResumeAccount` and the indicator and Resume control clear; must coexist with this feature's focus rule.
- **PRESERVE** `@AC-2` "Resume control appears only for a halted account" and `@AC-5` "A non-admin caller cannot resume" (same file) — menu-item visibility unchanged.
- **PRESERVE** `@AC-10` "A failed mutation with no per-call error handler still shows an error" (`services/xstockstrat-ui/acceptance/fix-ui-trader-feedback.feature`, @feature-270) — the global error must still show with the menu closed and focus restored; `@AC-5`/`@AC-6` of the same file likewise.
- **PRESERVE** `@AC-29` "Config-ui shows system templates as read-only" (`services/xstockstrat-ui/acceptance/seed-curated-templates.feature`, @feature-335).
- **PRESERVE** `@AC-12` "A shared component is displayed with its state styling" (`services/xstockstrat-ui/acceptance/fix-symbol-page-alerts-ui.feature`, @feature-339) — a menu or dialog keeps its opening and closing animation, so the menu must close through its normal closing state, never by unmounting it.
- **PRESERVE** `@AC-11`, `@AC-12` (`services/xstockstrat-ui/acceptance/watchlist-opportunity-signal-cues.feature`, @feature-155) — source-filter behaviour; the keep-open rule is first pinned by this feature's `@AC-7`.
- **PRESERVE** `@AC-15` (@feature-157), `@AC-23` (@feature-224), `@AC-26` (@feature-335) in `docs/sdd/business-rules/platform.feature` — backend rules reached through Remove / Deactivate / Retire; UI-only fix.
- No existing scenario covers the `/accounts/authorized-apps` Disconnect or `/insights/strategies` Deactivate row actions.

## Dependencies

- Proto/RPC: none
- Migration: none
- Config keys: none
- Inter-service edges: none
- New env vars / ports: none

## Risks / Not-found

- **Why the `preventDefault` was added is not recorded** beyond the in-code comment; no failing case
  was found in history, and variant A opened the dialog 4/4 in the browser. The "race" could not be
  reproduced on the installed Radix versions.
- **Focus transient in variant A**: when the menu's close animation ends (~140 ms after the dialog
  opened) Radix tries to focus the menu trigger and the dialog's focus trap takes focus back. No
  visible effect was measured; a screen reader could in principle announce the trigger.
- **Orders table has one table-level dialog and no per-row component**, so a per-row trigger ref
  does not exist there today (`OrdersTable.tsx:150-194,234-254`).
- **Orders cancel dialog has no title or description** (`OrdersTable.tsx:234-254`); adopting the
  shared menu would give it visible text that does not exist today (operator's call on the copy).
- **A cancelled order does not leave the table**, so the "row has gone" focus case is exercised by
  authorized-apps Disconnect and accounts Remove, not by orders.
- **Side defect found, out of scope**: the "Edit keys" `FormDialog` opened from the row menu never
  receives focus — measured: dialog open, `document.activeElement` is the row's actions trigger,
  outside the dialog. Cause as read: `AlertDialog` moves initial focus to its Cancel part and
  `FormDialog` renders none (`FormDialog.tsx:37-47`). Not a confirm action; FR-5 leaves it as is.
- `fails.md` 2026-09-16 (ui-resume-halted-account) and `insights.md` 2026-09-05 tell future authors
  to expect the menu to stay mounted and to `Escape`-reset it; both become untrue with the fix.
- `fails.md` 2026-11-16 (alpaca-adaptive-rate-limit): for every new scenario state which test drives
  it and check it fails on today's code. `@AC-7` (non-confirm unchanged) is a guard, not a RED test.
- Vitest is node-only (`vitest.config.ts:19-20`); there is no jsdom/component harness, so every test
  for this fix is a Playwright spec. No reduced-motion or animation override exists in the
  Playwright configuration, and none may be added.
- Not found: any doc outside code comments and the two ledger entries that describes the stays-open
  behaviour; an authorized-apps fixture module.

## Recommended Scope

1. Tests first (RED on today's code): shared-menu spec on `/trader/accounts`, orders-table cases in
   `e2e/trader/orders.spec.ts`, the row-gone case, the strategies and remaining shared-menu tables.
2. The mechanism in `RowActionsMenu` (close on select, focus rule, fallback), then the orders table
   and the strategies list brought onto the same mechanism.
3. Remove the two specs' workarounds; correct the component doc comment and the two ledger entries'
   guidance.
