import { test, expect } from '@playwright/test';

/**
 * E2E tests for the OrderForm component.
 *
 * The API routes are mocked at the browser level with page.route() so these
 * tests exercise the component's rendering and state transitions without
 * relying on the backend mock server.
 */
test.describe('OrderForm', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('renders the Place Order card', async ({ page }) => {
    await expect(page.getByText('Place Order')).toBeVisible();
  });

  test('limit price field is hidden for market orders by default', async ({ page }) => {
    // Default order type is market — limit price should not be in the DOM
    await expect(page.getByPlaceholder('Limit price')).not.toBeVisible();
  });

  test('limit price field appears when order type is Limit', async ({ page }) => {
    // Open the Select dropdown and pick Limit
    await page.getByRole('combobox').click();
    await page.getByRole('option', { name: 'Limit' }).click();

    await expect(page.getByPlaceholder('Limit price')).toBeVisible();
  });

  test('limit price field appears when order type is Stop Limit', async ({ page }) => {
    await page.getByRole('combobox').click();
    await page.getByRole('option', { name: 'Stop Limit' }).click();

    await expect(page.getByPlaceholder('Limit price')).toBeVisible();
  });

  test('limit price field is hidden for Stop orders', async ({ page }) => {
    await page.getByRole('combobox').click();
    await page.getByRole('option', { name: 'Stop' }).click();

    await expect(page.getByPlaceholder('Limit price')).not.toBeVisible();
  });

  test('successful order submission shows order_id and status', async ({ page }) => {
    // Mock POST /api/orders to return a successful order
    await page.route('/api/orders', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            order_id: 'ord-test-123',
            status: 'ORDER_STATUS_FILLED',
            trading_mode: 1,
          }),
        });
      } else {
        await route.continue();
      }
    });

    await page.getByPlaceholder('Symbol (e.g. AAPL)').fill('aapl');
    await page.getByPlaceholder('Quantity').fill('5');
    await page.getByRole('button', { name: /place order|buy|sell/i }).last().click();

    // Success message includes order_id and status (with ORDER_STATUS_ prefix intact)
    await expect(page.getByText(/ord-test-123/)).toBeVisible();
    await expect(page.getByText(/ORDER_STATUS_FILLED/)).toBeVisible();
  });

  test('failed order submission shows error message', async ({ page }) => {
    await page.route('/api/orders', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Insufficient buying power' }),
        });
      } else {
        await route.continue();
      }
    });

    await page.getByPlaceholder('Symbol (e.g. AAPL)').fill('TSLA');
    await page.getByPlaceholder('Quantity').fill('1000');
    await page.getByRole('button', { name: /buy|sell/i }).last().click();

    await expect(page.getByText('Insufficient buying power')).toBeVisible();
  });

  test('BUY and SELL side buttons are present', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'BUY' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'SELL' })).toBeVisible();
  });

  test('PAPER or LIVE badge is shown in the form header', async ({ page }) => {
    // At least one of the mode badges should be visible
    const modeBadge = page.getByText(/^PAPER$|^LIVE$/);
    await expect(modeBadge.first()).toBeVisible();
  });
});
