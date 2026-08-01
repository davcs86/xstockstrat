import { test, expect } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';

/**
 * AC-8 valuation parity (feature 083, Step 26). A symbol's valuation must resolve to the
 * same broker-authoritative source everywhere it appears — the UI never re-derives P&L.
 * Here AAPL's unrealized P&L is asserted identical on Book → Portfolio (PortfolioPanel,
 * ListPortfolios) and Book → Exposure (positions table, ListPositions). The mock backend is
 * seeded so both RPCs report AAPL at +$100.00 (producer agreement isn't verifiable from the
 * UI; the seam is healed at portfolio_repo.go — C-10(b)).
 */
test.describe('AC-8 valuation parity', () => {
  test('AAPL unrealized P&L is identical on Portfolio and Exposure', async ({ page }) => {
    await addAuthCookie(page);

    // Portfolio (read-only broker mirror) — PortfolioPanel lists AAPL's unrealized P&L.
    await page.goto('/trader/portfolio');
    await expect(page.getByTestId('ledger-disclaimer')).toBeVisible({ timeout: 10000 });
    const portfolioAapl = page.getByText('AAPL', { exact: true }).first();
    await expect(portfolioAapl).toBeVisible();
    const portfolioPnl = portfolioAapl.locator('..');
    await expect(portfolioPnl).toContainText('+$100.00');

    // Exposure (positions) — the AAPL row's Total P/L ($) reads the same source.
    await page.goto('/trader/positions');
    const exposureRow = page.getByRole('row', { name: /AAPL/ });
    await expect(exposureRow).toBeVisible({ timeout: 10000 });
    await expect(exposureRow).toContainText('+$100.00');
  });
});
