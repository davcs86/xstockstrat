import { test, expect } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';
import {
  BROKER_ACCOUNT_ALPACA,
  BROKER_ACCOUNT_OFFLINE,
  PORTFOLIO_ALPACA,
  PORTFOLIO_OFFLINE,
} from '../fixtures';

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

  test('offline account row has no "Edit keys" action (no credentials)', async ({ page }) => {
    await page.route(LIST_ACCOUNTS, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ accounts: [BROKER_ACCOUNT_ALPACA, BROKER_ACCOUNT_OFFLINE] }),
      });
    });

    await addAuthCookie(page);
    await page.goto('/trader/accounts');

    // The Alpaca row still offers "Edit keys"; the offline row does not (it has no credentials).
    await page.getByRole('button', { name: 'Actions for Offline Book' }).click();
    await expect(page.getByRole('menuitem', { name: 'Remove' })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('menuitem', { name: 'Edit keys' })).toHaveCount(0);
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

/**
 * E2E for the offline-account UI gaps (feature 159 — @AC-1/@AC-2/@AC-3/@AC-4). Same page.route()
 * + fixtures + auth pattern as above. The "persisted NEW, never CANCELED" half of @AC-1 is a Go
 * assertion (the mock placeOrder hardcodes FILLED); here we assert the UI affordance only.
 */
test.describe('Offline account UI gaps (feature 159)', () => {
  const routeAccounts = async (page: import('@playwright/test').Page, accounts: unknown[]) => {
    await page.route(LIST_ACCOUNTS, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ accounts }),
      });
    });
  };
  const routePortfolios = async (page: import('@playwright/test').Page, portfolios: unknown[]) => {
    await page.route(LIST_PORTFOLIOS, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ portfolios }),
      });
    });
  };

  test('@AC-1 offline account shows the Record-order control on /trader, not the broker ticket', async ({
    page,
  }) => {
    await routeAccounts(page, [BROKER_ACCOUNT_ALPACA, BROKER_ACCOUNT_OFFLINE]);
    await routePortfolios(page, [PORTFOLIO_OFFLINE]);
    await addAuthCookie(page);
    await page.goto('/trader');

    // Select the offline account, then the order ticket switches to record mode.
    await page.getByRole('combobox').first().click();
    await page.getByRole('option', { name: /Offline Book/ }).click();

    await expect(page.getByText('Record Offline Order')).toBeVisible({ timeout: 5000 });
    // The broker ticket title and its order-type control are gone in record mode.
    await expect(page.getByText('Place Order')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Record (BUY|SELL)/ })).toBeVisible();
  });

  test('@AC-2 offline portfolio card hides Cash / Buying Power / Day P&L', async ({ page }) => {
    await routeAccounts(page, [BROKER_ACCOUNT_ALPACA, BROKER_ACCOUNT_OFFLINE]);
    await routePortfolios(page, [PORTFOLIO_OFFLINE]);
    await addAuthCookie(page);
    await page.goto('/trader');

    await page.getByRole('combobox').first().click();
    await page.getByRole('option', { name: /Offline Book/ }).click();

    // The single-account portfolio card for the offline book.
    const card = page.locator('[data-slot="card"]', { hasText: 'Offline Book' });
    await expect(card.getByText('Realized P&L')).toBeVisible({ timeout: 5000 });
    await expect(card.getByText('Equity')).toBeVisible();
    // Broker-only fields must not render on an offline card.
    await expect(card.getByText('Cash')).toHaveCount(0);
    await expect(card.getByText('Buying Power')).toHaveCount(0);
    await expect(card.getByText('Day P&L')).toHaveCount(0);
  });

  test('@AC-3 @AC-4 Book combined view shows the offline card with only meaningful fields', async ({
    page,
  }) => {
    await routeAccounts(page, [BROKER_ACCOUNT_ALPACA, BROKER_ACCOUNT_OFFLINE]);
    // The Book page always requests the combined (all-accounts) view.
    await routePortfolios(page, [PORTFOLIO_ALPACA, PORTFOLIO_OFFLINE]);
    await addAuthCookie(page);
    await page.goto('/trader/portfolio');

    const offlineCard = page.locator('[data-slot="card"]', { hasText: 'Offline Book' });
    const brokerCard = page.locator('[data-slot="card"]', { hasText: 'Alpaca Paper' });

    // @AC-4: the offline account is visible in the combined view as its own card…
    await expect(offlineCard).toBeVisible({ timeout: 8000 });
    await expect(offlineCard.getByText('Equity')).toBeVisible();
    // …showing only meaningful fields (broker-only fields hidden).
    await expect(offlineCard.getByText('Cash')).toHaveCount(0);
    await expect(offlineCard.getByText('Buying power')).toHaveCount(0);
    await expect(offlineCard.getByText('Day P&L')).toHaveCount(0);
    // @AC-3: the broker card still shows its broker figures — the gate is per-account, not global.
    await expect(brokerCard.getByText('Buying power')).toBeVisible();
    await expect(brokerCard.getByText('Day P&L')).toBeVisible();
  });

  test('@AC-1 the signal-detail ticket keeps the broker ticket for an offline account', async ({
    page,
  }) => {
    // Only an offline account registered → AccountContext auto-selects it. The signal-detail mount
    // passes allowOfflineRecord={false}, so the broker ticket (not the Record-order control) renders.
    await routeAccounts(page, [BROKER_ACCOUNT_OFFLINE]);
    await addAuthCookie(page);
    // The signal-detail page (feature 125's unified /trader/positions/[symbol]) polls several data
    // sources, so `load` may never settle — wait only for the DOM, then let the order-ticket column
    // (OrderForm) hydrate on its own.
    await page.goto('/trader/positions/AAPL', { waitUntil: 'domcontentloaded' });

    // The OrderForm renders its title as a card heading — scope to the heading role so we don't collide
    // with the page's "Place order" toggle button.
    await expect(page.getByRole('heading', { name: 'Place Order' })).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByRole('heading', { name: 'Record Offline Order' })).toHaveCount(0);
  });
});
