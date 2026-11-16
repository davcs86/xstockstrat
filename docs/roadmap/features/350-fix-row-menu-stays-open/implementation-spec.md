# Implementation Spec: fix-row-menu-stays-open

**Status**: `complete`
**Created**: 2026-11-16
**Feature**: `docs/roadmap/features/350-fix-row-menu-stays-open/feature.md`
**Total Steps**: 9
**Feature Branch**: `feature/fix-row-menu-stays-open`

---

Paths: `ui/` abbreviates `services/xstockstrat-ui/`. Every `path:line` below was read on the tree
`feature/fix-row-menu-stays-open@e30da236` (≡ origin, `origin/main-dev@78ab5cac` merged; that merge
changed one `context.md` of another feature and no file under `ui/`). Radix and TanStack lines are
from the installed packages under the repo-root `node_modules/.pnpm/` (`radix-ui@1.6.7`,
`@radix-ui/react-dropdown-menu@2.1.24`, `react-menu@2.1.24`, `react-dialog@1.1.23`,
`react-focus-scope@1.1.16`) and `ui/node_modules/@tanstack/react-table`. Symbols marked **new** do
not exist today and are created by the step that names them.

## Execution Summary

Steps 1-8 are in `xstockstrat-ui`; Step 9 appends to the ledger. There is no proto, migration, config
key, env var, port, BFF route or mock-backend change.

The order is the design's build order (design.md § Chosen Approach item 8, debate.md D-19). Each of
D-19's four code units is written here as a `service` step and a `test` step that land together, so
D-19's five atomic steps are nine numbered steps:

1. **Steps 1-2** — the mechanism in `RowActionsMenu` (close on select, focus rule, keyboard guard),
   the four focusable `<main>` landmarks, the shared e2e helper, and the tests for the three tables
   that already use the shared menu with a confirm action (accounts, authorized apps, config
   templates).
2. **Steps 3-4** — a stable actions cell on authorized apps and config templates, so the trigger the
   focus rule targets survives a page update during the confirmation; the `columns` constraint is
   written down on `DataTable`.
3. **Steps 5-6** — the orders table adopts `RowActionsMenu`.
4. **Steps 7-8** — the strategies list adopts `RowActionsMenu` through a module-level cell.
5. **Step 9** — ledger entries that supersede the two entries telling authors to expect a mounted
   menu.

**Consumer surfaces (C-14).** Browser UI only; no Agent tool, RPC or CLI surface.

- `/trader/accounts` (Resume, Remove) — Step 1.
- `/accounts/authorized-apps` (Disconnect) — Steps 1 and 3.
- `/config-ui/templates` (Retire) — Steps 1 and 3.
- `/trader/orders` (Cancel) — Step 5.
- `/insights/strategies` (Deactivate) — Step 7.
- `/insights/signal-sources` (shared menu, no confirm action; FR-5) — reached by Step 1's component
  change and kept green by Step 2's verification; no code change of its own.

No page or route is added, so no `PLATFORM_SUBNAV` registration is needed (C-10(a)).

**Trading domain (step-constraints §A).** Step 5 rewires the orders table's Cancel and Edit menu
items. It calls the same `cancelOrder` mutation (`ui/src/hooks/useCancelOrder.ts:9-13`) and reuses
the `TERMINAL` set (`ui/src/components/trader/OrdersTable.tsx:39-44`) unchanged. No `TRADING_MODE`
gate, broker dispatch, order-type handling or fill processing is touched by any step.

**Assumptions made by this spec** (each is a choice the design left to `/sdd-spec`):

- D-19's units are split into `service` + `test` pairs with `**Lands with**`; basis: the template's
  step categories and the feature-339 spec.
- `@AC-7`'s last line (the opportunities source filter keeps its menu open) gets a guard test in
  `ui/e2e/insights/opportunities.spec.ts` in Step 6. D-19 names only the orders spec for that unit;
  basis: C-15 needs every line of the scenario covered, and no production file changes for it.
- Every test this feature adds sits in a `test.describe('… (feature 350)')` block and its title
  starts with its `@AC-N`. Basis: `account-resume.spec.ts` already uses `@AC-1..@AC-6` for feature
  179 and `orders.spec.ts` uses `@AC-10` for feature 270, so a bare `-g "@AC-3"` is ambiguous.
- The marker helpers of D-13 live in the same new module as D-7's settle helper
  (`ui/e2e/helpers/rowMenu.ts`); basis: four specs use them.
- "No outline" on `<main>` (D-6) is the `outline-none` class; precedent
  `ui/src/components/ui/alert-dialog.tsx:53`.
- The authorized-apps `@AC-4` test serves its first list through the real BFF (`route.fallback()`)
  instead of copying the inline app literal at `authorized-apps.spec.ts:69-75`; basis: C-12.

**Carried from design.md § Open Risks** (none blocks this spec):

- The trigger ref reaches the DOM button only under Next's vendored React 19 (D-11) — the `@AC-3`
  tests of Step 2 fail loudly if it does not.
- The guard test listens for the Radix-internal event name `focusScope.autoFocusOnUnmount`
  (`react-focus-scope` `dist/index.mjs:12`); a rename fails Step 2's `@AC-10` by timeout.
- `<main tabIndex={-1}>` — Step 2 runs `ui/e2e/theme/theme-bundle.spec.ts`.
- Reported at the integration PR, not fixed here: the mouse-path focus pair inside the dialog (D-16);
  Deactivate is disabled only on the row being deactivated and the dialog buttons are no longer
  disabled while deactivating (O-10); the "Edit keys" dialog never receives focus; signal sources'
  Enable/Disable drops focus to `<body>` (O-18).

**Integration PR obligations (not steps).** Promote `@AC-1..@AC-10` into the new durable suite
`services/xstockstrat-ui/acceptance/fix-row-menu-stays-open.feature`, tagged `@feature-350`, with
no existing suite edited (operator approved in advance, context.md round-1 and round-3 gates). List
the exact text in the PR description together with the four items above.

## Scenario Coverage (C-15)

"RED" means the test fails on the tree before its unit; "guard" means it passes there and stays.

| Scenario | Step(s) | Spec file | On the pre-unit tree |
|---|---|---|---|
| `@AC-1` | 2 (accounts Resume), 6 (orders Cancel) | `account-resume.spec.ts`, `orders.spec.ts` | RED — the menu element is still in the document |
| `@AC-2` | 2 (accounts ×2), 6 (orders ×2) | same | RED — menu open, `body` blocked |
| `@AC-3` | 2 (accounts ×2), 6 (orders ×2) | same | RED — focus on `<body>` |
| `@AC-4` | 2 (accounts Remove, authorized apps Disconnect); re-run in 4 | `account-resume.spec.ts`, `authorized-apps.spec.ts` | RED — focus on `<body>` |
| `@AC-5` | 6 | `orders.spec.ts` | RED — focus on `<body>` after Escape |
| `@AC-6` | 2 (accounts Remove, authorized apps, templates — dismisses), 8 (strategies dismisses and confirms) | the four table specs | RED for every "dismisses" row; strategies "confirms" is a guard for "menu closed" (the remount removes the stuck menu, O-4) |
| `@AC-7` | 6 | `orders.spec.ts`, `opportunities.spec.ts` | guard — FR-5 behaviour is unchanged |
| `@AC-8` | 6 | `orders.spec.ts` | RED — the menu is still shown |
| `@AC-9` | 4 (authorized apps, templates), 8 (strategies) | `authorized-apps.spec.ts`, `config-ui/templates.spec.ts`, `strategy-authoring.spec.ts` | RED after Step 2 and before Step 3 because the cell remounts (D-18); strategies RED on today's markup |
| `@AC-10` | 2 | `account-resume.spec.ts` | RED only because the menu never closes; the proof of the guard is the mutation run in Step 2 (D-17) |

## Step Dependencies

- Steps 1+2 land together: Step 2's tests are red until Step 1, and they are Step 1's only proof
  (a pair that cannot pass its verification apart, C-08); D-19 unit 1.
- Steps 3+4 land together: Step 4's `@AC-9` tests are red until Step 3 and are its only proof; D-19
  unit 2.
- Step 3 requires Step 1: the focus rule it protects lives in `RowActionsMenu`.
- Step 4 requires Step 2: it imports `ui/e2e/helpers/rowMenu.ts` and extends the feature-350 blocks
  Step 2 creates.
- Steps 5+6 land together: Step 5 deletes the test ids `edit-<id>`, `cancel-<id>`,
  `cancel-<id>-confirm` and `cancel-<id>-dismiss`, which `ui/e2e/trader/orders.spec.ts:174-216`
  references (§C, "deletes a referenced resource"); D-19 unit 3.
- Steps 5 and 7 require Step 1 (they adopt the fixed component); Steps 6 and 8 require Step 2 (the
  helper).
- Steps 7+8 land together: Step 7 gives the dialog the title "Deactivate strategy", which makes
  `page.getByText(/Deactivate strategy/)` at `ui/e2e/insights/strategy-authoring.spec.ts:123` match
  two elements (strict mode, O-5); D-19 unit 4.
- Step 9 stands alone and lands last, so the entries cite merged behaviour.
- Every unit is two adjacent steps on the ui surface.

**Running e2e in the execute sandbox.** A full Playwright run is impractical there (fails.md
2026-08-10, shadcn-sidebar-visual-rewrite). Every e2e command below is scoped:
`pnpm exec playwright test <files> --project=chromium --no-deps`, after pre-warming only the routes
the specs visit. The full suite runs in the `frontend-e2e` CI job on the integration PR. If a scoped
run cannot complete, `pnpm exec tsc --noEmit && pnpm run lint && pnpm exec playwright test <file>
--list` is a fallback that proves no scenario: the step records a Deviation Log row headed
**unverified AC** naming each scenario, with its red-before-green record "not captured", and the row
stays open until the spec file is green in a real run.

**Test conventions for Steps 2, 4, 6 and 8** (D-7, D-13):

- No sleep, no animation or reduced-motion override. Wait on the closing surface (count 0) or on a
  rendered outcome.
- "Menu not shown" is `page.locator('[role="menu"]')` with `toHaveCount(0)` — a CSS locator counts
  elements the open dialog has marked `aria-hidden`, which `getByRole('menu')` skips (O-3).
- Dialog buttons are located by exact name inside `page.getByRole('alertdialog')`
  (`{ name: 'Dismiss', exact: true }` also keeps "Dismiss error" out, O-6).
- A focus assertion after a Confirm first waits for something the refresh renders (D-13, O-13).
- No new inline domain literal (C-12). `{ ...FIXTURE, override }` spreads and error bodies are
  scenario one-offs and stay inline.

---

### Step 1 — service: `RowActionsMenu` closes on select and returns focus; focusable `<main>`

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/shared/RowActionsMenu.tsx` — modify
- `services/xstockstrat-ui/src/components/trader/AppShell.tsx` — modify
- `services/xstockstrat-ui/src/components/insights/AppShell.tsx` — modify
- `services/xstockstrat-ui/src/app/accounts/layout.tsx` — modify
- `services/xstockstrat-ui/src/app/config-ui/layout.tsx` — modify

**Reviewers**: `xstockstrat-ui` owner — Trading UI correctness, config mutation safety

**Codebase Evidence**:
- `ui/src/components/shared/RowActionsMenu.tsx`: doc comment `:45-50`; `pending` state `:65`; the
  early return `if (actions.length === 0) return null;` `:67`; `<DropdownMenuTrigger asChild>` `:72`;
  `<DropdownMenuContent align={align} className="min-w-40">` `:84`; the item `onSelect` with
  `e.preventDefault(); setPending(action);` `:90-100` (comment `:92-94`); the sibling `AlertDialog`
  `:109-114`; `<AlertDialogContent>` `:115`; the confirm `onClick` that nulls `pending` before
  calling `action.onSelect()` `:124-129`.
- Both wrappers spread `...props` onto the Radix part, so `ref` and `onCloseAutoFocus` reach it:
  `ui/src/components/ui/dropdown-menu.tsx:19-23` (trigger), `:25-45` (content);
  `ui/src/components/ui/alert-dialog.tsx:39-60` (content).
- Radix: a select that is not `defaultPrevented` calls `rootContext.onClose()`
  (`react-menu` `dist/index.mjs:381-387`). The menu's close focuses its trigger unless the caller's
  `onCloseAutoFocus` prevented the event (`react-dropdown-menu` `dist/index.mjs:114-118`,
  `composeEventHandlers`). The dialog's close focuses only its own `Dialog.Trigger`
  (`react-dialog` `dist/index.mjs:154-157`), so a state-opened dialog drops focus to `<body>`. The
  trigger composes a forwarded ref with its own (`react-dropdown-menu` `dist/index.mjs:63`).
- The four segment landmarks: `ui/src/components/trader/AppShell.tsx:26`
  (`<main className="flex-1 pb-20 sm:pb-0">`), `ui/src/components/insights/AppShell.tsx:21` (same
  classes), `ui/src/app/accounts/layout.tsx:26` and `ui/src/app/config-ui/layout.tsx:14`
  (`<main className="p-4 pb-20 sm:p-6 sm:pb-6">`). The only other `<main` in `src` is
  `ui/src/components/ui/sidebar.tsx:295` (`SidebarInset`), which nothing outside that file imports.
- Call sites of the component (4): `ui/src/components/trader/accountShared.tsx:338`,
  `ui/src/app/accounts/authorized-apps/page.tsx:119`, `ui/src/app/config-ui/templates/page.tsx:288`,
  `ui/src/app/insights/signal-sources/page.tsx:454`. Every one passes at least one action, so the
  component never mounts with an empty list.
- In-repo precedent for "menu item opens a dialog and the menu closes":
  `accountShared.tsx:341` ("Edit keys", no `preventDefault`).
- Measured in recon (recon.md § Browser measurements): dropping `preventDefault` opened the dialog
  4/4; with the focus rule, focus was on the row's trigger after Cancel and Confirm (4/4) and on
  `<main>` when the row was removed.

**Lands with**: `Step 2`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. In `RowActionsMenu`, above the early return at `:67` (D-12: every hook above it), add three refs:
   `triggerRef` (`HTMLButtonElement | null`), `mainRef` (`HTMLElement | null`) and
   `skipMenuCloseFocus` (boolean, starts `false`). All three names are **new**.
2. Add a mount-only `React.useLayoutEffect` (also above `:67`) that stores
   `triggerRef.current?.closest('main') ?? null` in `mainRef`, and whose cleanup moves focus to
   `mainRef.current` with `{ preventScroll: true }` when the trigger node captured at mount is
   `document.activeElement` (D-2, D-12). Do not add a re-capture path for a list that starts empty:
   no call site mounts one (evidence above; C-18).
3. Pass `ref={triggerRef}` to `<DropdownMenuTrigger asChild>` at `:72` — not to `Button`, and not
   through an `id` override or a wrapper element (D-11, R-10).
4. In the item `onSelect` at `:90-100`: for an action with `confirm`, delete `e.preventDefault()`
   and the comment at `:92-94`, set `skipMenuCloseFocus.current = true`, then `setPending(action)`
   (D-1, D-3). The non-confirm branch stays `action.onSelect()`. Drop the now-unused `e` parameter.
5. On `<DropdownMenuContent>` at `:84` add `onCloseAutoFocus`: when `skipMenuCloseFocus.current` is
   `true`, reset it to `false` and call `event.preventDefault()`; otherwise do nothing, so Escape,
   an outside click and a non-confirm item keep Radix's focus return to the trigger (D-12 one-shot).
6. On `<AlertDialogContent>` at `:115` add `onCloseAutoFocus`: call `event.preventDefault()`, then
   focus `triggerRef.current` when it is non-null, `isConnected` and not `disabled`; otherwise focus
   `mainRef.current` with `{ preventScroll: true }` (D-2, D-6, D-12). No `contentRef` (R-7).
7. Replace the doc comment at `:45-50` with a constraint of at most two lines (D-9, root CLAUDE.md
   How to Act #5): a confirm item must let the menu close on select, and the dialog returns focus
   to the row's trigger or to the enclosing `<main>`. Add no other comment.
8. On each of the four `<main>` elements add `tabIndex={-1}` and append `outline-none` to its
   `className` (D-6). Leave `sidebar.tsx:295` alone.
9. Do not change `RowAction`, the props, the dialog markup or `modal` on the menu (R-2, R-3), and do
   not open the dialog from the menu's `onCloseAutoFocus` (R-1).

**Verification**:
The union with Step 2. On its own — Run from `services/xstockstrat-ui` with Node 24 first on `PATH`; one command per line, each must exit 0.
```bash
pnpm run lint
pnpm exec tsc --noEmit
pnpm run format:check
pnpm run lint:dup
```

---

### Step 2 — test: shared settle helper; accounts, authorized-apps and templates confirm flows; keyboard guard

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/helpers/rowMenu.ts` — create
- `services/xstockstrat-ui/e2e/trader/account-resume.spec.ts` — modify
- `services/xstockstrat-ui/e2e/accounts/authorized-apps.spec.ts` — modify
- `services/xstockstrat-ui/e2e/config-ui/templates.spec.ts` — modify

**Reviewers**: `xstockstrat-ui` owner — Trading UI correctness, config mutation safety

**Codebase Evidence**:
- Helper home: `ui/e2e/helpers/` holds `alertReadState.ts`, `auth.ts`, `connectStream.ts`,
  `watchlistMock.ts`. **Not found**: any existing settle or focus-marker helper — `rowMenu.ts` is
  created from scratch.
- Auth helpers: `addAuthCookie` `ui/e2e/helpers/auth.ts:83`, `addAdminCookie` `:88`.
- Fixtures (INVENTORY.md `:15`, `:32`): `BROKER_ACCOUNT_ALPACA` (`ui/e2e/fixtures/accounts.ts:15`,
  `displayName: 'Alpaca Paper'`), `BROKER_ACCOUNT_HALTED` (`:76`, `displayName: 'Halted Alpaca'`),
  both already imported at `ui/e2e/trader/account-resume.spec.ts:3`; `STRATEGY_TEMPLATE_MEANREV`
  (`ui/e2e/fixtures/templates.ts:33-46`, name "Mean Reversion Starter"), already imported at
  `ui/e2e/config-ui/templates.spec.ts:3` and served by the shared mock
  (`ui/e2e/mock-backend.ts:1459-1461`).
- `account-resume.spec.ts`: `LIST` route constant `:13`; `fulfillAccounts` `:16-24`; the stateful
  list of the existing `@AC-3` (feature 179) `:56-64`; its workaround `:79-82` (comment, dialog
  wait, `Escape`); the `Escape` at `:85` closes a menu the test opened itself.
- Accounts page: the menu is rendered only for an active account
  (`ui/src/components/trader/accountShared.tsx:336-338`); Resume `:345`, dialog title "Resume
  account" `:349`; Remove `:361`, dialog title "Deregister account" `:366`; `handleRemove`
  `:283-295` calls `deregisterBrokerAccount` then `refreshAccounts`. Mock:
  `deregisterBrokerAccount` `ui/e2e/mock-backend.ts:459-461`, `resumeAccount` `:471-473`. The first
  control inside `<main>` is "Add account" (`ui/src/components/trader/AccountsModule.tsx:94-103`;
  "Clear filters" above it renders only with an active filter).
- `authorized-apps.spec.ts`: `APPS_BFF` `:13`, `stubAgentHealth` `:17-25`; the existing revoke test
  `:50-95` holds the only inline app literal `:69-75`. The shared mock serves "Claude.ai (E2E)"
  (`ui/e2e/mock-backend.ts:312-323`) and accepts the revoke (`:324`). The page unmounts the table
  while it reloads (`ui/src/app/accounts/authorized-apps/page.tsx:39`, `:242-251`). First control
  inside `<main>`: "Connect a new app" (`page.tsx:184-187`), whose dialog holds the field labelled
  "MCP connector URL" (`:200`).
- Templates page: trigger name `Actions for template ${name}` (`ui/src/app/config-ui/templates/page.tsx:289`),
  Retire with `confirmLabel: 'Retire'` `:293-301`; "New {label} template" button `:316-318`; the
  Strategy tab locator in use `ui/e2e/config-ui/templates.spec.ts:29`.
- Radix dispatches `focusScope.autoFocusOnUnmount` on the scope's container from a `setTimeout(0)`
  when it unmounts (`react-focus-scope` `dist/index.mjs:12`, `:92-103`).
- Specs that drive a shared-menu table or snapshot `<main>` and must stay green:
  `ui/e2e/trader/account-selector.spec.ts:106-170,270-296` ("Edit keys"),
  `ui/e2e/trader/offline-accounts.spec.ts:102-118`, `ui/e2e/insights/signal-sources.spec.ts:98,120`,
  `ui/e2e/theme/theme-bundle.spec.ts:82-98`.
- Playwright config: `retries: isCI ? 1 : 0` (`ui/playwright.config.ts:86`); project `chromium`
  `:104`; `CI=1` serves a production build (`:129-133`).

**Lands with**: `Step 1`

**TDD**: `red-green required` — capture RED for every test below on the tree before Step 1, then
GREEN after it. `@AC-10` is RED there only because the menu never closes; its real evidence is the
mutation run in **Verification**.

**Covers**: `AC-1, AC-2, AC-3, AC-4, AC-6, AC-10`

**Instructions**:
1. Create `ui/e2e/helpers/rowMenu.ts` exporting three **new** functions (no domain data, so no
   fixture module and no INVENTORY.md row):
   - `expectRowMenuSettled(page)` — `[role="menu"]` count 0, `[role="alertdialog"]` count 0,
     `expect.poll` that the computed `pointer-events` of `document.body` is not `none`, and
     `body > [aria-hidden="true"]` count 0 (D-7).
   - `markTrigger(locator)` — sets one marker attribute on the element (D-13).
   - `expectFocusOnMarkedTrigger(page)` — `expect.poll` that `document.activeElement` carries the
     marker, i.e. the same node, not a remounted one.
   If a page has a permanent `body > [aria-hidden="true"]` node, stop and record a deviation; do
   not loosen the check.
2. `account-resume.spec.ts` — add `test.describe('Row menu confirm flow (feature 350)', …)`:
   - `@AC-1` (admin, `[BROKER_ACCOUNT_HALTED, BROKER_ACCOUNT_ALPACA]`): open "Actions for Halted
     Alpaca", choose Resume → the dialog is visible and `[role="menu"]` has count 0.
   - `@AC-2 @AC-3` Resume → dismiss: mark the trigger, choose Resume, click the dialog's "Cancel",
     `expectRowMenuSettled`, `expectFocusOnMarkedTrigger`, then one click on "Actions for Alpaca
     Paper" shows the "Remove" menu item.
   - `@AC-2 @AC-3` Resume → confirm: stateful list as at `:56-64` but with `BROKER_ACCOUNT_ALPACA`
     as a second row; mark, choose, click the dialog's "Confirm", wait for the row's "Halted" text
     to reach count 0, then settled, focus on the marked trigger, and the same one-click check.
   - `@AC-4` Remove → confirm: `[BROKER_ACCOUNT_ALPACA]`, switching to
     `{ ...BROKER_ACCOUNT_ALPACA, isActive: false }` once Confirm is clicked (the flag pattern of
     `:73-74`); wait for "Actions for Alpaca Paper" to reach count 0, settled, then
     `page.getByRole('main')` is focused and one `Tab` focuses "Add account".
   - `@AC-6` Remove → dismiss: choose Remove, click "Cancel", settled, then one click on "Add
     account" opens its dialog.
   - `@AC-10` keyboard guard (D-17), `[BROKER_ACCOUNT_ALPACA]`: focus "Actions for Alpaca Paper",
     press Enter. While the menu is open, in one `page.evaluate`: add a
     `focusScope.autoFocusOnUnmount` listener to the `[role="menu"]` element that sets a window
     flag, and install document-level `focusin`/`focusout` listeners that start logging readable
     descriptors (event type, target name, related-target name) after the first `focusin` inside
     `[role="alertdialog"]`. Press End, then Enter. Assert the "Deregister account" dialog is shown
     with its "Cancel" focused; `page.waitForFunction` on the window flag (the positive signal that
     Radix's close-focus ran); then assert the log is empty and "Cancel" is still focused. No
     `requestAnimationFrame`/timer settle (R-12) and no narrower assertion than an empty log (R-13).
3. In the existing feature-179 `@AC-3` test delete `:79-82` only (D-8); keep `:83-85`.
4. `authorized-apps.spec.ts` — add a feature-350 describe block (each test: `addAuthCookie`,
   `stubAgentHealth(page, false)`):
   - `@AC-6` Disconnect → dismiss, no `APPS_BFF` route (real BFF): open "Actions for Claude.ai
     (E2E)", choose Disconnect, click "Cancel", settled, then one click on "Connect a new app"
     shows the "MCP connector URL" field.
   - `@AC-4` Disconnect → confirm: route `APPS_BFF` so the first GET is `route.fallback()`, later
     GETs answer `{ apps: [] }`, and POST falls back to the real BFF. Confirm, wait for the
     "haven't authorized any apps" text (`:94`), settled, `page.getByRole('main')` is focused and one
     `Tab` focuses "Connect a new app". Do not copy the literal at `:69-75`.
5. `templates.spec.ts` — add a feature-350 describe block: `@AC-6` Retire → dismiss (admin, shared
   mock, Strategy tab): open "Actions for template Mean Reversion Starter", choose Retire, click
   "Cancel", settled, then one click on "New strategy template" opens the dialog with that title.
6. Record in `context.md`, per test, RED or guard with the failing assertion (fails.md 2026-11-16,
   alpaca-adaptive-rate-limit).

**Verification**:
Run from `services/xstockstrat-ui` with Node 24 first on `PATH`; one command per line, each must exit 0.
```bash
pnpm run lint
pnpm exec tsc --noEmit
pnpm run format:check
pnpm run lint:dup
CI=1 NEXT_DISABLE_STANDALONE=1 pnpm exec playwright test e2e/trader/account-resume.spec.ts e2e/accounts/authorized-apps.spec.ts e2e/config-ui/templates.spec.ts --project=chromium --no-deps --trace off
CI=1 NEXT_DISABLE_STANDALONE=1 pnpm exec playwright test e2e/trader/account-selector.spec.ts e2e/trader/offline-accounts.spec.ts e2e/insights/signal-sources.spec.ts e2e/theme/theme-bundle.spec.ts --project=chromium --no-deps --trace off
test "$(grep -c 'helpers/rowMenu' e2e/trader/account-resume.spec.ts)" -ge 1
```
Then the D-17 mutation run. Temporarily delete the `skipMenuCloseFocus` branch added by Step 1
instruction 5 and run both (the leading `!` makes each line pass only when Playwright fails):
```bash
! pnpm exec playwright test e2e/trader/account-resume.spec.ts -g "feature 350.*@AC-10" --project=chromium --no-deps --trace off --repeat-each=5 --retries=0
! CI=1 NEXT_DISABLE_STANDALONE=1 pnpm exec playwright test e2e/trader/account-resume.spec.ts -g "feature 350.*@AC-10" --project=chromium --no-deps --trace off --repeat-each=5 --retries=0
```
Read each output: all five repeats must fail (dev server, then production build) — a run with any
passing repeat is a stop, even though the `!` line exits 0. Restore the branch, then:
```bash
pnpm exec playwright test e2e/trader/account-resume.spec.ts -g "feature 350.*@AC-10" --project=chromium --no-deps --trace off --repeat-each=5 --retries=0
CI=1 NEXT_DISABLE_STANDALONE=1 pnpm exec playwright test e2e/trader/account-resume.spec.ts -g "feature 350.*@AC-10" --project=chromium --no-deps --trace off --repeat-each=5 --retries=0
git diff --exit-code -- src/components/shared/RowActionsMenu.tsx
```
The last line runs after the unit's commit and proves the mutation was reverted. Paste the outputs
(today's-code RED, mutation RED ×2, restored GREEN ×2) into `context.md`. If the mutation run passes
in any repeat, stop: the guard is unproven (D-17) — record a deviation and ask the operator; do not commit.
Coverage: no `src/lib/**` code is added, so the 40% Vitest threshold is unaffected; e2e is not
coverage-gated. C-12: the new tests import domain data only from `e2e/fixtures` and `e2e/helpers`.

---

### Step 3 — service: stable actions cells on authorized apps and config templates; `DataTable` `columns` constraint

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/accounts/authorized-apps/page.tsx` — modify
- `services/xstockstrat-ui/src/app/config-ui/templates/page.tsx` — modify
- `services/xstockstrat-ui/src/components/ui/data-table.tsx` — modify (comment only)
- `docs/patterns/ui-ux-governance.md` — modify

**Reviewers**: `xstockstrat-ui` owner — config mutation safety, Trading UI correctness

**Codebase Evidence**:
- A function `cell` is rendered as a component type: `flexRender` returns
  `React.createElement(Comp, props)` (`@tanstack/react-table` `build/lib/index.mjs:20-22`), called
  at `ui/src/components/ui/data-table.tsx:191`. A rebuilt `columns` array therefore gives every cell
  a new component type and React remounts it (D-5).
- Authorized apps (`ui/src/app/accounts/authorized-apps/page.tsx`): `revoking` state `:33`;
  `loadApps` is a `useCallback` with `[]` `:38-51`; `handleDisconnect` `:72-87` sets `revoking`
  `:73`, throws `Failed to disconnect (${res.status})` `:80`, stores it with `setError` `:83` and
  clears `revoking` `:85`; the actions cell `:116-140` reads `revoking` `:125`; `columns` deps
  `[revoking]` `:143`; the error line `:241`. `formatDate` (module scope) `:22-26`.
- Config templates (`ui/src/app/config-ui/templates/page.tsx`): `TemplateTable` `columns` deps
  `[onEdit, onRetire]` `:309`; `const manage = useManageTemplate();` `:346`; `errorMessage` is
  declared inside the component `:352-353`; `openEdit` `:360-364` and `retire` `:365-377` are plain
  functions, rebuilt every render and passed as `onEdit`/`onRetire` `:432-433`; `manage.mutate`
  `:366`, `:393`; `manage.isPending` `:482`, `:485`; the hooks sit above the early returns `:402-403`.
  `formFromTemplate` `:108` and `emptyForm` `:241` are module-level. React import `:3`.
- `useManageTemplate` returns a TanStack Query v5 `useMutation` result
  (`ui/src/hooks/useTemplates.ts:167-169`, `ui/src/hooks/useInvalidatingMutation.ts:21`), whose
  `mutate` is referentially stable while the result object is not (D-10, O-14).
- `DataTableProps.columns` has no comment today (`data-table.tsx:53`); `data` carries the
  stable-reference note `:54-58`. Governance row: `docs/patterns/ui-ux-governance.md:127`, ending
  "Requires referentially-stable `data`."
- Not changed (D-10): `ui/src/app/insights/signal-sources/page.tsx:454` (no confirm action) and the
  accounts page (not a `DataTable`).

**Lands with**: `Step 4`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Authorized apps:
   - Delete the `revoking` state (`:33`), both `setRevoking` calls and the then-empty `finally`.
   - Wrap `handleDisconnect` in `useCallback` with deps `[loadApps]`; keep its request, its error
     text and `await loadApps()`.
   - Add a module-level component `AppActionsCell` (**new**) taking `app` and `onDisconnect`. It
     holds a local busy flag and renders the same `RowActionsMenu` as `:119-138` — same
     `triggerLabel`, label, `destructive`, `confirm` title and description — with
     `disabled: busy` and an `onSelect` that sets the flag, awaits `onDisconnect(app)` and clears
     it in `finally`.
   - The actions column's `cell` renders `<AppActionsCell app={row.original}
     onDisconnect={handleDisconnect} />`; `columns` deps become `[handleDisconnect]`.
2. Config templates:
   - Move `errorMessage` to module scope, body unchanged.
   - Replace `:346` with a destructure of `mutate` and `isPending` from `useManageTemplate()`;
     switch `:366`, `:393`, `:482` and `:485` to them.
   - Make `openEdit` a `useCallback` with `[]` and `retire` a `useCallback` with `[mutate]`; add
     `useCallback` to the React import. `TemplateTable` is not edited.
3. `data-table.tsx`: add a doc comment of at most two lines on `columns` stating the constraint —
   the array must stay referentially stable while a cell holds state, because a rebuilt array
   remounts every cell (D-14).
4. `ui-ux-governance.md:127`: extend the DataTable row's last sentence with the same constraint and
   the two remedies (a stable memo, or a module-level cell component). No new context-constitution
   ID and no third copy of the rule (D-14, O-17).
5. Do not change `DataTable`'s rendering (R-8) and add no `meta`/context plumbing (R-9).

**Verification**:
The union with Step 4. On its own — Run from `services/xstockstrat-ui` with Node 24 first on `PATH`; one command per line, each must exit 0.
```bash
pnpm run lint
pnpm exec tsc --noEmit
pnpm run format:check
pnpm run lint:dup
```

---

### Step 4 — test: focus stays on the same trigger when the page updates during the confirmation

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/accounts/authorized-apps.spec.ts` — modify
- `services/xstockstrat-ui/e2e/config-ui/templates.spec.ts` — modify

**Reviewers**: `xstockstrat-ui` owner — config mutation safety

**Codebase Evidence**:
- The helper and the feature-350 describe blocks come from Step 2.
- Authorized apps: a non-OK revoke renders `Failed to disconnect (500)` above the table without
  reloading the list (`ui/src/app/accounts/authorized-apps/page.tsx:80-83`, `:241`); `apiFetch`
  retries only on 401 (`ui/src/lib/authRedirect.ts:67-73`).
- Templates: a failed retire calls `setActionError(errorMessage(err))` (`page.tsx:374`), where a
  `ConnectError` yields `rawMessage` (`:352-353`), rendered by `<CardNotice variant="error">`
  inside `<main>` (`:417`). The same message is also reported by the global fallback, which renders
  outside `<main>` (`ui/src/lib/mutationErrorStore.ts:36-39`,
  `ui/src/components/shared/QueryProviders.tsx:17-18`, `ui/src/app/config-ui/layout.tsx:12-15`) —
  an unscoped text locator matches twice (fails.md 2026-11-04, fix-ui-trader-feedback).
- BFF path pattern for the Strategy tab: `**/config-ui/api/xstockstrat.analysis.v1.AnalysisService/…`
  (`ui/e2e/config-ui/templates.spec.ts:19`). Connect error body precedent:
  `ui/e2e/trader/orders.spec.ts:208-212`.
- The state under test survives only on the mounted page — trigger the update in place, never with
  a reload (fails.md `:1647-1649`).

**Lands with**: `Step 3`

**TDD**: `red-green required` — RED is captured on the tree that has Steps 1-2 and not Step 3: the
menu closes but the cell remounts, so focus ends on `<main>` (D-18).

**Covers**: `AC-9` (authorized apps and config templates rows), `AC-4` (authorized apps, re-run)

**Instructions**:
1. `authorized-apps.spec.ts`, in the feature-350 block — `@AC-9`: route `APPS_BFF` so POST answers
   status 500 and GET is `route.fallback()`. Mark "Actions for Claude.ai (E2E)", choose Disconnect,
   click the dialog's "Confirm", wait for `Failed to disconnect (500)` to be visible, then
   `expectRowMenuSettled` and `expectFocusOnMarkedTrigger`.
2. `templates.spec.ts`, in the feature-350 block — `@AC-9` (admin, Strategy tab): route
   `**/config-ui/api/xstockstrat.analysis.v1.AnalysisService/ManageTemplate` to a Connect error
   body with code `failed_precondition` and message `template is in use` (status 400). Mark
   "Actions for template Mean Reversion Starter", choose Retire, click the dialog's "Retire", wait
   for `page.getByRole('main').getByText('template is in use')`, then settled and focus on the
   marked trigger.
3. Re-run Step 2's authorized-apps `@AC-4`: it now passes through a different path (the cell stays
   mounted until the list reloads) and must stay green (O-22).

**Verification**:
Run from `services/xstockstrat-ui` with Node 24 first on `PATH`; one command per line, each must exit 0.
```bash
pnpm run lint
pnpm exec tsc --noEmit
pnpm run format:check
pnpm run lint:dup
CI=1 NEXT_DISABLE_STANDALONE=1 pnpm exec playwright test e2e/accounts/authorized-apps.spec.ts e2e/config-ui/templates.spec.ts --project=chromium --no-deps --trace off
```
RED before Step 3: both `@AC-9` tests fail at `expectFocusOnMarkedTrigger`.
Coverage: no `src/lib/**` code is added; e2e is not coverage-gated.
C-12: the 500 and `failed_precondition` bodies are error-path one-offs; no domain literal is added.

---

### Step 5 — service: the orders table adopts `RowActionsMenu`

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/trader/OrdersTable.tsx` — modify

**Reviewers**: `xstockstrat-ui` owner — Trading UI correctness

**Codebase Evidence**:
- `ui/src/components/trader/OrdersTable.tsx`: imports to drop — `EllipsisVertical` `:4`, `Button`
  `:13` (used only at `:161`), the dropdown parts `:16-21`, the alert-dialog parts `:22-27`;
  `TERMINAL` `:39-44`; `const { mutate: cancelOrder } = useCancelOrder();` `:62`; `editing` `:63`;
  `cancelling` `:64`; the actions cell `:155-193` (trigger `aria-label="Actions"` `:165`,
  `data-testid={`actions-${order.orderId}`}` `:166`; Edit via `onClick` `:172-178`; Cancel via
  `onSelect` + `preventDefault` `:179-189`); `columns` deps `[]` `:196`; `EditOrderDialog`
  `:227-233`; the table-level `AlertDialog` with two buttons and no title or description `:234-254`.
- Sibling import style: `'../shared/QueryStateMessages'` `:29`.
- `RowActionsMenu` props `testId` and `triggerLabel`, and `RowAction.confirm`
  (`title`, `description`, `confirmLabel`, `cancelLabel`):
  `ui/src/components/shared/RowActionsMenu.tsx:23-43,51-64`; a `destructive` action styles the
  dialog's confirm button (`:123`).
- `cancelOrder` is the `mutate` of a `useMutation` (`ui/src/hooks/useCancelOrder.ts:9-13`,
  `ui/src/hooks/useInvalidatingMutation.ts:21`) — stable. A cancelled order's row stays; both items
  become disabled (recon.md § Codebase Map).
- The only consumer of `OrdersTable` is `ui/src/app/trader/orders/page.tsx:55`. The four item and
  dialog test ids are referenced only by `ui/e2e/trader/orders.spec.ts:174-216`.
- Trading domain: no `TRADING_MODE`, `BrokerType` or `OrderType` handling is in this file's actions
  cell; the only status logic is `TERMINAL`, reused as is.

**Lands with**: `Step 6`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Replace the actions cell body (`:155-193`) with one `RowActionsMenu`, keeping `order` and
   `isTerminal`:
   - `testId` `actions-${order.orderId}` (kept), `triggerLabel` `Actions for order ${order.orderId}`
     (D-15).
   - "Edit": `disabled: isTerminal`, `onSelect: () => setEditing(order)`.
   - "Cancel": `destructive: true`, `disabled: isTerminal`,
     `onSelect: () => cancelOrder({ orderId: order.orderId })`, `confirm` with title "Cancel order",
     description `Cancel this ${order.symbol} order?`, `cancelLabel` "Dismiss", `confirmLabel`
     "Confirm" (operator-approved text, context.md round-1 gate).
2. Delete the `cancelling` state (`:64`) and the table-level `AlertDialog` (`:234-254`). Keep
   `editing` and `EditOrderDialog`.
3. `columns` deps become `[cancelOrder]` (D-10).
4. Remove the imports listed above and import `RowActionsMenu` from `'../shared/RowActionsMenu'`.
5. Do not add a per-item test-id prop to `RowActionsMenu` (C-18); Step 6 moves the spec to roles.
6. Order-type and fill handling are unaffected by this step; PARTIALLY_FILLED stays editable and
   cancellable and FILLED stays disabled, through the unchanged `TERMINAL` set.

**Verification**:
The union with Step 6. On its own — Run from `services/xstockstrat-ui` with Node 24 first on `PATH`; one command per line, each must exit 0.
```bash
pnpm run lint
pnpm exec tsc --noEmit
pnpm run format:check
pnpm run lint:dup
! grep -nE "preventDefault|AlertDialog|cancelling" src/components/trader/OrdersTable.tsx
```

---

### Step 6 — test: orders confirm flow, keyboard path, unchanged non-confirm items

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/trader/orders.spec.ts` — modify
- `services/xstockstrat-ui/e2e/insights/opportunities.spec.ts` — modify

**Reviewers**: `xstockstrat-ui` owner — Trading UI correctness

**Codebase Evidence**:
- `ui/e2e/trader/orders.spec.ts`: the inline `ORDERS` set `:15-76` is a registered single-site
  scenario override (INVENTORY.md `:100`) — reuse it, add none; `beforeEach` with the routes and
  `page.goto('/trader/orders')` `:82-141`; counters `listOrdersCount`/`cancelRequested` `:79-80`;
  the test-id uses to repoint `:174-175`, `:179`, `:183-184`, `:193`, `:196`, `:215-216`; the
  feature-270 `@AC-10` test `:202-228` and its workaround `:220-223`.
- The edit dialog is a sheet titled `Edit order {symbol}`
  (`ui/src/components/trader/EditOrderDialog.tsx:76-79`).
- The source filter keeps its menu open on purpose
  (`ui/src/app/insights/opportunities/page.tsx:254-257`); the spec's `selectSource` presses Escape
  for that reason (`ui/e2e/insights/opportunities.spec.ts:139-143`); describe and `beforeEach`
  `:149-158`; source name in use: `marketwatch` `:182`.
- Other specs that open `/trader/orders`: `ui/e2e/trader/order-parity.spec.ts`,
  `stream-reconnect.spec.ts`, `signal-confidence-ticket.spec.ts`.
- The helper comes from Step 2.

**Lands with**: `Step 5`

**TDD**: `red-green required` — `@AC-7` is a guard: record "passes on the pre-change tree" for it.

**Covers**: `AC-1, AC-2, AC-3, AC-5, AC-7, AC-8`

**Instructions**:
1. Repoint the three existing tests from test ids to roles: menu items by
   `getByRole('menuitem', { name: 'Edit' | 'Cancel', exact: true })`; the dialog by
   `getByRole('alertdialog')` with its "Cancel order" heading; its buttons by exact name. The
   enabled/disabled expectations at `:174-184` stay as they are.
2. In the feature-270 `@AC-10` test delete the workaround `:220-223`; turn `:224` into a
   `[role="menu"]` count-0 assertion and click "Dismiss error" directly (D-8).
3. Add `test.describe('Row menu confirm flow (feature 350)', …)` nested inside the existing
   describe, so it shares `beforeEach`:
   - `@AC-1`: choose Cancel on `actions-ord-new` → the dialog is visible, `[role="menu"]` count 0.
   - `@AC-2 @AC-3` dismiss: mark the trigger, choose Cancel, click "Dismiss", settled, focus on the
     marked trigger, then one click on `actions-ord-partial` shows its "Edit" item.
   - `@AC-2 @AC-3 @AC-8` confirm: mark, choose Cancel, click "Confirm"; poll `cancelRequested` and
     that `listOrdersCount` grew (the refetch); then, with no key press or click, `[role="menu"]`
     count 0, settled, focus on the marked trigger, and the same one-click check.
   - `@AC-5` keyboard: focus `actions-ord-new`, Enter, ArrowDown to "Cancel", Enter → the dialog is
     shown with "Dismiss" focused; Escape → dialog count 0 and `actions-ord-new` is focused.
   - `@AC-7` (guard): choose "Edit" → the "Edit order AAPL" sheet is visible and `[role="menu"]`
     has count 0.
4. `opportunities.spec.ts`, inside the existing describe, in a feature-350 block — `@AC-7` (guard):
   open "source filter", tick `marketwatch` → the menu is still visible and the item is checked;
   then Escape.
5. Record RED or guard per test in `context.md`.

**Verification**:
Run from `services/xstockstrat-ui` with Node 24 first on `PATH`; one command per line, each must exit 0.
```bash
pnpm run lint
pnpm exec tsc --noEmit
pnpm run format:check
pnpm run lint:dup
CI=1 NEXT_DISABLE_STANDALONE=1 pnpm exec playwright test e2e/trader/orders.spec.ts e2e/insights/opportunities.spec.ts --project=chromium --no-deps --trace off
CI=1 NEXT_DISABLE_STANDALONE=1 pnpm exec playwright test e2e/trader/order-parity.spec.ts e2e/trader/stream-reconnect.spec.ts e2e/trader/signal-confidence-ticket.spec.ts --project=chromium --no-deps --trace off
test "$(grep -c 'disabled: isTerminal' src/components/trader/OrdersTable.tsx)" -eq 2
```
RED before Step 5: every feature-350 orders test except `@AC-7`; record each failing assertion in `context.md`.
Trading-domain check: the last line pins both `disabled: isTerminal` uses; the repointed
"Edit is enabled…" test covers NEW, PARTIALLY_FILLED and FILLED.
Coverage: no `src/lib/**` code is added; e2e is not coverage-gated.
C-12: no fixture is added, INVENTORY.md is unchanged.

---

### Step 7 — service: the strategies list adopts `RowActionsMenu` through a module-level cell

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/insights/strategies/page.tsx` — modify

**Reviewers**: `xstockstrat-ui` owner — Trading UI correctness, analytics display accuracy

**Codebase Evidence**:
- `ui/src/app/insights/strategies/page.tsx`: imports — `useState` `:2`, `EllipsisVertical` `:5`,
  the dropdown parts `:13-18`, the alert-dialog parts `:19-25`; `router` `:35` (also used by "New
  Strategy" `:204`); `const manage = useManageStrategy();` `:43`; `scoreById` is a new `Map` every
  render `:45`; `handleDeactivate` `:58-60`; the actions column `:164-188` (header
  `isAdmin ? 'Actions' : ''` `:166`; the non-admin "Open →" link `:180-185`); `columns` deps
  `[scoreById, isAdmin, manage.isPending, router, handleDeactivate]` `:190` — rebuilt every render;
  `StrategyActionsCell` `:272-337` (trigger `aria-label="Actions"` `:294`,
  `data-testid={`actions-${strategyId}`}` `:295`; Edit `:301`; Deactivate only when `active`
  `:302-313`; dialog text `:319-320`, no title).
- Hooks the cell will read itself: `useIsAdmin` (`ui/src/hooks/useLiveStrategies.ts:61-64`, one
  shared `auth-me` query), `useManageStrategy` (`ui/src/hooks/useStrategyDefinitions.ts:34-60`, no
  `meta`, so a failure still reaches the global fallback).
- `CellContext` typing precedent: `ui/src/app/config-ui/[namespace]/NamespaceEditor.tsx:5,62`.
- A module-level function used directly as `cell` keeps its component type across a rebuilt
  `columns` array (`flexRender`, `@tanstack/react-table` `build/lib/index.mjs:20-22`;
  `ui/src/components/ui/data-table.tsx:184-191`, cell key = `cell.id`).

**Lands with**: `Step 8`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Rewrite `StrategyActionsCell` (same name, module level) to take the TanStack cell context
   (`CellContext<StrategyDefinition, unknown>`) and to call `useIsAdmin`, `useRouter` and its own
   `useManageStrategy` (D-10). All hooks run before any return.
   - Non-admin: return the "Open →" link exactly as at `:180-185`.
   - Admin: return one `RowActionsMenu` with `testId` `actions-${strategyId}` (kept) and
     `triggerLabel` `Actions for ${strategyId}` (D-15); "Edit" →
     `router.push(`/insights/strategies/${strategyId}/edit`)`; "Deactivate" only when the definition
     is `active`, `destructive: true`, `disabled` while this row's mutation is pending, `onSelect`
     calling the mutation with `StrategyOperation.DEACTIVATE` and `{ strategyId }` (as `:59`),
     `confirm` with title "Deactivate strategy" and the existing description text of `:319-320`.
2. In the `columns` memo set the actions column's `cell` to `StrategyActionsCell` itself (a
   reference, not an inline arrow); keep `id`, `header`, `enableSorting` and `meta`. Deps become
   `[scoreById, isAdmin]`.
3. Delete the page-level `manage` (`:43`) and `handleDeactivate` (`:58-60`). Keep `router`.
4. Remove the imports that are no longer used (`useState`, `EllipsisVertical`, the dropdown and
   alert-dialog parts); add `RowActionsMenu` and the `CellContext` type.
5. No context provider and no `DataTable` `meta` prop (R-9); no change to the other columns.

**Verification**:
The union with Step 8. On its own — Run from `services/xstockstrat-ui` with Node 24 first on `PATH`; one command per line, each must exit 0.
```bash
pnpm run lint
pnpm exec tsc --noEmit
pnpm run format:check
pnpm run lint:dup
! grep -nE "preventDefault|AlertDialog|DropdownMenu" src/app/insights/strategies/page.tsx
```

---

### Step 8 — test: strategies Deactivate confirm flow

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/insights/strategy-authoring.spec.ts` — modify

**Reviewers**: `xstockstrat-ui` owner — Trading UI correctness

**Codebase Evidence**:
- `ui/e2e/insights/strategy-authoring.spec.ts`: imports `:1-3`; the Edit test `:105-111`; the
  Deactivate test `:113-127` with the unscoped `page.getByText(/Deactivate strategy/)` `:123` and
  the unscoped "Confirm" `:124`.
- Fixtures (INVENTORY.md `:30`): `STRATEGY_DEF_LIVE` (`strat-live-001`,
  `ui/e2e/fixtures/strategies.ts:53-58`), `STRATEGY_DEF_INACTIVE` (`strat-live-002`, `:60-65`),
  `STRATEGY_DEFINITIONS` `:77`, exported from `../fixtures` (`ui/e2e/fixtures/index.ts`).
- The shared mock returns the static `STRATEGY_DEFINITIONS` as `{ definitions, totalCount }`
  (`ui/e2e/mock-backend.ts:1364-1373`) and echoes `manageStrategy` (`:1385-1397`), so "switched
  off" needs a per-test stateful `ListStrategyDefinitions` route. Stateful-route precedent:
  `ui/e2e/trader/account-resume.spec.ts:56-64,73-74`.
- The page refetches the list after the mutation
  (`ui/src/hooks/useStrategyDefinitions.ts:54-58`) and an admin still sees an inactive definition,
  shown as "Off" (`ui/src/app/insights/strategies/page.tsx:39`, `:81-86`).
- Other spec that opens the list: `ui/e2e/insights/strategy-ownership.spec.ts`.
- The helper comes from Step 2.

**Lands with**: `Step 7`

**TDD**: `red-green required` — the "menu closed after Confirm" half of `@AC-6` is a guard (O-4);
the trigger-focus assertion of `@AC-9` is the RED.

**Covers**: `AC-6` (strategies rows), `AC-9` (strategies row)

**Instructions**:
1. In the existing Deactivate test scope both locators to `page.getByRole('alertdialog')`: the
   "Deactivate strategy" heading and the exact-name "Confirm" button. The Edit test is unchanged.
2. Add `test.describe('Row menu confirm flow (feature 350)', …)` (admin cookie):
   - `@AC-6` dismiss: choose Deactivate on `actions-strat-live-001`, click "Cancel",
     `expectRowMenuSettled`, then one click on `actions-strat-live-002` shows its "Edit" item.
   - `@AC-6 @AC-9` confirm: route
     `**/insights/api/xstockstrat.analysis.v1.AnalysisService/ListStrategyDefinitions` statefully —
     `STRATEGY_DEFINITIONS` first, and the same list with
     `{ ...STRATEGY_DEF_LIVE, active: false }` once Confirm is clicked. Mark the button named
     "Actions for strat-live-001", choose Deactivate, click "Confirm", wait for that row to show
     "Off" (exact), then settled, `expectFocusOnMarkedTrigger`, and one click on
     `actions-strat-live-002` shows its "Edit" item. No reload.
3. Record RED or guard per assertion in `context.md`.

**Verification**:
Run from `services/xstockstrat-ui` with Node 24 first on `PATH`; one command per line, each must exit 0.
```bash
pnpm run lint
pnpm exec tsc --noEmit
pnpm run format:check
pnpm run lint:dup
CI=1 NEXT_DISABLE_STANDALONE=1 pnpm exec playwright test e2e/insights/strategy-authoring.spec.ts e2e/insights/strategy-ownership.spec.ts --project=chromium --no-deps --trace off
```
RED before Step 7: the `@AC-6` dismiss test (menu still open) and the `@AC-9` focus assertion.
Coverage: no `src/lib/**` code is added; e2e is not coverage-gated.
C-12: the `active: false` spread is a scenario one-off; no domain literal is added.

---

### Step 9 — docs: ledger entries superseding the "menu stays mounted" guidance

**Status**: `done`
**Service**: `docs/roadmap/ledger/`
**Files**:
- `docs/roadmap/ledger/fails.md` — modify (append)
- `docs/roadmap/ledger/insights.md` — modify (append)

**Reviewers**: none

**Codebase Evidence**:
- `docs/roadmap/ledger/fails.md:2307-2310` (2026-09-16, ui-resume-halted-account) tells authors to
  "expect the trigger to stay mounted" and to "reset the menu between interactions".
- `docs/roadmap/ledger/insights.md:2999-3010` (2026-09-05, ui-resume-halted-account) says the
  dropdown "stays *mounted* through the confirm flow" and that re-opening needs an `Escape` reset.
- Both files are append-newest-at-bottom with a fixed schema (`fails.md:14-29`,
  `insights.md:14-27`); an entry is superseded by a new entry, never edited (D-9).
- The remount trap is recorded in debate.md D-5 and D-10.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. Append to `fails.md`, dated the day of execution, slug `fix-row-menu-stays-open`, category
   `assumption`:
   - an entry that supersedes the "stays mounted / reset the menu" half of the 2026-09-16 entry:
     the confirm item's `preventDefault` never let the modal menu close; since feature 350 the menu
     closes on select and focus returns to the row's trigger. Its dialog-scoped-assertion half
     still holds. Evidence: `RowActionsMenu.tsx`, the defect report, this feature's `@AC-1..@AC-3`.
   - an entry for the remount trap: a `columns` memo that rebuilds remounts every `DataTable` cell,
     dropping a cell's open dialog and the element focus should return to. Evidence: debate.md D-5,
     D-10; `data-table.tsx` `columns` comment. Rule: keep the memo stable or use a module-level
     cell component when a cell holds state.
2. Append to `insights.md`, category `reuse`: an entry that supersedes consequence (b) of the
   2026-09-05 entry (no `Escape` reset is needed any more) and keeps (a); and names
   `e2e/helpers/rowMenu.ts` as the helper for confirm-flow assertions.
3. Edit no existing entry. Use no Tailwind class name or colour literal in the text
   (fails.md 2026-11-10, ui-env-themed-bundles).

**Verification**:
Run from the repo root before the commit; one command per line, each must exit 0.
```bash
git diff HEAD --stat -- docs/roadmap/ledger/
! git diff HEAD -- docs/roadmap/ledger/ | grep -q '^-[^-]'
test "$(git diff HEAD -- docs/roadmap/ledger/ | grep -c '^+### .*fix-row-menu-stays-open')" -eq 3
```
The second line proves the change is append-only; the third counts the three new headings (two in
`fails.md`, one in `insights.md`).

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

### Deviation: Step 2 — Playwright invocation and the dev-server repeats
**Spec said**: `CI=1 NEXT_DISABLE_STANDALONE=1 pnpm exec playwright test …` for every e2e line, and for the D-17 runs "all five repeats must fail (dev server, then production build)" / restored "must then pass 5/5" in both modes.
**Actual**: every production-build line was run as `NEXT_DISABLE_STANDALONE=1 pnpm build` once per code state followed by `CI=1 E2E_PREBUILT=1 NEXT_DISABLE_STANDALONE=1 pnpm exec playwright test …` (the config's own prebuilt path, `playwright.config.ts:129-133`). Production build: mutation 5/5 failed on the empty-log assertion, restored 5/5 passed. Dev server: mutation 5/5 failed (4 on the empty-log assertion, 1 on `page.goto` exceeding the 10 s local test timeout while the route compiled); restored 4/5 passed, 1 failed on the same first-navigation compile timeout — in three consecutive dev runs the first repeat timed out at `page.goto` and no repeat ever failed or passed on the guard for the wrong reason.
**Reason**: rebuilding inside every Playwright command costs ~2 minutes each; the dev server compiles a route on its first hit (the flake `playwright.config.ts` documents), which the local 10 s test timeout does not absorb.
**Disposition**: CI-equivalent fallback — the production build is the mode `frontend-e2e` runs; the dev-server evidence is recorded as 4 right-reason failures / 4 passes with the first repeat lost to route compilation. No mutation repeat passed in either mode (D-17's stop condition did not fire).

### Deviation: Step 8 — how the `@AC-9` strategies test finds the trigger
**Spec said**: "Mark the button named \"Actions for strat-live-001\", choose Deactivate, click \"Confirm\" …"
**Actual**: the test marks the trigger through its kept test id `actions-strat-live-001` and asserts its accessible name "Actions for strat-live-001" after the focus assertion.
**Reason**: on the pre-unit tree every trigger is named "Actions", so a name locator would fail before the flow starts and the RED would not be the focus assertion the step requires.
**Disposition**: test-only; same behaviour asserted, RED captured for the right reason.

### Deviation: Steps 2, 4, 6, 8 — the focus-marker helper and the orders load wait
**Spec said**: `markTrigger(locator)` — "sets one marker attribute on the element (D-13)", called before the row menu is opened; the orders feature-350 block "shares `beforeEach`".
**Actual**: the helper is `openMarkedRowMenu(trigger)`: it tags the trigger and opens the menu by clicking the tagged node. The orders feature-350 block adds its own `beforeEach` that waits for the first account-scoped `ListOrders` request.
**Reason**: a full local e2e run passed (692 passed, 1 flaky): the orders confirm test failed once at the marker check and passed on retry. Reproduced under load (10 of 34 runs). The page snapshot showed focus on the correct trigger with the marker gone: the orders table remounts once at page load, when the selected account resolves and the list query is re-keyed (`useOrders` query key; `OrdersTable` renders the table only when not loading), so a marker set, or a menu opened, before that is lost. This is page-load behaviour that predates this feature and is not part of the confirm flow.
**Disposition**: test-only fix at the root cause. After it: orders feature-350 tests 100 of 100 under load; all feature-350 tests ×4 (76 runs) passed; the five touched spec files pass with retries off. No production code changed.

