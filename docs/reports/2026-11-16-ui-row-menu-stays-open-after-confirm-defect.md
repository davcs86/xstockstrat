# Defect: A row's actions menu stays open after a confirmed action and swallows the next click

**Recorded**: 2026-11-16
**Severity**: SEV-3
**Impact type**: ui-interaction-blocked
**Environment**: staging (homelab, main-dev)
**Affected service(s)**: xstockstrat-ui
**Config-only fix possible**: no

## Observed

In a table whose row actions open a confirmation dialog (cancel an order, resume a halted account,
and every other `confirm` action on the shared row menu), confirming or cancelling the dialog
leaves the row's three-dots menu open behind it. The open menu is modal: the page behind it does
not respond, and the user's next click anywhere only closes the menu. The click after that does
what they meant. Measured on `/trader/orders` in a headless Chromium run (feature 339 CI
investigation, 2026-11-16): 1.5 s after the dialog had gone, the menu was still open and `body`
still had `pointer-events: none`; one click outside closed the menu and restored pointer events,
and only the following click dismissed the error banner.

Since feature 339 (PR #1550) the dialog also plays a 100 ms closing animation and stays in the
dismissable-layer stack until it ends, so an Escape pressed right after Confirm goes to the closing
dialog instead of the menu. Before 339 an immediate Escape closed the menu.

## Expected

Choosing a menu action that needs confirmation closes the menu. After the dialog is confirmed or
cancelled, the page is interactive at once: the first click or key press does what the user
intends, and focus returns to the row's actions trigger.

## Reproduction

1. Open `/trader/orders` with at least one cancellable order.
2. Open a row's three-dots menu and choose Cancel.
3. Confirm (or dismiss) the dialog.
4. Click any other control on the page: the click only closes the still-open row menu.

## Evidence

`services/xstockstrat-ui/src/components/shared/RowActionsMenu.tsx:90-96`
> onSelect={(e) => { if (action.confirm) { … e.preventDefault(); setPending(action); }

`services/xstockstrat-ui/src/components/trader/OrdersTable.tsx:182-183`
> onSelect={(e) => { e.preventDefault();

`services/xstockstrat-ui/e2e/trader/orders.spec.ts:220`
> // The row's kebab menu stays open (modal) after the confirm; close it so the banner is clickable.

`services/xstockstrat-ui/e2e/trader/account-resume.spec.ts:79`
> // The confirm flow leaves the row menu open (select-preventDefault), blocking the trigger click.

Other users of the shared menu: `src/components/trader/accountShared.tsx`,
`src/app/accounts/authorized-apps/page.tsx`, `src/app/config-ui/templates/page.tsx`,
`src/app/insights/signal-sources/page.tsx`. Similar `onSelect` + `preventDefault` sites, not yet
checked for the same effect: `src/app/insights/strategies/page.tsx:306`,
`src/app/insights/opportunities/page.tsx:257`.

## Root cause hypothesis

The menu item's `onSelect` calls `preventDefault()` to stop the menu's close from racing the dialog
opening, which also stops the menu from ever closing; nothing closes it when the dialog resolves.

## Confidence

high (behaviour measured in the browser; the two specs already work around it)
