import { test, expect } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';

/**
 * E2E tests for the /trader/orders management page (feature 055).
 *
 * All trading RPCs are intercepted via page.route on the BFF Connect paths so the test
 * is paper-safe and never reaches a live broker. ListOrders returns four orders spanning
 * the editable (NEW / PARTIALLY_FILLED) and terminal (FILLED) states plus PENDING_APPROVAL.
 * StreamOrderUpdates is failed fast so the live-feed hook stops silently (it wraps the
 * stream in try/catch, matching AlertStream).
 */

const ORDERS = [
  { orderId: 'ord-new', symbol: 'AAPL', side: 1, orderType: 2, status: 1, qty: 10, filledQty: 0, limitPrice: 150, stopPrice: 0, filledAvgPrice: 0, timeInForce: 'day', accountId: 'alpaca-default', brokerType: 1 },
  { orderId: 'ord-partial', symbol: 'MSFT', side: 1, orderType: 2, status: 2, qty: 20, filledQty: 5, limitPrice: 300, stopPrice: 0, filledAvgPrice: 299, timeInForce: 'day', accountId: 'alpaca-default', brokerType: 1 },
  { orderId: 'ord-filled', symbol: 'TSLA', side: 2, orderType: 1, status: 3, qty: 3, filledQty: 3, limitPrice: 0, stopPrice: 0, filledAvgPrice: 250, timeInForce: 'day', accountId: 'alpaca-default', brokerType: 1 },
  { orderId: 'ord-pending', symbol: 'NVDA', side: 1, orderType: 1, status: 7, qty: 1000, filledQty: 0, limitPrice: 0, stopPrice: 0, filledAvgPrice: 0, timeInForce: 'day', accountId: 'alpaca-default', brokerType: 1 },
];

test.describe('Orders management page', () => {
  let listOrdersCount = 0;
  let cancelRequested = false;

  test.beforeEach(async ({ page }) => {
    listOrdersCount = 0;
    cancelRequested = false;

    await addAuthCookie(page);

    await page.route('**/xstockstrat.trading.v1.TradingService/ListBrokerAccounts', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          accounts: [{ id: 'alpaca-default', displayName: 'Alpaca Paper', brokerType: 1, isPaper: true, isActive: true }],
        }),
      });
    });

    await page.route('**/xstockstrat.trading.v1.TradingService/ListOrders', async (route) => {
      listOrdersCount += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ orders: ORDERS, page: { totalCount: ORDERS.length, nextPageToken: '' } }),
      });
    });

    await page.route('**/xstockstrat.trading.v1.TradingService/CancelOrder', async (route) => {
      cancelRequested = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, order: { ...ORDERS[0], status: 4 } }),
      });
    });

    await page.route('**/xstockstrat.trading.v1.TradingService/ReplaceOrder', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...ORDERS[0], qty: 99 }),
      });
    });

    // Fail the live stream fast so useOrderUpdates stops silently.
    await page.route('**/xstockstrat.trading.v1.TradingService/StreamOrderUpdates', async (route) => {
      await route.fulfill({
        status: 400,
        contentType: 'application/connect+json',
        body: JSON.stringify({ code: 'unavailable', message: 'no stream in test' }),
      });
    });

    await page.goto('/trader/orders');
  });

  test('renders the mocked orders list', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'AAPL' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('link', { name: 'MSFT' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'TSLA' })).toBeVisible();
    expect(listOrdersCount).toBeGreaterThan(0);
  });

  test('create form offers all 5 order types with correct price fields', async ({ page }) => {
    const form = page.locator('form');
    await form.getByRole('combobox').click();
    await expect(page.getByRole('option', { name: 'Market', exact: true })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Limit', exact: true })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Stop', exact: true })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Stop Limit', exact: true })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Trailing Stop', exact: true })).toBeVisible();

    // Stop Limit → both limit and stop price inputs appear.
    await page.getByRole('option', { name: 'Stop Limit', exact: true }).click();
    await expect(page.getByPlaceholder('Limit price')).toBeVisible();
    await expect(page.getByPlaceholder('Stop price')).toBeVisible();

    // Trailing Stop → a trail amount input appears.
    await form.getByRole('combobox').click();
    await page.getByRole('option', { name: 'Trailing Stop', exact: true }).click();
    await expect(page.getByPlaceholder('Trail amount')).toBeVisible();
  });

  test('Edit is enabled for NEW/PARTIALLY_FILLED and disabled for FILLED', async ({ page }) => {
    await expect(page.getByTestId('edit-ord-new')).toBeEnabled({ timeout: 10000 });
    await expect(page.getByTestId('edit-ord-partial')).toBeEnabled();
    await expect(page.getByTestId('edit-ord-filled')).toBeDisabled();
    await expect(page.getByTestId('cancel-ord-filled')).toBeDisabled();
  });

  test('Cancel requires a confirmation step then issues CancelOrder', async ({ page }) => {
    const cancelBtn = page.getByTestId('cancel-ord-new');
    await expect(cancelBtn).toHaveText('Cancel', { timeout: 10000 });
    await cancelBtn.click();
    await expect(cancelBtn).toHaveText('Confirm');
    await cancelBtn.click();
    await expect.poll(() => cancelRequested).toBe(true);
  });

  test('PENDING_APPROVAL is surfaced in the list', async ({ page }) => {
    await expect(page.getByText('PENDING_APPROVAL')).toBeVisible({ timeout: 10000 });
  });

  test('changing a filter re-issues a server-side ListOrders request', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'AAPL' })).toBeVisible({ timeout: 10000 });
    const before = listOrdersCount;
    // Select a status filter — the first filter combobox in the filters panel.
    await page.getByLabel('Filter by status').click();
    await page.getByRole('option', { name: 'Filled', exact: true }).click();
    await expect.poll(() => listOrdersCount).toBeGreaterThan(before);
  });
});
