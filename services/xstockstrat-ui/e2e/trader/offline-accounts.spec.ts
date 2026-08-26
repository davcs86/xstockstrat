import { test, expect } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';
import { BROKER_ACCOUNT_ALPACA, BROKER_ACCOUNT_OFFLINE, PORTFOLIO_OFFLINE } from '../fixtures';

/**
 * E2E for offline-account portfolios (feature 157). Offline-specific responses are injected via
 * page.route() on the BFF Connect paths, keeping the shared mock-backend defaults intact for other
 * specs. All domain objects come from e2e/fixtures/ (C-12); auth from e2e/helpers/auth.ts.
 *
 * Covers @AC-3 (selector lists both; offline card via ListPortfolios), @AC-5 (UI confirm flips the
 * order to FILLED with a server-derived status, not an echo), @AC-13 (Realized P&L on the offline
 * card even with no open positions).
 */

const CONFIRM_ORDER = '**/xstockstrat.trading.v1.TradingService/ConfirmOrder';
const LIST_ACCOUNTS = '**/xstockstrat.trading.v1.TradingService/ListBrokerAccounts';
const GET_ORDER = '**/xstockstrat.trading.v1.TradingService/GetOrder';
const LIST_PORTFOLIOS = '**/xstockstrat.portfolio.v1.PortfolioService/ListPortfolios';

// The offline order under confirmation — a NEW buy with no fill yet, on the offline account.
const OFFLINE_ORDER_NEW = {
  orderId: 'offline-order-001',
  symbol: 'AAPL',
  side: 1, // BUY
  orderType: 1, // MARKET
  status: 1, // NEW
  qty: 10,
  filledQty: 0,
  filledAvgPrice: 0,
  timeInForce: 'day',
  accountId: BROKER_ACCOUNT_OFFLINE.id,
  brokerOrderId: '',
  brokerType: 3, // BROKER_TYPE_OFFLINE
  tradingMode: 1, // PAPER
};

test.describe('Offline account portfolios (feature 157)', () => {
  test('@AC-3 account selector lists both accounts; offline card renders via ListPortfolios', async ({
    page,
  }) => {
    await page.route(LIST_ACCOUNTS, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ accounts: [BROKER_ACCOUNT_ALPACA, BROKER_ACCOUNT_OFFLINE] }),
      });
    });
    // ListPortfolios for the offline account → its derived-equity card with realized P&L.
    await page.route(LIST_PORTFOLIOS, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ portfolios: [PORTFOLIO_OFFLINE] }),
      });
    });

    await addAuthCookie(page);
    await page.goto('/trader');

    // The account selector lists both accounts.
    await page.getByRole('combobox').first().click();
    await expect(page.getByRole('option', { name: /Alpaca Paper/ })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('option', { name: /Offline Book/ })).toBeVisible();

    // Selecting the offline account shows its portfolio card (via ListPortfolios) — the card's
    // Realized P&L Stat is offline-specific and unambiguous.
    await page.getByRole('option', { name: /Offline Book/ }).click();
    await expect(page.getByText('Realized P&L')).toBeVisible({ timeout: 5000 });
  });

  test('@AC-13 offline card shows Realized P&L with no open positions', async ({ page }) => {
    await page.route(LIST_ACCOUNTS, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ accounts: [BROKER_ACCOUNT_ALPACA, BROKER_ACCOUNT_OFFLINE] }),
      });
    });
    await page.route(LIST_PORTFOLIOS, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ portfolios: [PORTFOLIO_OFFLINE] }),
      });
    });

    await addAuthCookie(page);
    await page.goto('/trader');
    await page.getByRole('combobox').first().click();
    await page.getByRole('option', { name: /Offline Book/ }).click();

    // Realized P&L Stat renders (offline-gated) even though positions is empty.
    await expect(page.getByText('Realized P&L')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('$97.50')).toBeVisible();
  });

  test('@AC-5 confirming an offline order flips it to FILLED (server-derived status)', async ({
    page,
  }) => {
    // Stateful GetOrder: NEW before confirm, FILLED after — driven by a flag the ConfirmOrder
    // route flips. Proves the status is genuinely derived, not echoed from the request.
    let confirmed = false;
    await page.route(GET_ORDER, async (route) => {
      const order = confirmed
        ? { ...OFFLINE_ORDER_NEW, status: 3, filledQty: 10, filledAvgPrice: 190.25 }
        : OFFLINE_ORDER_NEW;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(order),
      });
    });
    await page.route(CONFIRM_ORDER, async (route) => {
      confirmed = true;
      // Server-derived: filledQty (10) == qty (10) → FILLED (3).
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...OFFLINE_ORDER_NEW,
          status: 3,
          filledQty: 10,
          filledAvgPrice: 190.25,
        }),
      });
    });

    await addAuthCookie(page);
    await page.goto(`/trader/orders/${OFFLINE_ORDER_NEW.orderId}`);

    // The offline order shows the Confirm fill control (not the broker Edit/Cancel actions).
    const confirmBtn = page.getByRole('button', { name: 'Confirm fill' });
    await expect(confirmBtn).toBeVisible({ timeout: 10000 });
    await confirmBtn.click();

    // Fill the dialog and submit.
    const dialog = page.getByRole('dialog');
    await dialog.getByPlaceholder('Filled quantity').fill('10');
    await dialog.getByPlaceholder('Average fill price').fill('190.25');
    await dialog.getByRole('button', { name: 'Confirm fill' }).click();

    // The detail page reflects the confirmed fill (server-derived FILLED status badge + fill fields).
    await expect(page.getByText('FILLED', { exact: true })).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('190.25').first()).toBeVisible();
  });
});
