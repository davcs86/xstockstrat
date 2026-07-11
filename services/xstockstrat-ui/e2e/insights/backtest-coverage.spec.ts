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

  // feature 064 — an OK backtest renders the day-by-day debug diagnostics table + no-trade reason.
  test('OK backtest renders day-by-day debug diagnostics', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/insights/strategies/strat-diag-001');

    await page.getByRole('button', { name: 'Run Backtest' }).click();

    await expect(page.getByTestId('diagnostics-table')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('no-trade-reason')).toContainText(
      'entry condition was never satisfied',
    );
  });

  // Score persistence + run history: a strategy with prior runs shows the persisted score
  // and a Past Runs table without needing to re-run a backtest.
  test('persisted score + past runs render from report metadata', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/insights/strategies/strat-history-001');

    // Persisted score card (no Run Backtest click needed).
    await expect(page.getByText('Strategy Score')).toBeVisible({ timeout: 10000 });

    // Past Runs history table lists both persisted runs, newest first.
    const pastRuns = page.getByTestId('past-runs');
    await expect(pastRuns).toBeVisible();
    await expect(pastRuns).toContainText('AAPL');
    await expect(pastRuns).toContainText('MSFT');
    await expect(pastRuns).toContainText('15.00%');
  });
});
