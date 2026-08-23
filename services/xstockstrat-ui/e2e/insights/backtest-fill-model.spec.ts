import { test, expect } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';

/**
 * E2E for feature 151 (backtest-next-bar-fill), Step 10.
 *
 * The strategy detail page must make a run's fill model visible so a next-bar-open run is never
 * silently compared against a legacy same-bar-close one:
 *  - the Past Runs table carries a "Fill model" column;
 *  - opening the next-bar-open run shows a "Next-bar open" badge on the results surface.
 *
 * Fixtures: `strat-history-001`'s bt-hist-2 is next-bar-open (+ portfolio sizing), bt-hist-1 is
 * legacy same-bar-close — see e2e/mock-backend.ts HIST_RUN_METRICS / HIST_RUN_DETAIL.
 */
test.describe('Backtest fill model', () => {
  test('Past Runs "Fill model" column distinguishes next-bar vs legacy rows', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/insights/strategies/strat-history-001');

    const pastRuns = page.getByTestId('past-runs');
    await expect(pastRuns).toBeVisible({ timeout: 10000 });
    await expect(pastRuns).toContainText('Next-bar open');
    await expect(pastRuns).toContainText('Same-bar close');
  });

  test('opening a next-bar-open run shows the fill-model badge', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/insights/strategies/strat-history-001');

    const rows = page.getByTestId('past-run-row');
    await expect(rows).toHaveCount(2, { timeout: 10000 });
    await rows.first().click(); // newest first → bt-hist-2 (next-bar-open, has detail)

    await expect(page.getByText('Backtest Results')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('fill-model-badge')).toHaveText('Next-bar open');
  });
});
