import { test, expect, type Page } from '@playwright/test';
import { addAdminCookie, addAuthCookie } from '../helpers/auth';
import { BROKER_ACCOUNT_HALTED, BROKER_ACCOUNT_ALPACA } from '../fixtures/accounts';
import { expectFocusOnMarkedTrigger, expectRowMenuSettled, markTrigger } from '../helpers/rowMenu';

/**
 * Feature 179 — halt indicator + admin-gated Resume on the /trader/accounts surface.
 *
 * The Resume action calls the real BFF route (traderBff `resumeAccount: forwardAdmin`) → the
 * mock backend's unconditional-success `resumeAccount`, so a PermissionDenied can originate ONLY
 * from the `forwardAdmin` gate — never the backend (isolates @AC-5). `ListBrokerAccounts` is routed
 * per test; `ResumeAccount` is deliberately NOT intercepted so the real edge gate runs.
 */
const LIST = '**/xstockstrat.trading.v1.TradingService/ListBrokerAccounts';
const RESUME = '**/xstockstrat.trading.v1.TradingService/ResumeAccount';

function fulfillAccounts(accounts: unknown[]) {
  return async (route: import('@playwright/test').Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ accounts }),
    });
  };
}

test.describe('Account halt indicator + admin Resume', () => {
  test('@AC-1 halted account shows the indicator, reason, and source on the accounts page', async ({
    page,
  }) => {
    await page.route(LIST, fulfillAccounts([BROKER_ACCOUNT_HALTED, BROKER_ACCOUNT_ALPACA]));
    await addAdminCookie(page);
    await page.goto('/trader/accounts');

    const row = page.getByTestId('account-row-halted-001');
    await expect(row.getByText('Halted', { exact: true })).toBeVisible({ timeout: 30000 });
    await expect(row.getByText('bracket flatten failed')).toBeVisible();
    await expect(row.getByText('Bracket protection')).toBeVisible();
    // Page load only — no order placed.
  });

  test('@AC-2 Resume action is offered only for the halted account', async ({ page }) => {
    await page.route(LIST, fulfillAccounts([BROKER_ACCOUNT_HALTED, BROKER_ACCOUNT_ALPACA]));
    await addAdminCookie(page);
    await page.goto('/trader/accounts');

    await expect(page.getByTestId('account-row-halted-001')).toBeVisible({ timeout: 30000 });
    await page.getByRole('button', { name: 'Actions for Halted Alpaca' }).click();
    await expect(page.getByRole('menuitem', { name: 'Resume' })).toBeVisible();
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Actions for Alpaca Paper' }).click();
    await expect(page.getByRole('menuitem', { name: 'Resume' })).toHaveCount(0);
  });

  test('@AC-3 confirming Resume clears the halt in place (no reload)', async ({ page }) => {
    let resumed = false;
    await page.route(LIST, async (route) => {
      const account = resumed ? { ...BROKER_ACCOUNT_HALTED, halted: false } : BROKER_ACCOUNT_HALTED;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ accounts: [account] }),
      });
    });
    await addAdminCookie(page);
    await page.goto('/trader/accounts');

    const row = page.getByTestId('account-row-halted-001');
    await expect(row.getByText('Halted', { exact: true })).toBeVisible({ timeout: 30000 });

    await page.getByRole('button', { name: 'Actions for Halted Alpaca' }).click();
    await page.getByRole('menuitem', { name: 'Resume' }).click();
    // The post-resume refetch must observe the cleared account.
    resumed = true;
    await page.getByRole('button', { name: 'Confirm' }).click();

    // In place (never a reload): the halt indicator and the Resume action are gone.
    await expect(row.getByText('Halted', { exact: true })).toHaveCount(0, { timeout: 30000 });
    await page.getByRole('button', { name: 'Actions for Halted Alpaca' }).click();
    await expect(page.getByRole('menuitem', { name: 'Resume' })).toHaveCount(0);
    await page.keyboard.press('Escape');
  });

  test('@AC-4 resume on a non-halted account is a benign 200 no-op', async ({ page }) => {
    await page.route(LIST, fulfillAccounts([BROKER_ACCOUNT_ALPACA]));
    await addAdminCookie(page);
    await page.goto('/trader/accounts');
    await expect(page.getByTestId('account-row-alpaca-default')).toBeVisible({ timeout: 30000 });

    const status = await page.evaluate(() =>
      fetch('/trader/api/xstockstrat.trading.v1.TradingService/ResumeAccount', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accountId: 'alpaca-default' }),
      }).then((r) => r.status),
    );
    expect(status).toBe(200);
  });

  test('@AC-5 a non-admin cannot resume — no action, and the route rejects 403', async ({
    page,
  }) => {
    await page.route(LIST, fulfillAccounts([BROKER_ACCOUNT_HALTED]));
    await addAuthCookie(page); // no roles → non-admin
    await page.goto('/trader/accounts');

    await expect(page.getByTestId('account-row-halted-001')).toBeVisible({ timeout: 30000 });
    await page.getByRole('button', { name: 'Actions for Halted Alpaca' }).click();
    await expect(page.getByRole('menuitem', { name: 'Resume' })).toHaveCount(0);
    await page.keyboard.press('Escape');

    // The BFF forwardAdmin gate rejects even though the backend would succeed.
    const status = await page.evaluate(() =>
      fetch('/trader/api/xstockstrat.trading.v1.TradingService/ResumeAccount', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accountId: 'halted-001' }),
      }).then((r) => r.status),
    );
    expect(status).toBe(403);
  });

  test('@AC-6 Resume requires a reason-surfacing confirmation before any request fires', async ({
    page,
  }) => {
    await page.route(LIST, fulfillAccounts([BROKER_ACCOUNT_HALTED]));
    let resumeRequests = 0;
    page.on('request', (r) => {
      if (r.url().includes('/TradingService/ResumeAccount')) resumeRequests += 1;
    });
    await addAdminCookie(page);
    await page.goto('/trader/accounts');

    const row = page.getByTestId('account-row-halted-001');
    await expect(row.getByText('Halted', { exact: true })).toBeVisible({ timeout: 30000 });

    await page.getByRole('button', { name: 'Actions for Halted Alpaca' }).click();
    await page.getByRole('menuitem', { name: 'Resume' }).click();

    // The confirmation surfaces the halt reason, and no request has fired yet. Scope to the dialog:
    // the reason also renders in the row behind it, so an unscoped match is a strict-mode dup.
    await expect(page.getByRole('alertdialog').getByText('bracket flatten failed')).toBeVisible();
    expect(resumeRequests).toBe(0);

    // Dismiss → still halted, still no request.
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(row.getByText('Halted', { exact: true })).toBeVisible();
    expect(resumeRequests).toBe(0);
  });
});

test.describe('Row menu confirm flow (feature 350)', () => {
  const HALTED_TRIGGER = 'Actions for Halted Alpaca';
  const ALPACA_TRIGGER = 'Actions for Alpaca Paper';

  async function openAccounts(page: Page, accounts: unknown[]) {
    await page.route(LIST, fulfillAccounts(accounts));
    await addAdminCookie(page);
    await page.goto('/trader/accounts');
    await expect(page.getByRole('button', { name: ALPACA_TRIGGER })).toBeVisible({
      timeout: 30000,
    });
  }

  async function expectOtherRowMenuOpensOnOneClick(page: Page) {
    await page.getByRole('button', { name: ALPACA_TRIGGER }).click();
    await expect(page.getByRole('menuitem', { name: 'Remove' })).toBeVisible();
  }

  test('@AC-1 choosing Resume closes the row menu and shows the dialog', async ({ page }) => {
    await openAccounts(page, [BROKER_ACCOUNT_HALTED, BROKER_ACCOUNT_ALPACA]);
    await page.getByRole('button', { name: HALTED_TRIGGER }).click();
    await page.getByRole('menuitem', { name: 'Resume' }).click();

    await expect(page.getByRole('alertdialog', { name: 'Resume account' })).toBeVisible();
    await expect(page.locator('[role="menu"]')).toHaveCount(0);
  });

  test('@AC-2 @AC-3 dismissing Resume leaves the page usable and focus on the trigger', async ({
    page,
  }) => {
    await openAccounts(page, [BROKER_ACCOUNT_HALTED, BROKER_ACCOUNT_ALPACA]);
    const trigger = page.getByRole('button', { name: HALTED_TRIGGER });
    await markTrigger(trigger);
    await trigger.click();
    await page.getByRole('menuitem', { name: 'Resume' }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Cancel', exact: true })
      .click();

    await expectRowMenuSettled(page);
    await expectFocusOnMarkedTrigger(page);
    await expectOtherRowMenuOpensOnOneClick(page);
  });

  test('@AC-2 @AC-3 confirming Resume leaves the page usable and focus on the trigger', async ({
    page,
  }) => {
    let resumed = false;
    await page.route(LIST, async (route) => {
      const halted = resumed ? { ...BROKER_ACCOUNT_HALTED, halted: false } : BROKER_ACCOUNT_HALTED;
      await fulfillAccounts([halted, BROKER_ACCOUNT_ALPACA])(route);
    });
    await addAdminCookie(page);
    await page.goto('/trader/accounts');
    const row = page.getByTestId('account-row-halted-001');
    await expect(row.getByText('Halted', { exact: true })).toBeVisible({ timeout: 30000 });

    const trigger = page.getByRole('button', { name: HALTED_TRIGGER });
    await markTrigger(trigger);
    await trigger.click();
    await page.getByRole('menuitem', { name: 'Resume' }).click();
    resumed = true;
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Confirm', exact: true })
      .click();

    await expect(row.getByText('Halted', { exact: true })).toHaveCount(0, { timeout: 30000 });
    await expectRowMenuSettled(page);
    await expectFocusOnMarkedTrigger(page);
    await expectOtherRowMenuOpensOnOneClick(page);
  });

  test('@AC-4 confirming Remove moves focus to the main content when the trigger disappears', async ({
    page,
  }) => {
    let removed = false;
    await page.route(LIST, async (route) => {
      const account = removed
        ? { ...BROKER_ACCOUNT_ALPACA, isActive: false }
        : BROKER_ACCOUNT_ALPACA;
      await fulfillAccounts([account])(route);
    });
    await addAdminCookie(page);
    await page.goto('/trader/accounts');
    const trigger = page.getByRole('button', { name: ALPACA_TRIGGER });
    await expect(trigger).toBeVisible({ timeout: 30000 });

    await trigger.click();
    await page.getByRole('menuitem', { name: 'Remove' }).click();
    removed = true;
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Confirm', exact: true })
      .click();

    await expect(trigger).toHaveCount(0, { timeout: 30000 });
    await expectRowMenuSettled(page);
    await expect(page.getByRole('main')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Add account' })).toBeFocused();
  });

  test('@AC-6 dismissing Remove closes the menu and the page answers the first click', async ({
    page,
  }) => {
    await openAccounts(page, [BROKER_ACCOUNT_ALPACA]);
    await page.getByRole('button', { name: ALPACA_TRIGGER }).click();
    await page.getByRole('menuitem', { name: 'Remove' }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Cancel', exact: true })
      .click();

    await expectRowMenuSettled(page);
    await page.getByRole('button', { name: 'Add account' }).click();
    await expect(page.getByRole('alertdialog', { name: 'Add account' })).toBeVisible();
  });

  test('@AC-10 keyboard: focus stays on the dialog while the row menu finishes closing', async ({
    page,
  }) => {
    await openAccounts(page, [BROKER_ACCOUNT_ALPACA]);
    await page.getByRole('button', { name: ALPACA_TRIGGER }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitem', { name: 'Edit keys' })).toBeFocused();

    await page.evaluate(() => {
      const w = window as unknown as { __menuCloseFocusRan?: boolean; __focusLog?: string[] };
      const name = (n: EventTarget | null) =>
        n instanceof Element
          ? (n.getAttribute('aria-label') ?? n.textContent ?? n.tagName)
          : 'none';
      w.__focusLog = [];
      // Radix dispatches this on the menu element itself, after it is detached; it does not bubble.
      document
        .querySelector('[role="menu"]')
        ?.addEventListener('focusScope.autoFocusOnUnmount', () => (w.__menuCloseFocusRan = true));
      let armed = false;
      for (const type of ['focusin', 'focusout'] as const) {
        document.addEventListener(
          type,
          (e) => {
            const fe = e as FocusEvent;
            if (armed)
              w.__focusLog?.push(`${type} ${name(fe.target)} <- ${name(fe.relatedTarget)}`);
            else if (type === 'focusin' && (fe.target as Element).closest('[role="alertdialog"]'))
              armed = true;
          },
          true,
        );
      }
    });

    await page.keyboard.press('End');
    await expect(page.getByRole('menuitem', { name: 'Remove' })).toBeFocused();
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('alertdialog', { name: 'Deregister account' });
    const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true });
    await expect(dialog).toBeVisible();
    await expect(cancel).toBeFocused();
    await page.waitForFunction(
      () => (window as unknown as { __menuCloseFocusRan?: boolean }).__menuCloseFocusRan === true,
    );
    expect(
      await page.evaluate(() => (window as unknown as { __focusLog?: string[] }).__focusLog),
    ).toEqual([]);
    await expect(cancel).toBeFocused();
  });
});
