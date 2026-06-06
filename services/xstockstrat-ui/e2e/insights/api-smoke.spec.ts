import { test, expect, type Page } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';

/**
 * BFF smoke tests for the Connect-RPC gateway in xstockstrat-insights.
 *
 * The mock backend (started in globalSetup on port 9092) handles ListStrategies
 * and returns pre-scored strategies.  These tests call the BFF via browser-level
 * fetch (page.evaluate) to avoid the Next.js dev-server Transfer-Encoding
 * quirk that breaks Playwright's undici-based APIRequestContext.
 *
 * Auth cookie is injected directly so the middleware allows the BFF call through.
 */

const ANALYSIS_BFF = '/insights/api/xstockstrat.analysis.v1.AnalysisService/ListStrategies';

async function callBff(page: Page): Promise<{ status: number; body: Record<string, unknown> }> {
  return page.evaluate(async (url) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    const body = await res.json() as Record<string, unknown>;
    return { status: res.status, body };
  }, ANALYSIS_BFF);
}

test.describe('Connect BFF — AnalysisService/ListStrategies data contract', () => {
  /**
   * InsightsDashboard (page.tsx) accesses:
   *   strategies?.strategies            → outer wrapper (optional chain)
   *   s.strategyId                      → Link href + chart label (sliced to 8 chars)
   *   s.rating                          → Badge (ratingVariant: A→buy, B→info, C→warning, D→destructive)
   *   s.overallScore                    → (s.overallScore * 100).toFixed(0) + '%'
   *                                       scoreColor: ≥0.8→text-buy, ≥0.6→text-paper, else→text-destructive
   */
  test('response is a { strategies: [] } object', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/auth/login');
    const { status, body } = await callBff(page);
    expect(status).toBe(200);
    expect(body).toHaveProperty('strategies');
    expect(Array.isArray(body.strategies)).toBe(true);
  });

  test('each strategy has strategyId used as the navigation key', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/auth/login');
    const { body } = await callBff(page);
    const strategies = body.strategies as Array<Record<string, unknown>>;

    expect(strategies.length).toBeGreaterThan(0);
    for (const s of strategies) {
      expect(s).toHaveProperty('strategyId');
      expect(typeof s.strategyId).toBe('string');
      expect((s.strategyId as string).length).toBeGreaterThan(0);
    }
  });

  test('overallScore is a decimal in [0, 1] — component multiplies by 100 for display', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/auth/login');
    const { body } = await callBff(page);
    const strategies = body.strategies as Array<Record<string, unknown>>;

    for (const s of strategies) {
      if (s.overallScore !== undefined) {
        expect(typeof s.overallScore).toBe('number');
        // Must be in [0, 1]: if it were already a percentage the display would
        // show "8700%" instead of "87%" — a critical UI regression
        expect(s.overallScore as number).toBeGreaterThanOrEqual(0);
        expect(s.overallScore as number).toBeLessThanOrEqual(1);
      }
    }
  });

  test('rating (when present) is a single uppercase letter A–D', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/auth/login');
    const { body } = await callBff(page);
    const strategies = body.strategies as Array<Record<string, unknown>>;

    for (const s of strategies) {
      if (s.rating !== undefined) {
        expect(s.rating).toMatch(/^[A-D]$/);
      }
    }
  });

  test('strategies with overallScore ≥ 0.8 are categorised as high-score', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/auth/login');
    const { body } = await callBff(page);
    const strategies = body.strategies as Array<Record<string, unknown>>;

    const highScore = strategies.filter((s) =>
      s.overallScore !== undefined && (s.overallScore as number) >= 0.8,
    );

    // The mock backend includes one A-rated strategy at 0.87 — verify it exists
    expect(highScore.length).toBeGreaterThanOrEqual(1);

    for (const s of highScore) {
      expect(s.overallScore as number).toBeGreaterThanOrEqual(0.8);
    }
  });

  test('chart data can be derived: strategyId.slice(0, 8) and overallScore * 100', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/auth/login');
    const { body } = await callBff(page);
    const strategies = body.strategies as Array<Record<string, unknown>>;

    for (const s of strategies) {
      const label = (s.strategyId as string | undefined)?.slice(0, 8) ?? '—';
      const score = Math.round(((s.overallScore as number | undefined) ?? 0) * 100);

      expect(typeof label).toBe('string');
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });
});
