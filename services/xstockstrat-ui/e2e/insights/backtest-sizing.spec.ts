import { test, expect } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';

/**
 * E2E for feature 150 (backtest-portfolio-sizing), Step 13.
 *
 * The strategy detail page must make a run's capital-allocation model visible so a portfolio-mode
 * return is never silently compared against a legacy one:
 *  - the Past Runs table carries a "Mode" column distinguishing the two persisted runs;
 *  - opening the portfolio-mode run shows a "Portfolio" badge on the results surface and plots the
 *    separate portfolio equity curve (distinct from the per-symbol curve).
 *
 * Fixtures: `strat-history-001`'s bt-hist-2 is portfolio mode (+ portfolioEquityCurve),
 * bt-hist-1 is legacy — see e2e/mock-backend.ts HIST_RUN_METRICS / HIST_RUN_DETAIL.
 */
test.describe('Backtest sizing mode', () => {
  test('Past Runs "Mode" column distinguishes portfolio vs legacy rows', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/insights/strategies/strat-history-001');

    const pastRuns = page.getByTestId('past-runs');
    await expect(pastRuns).toBeVisible({ timeout: 10000 });
    // Both mode labels present — the portfolio-mode run and the legacy run.
    await expect(pastRuns).toContainText('Portfolio');
    await expect(pastRuns).toContainText('Legacy');
  });

  test('opening a portfolio-mode run shows the mode badge + portfolio equity curve', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await page.goto('/insights/strategies/strat-history-001');

    const rows = page.getByTestId('past-run-row');
    await expect(rows).toHaveCount(2, { timeout: 10000 });
    await rows.first().click(); // newest first → bt-hist-2 (portfolio mode, has detail)

    await expect(page.getByText('Backtest Results')).toBeVisible({ timeout: 10000 });
    // The results surface labels the mode so it can't be misread as legacy.
    await expect(page.getByTestId('sizing-mode-badge')).toHaveText('Portfolio');
    // The separate portfolio (shared-pool) equity curve renders alongside the per-symbol curve.
    await expect(page.getByTestId('portfolio-equity-curve-chart')).toBeVisible();
    await expect(page.getByTestId('equity-curve-chart')).toBeVisible();
  });
});
