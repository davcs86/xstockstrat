import { test, expect, type Page } from '@playwright/test';
import { SignJWT } from 'jose';

/**
 * API smoke tests for xstockstrat-insights Next.js route handlers.
 *
 * The /api/analysis/strategies route calls ListStrategies (and optionally
 * ScoreStrategy for enrichment).  These tests verify that the response shape
 * matches exactly what the InsightsDashboard component expects.
 *
 * The mock backend (started in globalSetup) returns pre-scored strategies so
 * the enrichment ScoreStrategy call is skipped, keeping the tests deterministic.
 *
 * Auth cookies are injected via addAuthCookie() so each test exercises the
 * authenticated code path.  The auth.spec.ts file covers the unauthenticated
 * (redirect/401) and login/logout flows separately.
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

test.describe('GET /api/analysis/strategies — InsightsDashboard data contract', () => {
  /**
   * InsightsDashboard (page.tsx) accesses:
   *   strategies?.strategies            → outer wrapper (optional chain)
   *   s.strategyId                      → Link href + chart label (sliced to 8 chars)
   *   s.rating                          → Badge (ratingVariant: A→buy, B→info, C→warning, D→destructive)
   *   s.overallScore                    → (s.overallScore * 100).toFixed(0) + '%'
   *                                       scoreColor: ≥0.8→text-buy, ≥0.6→text-paper, else→text-destructive
   */
  test('response is wrapped in a { strategies: [] } object', async ({ page }) => {
    await addAuthCookie(page);
    const res = await page.request.get('/api/analysis/strategies');
    expect(res.status()).toBe(200);

    const body = await res.json();
    // Component accesses strategies?.strategies — the outer key must be "strategies"
    expect(body).toHaveProperty('strategies');
    expect(Array.isArray(body.strategies)).toBe(true);
  });

  test('each strategy has strategyId used as the navigation key', async ({ page }) => {
    await addAuthCookie(page);
    const res = await page.request.get('/api/analysis/strategies');
    const { strategies } = await res.json();

    expect(strategies.length).toBeGreaterThan(0);
    for (const s of strategies) {
      // strategyId is used as: href={`/strategies/${s.strategyId}`} and key={s.strategyId}
      expect(s).toHaveProperty('strategyId');
      expect(typeof s.strategyId).toBe('string');
      expect(s.strategyId.length).toBeGreaterThan(0);
    }
  });

  test('overallScore is a decimal in [0, 1] — component multiplies by 100 for display', async ({ page }) => {
    await addAuthCookie(page);
    const res = await page.request.get('/api/analysis/strategies');
    const { strategies } = await res.json();

    for (const s of strategies) {
      if (s.overallScore !== undefined) {
        expect(typeof s.overallScore).toBe('number');
        // Must be in [0, 1]: if it were already a percentage the display would
        // show "8700%" instead of "87%" — a critical UI regression
        expect(s.overallScore).toBeGreaterThanOrEqual(0);
        expect(s.overallScore).toBeLessThanOrEqual(1);
      }
    }
  });

  test('rating (when present) is a single uppercase letter A–D', async ({ page }) => {
    await addAuthCookie(page);
    const res = await page.request.get('/api/analysis/strategies');
    const { strategies } = await res.json();

    for (const s of strategies) {
      if (s.rating !== undefined) {
        // ratingVariant() maps A→buy, B→info, C→warning, else→destructive
        // Any value outside A–D falls through to destructive variant — verify
        // the backend only sends recognised values
        expect(s.rating).toMatch(/^[A-D]$/);
      }
    }
  });

  test('strategies with overallScore ≥ 0.8 are categorised as high-score', async ({ page }) => {
    await addAuthCookie(page);
    const res = await page.request.get('/api/analysis/strategies');
    const { strategies } = await res.json();

    const highScore = strategies.filter((s: { overallScore?: number }) =>
      s.overallScore !== undefined && s.overallScore >= 0.8,
    );

    // The mock backend includes one A-rated strategy at 0.87 — verify it exists
    expect(highScore.length).toBeGreaterThanOrEqual(1);

    for (const s of highScore) {
      // Component renders these with text-buy (green) colour class
      expect(s.overallScore).toBeGreaterThanOrEqual(0.8);
    }
  });

  test('chart data can be derived: strategyId.slice(0, 8) and overallScore * 100', async ({ page }) => {
    await addAuthCookie(page);
    const res = await page.request.get('/api/analysis/strategies');
    const { strategies } = await res.json();

    // chartData() function in page.tsx:
    //   { label: s.strategyId?.slice(0, 8) ?? '—', score: Math.round((s.overallScore ?? 0) * 100) }
    for (const s of strategies) {
      const label = s.strategyId?.slice(0, 8) ?? '—';
      const score = Math.round((s.overallScore ?? 0) * 100);

      expect(typeof label).toBe('string');
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });
});
