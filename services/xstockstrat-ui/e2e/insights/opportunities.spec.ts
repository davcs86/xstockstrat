import { test, expect } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';

/**
 * Decide → Opportunities queue (feature 083, Step 22 + the handoff-fidelity card rebuild).
 * Exercises the real analysis.ListOpportunities call chain (browser analysisClient → insights
 * BFF → mock backend on 9092) against the OPPORTUNITIES fixture: ranked conviction cards, action
 * tags, the "N/M conditions" render, source-chip filtering, and the min-conviction slider.
 */
test.describe('Opportunities queue', () => {
  const card = (page: import('@playwright/test').Page, sym: string) =>
    page.getByTestId('opportunity-card').filter({ hasText: sym });

  test.beforeEach(async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/insights/opportunities');
    await expect(card(page, 'AAPL')).toBeVisible({ timeout: 8000 });
  });

  test('renders ranked cards with action tags and conviction', async ({ page }) => {
    for (const sym of ['AAPL', 'MSFT', 'TSLA', 'NVDA']) {
      await expect(card(page, sym)).toBeVisible();
    }
    // Action tags from the OpportunityActionTag render map — scoped to the visible desktop
    // cards (the mobile SectionRenderer renders the same badges behind sm:hidden).
    await expect(card(page, 'AAPL').getByText('Enter', { exact: true })).toBeVisible();
    await expect(card(page, 'MSFT').getByText('Add', { exact: true })).toBeVisible();
    await expect(card(page, 'TSLA').getByText('Reduce', { exact: true })).toBeVisible();
    // Conviction card shows "N/M conditions" when the row carries readiness (AAPL: 4/5).
    await expect(card(page, 'AAPL').getByText('4/5')).toBeVisible();
  });

  test('min-conviction slider filters low-conviction cards', async ({ page }) => {
    await page.getByLabel('Minimum conviction').fill('80');
    await expect(card(page, 'AAPL')).toBeVisible(); // 0.90
    await expect(card(page, 'NVDA')).toBeVisible(); // 0.85
    await expect(card(page, 'MSFT')).toBeHidden(); // 0.75 filtered
    await expect(card(page, 'TSLA')).toBeHidden(); // 0.60 filtered
  });

  test('source chip narrows the queue to one source', async ({ page }) => {
    await page.getByRole('button', { name: 'marketwatch' }).click();
    await expect(card(page, 'MSFT')).toBeVisible();
    await expect(card(page, 'AAPL')).toBeHidden();
  });

  test('Snooze removes an opportunity from the queue', async ({ page }) => {
    await expect(card(page, 'AAPL')).toBeVisible();
    await page.getByTestId('snooze-AAPL').click();
    await expect(card(page, 'AAPL')).toBeHidden();
    // Other cards remain.
    await expect(card(page, 'NVDA')).toBeVisible();
  });
});
