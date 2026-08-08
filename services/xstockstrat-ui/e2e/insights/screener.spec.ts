import { test, expect, type Page } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';
import { mockWatchlists } from '../helpers/watchlistMock';

// A controlled ScreenSymbols response (connect-JSON, camelCase) + capture of the sent request, so
// the weight/hard-filter wire assertions (feature 098, FR-1/FR-2) don't depend on the global mock.
function mockScreen(page: Page, captured: { req?: Record<string, unknown> }) {
  return page.route('**/xstockstrat.analysis.v1.AnalysisService/ScreenSymbols', (route) => {
    captured.req = JSON.parse(route.request().postData() ?? '{}');
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [
          { symbol: 'AAA', score: 0.91, passed: true, status: 1, criterionScores: { c1: 0.9 } },
          { symbol: 'BBB', score: 0.72, passed: true, status: 1, criterionScores: { c1: 0.7 } },
          { symbol: 'CCC', score: 0.55, passed: true, status: 1, criterionScores: { c1: 0.5 } },
        ],
        coverageGaps: [],
      }),
    });
  });
}

/**
 * E2E for feature 060 (screener-engine), Acceptance #6.
 *
 * The insights mock backend returns a deterministic ranked ScreenSymbolsResponse (3 results,
 * score-ordered, one INSUFFICIENT_DATA). The screener page must render the ranked table and
 * surface the loading + insufficient-data states.
 */
test.describe('Screener', () => {
  test('runs a scan and renders a ranked results table', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/insights/screener');

    await expect(page.getByRole('heading', { name: 'Screener' })).toBeVisible({ timeout: 5000 });

    // Default criterion is present; run the scan against the default symbols.
    await page.getByTestId('run-screen').click();

    const results = page.getByTestId('screen-results');
    await expect(results).toBeVisible({ timeout: 10000 });

    // Three ranked rows, score-ordered (highest first).
    const rows = page.getByTestId('result-row');
    await expect(rows).toHaveCount(3);
    await expect(rows.first()).toContainText('AAPL');

    // The third symbol is reported as insufficient data (not dropped).
    await expect(page.getByTestId('insufficient-data')).toBeVisible();
  });

  test('shows "Fundamentals pending" (not the generic bars message) when a fundamental criterion has no gap', async ({
    page,
  }) => {
    // INSUFFICIENT_DATA with no `gap` is the fundamentals-unavailable case (screener.py never
    // attaches a CoverageGap for it — that message is bars-specific); the UI must tell it apart
    // from the bars-insufficient case (which does carry a gap) rather than showing one generic
    // "Insufficient data" label for both.
    await addAuthCookie(page);
    await page.route('**/xstockstrat.analysis.v1.AnalysisService/ScreenSymbols', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          results: [{ symbol: 'AAA', score: 0, passed: false, status: 2 }],
          coverageGaps: [],
        }),
      }),
    );
    await page.goto('/insights/screener');
    await page.getByTestId('run-screen').click();
    await expect(page.getByTestId('screen-results')).toBeVisible({ timeout: 10000 });

    await expect(page.getByTestId('fundamentals-pending')).toBeVisible();
    await expect(page.getByTestId('insufficient-data')).toHaveCount(0);
    await expect(page.getByTestId('fundamentals-pending-banner')).toContainText(
      "isn't available right now for any symbol",
    );
  });

  test('renders the feature-083 raw columns (pe / rsi / atr / rev-growth / held)', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await page.goto('/insights/screener');
    await page.getByTestId('run-screen').click();
    const results = page.getByTestId('screen-results');
    await expect(results).toBeVisible({ timeout: 10000 });
    // New column headers.
    await expect(results.getByText('P/E')).toBeVisible();
    await expect(results.getByText('RSI')).toBeVisible();
    await expect(results.getByText('Rev growth')).toBeVisible();
    // The top row carries its raw values + the Held badge.
    const first = page.getByTestId('result-row').first();
    await expect(first).toContainText('22.5'); // P/E
    await expect(first).toContainText('58'); // RSI
    await expect(first.getByText('Held')).toBeVisible();
  });

  test('the 10-column results table does not overflow the phone frame', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await addAuthCookie(page);
    await page.goto('/insights/screener');
    await page.getByTestId('run-screen').click();
    await expect(page.getByTestId('screen-results')).toBeVisible({ timeout: 10000 });

    // The page body must not scroll horizontally — the wide table scrolls inside its own
    // overflow-x container instead (regression guard for the raw-table overflow bug).
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1); // allow sub-pixel rounding
  });

  test('sends an edited criterion weight on the wire, not the hardcoded 1 (feature 098, FR-1)', async ({
    page,
  }) => {
    await addAuthCookie(page);
    const captured: { req?: Record<string, unknown> } = {};
    await mockScreen(page, captured);
    await page.goto('/insights/screener');
    await expect(page.getByRole('heading', { name: 'Screener' })).toBeVisible({ timeout: 5000 });

    // Edit the weight to 0.5 (default is 1) via the numeric input, then scan.
    await page.getByLabel('weight', { exact: true }).fill('0.5');
    await page.getByTestId('run-screen').click();
    await expect(page.getByTestId('screen-results')).toBeVisible({ timeout: 10000 });

    const criteria = captured.req?.criteria as Array<{ weight: number }>;
    expect(criteria[0].weight).toBe(0.5);
    expect(criteria[0].weight).not.toBe(1);
  });

  test('the hard/rank toggle flips the sent hardFilter (feature 098, FR-2)', async ({ page }) => {
    await addAuthCookie(page);
    const captured: { req?: Record<string, unknown> } = {};
    await mockScreen(page, captured);
    await page.goto('/insights/screener');

    // Default is rank (hardFilter false); switch to hard, then scan.
    await page.getByRole('button', { name: 'hard filter' }).click();
    await page.getByTestId('run-screen').click();
    await expect(page.getByTestId('screen-results')).toBeVisible({ timeout: 10000 });

    const criteria = captured.req?.criteria as Array<{ hardFilter: boolean }>;
    expect(criteria[0].hardFilter).toBe(true);
  });

  test('a Technical indicator criterion sends component.indicator, not metricName (bug fix)', async ({
    page,
  }) => {
    await addAuthCookie(page);
    const captured: { req?: Record<string, unknown> } = {};
    await mockScreen(page, captured);
    await page.goto('/insights/screener');

    // Switch the default criterion's kind from Fundamental to Technical indicator, then scan.
    await page.getByLabel('kind').selectOption({ label: 'Technical indicator' });
    await page.getByLabel('metric').selectOption('RSI');
    await page.getByTestId('run-screen').click();
    await expect(page.getByTestId('screen-results')).toBeVisible({ timeout: 10000 });

    const criteria = captured.req?.criteria as Array<{
      metricName?: string;
      component?: { indicator?: string };
    }>;
    // Must NOT be sent as a bare metricName — that only resolves fundamentals fields and would
    // silently skip an indicator criterion, letting a hard filter like "rsi < 30" pass unchecked.
    expect(criteria[0].metricName ?? '').toBe('');
    expect(criteria[0].component?.indicator).toBe('RSI');
  });

  test('shows last-run metadata after a scan (feature 098, FR-4)', async ({ page }) => {
    await addAuthCookie(page);
    await mockScreen(page, {});
    await page.goto('/insights/screener');

    await page.getByTestId('run-screen').click();
    const lastRun = page.getByTestId('last-run');
    await expect(lastRun).toBeVisible({ timeout: 10000 });
    await expect(lastRun).toContainText('last run');
    // Default symbol box "AAPL MSFT GOOG" → 3 symbols.
    await expect(lastRun).toContainText('3 symbols');
  });

  test('Save as watchlist seeds a new list from the results (feature 098, FR-5)', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await mockScreen(page, {});
    let createReq: { name?: string; symbols?: string[] } = {};
    await page.route('**/xstockstrat.portfolio.v1.PortfolioService/ListWatchlists', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"watchlists":[]}' }),
    );
    await page.route('**/xstockstrat.portfolio.v1.PortfolioService/CreateWatchlist', (route) => {
      createReq = JSON.parse(route.request().postData() ?? '{}');
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ watchlist: { watchlistId: 'wl-1', name: createReq.name } }),
      });
    });
    await page.goto('/insights/screener');

    await page.getByTestId('run-screen').click();
    await expect(page.getByTestId('screen-results')).toBeVisible({ timeout: 10000 });

    // No hard filter → all result symbols are seeded.
    await expect(page.getByTestId('save-as-watchlist')).toContainText('Save 3 as watchlist');
    await page.getByLabel('new watchlist name').fill('From Screener');
    await page.getByTestId('save-as-watchlist').click();

    await expect.poll(() => createReq.name).toBe('From Screener');
    expect(createReq.symbols).toEqual(['AAA', 'BBB', 'CCC']);
  });

  test('Add top-N adds the top-ranked symbols to a chosen list (feature 098, FR-6)', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await mockScreen(page, {});
    let addReq: { watchlistId?: string; symbols?: string[] } = {};
    await mockWatchlists(page); // stateful — but we pre-seed one list via a create below
    await page.route(
      '**/xstockstrat.portfolio.v1.PortfolioService/AddWatchlistSymbols',
      (route) => {
        addReq = JSON.parse(route.request().postData() ?? '{}');
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            watchlist: { watchlistId: addReq.watchlistId, symbols: addReq.symbols },
          }),
        });
      },
    );
    await page.goto('/insights/watchlists');
    // Pre-create a target list so the screener's target-list picker has an option.
    await page.getByPlaceholder('e.g. Tech Large-Cap').fill('Target List');
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByRole('heading', { name: 'Target List' })).toBeVisible({ timeout: 5000 });

    await page.goto('/insights/screener');
    await page.getByTestId('run-screen').click();
    await expect(page.getByTestId('screen-results')).toBeVisible({ timeout: 10000 });

    // Pick the target list, then add the top-N (3 results here → all three).
    await page.getByLabel('Target watchlist').click();
    await page.getByRole('option', { name: 'Target List' }).click();
    await page.getByTestId('add-top-n').click();

    await expect.poll(() => addReq.symbols).toEqual(['AAA', 'BBB', 'CCC']);
  });
});
