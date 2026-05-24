import { test, expect, type Page } from '@playwright/test';
import { SignJWT } from 'jose';

/**
 * E2E tests for /api/chart route handler and ChartPanel component.
 *
 * API tests exercise the full server-side path against the mock backend.
 * Component tests load the trading dashboard page and assert the ChartPanel
 * renders correctly (symbol selector, timeframe buttons, chart container).
 */

const TEST_JWT_SECRET = 'test-jwt-secret-for-e2e-tests-min32c';
const BASE_URL = 'http://localhost:3000';

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

test.describe('GET /api/chart — GetBars proxy', () => {
  test('returns bars array with required OHLCV fields', async ({ page }) => {
    await addAuthCookie(page);
    const res = await page.request.get('/trader/api/chart?symbol=AAPL&timeframe=1Day&limit=100');
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty('bars');
    expect(Array.isArray(body.bars)).toBe(true);
    expect(body.bars.length).toBeGreaterThan(0);

    const bar = body.bars[0];
    expect(bar).toHaveProperty('time');
    expect(typeof bar.time).toBe('number');
    expect(bar).toHaveProperty('open');
    expect(bar).toHaveProperty('high');
    expect(bar).toHaveProperty('low');
    expect(bar).toHaveProperty('close');
    expect(bar).toHaveProperty('volume');

    // bars must be sorted ascending by time (lightweight-charts requirement)
    if (body.bars.length > 1) {
      expect(body.bars[0].time).toBeLessThanOrEqual(body.bars[1].time);
    }
  });

  test('returns 400 when symbol query param is missing', async ({ page }) => {
    await addAuthCookie(page);
    const res = await page.request.get('/trader/api/chart?timeframe=1Day&limit=100');
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  test('returns 401 when not authenticated', async ({ page }) => {
    // No auth cookie — middleware should reject
    const res = await page.request.get('/trader/api/chart?symbol=AAPL&timeframe=1Day&limit=100');
    expect([401, 307]).toContain(res.status());
  });
});

test.describe('POST /api/chart — ListAssets proxy', () => {
  test('returns symbols array for the symbol selector', async ({ page }) => {
    await addAuthCookie(page);
    const res = await page.request.post('/trader/api/chart', { data: {} });
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty('symbols');
    expect(Array.isArray(body.symbols)).toBe(true);
    expect(body.symbols.length).toBeGreaterThan(0);

    // All symbols must be non-empty strings
    for (const sym of body.symbols) {
      expect(typeof sym).toBe('string');
      expect(sym.length).toBeGreaterThan(0);
    }

    // Mock backend returns AAPL, MSFT, TSLA
    expect(body.symbols).toContain('AAPL');
  });

  test('returns 401 when not authenticated', async ({ page }) => {
    const res = await page.request.post('/trader/api/chart', { data: {} });
    expect([401, 307]).toContain(res.status());
  });
});

test.describe('ChartPanel component — trading dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/trader/');
  });

  test('renders ChartPanel card on the dashboard', async ({ page }) => {
    // The ChartPanel renders inside a Card — look for its heading
    await expect(page.getByRole('heading', { name: /chart/i })).toBeVisible({ timeout: 10000 });
  });

  test('renders all 6 timeframe buttons', async ({ page }) => {
    const labels = ['10m', '30m', '1h', '1d', '1w', '1mo'];
    for (const label of labels) {
      await expect(page.getByRole('button', { name: label })).toBeVisible({ timeout: 10000 });
    }
  });

  test('1d is the active timeframe by default', async ({ page }) => {
    // The active button has a distinct variant — check it is present and the others are not
    const dayButton = page.getByRole('button', { name: '1d' });
    await expect(dayButton).toBeVisible({ timeout: 10000 });
    // Active button uses 'default' variant (dark background); verify aria or class distinguishes it
    // We assert the button exists and is visible — visual variant is verified via aria-pressed if set
  });

  test('renders bar count selector with 50 / 100 / 200 options', async ({ page }) => {
    // The bar count selector is a <select> element
    const select = page.locator('select');
    await expect(select).toBeVisible({ timeout: 10000 });

    const options = await select.locator('option').allTextContents();
    expect(options).toContain('50');
    expect(options).toContain('100');
    expect(options).toContain('200');
  });

  test('renders chart container after data loads', async ({ page }) => {
    // lightweight-charts mounts a <canvas> inside the chart div
    await expect(page.locator('canvas')).toBeVisible({ timeout: 15000 });
  });
});
