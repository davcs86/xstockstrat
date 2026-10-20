import { test, expect, type Page } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';
import {
  BROKER_ACCOUNT_ALPACA,
  BROKER_ACCOUNT_OFFLINE,
  PORTFOLIO_ALPACA_AC30,
  PORTFOLIO_OFFLINE_FULL_PNL,
  POSITION_OFFLINE_AAPL,
  POSITION_OFFLINE_TSLA_SHORT,
  POSITION_OFFLINE_XYZ,
  POSITION_OFFLINE_ZZZZ,
} from '../fixtures';

/**
 * E2E for the feature-230 offline P&L surfaces (AC-14/15/16/20/30/31/32). Each test injects its own
 * responses with page.route() on the BFF Connect paths, so the shared mock-backend defaults stay
 * untouched. Domain objects come from e2e/fixtures/ (C-12); auth from e2e/helpers/auth.ts.
 */

const LIST_ACCOUNTS = '**/xstockstrat.trading.v1.TradingService/ListBrokerAccounts';
const LIST_PORTFOLIOS = '**/xstockstrat.portfolio.v1.PortfolioService/ListPortfolios';
const LIST_POSITIONS = '**/xstockstrat.portfolio.v1.PortfolioService/ListPositions';
const GET_POSITION = '**/xstockstrat.portfolio.v1.PortfolioService/GetPosition';

async function routeJson(page: Page, path: string, body: unknown) {
  await page.route(path, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
}

async function openOfflinePanel(page: Page) {
  await routeJson(page, LIST_ACCOUNTS, {
    accounts: [BROKER_ACCOUNT_ALPACA, BROKER_ACCOUNT_OFFLINE],
  });
  await routeJson(page, LIST_PORTFOLIOS, { portfolios: [PORTFOLIO_OFFLINE_FULL_PNL] });
  await addAuthCookie(page);
  await page.goto('/trader');
  await page.getByRole('combobox').first().click();
  await page.getByRole('option', { name: /Offline Book/ }).click();
  return page.locator('[data-slot="card"]', { hasText: 'Offline Book' });
}

/** An Exposure table row (rows are clickable, so their role is button, not row). */
function positionRow(page: Page, symbol: string) {
  return page.locator('tbody tr', { has: page.getByRole('link', { name: symbol, exact: true }) });
}

/** The value cell beside a Stat label, as one normalized string. */
async function statValue(card: ReturnType<Page['locator']>, label: string) {
  const row = card.locator('div', { has: card.page().getByText(label, { exact: true }) }).last();
  return (await row.innerText()).replace(/\s+/g, ' ');
}

test.describe('Offline account full P&L (feature 230)', () => {
  test('@AC-14 the trader card shows Day, Total, realized gross/net and both fee scopes', async ({
    page,
  }) => {
    const card = await openOfflinePanel(page);
    await expect(card.getByText('Day P&L', { exact: true })).toBeVisible({ timeout: 8000 });
    expect(await statValue(card, 'Day P&L')).toContain('+$300.00');
    expect(await statValue(card, 'Total P&L')).toContain('+$1,300.00 (+12.38%)');
    expect(await statValue(card, 'Realized (since snapshot)')).toContain('+$600.00 (net +$597.00)');
    expect(await statValue(card, 'Realized (lifetime)')).toContain('+$900.00 (net +$895.50)');
    expect(await statValue(card, 'Fees (since snapshot)')).toContain('$3.00');
    expect(await statValue(card, 'Fees (lifetime)')).toContain('$4.50');
    await expect(card.getByText('Cash')).toHaveCount(0);
    await expect(card.getByText('Buying Power')).toHaveCount(0);
  });

  test('@AC-20 realized since snapshot is shown gross with its net of fees', async ({ page }) => {
    const card = await openOfflinePanel(page);
    await expect(card.getByText('Realized (since snapshot)')).toBeVisible({ timeout: 8000 });
    expect(await statValue(card, 'Realized (since snapshot)')).toContain('+$600.00 (net +$597.00)');
  });

  test('@AC-15 the Book offline card shows Day and Total P&L beside Equity and positions', async ({
    page,
  }) => {
    await routeJson(page, LIST_ACCOUNTS, {
      accounts: [BROKER_ACCOUNT_ALPACA, BROKER_ACCOUNT_OFFLINE],
    });
    await routeJson(page, LIST_PORTFOLIOS, {
      portfolios: [PORTFOLIO_ALPACA_AC30, PORTFOLIO_OFFLINE_FULL_PNL],
    });
    await addAuthCookie(page);
    await page.goto('/trader/portfolio');

    const card = page.locator('[data-slot="card"]', { hasText: 'Offline Book' });
    await expect(card).toBeVisible({ timeout: 8000 });
    await expect(card.getByText('Equity')).toBeVisible();
    await expect(card.getByText('+$300.00')).toBeVisible();
    await expect(card.getByText('+$1,300.00 (+12.38%)')).toBeVisible();
    await expect(card.getByText('1 open')).toBeVisible();
  });

  test('@AC-30 the combined panel sums every account and labels the offline-only rows', async ({
    page,
  }) => {
    // The combined panel renders only when no account is auto-selected (none active).
    await routeJson(page, LIST_ACCOUNTS, {
      accounts: [
        { ...BROKER_ACCOUNT_ALPACA, isActive: false },
        { ...BROKER_ACCOUNT_OFFLINE, isActive: false },
      ],
    });
    await routeJson(page, LIST_PORTFOLIOS, {
      portfolios: [PORTFOLIO_OFFLINE_FULL_PNL, PORTFOLIO_ALPACA_AC30],
    });
    await addAuthCookie(page);
    await page.goto('/trader');

    const summary = page.locator('[data-slot="card"]', { hasText: 'All accounts' });
    await expect(summary).toBeVisible({ timeout: 8000 });
    expect(await statValue(summary, 'Day P&L')).toContain('+$420.00');
    expect(await statValue(summary, 'Total P&L')).toContain('+$1,800.00');
    expect(await statValue(summary, 'Realized (since snapshot)')).toContain('+$600.00');
    expect(await statValue(summary, 'Realized (lifetime)')).toContain('+$900.00');
    await expect(summary.getByText('Offline accounts only')).toBeVisible();
  });

  test.describe('positions list', () => {
    test.beforeEach(async ({ page }) => {
      await routeJson(page, LIST_ACCOUNTS, { accounts: [BROKER_ACCOUNT_OFFLINE] });
      await routeJson(page, LIST_POSITIONS, {
        positions: [POSITION_OFFLINE_AAPL, POSITION_OFFLINE_XYZ, POSITION_OFFLINE_ZZZZ],
      });
      await addAuthCookie(page);
      await page.goto('/trader/positions');
    });

    test("@AC-16 shows Today's P/L and a last-close stale-price badge", async ({ page }) => {
      const aapl = positionRow(page, 'AAPL');
      await expect(aapl).toBeVisible({ timeout: 8000 });
      await expect(aapl.getByText('+$300.00')).toBeVisible();
      await expect(positionRow(page, 'XYZ').getByText('Last close 2026-10-16')).toBeVisible();
    });

    test('@AC-32 an unpriced position shows its qty and "No price", with no value or P&L', async ({
      page,
    }) => {
      const zzzz = positionRow(page, 'ZZZZ');
      await expect(zzzz).toBeVisible({ timeout: 8000 });
      await expect(zzzz.getByText('No price')).toBeVisible();
      await expect(zzzz.getByRole('cell', { name: '5', exact: true })).toBeVisible();
      // No fabricated $0 value: price, market value, Today's P/L and Total P/L cells are dashes.
      await expect(zzzz.getByText('$0.00')).toHaveCount(0);
      expect(
        await zzzz.getByRole('cell', { name: '—', exact: true }).count(),
      ).toBeGreaterThanOrEqual(5);
    });
  });

  test('@AC-31 the position page shows Day P&L, the signed short % and mark provenance', async ({
    page,
  }) => {
    await routeJson(page, LIST_ACCOUNTS, { accounts: [BROKER_ACCOUNT_OFFLINE] });
    await routeJson(page, GET_POSITION, POSITION_OFFLINE_TSLA_SHORT);
    await addAuthCookie(page);
    await page.goto('/trader/positions/TSLA');

    await expect(page.getByText('Last close 2026-10-16').first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('+$50.00').first()).toBeVisible();
    await expect(page.getByText('+$200.00').first()).toBeVisible();
    await expect(page.getByText('+10.00%').first()).toBeVisible();
  });
});
