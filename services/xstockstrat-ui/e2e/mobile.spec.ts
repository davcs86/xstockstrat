import { test, expect } from '@playwright/test';
import { addAuthCookie } from './helpers/auth';

/**
 * Mobile companion (feature 083, FR-16 / Step 28+30). The same responsive routes render on a
 * phone frame with a fixed bottom tab bar (Decide/Discover/Engine/Book) and ≥44px tap targets.
 * The Opportunities queue renders 1:1 through the shared SectionRenderer instead of the desktop
 * table. Runs at an iPhone-class viewport.
 */
test.use({ viewport: { width: 390, height: 844 } });

test.describe('Mobile companion', () => {
  test.beforeEach(async ({ page }) => {
    await addAuthCookie(page);
  });

  test('bottom tab bar is visible with four ≥44px targets', async ({ page }) => {
    await page.goto('/insights/opportunities');
    const bar = page.getByTestId('mobile-tab-bar');
    await expect(bar).toBeVisible({ timeout: 10000 });

    const tabs = bar.getByRole('link');
    await expect(tabs).toHaveCount(4);
    for (const label of ['Decide', 'Discover', 'Engine', 'Book']) {
      await expect(bar.getByRole('link', { name: label })).toBeVisible();
    }
    // Tap-target floor (FR-16): every tab is at least 44px tall.
    const count = await tabs.count();
    for (let i = 0; i < count; i++) {
      const box = await tabs.nth(i).boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
  });

  test('Opportunities renders the shared section renderer, not the desktop cards', async ({
    page,
  }) => {
    await page.goto('/insights/opportunities');
    await expect(page.getByTestId('mobile-sections')).toBeVisible({ timeout: 10000 });
    // The desktop conviction cards are hidden on phone frames (hidden sm:block).
    await expect(page.getByTestId('opportunity-card').first()).toBeHidden();
    // At least one queued signal row renders as a section.
    await expect(page.getByTestId('mobile-sections').getByText('AAPL').first()).toBeVisible();
  });

  test('bottom tabs navigate across the four groups', async ({ page }) => {
    await page.goto('/insights/opportunities');
    const bar = page.getByTestId('mobile-tab-bar');
    await expect(bar).toBeVisible({ timeout: 10000 });

    await bar.getByRole('link', { name: 'Book' }).click();
    await expect(page).toHaveURL(/\/trader\/positions/);
    await expect(page.getByTestId('mobile-tab-bar')).toBeVisible();

    await bar.getByRole('link', { name: 'Engine' }).click();
    await expect(page).toHaveURL(/\/insights\/strategies/);
  });
});
