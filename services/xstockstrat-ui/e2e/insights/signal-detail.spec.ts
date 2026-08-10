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
    await expect(page.getByText('Why this fired')).toBeVisible({ timeout: 8000 });
    // Signal-detail header enrichment: AAPL is in the ranked queue (action ENTER, conviction 0.9).
    // The header stats come from ListOpportunities (a separate query from readiness), so wait for
    // the queue fetch to resolve before asserting.
    await expect(page.getByRole('link', { name: /Queue/ })).toBeVisible();
    await expect(page.getByText('Conviction')).toBeVisible({ timeout: 10000 }); // CONVICTION stat
    await expect(page.getByText('Edge (BT)')).toBeVisible(); // EDGE (BT) stat from analytics
    // Deterministic conviction as N/M conditions (never a fabricated %).
    await expect(page.getByText('2/3 conditions')).toBeVisible();
    // Traced leaves from EvaluateReadiness.
    await expect(page.getByText('sma_fast', { exact: false })).toBeVisible();
    await expect(page.getByText('rsi', { exact: false })).toBeVisible();
    // The picker reflects the threaded strategy.
    await expect(page.getByText('Live Test Strategy')).toBeVisible();
    // The opportunity's source renders as a Badge (FR-7) — exact match to disambiguate from the
    // meta-info line below, which also joins in the same source string.
    await expect(page.getByText('unusual_whales', { exact: true })).toBeVisible();

    // Strategy track-record block (GetStrategyAnalytics): signals 30d 42, hit rate 62%, expectancy 0.35.
    const record = page.getByTestId('strategy-track-record');
    await expect(record).toBeVisible();
    await expect(record).toContainText('42'); // signals 30d
    await expect(record).toContainText('62%'); // hit rate
    await expect(record).toContainText('0.35'); // expectancy
  });

  test('prompts to pick a strategy when none is threaded (no fabricated binding)', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await page.goto('/insights/market/AAPL');
    await expect(page.getByText(/Select a strategy to evaluate/)).toBeVisible({ timeout: 8000 });
  });

  test('strategy picker excludes non-live strategies (disabled strategies must not be usable)', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await page.goto('/insights/market/AAPL');
    await expect(page.getByText(/Select a strategy to evaluate/)).toBeVisible({ timeout: 8000 });
    await page.getByLabel('Strategy').click();
    await expect(page.getByRole('option', { name: 'Live Test Strategy' })).toBeVisible();
    // "Inactive Strategy" (liveEnabled: false in the fixture) must not be a selectable option.
    await expect(page.getByRole('option', { name: 'Inactive Strategy' })).toHaveCount(0);
  });
});
