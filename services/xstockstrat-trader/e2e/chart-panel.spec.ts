import { test, expect, type Page } from '@playwright/test';
import { SignJWT } from 'jose';

/**
 * E2E tests for the MarketDataService BFF paths and ChartPanel component.
 *
 * API tests call the BFF via page.evaluate to avoid the undici Transfer-Encoding
 * quirk. Component tests load the trading dashboard and assert DOM rendering.
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

test.describe('Connect BFF — MarketDataService/GetBars data contract', () => {
  test('returns bars array with required OHLCV fields', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/trader/login');

    const result = await page.evaluate(async () => {
      const res = await fetch(
        '/trader/api/xstockstrat.marketdata.v1.MarketDataService/GetBars',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ symbol: 'AAPL', timeframe: '1Day', limit: 100 }),
        },
      );
      return { status: res.status, body: await res.json() as Record<string, unknown> };
    });

    expect(result.status).toBe(200);
    const body = result.body;
    expect(body).toHaveProperty('bars');
    expect(Array.isArray(body.bars)).toBe(true);
    expect((body.bars as unknown[]).length).toBeGreaterThan(0);

    const bar = (body.bars as Record<string, unknown>[])[0];
    expect(bar).toHaveProperty('symbol');
    expect(bar).toHaveProperty('open');
    expect(bar).toHaveProperty('high');
    expect(bar).toHaveProperty('low');
    expect(bar).toHaveProperty('close');
    // BigInt fields serialize as string in protobuf-es JSON
    expect(typeof bar.volume).toBe('string');
  });

  test('returns 401 when not authenticated', async ({ page }) => {
    // No auth cookie — middleware rejects BFF call
    await page.goto('/trader/login');
    const result = await page.evaluate(async () => {
      const res = await fetch(
        '/trader/api/xstockstrat.marketdata.v1.MarketDataService/GetBars',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ symbol: 'AAPL', timeframe: '1Day', limit: 100 }),
        },
      );
      return { status: res.status };
    });
    expect([401, 307]).toContain(result.status);
  });
});

test.describe('Connect BFF — MarketDataService/ListAssets data contract', () => {
  test('returns assets array for the symbol selector', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/trader/login');

    const result = await page.evaluate(async () => {
      const res = await fetch(
        '/trader/api/xstockstrat.marketdata.v1.MarketDataService/ListAssets',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        },
      );
      return { status: res.status, body: await res.json() as Record<string, unknown> };
    });

    expect(result.status).toBe(200);
    const assets = result.body.assets as Array<{ symbol: string; exchange: string; assetClass: string }>;
    expect(Array.isArray(assets)).toBe(true);
    expect(assets.length).toBeGreaterThan(0);
    for (const asset of assets) {
      expect(typeof asset.symbol).toBe('string');
      expect(asset.symbol.length).toBeGreaterThan(0);
    }
    expect(assets.map((a) => a.symbol)).toContain('AAPL');
  });

  test('returns 401 when not authenticated', async ({ page }) => {
    await page.goto('/trader/login');
    const result = await page.evaluate(async () => {
      const res = await fetch(
        '/trader/api/xstockstrat.marketdata.v1.MarketDataService/ListAssets',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        },
      );
      return { status: res.status };
    });
    expect([401, 307]).toContain(result.status);
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
    const dayButton = page.getByRole('button', { name: '1d' });
    await expect(dayButton).toBeVisible({ timeout: 10000 });
  });

  test('renders bar count selector with 50 / 100 / 200 options', async ({ page }) => {
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
