import { test, expect } from '@playwright/test';
import { addAdminCookie, addAuthCookie } from '../helpers/auth';
import { BROKER_ACCOUNT_HALTED, BROKER_ACCOUNT_ALPACA } from '../fixtures/accounts';

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
    // The confirm flow leaves the row menu mounted (Radix keeps it open on select-preventDefault);
    // reset it before re-opening so the trigger click isn't blocked by the still-open menu.
    await page.keyboard.press('Escape');
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
