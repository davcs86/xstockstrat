import { test, expect, type Page } from '@playwright/test';
import { SignJWT } from 'jose';

/**
 * E2E tests for the InsightsDashboard page.
 *
 * Auth cookie is injected directly so the middleware does not redirect to /login.
 * The Connect-RPC ListStrategies call is mocked at the browser level with
 * page.route() so the component's rendering, score colour coding, and
 * navigation are tested without relying on the mock backend server.
 */

const TEST_JWT_SECRET = 'test-jwt-secret-for-e2e-tests-min32c';
const BASE_URL = 'http://localhost:3001';

async function addAuthCookie(page: Page): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({
    user_id: 'test-user-001',
    email: 'test@example.com',
    roles: [],
    issued_at: now,
    expires_at: now + 3600,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(TEST_JWT_SECRET));

  await page.context().addCookies([
    { name: 'access_token', value: token, url: BASE_URL, httpOnly: true, sameSite: 'Lax' },
  ]);
}

const MOCK_STRATEGIES = [
  { strategyId: 'strat-high-001', name: 'Momentum Alpha', rating: 'A', overallScore: 0.87 },
  { strategyId: 'strat-mid-002', name: 'Mean Reversion', rating: 'B', overallScore: 0.68 },
  { strategyId: 'strat-low-003', name: 'Trend Follow', rating: 'D', overallScore: 0.42 },
];

test.describe('InsightsDashboard', () => {
  test('Strategy Scores card is visible', async ({ page }) => {
    await addAuthCookie(page);
    await page.route('**/xstockstrat.analysis.v1.AnalysisService/ListStrategies', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ strategies: MOCK_STRATEGIES }),
      });
    });

    await page.goto('/insights');
    await expect(page.getByRole('heading', { name: 'Strategy Scores' })).toBeVisible();
  });

  test('renders strategy cards for each returned strategy', async ({ page }) => {
    await addAuthCookie(page);
    await page.route('**/xstockstrat.analysis.v1.AnalysisService/ListStrategies', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ strategies: MOCK_STRATEGIES }),
      });
    });

    await page.goto('/insights');

    // Each strategy's ID is shown in the list (font-mono span)
    for (const s of MOCK_STRATEGIES) {
      await expect(page.getByText(s.strategyId, { exact: true })).toBeVisible({ timeout: 5000 });
    }
  });

  test('high-score strategy (≥80%) shows score in green', async ({ page }) => {
    await addAuthCookie(page);
    await page.route('**/xstockstrat.analysis.v1.AnalysisService/ListStrategies', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          strategies: [{ strategyId: 'strat-high-001', rating: 'A', overallScore: 0.87 }],
        }),
      });
    });

    await page.goto('/insights');
    // Score display: "87%" in a span with class text-buy (green)
    const scoreSpan = page.locator('span.text-buy').filter({ hasText: '87%' });
    await expect(scoreSpan).toBeVisible({ timeout: 5000 });
  });

  test('mid-score strategy (60–79%) shows score in yellow', async ({ page }) => {
    await addAuthCookie(page);
    await page.route('**/xstockstrat.analysis.v1.AnalysisService/ListStrategies', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          strategies: [{ strategyId: 'strat-mid-002', rating: 'B', overallScore: 0.68 }],
        }),
      });
    });

    await page.goto('/insights');
    // 68% in a span with class text-paper (yellow/amber)
    const scoreSpan = page.locator('span.text-paper').filter({ hasText: '68%' });
    await expect(scoreSpan).toBeVisible({ timeout: 5000 });
  });

  test('low-score strategy (<60%) shows score in red', async ({ page }) => {
    await addAuthCookie(page);
    await page.route('**/xstockstrat.analysis.v1.AnalysisService/ListStrategies', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          strategies: [{ strategyId: 'strat-low-003', rating: 'D', overallScore: 0.42 }],
        }),
      });
    });

    await page.goto('/insights');
    // 42% in a span with class text-destructive (red)
    const scoreSpan = page.locator('span.text-destructive').filter({ hasText: '42%' });
    await expect(scoreSpan).toBeVisible({ timeout: 5000 });
  });

  test('rating badge is shown for strategies with a rating field', async ({ page }) => {
    await addAuthCookie(page);
    await page.route('**/xstockstrat.analysis.v1.AnalysisService/ListStrategies', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          strategies: [{ strategyId: 'strat-001', rating: 'A', overallScore: 0.87 }],
        }),
      });
    });

    await page.goto('/insights');
    await expect(page.getByText('A', { exact: true }).first()).toBeVisible({ timeout: 5000 });
  });

  test('empty-state link "Run a backtest" shown when strategies is empty', async ({ page }) => {
    await addAuthCookie(page);
    await page.route('**/xstockstrat.analysis.v1.AnalysisService/ListStrategies', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ strategies: [] }),
      });
    });

    await page.goto('/insights');
    await expect(page.getByText('Run a backtest')).toBeVisible({ timeout: 5000 });
  });

  test('clicking a strategy navigates to /strategies/[id]', async ({ page }) => {
    await addAuthCookie(page);
    await page.route('**/xstockstrat.analysis.v1.AnalysisService/ListStrategies', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          strategies: [{ strategyId: 'strat-nav-001', rating: 'B', overallScore: 0.72 }],
        }),
      });
    });

    await page.goto('/insights');
    await page.getByText('strat-nav-001', { exact: true }).click();

    await expect(page).toHaveURL(/\/strategies\/strat-nav-001/);
  });
});
