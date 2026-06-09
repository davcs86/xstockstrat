import { test, expect } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';

/**
 * E2E for feature 053 (backfill-backtest-coverage), AC-4.
 *
 * The insights mock backend returns a BACKTEST_STATUS_INSUFFICIENT_DATA result with a
 * coverage gap; the strategy detail page must render the gap panel instead of metrics,
 * and the "Backfill this range" action must call TriggerBackfill and surface the job id.
 */
test.describe('Backtest data coverage', () => {
  test('insufficient data renders gap panel + working backfill action', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/insights/strategies/strat-high-001');

    // Run a backtest — the mock returns INSUFFICIENT_DATA.
    await page.getByRole('button', { name: 'Run Backtest' }).click();

    const panel = page.getByTestId('insufficient-data');
    await expect(panel).toBeVisible({ timeout: 10000 });
    // Missing-range detail: bars have (3) and bars need (52).
    await expect(panel).toContainText('3');
    await expect(panel).toContainText('52');

    // Trigger the gap fill and assert the returned job id is confirmed.
    await page.getByTestId('backfill-action').click();
    await expect(page.getByTestId('backfill-confirmation')).toContainText('job-e2e-1', {
      timeout: 10000,
    });
  });
});
