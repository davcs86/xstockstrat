import { test, expect, type Page } from '@playwright/test';
import { SignJWT } from 'jose';

/**
 * E2E tests for the OrderForm component.
 *
 * The mock backend (port 9091) handles TradingService.PlaceOrder and returns
 * { orderId: 'mock-order-001', status: 3 } (ORDER_STATUS_FILLED). The AccountContext
 * auto-selects the first active account; ListBrokerAccounts is intercepted via
 * page.route to return a single account with the correct proto `id` field.
 */

const TEST_JWT_SECRET = 'test-jwt-secret-for-e2e-tests-min32c';
const BASE_URL = 'http://localhost:3000';

async function addAuthCookie(page: Page): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({
    user_id: 'test-user-001',
    email: 'test@example.com',
    roles: [],
    issued_at: now,
    expires_at: now + 3600,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(TEST_JWT_SECRET));

  await page.context().addCookies([
    { name: 'access_token', value: token, url: BASE_URL, httpOnly: true, sameSite: 'Lax' },
  ]);
}

test.describe('OrderForm', () => {
  test.beforeEach(async ({ page }) => {
    await addAuthCookie(page);
    // Provide a valid account so AccountContext auto-selects it and the submit button is enabled.
    await page.route('**/xstockstrat.trading.v1.TradingService/ListBrokerAccounts', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          accounts: [{ id: 'alpaca-default', displayName: 'Alpaca Paper', brokerType: 1, isPaper: true, isActive: true }],
        }),
      });
    });
    await page.goto('/trader');
  });

  test('renders the Place Order card', async ({ page }) => {
    await expect(page.getByText('Place Order')).toBeVisible();
  });

  test('limit price field is hidden for market orders by default', async ({ page }) => {
    await expect(page.getByPlaceholder('Limit price')).not.toBeVisible();
  });

  test('limit price field appears when order type is Limit', async ({ page }) => {
    // The order type combobox is inside the <form> — use that scope to avoid picking
    // ChartPanel's bar-count or symbol selectors which render after the form in the DOM.
    await page.locator('form').getByRole('combobox').click();
    await page.getByRole('option', { name: 'Limit', exact: true }).click();
    await expect(page.getByPlaceholder('Limit price')).toBeVisible();
  });

  test('limit price field appears when order type is Stop Limit', async ({ page }) => {
    await page.locator('form').getByRole('combobox').click();
    await page.getByRole('option', { name: 'Stop Limit', exact: true }).click();
    await expect(page.getByPlaceholder('Limit price')).toBeVisible();
  });

  test('limit price field is hidden for Stop orders', async ({ page }) => {
    await page.locator('form').getByRole('combobox').click();
    await page.getByRole('option', { name: 'Stop', exact: true }).click();
    await expect(page.getByPlaceholder('Limit price')).not.toBeVisible();
  });

  test('successful order submission shows orderId and status', async ({ page }) => {
    await page.getByPlaceholder('Symbol (e.g. AAPL)').fill('aapl');
    await page.getByPlaceholder('Quantity').fill('5');
    await page.getByRole('button', { name: /place order|buy|sell/i }).last().click();

    // Mock returns { orderId: 'mock-order-001', status: 3 }
    // Component shows: "Order placed: mock-order-001 (FILLED)" (OrderStatus[3] = 'FILLED')
    await expect(page.getByText(/mock-order-001/)).toBeVisible({ timeout: 10000 });
    // Order book also shows "FILLED" badge — match the success message paragraph specifically
    await expect(page.getByText(/Order placed:.*FILLED/)).toBeVisible();
  });

  test('failed order submission shows error message', async ({ page }) => {
    // Intercept PlaceOrder BFF path to return a Connect error
    await page.route('**/xstockstrat.trading.v1.TradingService/PlaceOrder', async (route) => {
      await route.fulfill({
        status: 400,
        contentType: 'application/connect+json',
        body: JSON.stringify({ code: 'invalid_argument', message: 'Insufficient buying power' }),
      });
    });

    await page.getByPlaceholder('Symbol (e.g. AAPL)').fill('TSLA');
    await page.getByPlaceholder('Quantity').fill('1000');
    await page.getByRole('button', { name: /buy|sell/i }).last().click();

    await expect(page.getByText('Insufficient buying power')).toBeVisible({ timeout: 10000 });
  });

  test('BUY and SELL side buttons are present', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'BUY', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'SELL', exact: true })).toBeVisible();
  });

  test('PAPER or LIVE badge is shown in the global header', async ({ page }) => {
    const modeBadge = page.getByText(/^PAPER$|^LIVE$/);
    await expect(modeBadge.first()).toBeVisible();
  });
});
