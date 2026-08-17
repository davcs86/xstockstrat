import { test, expect } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';
import { BROKER_ACCOUNT_ALPACA, BROKER_ACCOUNT_NEW } from '../fixtures';

/**
 * E2E tests for AccountSelector and AccountManagementPanel.
 *
 * ListBrokerAccounts and RegisterBrokerAccount are intercepted via page.route on
 * the BFF Connect paths (glob: "**TradingService/ListBrokerAccounts", etc.) rather than
 * the non-existent /trader/api/accounts REST route. The Connect JSON response uses
 * camelCase proto field names (id, displayName, brokerType, isPaper, isActive).
 */

test.describe('AccountSelector', () => {
  test('Account Selector is visible in the header', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/trader');
    await expect(page.getByRole('combobox').first()).toBeVisible({ timeout: 5000 });
  });

  test('Place Order button is disabled when no account is selected', async ({ page }) => {
    await page.route(
      '**/xstockstrat.trading.v1.TradingService/ListBrokerAccounts',
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ accounts: [] }),
        });
      },
    );
    await addAuthCookie(page);
    await page.goto('/trader');
    const submitBtn = page.getByRole('button', { name: /buy|sell/i }).last();
    await expect(submitBtn).toBeDisabled({ timeout: 5000 });
  });

  test('Place Order button is enabled when an account is selected', async ({ page }) => {
    await page.route(
      '**/xstockstrat.trading.v1.TradingService/ListBrokerAccounts',
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ accounts: [BROKER_ACCOUNT_ALPACA] }),
        });
      },
    );
    await addAuthCookie(page);
    await page.goto('/trader');
    const submitBtn = page.getByRole('button', { name: /buy|sell/i }).last();
    await expect(submitBtn).toBeEnabled({ timeout: 5000 });
  });

  test('Account Management Panel opens via gear icon', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/trader');
    // Gear icon is a link that navigates to the accounts submodule page.
    await page.getByRole('link', { name: /manage accounts/i }).click();
    await expect(page.getByRole('heading', { name: 'Broker Accounts' })).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByRole('button', { name: 'Add account' })).toBeVisible();
  });

  test('Add Account modal closes on success', async ({ page }) => {
    await page.route(
      '**/xstockstrat.trading.v1.TradingService/ListBrokerAccounts',
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ accounts: [BROKER_ACCOUNT_ALPACA] }),
        });
      },
    );
    await page.route(
      '**/xstockstrat.trading.v1.TradingService/RegisterBrokerAccount',
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ account: BROKER_ACCOUNT_NEW }),
        });
      },
    );
    await addAuthCookie(page);
    // Navigate directly to the accounts submodule page. Add now happens in a modal opened from the
    // "Add account" button in the Registered Accounts header.
    await page.goto('/trader/accounts');
    await page.getByRole('button', { name: 'Add account' }).click();
    const dialog = page.getByRole('alertdialog');
    await dialog.getByPlaceholder('Display name').fill('Test Account');
    await dialog.getByPlaceholder('API Key').fill('test-key-123');
    await dialog.getByPlaceholder('API Secret').fill('test-secret-456');
    await dialog.getByRole('button', { name: 'Add Account' }).click();
    // The modal closes on successful registration.
    await expect(page.getByRole('alertdialog')).toHaveCount(0, { timeout: 5000 });
  });

  test('Edit keys opens a credential modal; Cancel closes it (feature 121, FR-3)', async ({
    page,
  }) => {
    await page.route(
      '**/xstockstrat.trading.v1.TradingService/ListBrokerAccounts',
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ accounts: [BROKER_ACCOUNT_ALPACA] }),
        });
      },
    );
    await addAuthCookie(page);
    await page.goto('/trader/accounts');

    // Edit keys now opens a modal (UI refinement) — no credential form is rendered until it opens.
    const row = page.getByTestId(`account-row-${BROKER_ACCOUNT_ALPACA.id}`);
    const actions = row.getByRole('button', {
      name: `Actions for ${BROKER_ACCOUNT_ALPACA.displayName}`,
    });
    await expect(actions).toBeVisible({ timeout: 5000 });
    await expect(page.getByPlaceholder('API Key')).toHaveCount(0);

    await actions.click();
    await page.getByRole('menuitem', { name: 'Edit keys' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog.getByPlaceholder('API Key')).toBeVisible();

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
  });

  test('Edit Credentials modal closes on successful save (feature 122, FR-3 characterization)', async ({
    page,
  }) => {
    await page.route(
      '**/xstockstrat.trading.v1.TradingService/ListBrokerAccounts',
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ accounts: [BROKER_ACCOUNT_ALPACA] }),
        });
      },
    );
    await addAuthCookie(page);
    await page.goto('/trader/accounts');

    const row = page.getByTestId(`account-row-${BROKER_ACCOUNT_ALPACA.id}`);
    await row
      .getByRole('button', { name: `Actions for ${BROKER_ACCOUNT_ALPACA.displayName}` })
      .click();
    await page.getByRole('menuitem', { name: 'Edit keys' }).click();
    const dialog = page.getByRole('alertdialog');
    await dialog.getByPlaceholder('API Key').fill('test-key-123');
    await dialog.getByPlaceholder('API Secret').fill('test-secret-456');
    await dialog.getByRole('button', { name: 'Save keys' }).click();

    // EditCredentialsForm's onDone callback closes the modal on success, so the parity assertion
    // is the dialog unmounting — not a cleared-but-mounted field.
    await expect(page.getByRole('alertdialog')).toHaveCount(0, { timeout: 5000 });
    await expect(page.getByPlaceholder('API Key')).toHaveCount(0);
  });
});
