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
    await expect(page.getByRole('heading', { name: 'Add Account' })).toBeVisible({ timeout: 5000 });
  });

  test('Add Account form clears credential fields on success', async ({ page }) => {
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
    // Navigate directly to the accounts submodule page.
    await page.goto('/trader/accounts');
    await page.getByPlaceholder('Display name').fill('Test Account');
    await page.getByPlaceholder('API Key').fill('test-key-123');
    await page.getByPlaceholder('API Secret').fill('test-secret-456');
    await page.getByRole('button', { name: /add account/i }).click();
    // Credential fields should be cleared after successful registration
    await expect(page.getByPlaceholder('API Key')).toHaveValue('', { timeout: 5000 });
  });

  test('Edit keys expands and collapses the credential form (feature 121, FR-3)', async ({
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

    // Scope to this account's row (data-testid, feature 121 FR-3) — the page also renders a
    // standalone "Add Account" form with its own "API Key" field, so an unscoped
    // getByPlaceholder('API Key') would be ambiguous once the row's own credential form expands.
    const row = page.getByTestId(`account-row-${BROKER_ACCOUNT_ALPACA.id}`);
    const editKeysBtn = row.getByRole('button', { name: 'Edit keys' });
    await expect(editKeysBtn).toBeVisible({ timeout: 5000 });
    await expect(row.getByPlaceholder('API Key')).not.toBeVisible();

    await editKeysBtn.click();
    await expect(row.getByPlaceholder('API Key')).toBeVisible();

    await editKeysBtn.click();
    await expect(row.getByPlaceholder('API Key')).not.toBeVisible();
  });

  test('Edit Credentials form closes on successful save (feature 122, FR-3 characterization)', async ({
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

    // Scope to this account's row (data-testid, feature 121 FR-3) — the page also renders a
    // standalone "Add Account" form with its own identical "API Key"/"API Secret" placeholders,
    // so an unscoped getByPlaceholder would be ambiguous once the row's own credential form
    // expands.
    const row = page.getByTestId(`account-row-${BROKER_ACCOUNT_ALPACA.id}`);
    await row.getByRole('button', { name: 'Edit keys' }).click();
    await row.getByPlaceholder('API Key').fill('test-key-123');
    await row.getByPlaceholder('API Secret').fill('test-secret-456');
    await row.getByRole('button', { name: 'Save keys' }).click();

    // EditCredentialsForm's onDone callback unmounts the form (AccountRow's `editing` state
    // collapses) rather than resetting-in-place like AddAccountForm — so the parity assertion is
    // the row collapsing back to its default "Edit keys" state, not a cleared-but-mounted field.
    await expect(row.getByRole('button', { name: 'Edit keys' })).toBeVisible({ timeout: 5000 });
    await expect(row.getByPlaceholder('API Key')).not.toBeVisible();
  });
});
