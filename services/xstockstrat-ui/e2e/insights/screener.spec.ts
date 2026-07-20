import { test, expect } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';

/**
 * E2E for feature 060 (screener-engine), Acceptance #6.
 *
 * The insights mock backend returns a deterministic ranked ScreenSymbolsResponse (3 results,
 * score-ordered, one INSUFFICIENT_DATA). The screener page must render the ranked table and
 * surface the loading + insufficient-data states.
 */
test.describe('Screener', () => {
  test('runs a scan and renders a ranked results table', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/insights/screener');

    await expect(page.getByRole('heading', { name: 'Screener' })).toBeVisible({ timeout: 5000 });

    // Default criterion is present; run the scan against the default symbols.
    await page.getByTestId('run-screen').click();

    const results = page.getByTestId('screen-results');
    await expect(results).toBeVisible({ timeout: 10000 });

    // Three ranked rows, score-ordered (highest first).
    const rows = page.getByTestId('result-row');
    await expect(rows).toHaveCount(3);
    await expect(rows.first()).toContainText('AAPL');

    // The third symbol is reported as insufficient data (not dropped).
    await expect(page.getByTestId('insufficient-data')).toBeVisible();
  });
});
