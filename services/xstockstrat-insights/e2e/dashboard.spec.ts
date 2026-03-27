import { test, expect } from '@playwright/test';

/**
 * E2E tests for the InsightsDashboard page.
 *
 * The /api/analysis/strategies route is mocked at the browser level with
 * page.route() so the component's rendering, score colour coding, and
 * navigation are tested without relying on the mock backend server.
 */

const MOCK_STRATEGIES = [
  { strategyId: 'strat-high-001', name: 'Momentum Alpha', rating: 'A', overallScore: 0.87 },
  { strategyId: 'strat-mid-002', name: 'Mean Reversion', rating: 'B', overallScore: 0.68 },
  { strategyId: 'strat-low-003', name: 'Trend Follow', rating: 'D', overallScore: 0.42 },
];

test.describe('InsightsDashboard', () => {
  test('Strategy Scores card is visible', async ({ page }) => {
    await page.route('/api/analysis/strategies', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ strategies: MOCK_STRATEGIES }),
      });
    });

    await page.goto('/');
    await expect(page.getByText('Strategy Scores')).toBeVisible();
  });

  test('renders strategy cards for each returned strategy', async ({ page }) => {
    await page.route('/api/analysis/strategies', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ strategies: MOCK_STRATEGIES }),
      });
    });

    await page.goto('/');

    // Each strategy's ID is shown in the list (font-mono span)
    for (const s of MOCK_STRATEGIES) {
      await expect(page.getByText(s.strategyId)).toBeVisible({ timeout: 5000 });
    }
  });

  test('high-score strategy (≥80%) shows score in green', async ({ page }) => {
    await page.route('/api/analysis/strategies', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          strategies: [{ strategyId: 'strat-high-001', rating: 'A', overallScore: 0.87 }],
        }),
      });
    });

    await page.goto('/');
    // Score display: "87%" in a span with class text-buy (green)
    const scoreSpan = page.locator('span.text-buy').filter({ hasText: '87%' });
    await expect(scoreSpan).toBeVisible({ timeout: 5000 });
  });

  test('mid-score strategy (60–79%) shows score in yellow', async ({ page }) => {
    await page.route('/api/analysis/strategies', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          strategies: [{ strategyId: 'strat-mid-002', rating: 'B', overallScore: 0.68 }],
        }),
      });
    });

    await page.goto('/');
    // 68% in a span with class text-paper (yellow/amber)
    const scoreSpan = page.locator('span.text-paper').filter({ hasText: '68%' });
    await expect(scoreSpan).toBeVisible({ timeout: 5000 });
  });

  test('low-score strategy (<60%) shows score in red', async ({ page }) => {
    await page.route('/api/analysis/strategies', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          strategies: [{ strategyId: 'strat-low-003', rating: 'D', overallScore: 0.42 }],
        }),
      });
    });

    await page.goto('/');
    // 42% in a span with class text-destructive (red)
    const scoreSpan = page.locator('span.text-destructive').filter({ hasText: '42%' });
    await expect(scoreSpan).toBeVisible({ timeout: 5000 });
  });

  test('rating badge is shown for strategies with a rating field', async ({ page }) => {
    await page.route('/api/analysis/strategies', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          strategies: [{ strategyId: 'strat-001', rating: 'A', overallScore: 0.87 }],
        }),
      });
    });

    await page.goto('/');
    await expect(page.getByText('A')).toBeVisible({ timeout: 5000 });
  });

  test('empty-state link "Run a backtest" shown when strategies is empty', async ({ page }) => {
    await page.route('/api/analysis/strategies', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ strategies: [] }),
      });
    });

    await page.goto('/');
    await expect(page.getByText('Run a backtest')).toBeVisible({ timeout: 5000 });
  });

  test('clicking a strategy navigates to /strategies/[id]', async ({ page }) => {
    await page.route('/api/analysis/strategies', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          strategies: [{ strategyId: 'strat-nav-001', rating: 'B', overallScore: 0.72 }],
        }),
      });
    });

    await page.goto('/');
    await page.getByText('strat-nav-001').click();

    await expect(page).toHaveURL(/\/strategies\/strat-nav-001/);
  });
});
