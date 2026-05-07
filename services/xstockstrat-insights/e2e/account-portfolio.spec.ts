import { test, expect } from '@playwright/test';

const MOCK_PORTFOLIO_DATA = {
  accounts: [
    { account_id: 'alpaca-default', display_name: 'Alpaca Paper', broker_type: 1, is_paper: true, is_active: true },
    { account_id: 'ibkr-001', display_name: 'IBKR Paper', broker_type: 2, is_paper: true, is_active: true },
  ],
  portfolios: [
    { portfolio_id: 'port-001', account_id: 'alpaca-default', equity: '50000.00', cash: '20000.00', day_pnl: '150.00', day_pnl_pct: '0.003', total_pnl: '1500.00', positions: [] },
    { portfolio_id: 'port-002', account_id: 'ibkr-001', equity: '30000.00', cash: '10000.00', day_pnl: '-50.00', day_pnl_pct: '-0.0017', total_pnl: '800.00', positions: [] },
  ],
};

test.describe('AccountPortfolioSelector (insights)', () => {
  test('portfolio selector is visible on the dashboard', async ({ page }) => {
    await page.route('/api/portfolio*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_PORTFOLIO_DATA),
      });
    });
    await page.goto('/');
    await expect(page.getByRole('combobox').first()).toBeVisible({ timeout: 5000 });
  });

  test('All Accounts option is available in selector', async ({ page }) => {
    await page.route('/api/portfolio*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_PORTFOLIO_DATA),
      });
    });
    await page.goto('/');
    await page.getByRole('combobox').first().click();
    await expect(page.getByRole('option', { name: 'All Accounts' })).toBeVisible({ timeout: 3000 });
  });

  test('selecting an account updates the URL with account_id param', async ({ page }) => {
    await page.route('/api/portfolio*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_PORTFOLIO_DATA),
      });
    });
    await page.goto('/');
    await page.getByRole('combobox').first().click();
    await page.getByRole('option', { name: 'Alpaca Paper' }).click();
    await expect(page).toHaveURL(/account_id=alpaca-default/, { timeout: 3000 });
  });

  test('deep link with account_id pre-selects the account', async ({ page }) => {
    await page.route('/api/portfolio*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_PORTFOLIO_DATA),
      });
    });
    await page.goto('/?account_id=ibkr-001');
    await expect(page.getByRole('heading', { name: 'IBKR Paper' })).toBeVisible({ timeout: 5000 });
  });
});
