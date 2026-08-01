import { test, expect } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';

/**
 * Book → Portfolio read-only broker mirror (feature 083, FR-14 / AC-8 — handoff-fidelity
 * rebuild). Combined 5-stat row (summed across accounts), one card per account (Alpaca + IBKR),
 * the broker-reported positions table, and the C-10(b) ledger disclaimer. Data: ListPortfolios
 * (both accounts) + ListPositions from the mock backend.
 */
test.describe('Portfolio — read-only broker mirror', () => {
  test.beforeEach(async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/trader/portfolio');
  });

  test('renders combined stats, per-account cards and the ledger disclaimer', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Portfolio' })).toBeVisible({ timeout: 10000 });

    // Combined 5-stat row (Alpaca 50k + IBKR 30k = 80k equity).
    await expect(page.getByText('Combined equity')).toBeVisible();
    await expect(page.getByText('$80,000.00')).toBeVisible();

    // One card per account (the names also appear in the header selector + positions table).
    await expect(page.getByText('Alpaca Paper').first()).toBeVisible();
    await expect(page.getByText('IBKR Paper').first()).toBeVisible();

    // AC-8 — the read-only / never-writes disclaimer.
    const disclaimer = page.getByTestId('ledger-disclaimer');
    await expect(disclaimer).toBeVisible();
    await expect(disclaimer).toContainText('never writes to the ledger');
  });

  test('renders the broker-reported positions table', async ({ page }) => {
    await expect(page.getByText('Positions · reported by broker')).toBeVisible({ timeout: 10000 });
    const aapl = page.getByRole('row', { name: /AAPL/ });
    await expect(aapl).toBeVisible();
    await expect(aapl).toContainText('+$100.00'); // unrealized (broker-authoritative)
  });
});
