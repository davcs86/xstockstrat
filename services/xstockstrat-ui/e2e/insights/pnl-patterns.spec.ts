import { test, expect } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';

/**
 * P&L Patterns view (feature 042, AC-4) — the ranked positive/negative attribution factor cards
 * render from the QueryPnLPatterns fixture (PNL_PATTERNS_AAPL, served by the mock backend). Distinct
 * fixture values prove the UI reads the right fields.
 */
test.describe('P&L Patterns (insights)', () => {
  test('renders ranked positive and negative factor cards', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/insights/pnl-patterns');

    await expect(page.getByTestId('pnl-patterns-page')).toBeVisible({ timeout: 8000 });
    await expect(page.getByRole('heading', { name: 'P&L Patterns' })).toBeVisible();

    // Positive column: the RSI 20–32 indicator (+142.50) and the unusual_whales signal (+61.25).
    const positive = page.getByTestId('pnl-positive');
    await expect(positive.getByText('RSI').first()).toBeVisible({ timeout: 5000 });
    await expect(positive.getByText('unusual_whales')).toBeVisible();
    await expect(positive.getByText('+142.50')).toBeVisible();
    await expect(positive.getByText('20.00 – 32.00 · 7 samples')).toBeVisible();

    // Negative column: the RSI 68–79 indicator (-97.40).
    const negative = page.getByTestId('pnl-negative');
    await expect(negative.getByText('-97.40')).toBeVisible();
    await expect(negative.getByText('68.00 – 79.00 · 8 samples')).toBeVisible();

    // FR-5 snapshot timeline placeholder present.
    await expect(page.getByTestId('pnl-timeline-placeholder')).toBeVisible();
  });
});
