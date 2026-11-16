# Product Spec: fix-row-menu-stays-open

**Type**: bug
**GitHub Issue**: none (Issues disabled) — report: `docs/reports/2026-11-16-ui-row-menu-stays-open-after-confirm-defect.md`
**Severity**: SEV-3
**Created**: 2026-11-16

---

## Problem Statement

In a table whose row actions open a confirmation dialog, confirming or cancelling the dialog leaves
the row's three-dots menu open behind it. The open menu is modal: `body` keeps
`pointer-events: none` and the rest of the page is hidden from assistive technology, so the user's
next click anywhere only closes the menu and the click after that does what they meant.

Measured on `/trader/orders` in headless Chromium (feature 339 CI investigation, 2026-11-16): 1.5 s
after the dialog had gone the menu was still open and `body` still had `pointer-events: none`; one
click outside closed the menu; only the following click dismissed the error banner.

Since feature 339 (PR #1550) the dialog also plays a 100 ms closing animation and stays in the
dismissable-layer stack until it ends, so an Escape pressed right after Confirm goes to the closing
dialog instead of the menu.

**Expected.** Choosing a menu action that needs confirmation closes the menu. After the dialog is
confirmed or cancelled the page is interactive at once: the first click or key press does what the
user intends, and focus returns to the row's actions trigger.

## Functional Requirements

- **FR-1** Choosing a confirm-type row action closes the row menu, and the confirmation dialog
  opens every time (pointer and keyboard).
- **FR-2** After the dialog is confirmed or cancelled, nothing of the menu or dialog is left
  blocking the page: no `pointer-events: none` on `body`, no page content left hidden from
  assistive technology, and the first click or key press reaches its target.
- **FR-3** After the dialog is confirmed or cancelled, keyboard focus is on the actions trigger of
  the row the action was chosen from. When that trigger no longer exists or is disabled (the row
  left the table), focus is not left on a removed element; the fallback target is fixed by the
  design.
- **FR-4** FR-1..FR-3 hold for every confirm action on every table that uses the shared row menu,
  and for the orders table's Cancel action, through one mechanism.
- **FR-5** Row actions that do not ask for confirmation, and menu items that deliberately keep
  their menu open (the multi-select source filter on opportunities), behave as they do today.

## Reproduction Steps

1. Open `/trader/orders` with at least one cancellable order.
2. Open a row's three-dots menu and choose Cancel.
3. Confirm (or dismiss) the dialog.
4. Click any other control on the page: the click only closes the still-open row menu.

## Root Cause Hypothesis

The menu item's `onSelect` calls `preventDefault()` to stop the menu's close from racing the dialog
opening, which also stops the menu from ever closing; nothing closes it when the dialog resolves.
Sites: `src/components/shared/RowActionsMenu.tsx` (shared row menu),
`src/components/trader/OrdersTable.tsx` (own menu and dialog),
`src/app/insights/strategies/page.tsx` (own menu and dialog, same shape — confirmed by reading at
triage, to be measured in recon).

## Affected Services

xstockstrat-ui

## Consumer Surface(s)

Browser UI only (C-14): every table with a three-dots row menu whose action asks for confirmation —
`/trader/orders`, `/trader/accounts`, `/accounts/authorized-apps`, `/config-ui/templates`,
`/insights/strategies`. No MCP tool, RPC or CLI surface changes.

## Fix Scope

- [x] No proto changes anticipated
- [x] No database migrations anticipated
- [x] No config key changes anticipated

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; the two e2e specs that work around
the open menu (`e2e/trader/orders.spec.ts` `@AC-10`, `e2e/trader/account-resume.spec.ts` `@AC-3`)
assert the fixed behaviour instead.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
- Any global animation or reduced-motion change, in CSS or in the Playwright configuration
- Confirmation dialogs opened from a plain button rather than a menu item (watchlist delete,
  formula delete, backfill cancel)
