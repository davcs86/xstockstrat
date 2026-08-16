import { test, expect } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';

/**
 * E2E tests for the MarketDataService BFF paths and ChartPanel component.
 *
 * API tests call the BFF via page.evaluate to avoid the undici Transfer-Encoding
 * quirk. Component tests load the trading dashboard and assert DOM rendering.
 */

test.describe('Connect BFF — MarketDataService/GetBars data contract', () => {
  test('returns bars array with required OHLCV fields', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/auth/login');

    const result = await page.evaluate(async () => {
      const res = await fetch('/trader/api/xstockstrat.marketdata.v1.MarketDataService/GetBars', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          symbol: 'AAPL',
          timeframe: '1Day',
          timeframeEnum: 'TIMEFRAME_1DAY',
          limit: 100,
        }),
      });
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
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

  test('returns auth error when not authenticated', async ({ page }) => {
    // No auth cookie — middleware redirects to login page (HTML) or BFF returns Connect error.
    // Either way the response body must not contain bar data.
    await page.goto('/auth/login');
    const result = await page.evaluate(async () => {
      const res = await fetch('/trader/api/xstockstrat.marketdata.v1.MarketDataService/GetBars', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          symbol: 'AAPL',
          timeframe: '1Day',
          timeframeEnum: 'TIMEFRAME_1DAY',
          limit: 100,
        }),
      });
      const text = await res.text();
      return { hasValidData: text.includes('"bars"') };
    });
    expect(result.hasValidData).toBe(false);
  });
});

test.describe('Connect BFF — MarketDataService/ListAssets data contract', () => {
  test('returns assets array for the symbol selector', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/auth/login');

    const result = await page.evaluate(async () => {
      const res = await fetch(
        '/trader/api/xstockstrat.marketdata.v1.MarketDataService/ListAssets',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        },
      );
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    });

    expect(result.status).toBe(200);
    const assets = result.body.assets as Array<{
      symbol: string;
      exchange: string;
      assetClass: string;
    }>;
    expect(Array.isArray(assets)).toBe(true);
    expect(assets.length).toBeGreaterThan(0);
    for (const asset of assets) {
      expect(typeof asset.symbol).toBe('string');
      expect(asset.symbol.length).toBeGreaterThan(0);
    }
    expect(assets.map((a) => a.symbol)).toContain('AAPL');
  });

  test('returns auth error when not authenticated', async ({ page }) => {
    await page.goto('/auth/login');
    const result = await page.evaluate(async () => {
      const res = await fetch(
        '/trader/api/xstockstrat.marketdata.v1.MarketDataService/ListAssets',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        },
      );
      const text = await res.text();
      return { hasValidData: text.includes('"assets"') };
    });
    expect(result.hasValidData).toBe(false);
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

  test('renders no timeframe selector (single 1d-only support, feature 143)', async ({ page }) => {
    // Chart panel loads with the chart card visible but no tab-role timeframe switcher —
    // only 1d is supported platform-wide, so the selector was removed entirely (not left
    // disabled with a single option).
    await expect(page.getByRole('heading', { name: /chart/i })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('tab')).toHaveCount(0);
  });

  test('renders bar count selector with 50 / 100 / 200 options', async ({ page }) => {
    // ChartPanel uses Radix Select for bar count — the trigger shows "100 bars" by default.
    // Radix hides the underlying native <select> (aria-hidden); verify the trigger is present.
    const trigger = page.getByText('100 bars', { exact: true });
    await expect(trigger).toBeVisible({ timeout: 10000 });
  });

  test('renders chart container after data loads', async ({ page }) => {
    // The chart mounts into the stable container div (data-testid); lightweight-charts then
    // injects a .tv-lightweight-charts child whose inline style also contains the 320 height,
    // so a style-based selector matches 1-or-2 elements by timing (strict-mode flake). Target
    // the container id, which is exactly one element whether or not the chart has drawn yet.
    const chartDiv = page.getByTestId('chart-container');
    await expect(chartDiv).toBeVisible({ timeout: 10000 });
  });

  test('sends timeframeEnum on the outbound GetBars request (AC-8)', async ({ page }) => {
    // Intercept in-process — proves the CLIENT populates timeframeEnum on its one and only
    // (mount-triggered) GetBars call, now that no tab click can trigger a second request.
    // Route registration BEFORE the goto below is required so the mount's own request is
    // captured (feature 143 removed the tab, so there is no click to observe a later request).
    let capturedBody: Record<string, unknown> | undefined;
    await page.route('**/xstockstrat.marketdata.v1.MarketDataService/GetBars', async (route) => {
      capturedBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          bars: [
            {
              symbol: 'AAPL',
              open: 188.0,
              high: 190.5,
              low: 187.2,
              close: 189.8,
              volume: '45000000',
              vwap: 189.1,
              tradeCount: 120000,
              timeframe: '1d',
              timeframeEnum: 'TIMEFRAME_1DAY',
              source: 'alpaca',
            },
          ],
        }),
      });
    });

    // Re-navigate with the route already registered so the mount's own GetBars is captured
    // (the describe's beforeEach navigated before this route existed). Cookies persist across
    // the goto, so no re-auth is needed.
    await page.goto('/trader/');

    await expect.poll(() => capturedBody?.timeframeEnum, { timeout: 10000 }).toBe('TIMEFRAME_1DAY');
  });
});
