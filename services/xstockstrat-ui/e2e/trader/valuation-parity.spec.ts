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

    // Portfolio (read-only broker mirror) — the AAPL positions row lists its unrealized P&L.
    // Row-scoped locator (feature 096 wrapped the symbol cell in a Link to the Position page).
    await page.goto('/trader/portfolio');
    await expect(page.getByTestId('ledger-disclaimer')).toBeVisible({ timeout: 10000 });
    const portfolioRow = page.getByRole('row', { name: /AAPL/ });
    await expect(portfolioRow).toBeVisible();
    await expect(portfolioRow).toContainText('+$100.00');

    // Exposure (positions) — the AAPL row's Total P/L ($) reads the same source.
    // Row role is 'button', not 'row', here: the Exposure table is onRowClick-enabled
    // (DataTable migration, feature 135) — the composite sets role="button" on a clickable
    // row for a11y, which overrides the native <tr> row role.
    await page.goto('/trader/positions');
    const exposureRow = page.getByRole('button', { name: /AAPL/ });
    await expect(exposureRow).toBeVisible({ timeout: 10000 });
    await expect(exposureRow).toContainText('+$100.00');

    // Third read path (feature 125, FR-14): the unified single-symbol page (GetPosition) reports the
    // same broker-authoritative +$100.00 — no fourth re-derivation.
    await page.goto('/trader/positions/AAPL');
    await expect(page.getByText('+$100.00').first()).toBeVisible({ timeout: 30000 });
  });
});
