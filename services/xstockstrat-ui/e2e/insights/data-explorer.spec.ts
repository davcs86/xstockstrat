import { test, expect, type Page, type Route } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { addAuthCookie } from '../helpers/auth';
import {
  DE_ASSETS_WIRE,
  DE_BARS_AAPL_PAGE1,
  DE_BARS_AAPL_PAGE2,
  DE_BARS_EMPTY,
  DE_HIST_AAPL_PAGE1,
  DE_HIST_AAPL_PAGE2,
  DE_SNAPSHOT_AAPL,
} from '../fixtures/historicalFundamentals';

/**
 * E2E for the Data Explorer (feature 204). The marketdata reads are stubbed at the browser level via
 * `page.route()` (like backfills/formulas specs) so pagination, empty results, and the missing-metric
 * case are deterministic. Timestamps in the fulfilled bodies are RFC3339 strings — the Connect-JSON
 * wire shape the browser client parses back to `{seconds,nanos}` (see backtest-coverage.spec.ts).
 * The page auto-selects the first listed asset (AAPL), so no combobox interaction is needed.
 */

const MarketDataPath = (m: string) => `**/xstockstrat.marketdata.v1.MarketDataService/${m}`;

async function fulfillJson(route: Route, body: unknown) {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

// Captured page sizes so a test can assert the client's per-page cap (AC-8/AC-20).
type Caps = { bars: number; hist: number };

function reqPage(route: Route): { pageSize: number; pageToken: string } {
  const body = route.request().postDataJSON() as {
    page?: { pageSize?: number; pageToken?: string };
  } | null;
  return { pageSize: body?.page?.pageSize ?? 0, pageToken: body?.page?.pageToken ?? '' };
}

async function setupRoutes(page: Page, caps: Caps) {
  await page.route(MarketDataPath('ListAssets'), (route) => fulfillJson(route, DE_ASSETS_WIRE));
  await page.route(MarketDataPath('GetBars'), (route) => {
    const { pageSize, pageToken } = reqPage(route);
    caps.bars = Math.max(caps.bars, pageSize);
    return fulfillJson(route, pageToken ? DE_BARS_AAPL_PAGE2 : DE_BARS_AAPL_PAGE1);
  });
  await page.route(MarketDataPath('GetFundamentals'), (route) =>
    fulfillJson(route, DE_SNAPSHOT_AAPL),
  );
  await page.route(MarketDataPath('GetHistoricalFundamentals'), (route) => {
    const { pageSize, pageToken } = reqPage(route);
    caps.hist = Math.max(caps.hist, pageSize);
    return fulfillJson(route, pageToken ? DE_HIST_AAPL_PAGE2 : DE_HIST_AAPL_PAGE1);
  });
}

async function openFundamentals(page: Page) {
  await expect(page.getByTestId('data-explorer-page')).toBeVisible({ timeout: 20000 });
  await page.getByRole('tab', { name: 'Fundamentals' }).click();
}

test.describe('Data Explorer — OHLCV tab', () => {
  test('AC-1/AC-8/AC-11/AC-16: table, chart, pagination, last-refresh, CSV', async ({ page }) => {
    await addAuthCookie(page);
    const caps: Caps = { bars: 0, hist: 0 };
    await setupRoutes(page, caps);
    await page.goto('/insights/data-explorer');

    const table = page.getByTestId('de-bars-table');
    await expect(table).toBeVisible({ timeout: 20000 });
    // AC-1: OHLCV columns + a bar value + a chart.
    for (const h of ['Time', 'Open', 'High', 'Low', 'Close', 'Volume']) {
      await expect(table.getByText(h, { exact: true })).toBeVisible();
    }
    await expect(table).toContainText('2024-01-03');
    await expect(table).toContainText('188.1');
    await expect(page.getByTestId('de-bars-chart').locator('svg')).toBeVisible();

    // AC-11: last-refreshed reflects the newest bar time in the page.
    await expect(page.getByTestId('de-bars-refreshed')).toContainText('2024-01-03');

    // AC-16: CSV export triggers a download with the right filename + header row.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('de-bars-csv').click(),
    ]);
    expect(download.suggestedFilename()).toBe('AAPL_1Day_bars.csv');
    const csv = readFileSync(await download.path(), 'utf8');
    expect(csv.split('\n')[0]).toBe('time,open,high,low,close,volume');
    expect(csv).toContain('188.1');

    // AC-8: Load More fetches the next page (≤ 500 bars requested per page).
    await expect(table).not.toContainText('2024-01-04');
    await page.getByTestId('de-bars-loadmore').click();
    await expect(table).toContainText('2024-01-04');
    expect(caps.bars).toBeGreaterThan(0);
    expect(caps.bars).toBeLessThanOrEqual(500);
  });

  test('AC-2: empty OHLCV result shows the empty state', async ({ page }) => {
    await addAuthCookie(page);
    const caps: Caps = { bars: 0, hist: 0 };
    await setupRoutes(page, caps);
    // Override GetBars to an empty page (last-registered route wins).
    await page.route(MarketDataPath('GetBars'), (route) => fulfillJson(route, DE_BARS_EMPTY));
    await page.goto('/insights/data-explorer');

    await expect(page.getByText('No OHLCV data found for the selected criteria')).toBeVisible({
      timeout: 20000,
    });
    await expect(page.getByTestId('de-bars-table')).toHaveCount(0);
  });
});

test.describe('Data Explorer — Fundamentals tab', () => {
  test('AC-3/AC-12/AC-17: snapshot card, last-refresh from as_of, CSV', async ({ page }) => {
    await addAuthCookie(page);
    const caps: Caps = { bars: 0, hist: 0 };
    await setupRoutes(page, caps);
    await page.goto('/insights/data-explorer');
    await openFundamentals(page);

    // AC-3: snapshot metrics.
    const snap = page.getByTestId('de-fund-snapshot');
    await expect(snap).toBeVisible({ timeout: 20000 });
    await expect(snap).toContainText('P/E');
    await expect(snap).toContainText('31.4');
    await expect(snap).toContainText('Market Cap');

    // AC-12: last-refreshed from as_of (2024-05-01).
    await expect(page.getByTestId('de-fund-refreshed')).toContainText('2024-05-01');

    // AC-17: fundamentals CSV export.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('de-fund-csv').click(),
    ]);
    expect(download.suggestedFilename()).toBe('AAPL_fundamentals_snapshot.csv');
    const csv = readFileSync(await download.path(), 'utf8');
    expect(csv.split('\n')[0]).toContain('symbol,as_of');
  });

  test('AC-4/AC-15/AC-20/AC-22: historical table, chart, pagination, missing metric', async ({
    page,
  }) => {
    await addAuthCookie(page);
    const caps: Caps = { bars: 0, hist: 0 };
    await setupRoutes(page, caps);
    await page.goto('/insights/data-explorer');
    await openFundamentals(page);
    await page.getByRole('tab', { name: 'Historical' }).click();

    const table = page.getByTestId('de-hist-table');
    // AC-4: rows for multiple periods.
    await expect(table).toBeVisible({ timeout: 20000 });
    await expect(table).toContainText('Q1-2024');
    await expect(table).toContainText('Q2-2024');

    // AC-15: the time-series chart renders.
    await expect(page.getByTestId('de-hist-chart').locator('svg')).toBeVisible();

    // AC-22: the Q1-2024 period is missing pe_ratio → its cell renders `—`.
    const q1Row = table.locator('tr', { hasText: 'Q1-2024' });
    await expect(q1Row).toContainText('—');
    // The full-data Q2-2024 row shows its P/E value, not a dash-for-everything artifact.
    await expect(table.locator('tr', { hasText: 'Q2-2024' })).toContainText('30.2');

    // AC-20: Load More fetches the next page (≤ 50 periods requested per page).
    await expect(table).not.toContainText('FY2023');
    await page.getByTestId('de-hist-loadmore').click();
    await expect(table).toContainText('FY2023');
    expect(caps.hist).toBeGreaterThan(0);
    expect(caps.hist).toBeLessThanOrEqual(50);
  });
});

test.describe('Data Explorer — navigation (AC-10)', () => {
  test('reachable from the insights Section nav', async ({ page }) => {
    await addAuthCookie(page);
    // No route stubs — the insights mock backend serves the page on navigation.
    await page.goto('/insights/strategies');
    const sectionNav = page.getByRole('navigation', { name: 'Section' });
    const link = sectionNav.getByRole('link', { name: 'Data Explorer' });
    await expect(link).toBeVisible({ timeout: 20000 });
    await link.click();
    await expect(page).toHaveURL(/\/insights\/data-explorer/);
    await expect(page.getByRole('heading', { name: 'Data Explorer' })).toBeVisible({
      timeout: 20000,
    });
  });
});
