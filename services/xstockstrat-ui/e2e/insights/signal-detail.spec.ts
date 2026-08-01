import { test, expect } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';

/**
 * Decide → Signal detail readiness (feature 083, FR-6). The strategy is an explicit input:
 * threaded from the opportunity row via ?strategy=, else picked. Exercises the real
 * EvaluateReadiness call chain (browser analysisClient → insights BFF → mock backend).
 */
test.describe('Signal detail readiness', () => {
  test('renders traced conditions for the threaded strategy', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/insights/market/AAPL?strategy=strat-live-001');
    await expect(page.getByText('Readiness')).toBeVisible({ timeout: 8000 });
    // Deterministic conviction as N/M conditions (never a fabricated %).
    await expect(page.getByText('2/3 conditions')).toBeVisible();
    // Traced leaves from EvaluateReadiness.
    await expect(page.getByText('sma_fast', { exact: false })).toBeVisible();
    await expect(page.getByText('rsi', { exact: false })).toBeVisible();
    // The picker reflects the threaded strategy.
    await expect(page.getByText('Live Test Strategy')).toBeVisible();
  });

  test('prompts to pick a strategy when none is threaded (no fabricated binding)', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await page.goto('/insights/market/AAPL');
    await expect(page.getByText(/Select a strategy to evaluate/)).toBeVisible({ timeout: 8000 });
  });
});
