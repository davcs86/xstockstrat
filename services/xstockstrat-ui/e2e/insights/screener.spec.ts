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

  test('renders the feature-083 raw columns (pe / rsi / atr / rev-growth / held)', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await page.goto('/insights/screener');
    await page.getByTestId('run-screen').click();
    const results = page.getByTestId('screen-results');
    await expect(results).toBeVisible({ timeout: 10000 });
    // New column headers.
    await expect(results.getByText('P/E')).toBeVisible();
    await expect(results.getByText('RSI')).toBeVisible();
    await expect(results.getByText('Rev growth')).toBeVisible();
    // The top row carries its raw values + the Held badge.
    const first = page.getByTestId('result-row').first();
    await expect(first).toContainText('22.5'); // P/E
    await expect(first).toContainText('58'); // RSI
    await expect(first.getByText('Held')).toBeVisible();
  });

  test('the 10-column results table does not overflow the phone frame', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await addAuthCookie(page);
    await page.goto('/insights/screener');
    await page.getByTestId('run-screen').click();
    await expect(page.getByTestId('screen-results')).toBeVisible({ timeout: 10000 });

    // The page body must not scroll horizontally — the wide table scrolls inside its own
    // overflow-x container instead (regression guard for the raw-table overflow bug).
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1); // allow sub-pixel rounding
  });
});
