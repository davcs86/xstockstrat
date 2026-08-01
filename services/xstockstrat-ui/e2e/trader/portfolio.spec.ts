import { test, expect } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';

/**
 * Book → Portfolio read-only broker mirror (feature 083, Step 25, FR-14 / AC-8).
 * The page reuses PortfolioPanel (usePortfolios → ListPortfolios from the mock backend)
 * and carries the C-10(b) ledger disclaimer asserting xstockstrat never writes to the
 * broker's ledger — the broker is the source of truth for positions and P&L.
 */
test.describe('Portfolio — read-only broker mirror', () => {
  test('renders the broker portfolio and the ledger disclaimer', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/trader/portfolio');

    await expect(page.getByRole('heading', { name: 'Portfolio' })).toBeVisible({ timeout: 10000 });
    // PortfolioPanel surfaces the broker-authoritative equity figure.
    await expect(page.getByText('Equity').first()).toBeVisible();
    // AC-8 — the read-only / never-writes disclaimer must be present.
    const disclaimer = page.getByTestId('ledger-disclaimer');
    await expect(disclaimer).toBeVisible();
    await expect(disclaimer).toContainText('never writes to the ledger');
  });
});
