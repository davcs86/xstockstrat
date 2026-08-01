import { test, expect } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';

/**
 * Decide → Opportunities queue (feature 083, Step 22). Exercises the real
 * analysis.ListOpportunities call chain (browser analysisClient → insights BFF → mock
 * backend on 9092) against the OPPORTUNITIES fixture: ranked rows, action tags, the
 * conviction "N/M conditions" render, source-chip filtering, and the min-conviction slider.
 */
test.describe('Opportunities queue', () => {
  test.beforeEach(async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/insights/opportunities');
    await expect(page.getByRole('cell', { name: 'AAPL' })).toBeVisible({ timeout: 8000 });
  });

  test('renders ranked rows with action tags and conviction', async ({ page }) => {
    for (const sym of ['AAPL', 'MSFT', 'TSLA', 'NVDA']) {
      await expect(page.getByRole('cell', { name: sym })).toBeVisible();
    }
    // Action tags from the OpportunityActionTag render map.
    await expect(page.getByText('Enter').first()).toBeVisible();
    await expect(page.getByText('Add').first()).toBeVisible();
    await expect(page.getByText('Reduce').first()).toBeVisible();
    // Conviction renders "N/M conditions" when the row carries readiness (AAPL: 4/5).
    await expect(page.getByText('4/5')).toBeVisible();
  });

  test('min-conviction slider filters low-conviction rows', async ({ page }) => {
    await page.getByLabel('Minimum conviction').fill('80');
    await expect(page.getByRole('cell', { name: 'AAPL' })).toBeVisible(); // 0.90
    await expect(page.getByRole('cell', { name: 'NVDA' })).toBeVisible(); // 0.85
    await expect(page.getByRole('cell', { name: 'MSFT' })).toBeHidden(); // 0.75 filtered
    await expect(page.getByRole('cell', { name: 'TSLA' })).toBeHidden(); // 0.60 filtered
  });

  test('source chip narrows the queue to one source', async ({ page }) => {
    await page.getByRole('button', { name: 'marketwatch' }).click();
    await expect(page.getByRole('cell', { name: 'MSFT' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'AAPL' })).toBeHidden();
  });
});
