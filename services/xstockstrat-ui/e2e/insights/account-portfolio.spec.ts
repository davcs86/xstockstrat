import { test, expect, type Page } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';
import { BROKER_ACCOUNTS, PORTFOLIOS } from '../fixtures';

async function mockAccountsAndPortfolios(page: Page): Promise<void> {
  await page.route('**/xstockstrat.trading.v1.TradingService/ListBrokerAccounts', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ accounts: BROKER_ACCOUNTS }),
    });
  });
  await page.route('**/xstockstrat.portfolio.v1.PortfolioService/ListPortfolios', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ portfolios: PORTFOLIOS }),
    });
  });
}

test.describe('AccountPortfolioSelector (insights)', () => {
  test('portfolio selector is visible on the dashboard', async ({ page }) => {
    await addAuthCookie(page);
    await mockAccountsAndPortfolios(page);
    await page.goto('/insights');
    await expect(page.getByRole('combobox').first()).toBeVisible({ timeout: 5000 });
  });

  test('All Accounts option is available in selector', async ({ page }) => {
    await addAuthCookie(page);
    await mockAccountsAndPortfolios(page);
    await page.goto('/insights');
    await page.getByRole('combobox').first().click();
    await expect(page.getByRole('option', { name: 'All Accounts' })).toBeVisible({ timeout: 3000 });
  });

  test('selecting an account updates the URL with account_id param', async ({ page }) => {
    await addAuthCookie(page);
    await mockAccountsAndPortfolios(page);
    await page.goto('/insights');
    await page.getByRole('combobox').first().click();
    await page.getByRole('option', { name: 'Alpaca Paper' }).click();
    await expect(page).toHaveURL(/account_id=alpaca-default/, { timeout: 3000 });
  });

  test('deep link with account_id pre-selects the account', async ({ page }) => {
    await addAuthCookie(page);
    await mockAccountsAndPortfolios(page);
    await page.goto('/insights?account_id=ibkr-001');
    await expect(page.getByRole('heading', { name: 'IBKR Paper' })).toBeVisible({ timeout: 5000 });
  });
});
