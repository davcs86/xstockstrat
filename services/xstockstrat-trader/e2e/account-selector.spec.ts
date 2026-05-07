import { test, expect } from '@playwright/test';

test.describe('AccountSelector', () => {
  test('Account Selector is visible in the header', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('combobox').first()).toBeVisible({ timeout: 5000 });
  });

  test('Place Order button is disabled when no account is selected', async ({ page }) => {
    await page.route('/api/accounts', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ accounts: [] }),
      });
    });
    await page.goto('/');
    const submitBtn = page.getByRole('button', { name: /buy|sell/i }).last();
    await expect(submitBtn).toBeDisabled({ timeout: 5000 });
  });

  test('Place Order button is enabled when an account is selected', async ({ page }) => {
    await page.route('/api/accounts', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          accounts: [{
            account_id: 'alpaca-default',
            display_name: 'Alpaca Paper',
            broker_type: 1,
            is_paper: true,
            is_active: true,
          }],
        }),
      });
    });
    await page.goto('/');
    const submitBtn = page.getByRole('button', { name: /buy|sell/i }).last();
    await expect(submitBtn).toBeEnabled({ timeout: 5000 });
  });

  test('Account Management Panel opens via gear icon', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /manage accounts/i }).click();
    await expect(page.getByText('Add Account')).toBeVisible({ timeout: 3000 });
  });

  test('Add Account form clears credential fields on success', async ({ page }) => {
    await page.route('/api/accounts', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            account: { account_id: 'new-001', display_name: 'New', broker_type: 1, is_paper: true, is_active: true },
          }),
        });
      } else {
        await route.continue();
      }
    });
    await page.goto('/');
    await page.getByRole('button', { name: /manage accounts/i }).click();
    const apiKeyInput = page.locator('input[type="password"]').first();
    await apiKeyInput.fill('test-key-123');
    await page.getByRole('button', { name: /add account/i }).click();
    await expect(apiKeyInput).toHaveValue('', { timeout: 3000 });
  });
});
