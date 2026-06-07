import { test, expect } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';

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
    await page.route('**/xstockstrat.trading.v1.TradingService/ListBrokerAccounts', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ accounts: [] }),
      });
    });
    await addAuthCookie(page);
    await page.goto('/trader');
    const submitBtn = page.getByRole('button', { name: /buy|sell/i }).last();
    await expect(submitBtn).toBeDisabled({ timeout: 5000 });
  });

  test('Place Order button is enabled when an account is selected', async ({ page }) => {
    await page.route('**/xstockstrat.trading.v1.TradingService/ListBrokerAccounts', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          accounts: [{ id: 'alpaca-default', displayName: 'Alpaca Paper', brokerType: 1, isPaper: true, isActive: true }],
        }),
      });
    });
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
    await page.route('**/xstockstrat.trading.v1.TradingService/ListBrokerAccounts', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          accounts: [{ id: 'alpaca-default', displayName: 'Alpaca Paper', brokerType: 1, isPaper: true, isActive: true }],
        }),
      });
    });
    await page.route('**/xstockstrat.trading.v1.TradingService/RegisterBrokerAccount', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          account: { id: 'new-account-001', displayName: 'New', brokerType: 1, isPaper: true, isActive: true },
        }),
      });
    });
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
});
