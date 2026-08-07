import { test, expect } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';
import { BROKER_ACCOUNT_ALPACA } from '../fixtures';

/**
 * FR-20 order parity (feature 083, Step 26). The revamped Book → Orders table and the
 * Decide → Signal-detail order ticket are a *re-presentation* of the legacy order surfaces:
 * all five OrderType values still render/submit through the shared `orderShared` maps, and
 * both partial + full fill states render — execution semantics unchanged.
 *
 * Every order type (1-5) and both fill states (PARTIALLY_FILLED=2, FILLED=3) are supplied via
 * a page.route-intercepted ListOrders so the parity claim is asserted against distinguishable
 * fields, not the shared mock backend's 2-order default.
 */

// One order per OrderType, spanning partial + full fills. filledQty < qty on the partial.
const PARITY_ORDERS = [
  {
    orderId: 'op-market',
    symbol: 'AAPL',
    side: 1,
    orderType: 1,
    status: 3,
    qty: 10,
    filledQty: 10,
    filledAvgPrice: 175.5,
    limitPrice: 0,
    stopPrice: 0,
    timeInForce: 'day',
    accountId: 'alpaca-default',
    brokerType: 1,
  },
  {
    orderId: 'op-limit',
    symbol: 'MSFT',
    side: 1,
    orderType: 2,
    status: 2,
    qty: 20,
    filledQty: 5,
    filledAvgPrice: 299,
    limitPrice: 300,
    stopPrice: 0,
    timeInForce: 'day',
    accountId: 'alpaca-default',
    brokerType: 1,
  },
  {
    orderId: 'op-stop',
    symbol: 'TSLA',
    side: 2,
    orderType: 3,
    status: 1,
    qty: 3,
    filledQty: 0,
    filledAvgPrice: 0,
    limitPrice: 0,
    stopPrice: 240,
    timeInForce: 'day',
    accountId: 'alpaca-default',
    brokerType: 1,
  },
  {
    orderId: 'op-stoplimit',
    symbol: 'NVDA',
    side: 1,
    orderType: 4,
    status: 1,
    qty: 4,
    filledQty: 0,
    filledAvgPrice: 0,
    limitPrice: 900,
    stopPrice: 880,
    timeInForce: 'day',
    accountId: 'alpaca-default',
    brokerType: 1,
  },
  {
    orderId: 'op-trailing',
    symbol: 'AMD',
    side: 2,
    orderType: 5,
    status: 1,
    qty: 6,
    filledQty: 0,
    filledAvgPrice: 0,
    limitPrice: 0,
    stopPrice: 5,
    timeInForce: 'day',
    accountId: 'alpaca-default',
    brokerType: 1,
  },
];

test.describe('FR-20 order parity', () => {
  test.beforeEach(async ({ page }) => {
    await addAuthCookie(page);
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
    await page.route('**/xstockstrat.trading.v1.TradingService/ListOrders', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          orders: PARITY_ORDERS,
          page: { totalCount: PARITY_ORDERS.length, nextPageToken: '' },
        }),
      });
    });
    // Live stream fails fast so useOrderUpdates stops silently (mirrors orders.spec).
    await page.route(
      '**/xstockstrat.trading.v1.TradingService/StreamOrderUpdates',
      async (route) => {
        await route.fulfill({
          status: 400,
          contentType: 'application/connect+json',
          body: JSON.stringify({ code: 'unavailable', message: 'no stream in test' }),
        });
      },
    );
  });

  test('Orders table renders all 5 order types and both fill states', async ({ page }) => {
    await page.goto('/trader/orders');

    const table = page.getByRole('table');
    await expect(table).toBeVisible({ timeout: 10000 });
    // All five OrderType labels (shared TYPE_LABEL map) render.
    for (const label of ['Market', 'Limit', 'Stop', 'Stop Limit', 'Trailing Stop']) {
      await expect(table.getByText(label, { exact: true }).first()).toBeVisible();
    }
    // Both partial + full fill states (shared STATUS_VARIANT map) render.
    await expect(page.getByText('PARTIALLY_FILLED').first()).toBeVisible();
    await expect(page.getByText('FILLED', { exact: true }).first()).toBeVisible();
    // Partial fill shows filled < qty (5 of 20).
    const partialRow = page.getByTestId('order-row-op-limit');
    await expect(partialRow).toContainText('5');
    await expect(partialRow).toContainText('20');
  });

  test('Signal-detail order ticket offers all 5 order types (re-presentation)', async ({
    page,
  }) => {
    await page.goto('/insights/market/AAPL');

    await expect(page.getByText('Place Order').first()).toBeVisible({ timeout: 10000 });
    // Scope to the OrderForm <form> so the type Select isn't confused with the
    // SignalReadiness strategy picker (also a combobox) on the same page.
    const form = page.locator('form').filter({ has: page.getByPlaceholder('Symbol (e.g. AAPL)') });
    // The symbol field is pre-filled from the route param (FR-6) and locked: the chart,
    // conviction, and edge stats above the ticket are all keyed to this symbol, so the field
    // must not be editable away from it (previously a plain editable input — inconsistent with
    // the rest of the pinned Signal-detail page).
    const symbolField = form.getByPlaceholder('Symbol (e.g. AAPL)');
    await expect(symbolField).toHaveValue('AAPL');
    await expect(symbolField).toBeDisabled();
    // Same 5-type selector as the trader ticket — proves FR-20 map reuse.
    await form.getByRole('combobox').click();
    for (const label of ['Market', 'Limit', 'Stop', 'Stop Limit', 'Trailing Stop']) {
      await expect(page.getByRole('option', { name: label, exact: true })).toBeVisible();
    }
  });
});
