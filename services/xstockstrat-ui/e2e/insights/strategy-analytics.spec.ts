import { test, expect } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';

/**
 * Engine → Strategies per-strategy analytics (feature 083, Step 24). Exercises
 * GetStrategyAnalytics on the strategy detail page + the Active/Paused/Off state (AC-5,
 * derived from active/live_enabled — never Live/Paper). The mock strategy is active +
 * not live-enabled → Paused.
 */
test.describe('Strategy analytics', () => {
  test('detail page renders analytics + Paused state', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/insights/strategies/strat-high-001');

    const analytics = page.getByTestId('strategy-analytics');
    await expect(analytics).toBeVisible({ timeout: 8000 });
    await expect(analytics).toContainText('Expectancy');
    await expect(analytics).toContainText('0.35'); // expectancy
    await expect(analytics).toContainText('62%'); // blended hit rate
    await expect(analytics).toContainText('42'); // signals 30d
    // active && !live_enabled → Paused (never Live/Paper).
    await expect(page.getByText('Paused', { exact: true })).toBeVisible();
  });
});
