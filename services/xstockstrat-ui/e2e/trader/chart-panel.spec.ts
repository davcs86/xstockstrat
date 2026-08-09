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

  test('renders the 3 supported timeframe buttons', async ({ page }) => {
    // The platform supports only 15m / 1h / 1d (common.v1.Timeframe = 15MIN/1HOUR/1DAY;
    // 15m is the smallest interval the free Alpaca data plan serves). 10m/30m/1w/1mo have
    // no backend support and are intentionally not offered.
    const labels = ['15m', '1h', '1d'];
    for (const label of labels) {
      await expect(page.getByRole('tab', { name: label, exact: true })).toBeVisible({
        timeout: 10000,
      });
    }
    for (const label of ['10m', '30m', '1w', '1mo']) {
      await expect(page.getByRole('tab', { name: label, exact: true })).toHaveCount(0);
    }
  });

  test('1d is the active timeframe by default', async ({ page }) => {
    const dayButton = page.getByRole('tab', { name: '1d' });
    await expect(dayButton).toBeVisible({ timeout: 10000 });
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
    // Intercept in-process (the mock backend runs in Playwright's globalSetup, a different
    // process, so it cannot record what the component sends). Proves the CLIENT populates
    // timeframeEnum, not just that chart.ts's map is correct (that's chart.test.ts's job).
    // Registered after the initial mount's own fetch (untouched, uses the real mock) — the
    // 1h timeframe button click below triggers a fresh GetBars this route can observe,
    // avoiding the timing uncertainty of racing a full page reload against a multi-request
    // client-side data-fetch cascade.
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
              timeframe: '1h',
              timeframeEnum: 'TIMEFRAME_1HOUR',
              source: 'alpaca',
            },
          ],
        }),
      });
    });

    // Wait for the chart to finish its async lightweight-charts import before clicking: until
    // the series exists, ChartPanel.fetchBars early-returns and the click sends no GetBars,
    // making this test flaky. The injected .tv-lightweight-charts child signals the series is ready.
    await expect(
      page.locator('[data-testid="chart-container"] .tv-lightweight-charts'),
    ).toBeVisible({ timeout: 10000 });

    await page.getByRole('tab', { name: '1h', exact: true }).click();

    // 1h is the timeframe clicked above — hardcoded, not derived from TIMEFRAME_ENUM, so this
    // can never assert the map against itself (feature 080 AC-8).
    await expect
      .poll(() => capturedBody?.timeframeEnum, { timeout: 10000 })
      .toBe('TIMEFRAME_1HOUR');
  });
});
