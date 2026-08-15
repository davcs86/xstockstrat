import { test, expect } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';

/**
 * Single-Position page (feature 096) — the dedicated `/trader/positions/[symbol]` view built from
 * the enriched `Position` risk fields (GetPosition), the per-symbol Orders & fills (ListOrders w/
 * symbol filter), and the marketdata chart. Data comes from the shared mock backend
 * (e2e/fixtures/positions.ts): AAPL carries factor 'Tech', a resting stop (flag STOP_NEAR) and
 * unrealizedPnl 100.0 (parity with the Exposure list + Portfolio); MSFT carries no risk metadata.
 * The account context auto-selects the first active broker account, so GetPosition is issued
 * without any manual selection.
 */
test.describe('Single Position page', () => {
  test('renders the risk-framed header, stat grid, risk sidebar and orders table', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await page.goto('/trader/positions/AAPL');

    // Header + stat grid — AAPL, big Unrealized (parity value), risk framing. Generous first-hit
    // timeout: the first client RPC through the trader BFF compiles its route on a cold server.
    await expect(page.getByText('AAPL').first()).toBeVisible({ timeout: 30000 });
    // AC-3 valuation parity: the Position page shows AAPL unrealized P&L = +$100.00, the same
    // value the Exposure list and Portfolio report (one broker-authoritative source).
    await expect(page.getByText('+$100.00').first()).toBeVisible();
    await expect(page.getByText('Open R')).toBeVisible();

    // Risk & exit sidebar — factor, flag, exit rule from the enriched Position.
    await expect(page.getByText('Risk & exit')).toBeVisible();
    await expect(page.getByText('Tech', { exact: true })).toBeVisible();
    await expect(page.getByText('Stop near')).toBeVisible();

    // Bracket leg order IDs (feature 030) — AAPL carries a confirmed resting bracket.
    await expect(page.getByText('Stop order')).toBeVisible();
    await expect(page.getByText('ord-stop-778')).toBeVisible();
    await expect(page.getByText('Take-profit order')).toBeVisible();
    await expect(page.getByText('ord-tp-779')).toBeVisible();

    // Per-symbol Orders & fills table (ListOrders filtered to AAPL → the filled AAPL order).
    await expect(page.getByText('Orders & fills · AAPL')).toBeVisible();
  });

  test('a position with no resting stop renders the no-stop fallbacks (no fabricated values)', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await page.goto('/trader/positions/MSFT');

    await expect(page.getByText('MSFT').first()).toBeVisible({ timeout: 30000 });
    // MSFT carries no stopPrice → the risk sidebar shows "no stop set", never a fabricated 0.
    await expect(page.getByText('no stop set').first()).toBeVisible();
    // MSFT carries no bracket (feature 030) → both leg-order rows fall back to the em-dash.
    await expect(page.getByText('Stop order')).toBeVisible();
    await expect(page.getByText('Take-profit order')).toBeVisible();
  });

  test('is reachable from the Exposure list by clicking a position symbol (C-10(a))', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await page.goto('/trader/positions');

    // The Exposure table's AAPL symbol links to the dedicated page.
    await page.getByRole('link', { name: 'AAPL', exact: true }).click();
    await expect(page).toHaveURL(/\/trader\/positions\/AAPL/);
    await expect(page.getByText('Risk & exit')).toBeVisible({ timeout: 30000 });
  });

  test('an unheld symbol still renders the chart, orders and trade sections (feature 125)', async ({
    page,
  }) => {
    await addAuthCookie(page);
    // ZZZZ is absent from the position fixtures → GetPosition returns NotFound.
    await page.goto('/trader/positions/ZZZZ');

    // The not-found state is a compact inline notice, NOT a page takeover.
    await expect(page.getByText(/position in ZZZZ/).first()).toBeVisible({ timeout: 30000 });

    // The research sections render for the unheld symbol (hoisted independent of position):
    // price chart, per-symbol orders, and the inline trade widget.
    await expect(page.getByText('Price · ZZZZ')).toBeVisible();
    await expect(page.getByText('Orders & fills · ZZZZ')).toBeVisible();
    await expect(page.getByText('Trade ZZZZ')).toBeVisible();

    // The position-specific sidebar (Risk & exit) is absent for an unheld symbol.
    await expect(page.getByText('Risk & exit')).toHaveCount(0);
  });

  test('a NotFound position shows the notice, not the generic error paragraph (render-order fix)', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await page.goto('/trader/positions/ZZZZ');

    await expect(page.getByText(/position in ZZZZ/).first()).toBeVisible({ timeout: 30000 });
    // A NotFound is not an error — the "Failed to load position" paragraph must not appear.
    await expect(page.getByText(/Failed to load position/)).toHaveCount(0);
  });

  test('a watchlisted symbol renders the Opportunity + Readiness sections (FR-11 watchlisted branch)', async ({
    page,
  }) => {
    await addAuthCookie(page);
    // Seed AAPL into a watchlist (bound to a live strategy) so the FR-11 gate takes the
    // watchlisted branch (Opportunity + Readiness), not the Screening branch.
    await watchlist(page, 'AAPL');
    await page.goto('/trader/positions/AAPL');

    await expect(page.getByText('Opportunity').first()).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('Why this fired')).toBeVisible({ timeout: 10000 });
  });

  test('a non-watchlisted symbol hides the Opportunity + Readiness sections (FR-11 gate)', async ({
    page,
  }) => {
    await addAuthCookie(page);
    // Default mock returns no watchlists → AAPL is not watchlisted → the watchlisted branch's
    // Opportunity/Readiness must be absent (the Screening branch arrives in Step 16).
    await page.goto('/trader/positions/AAPL');

    // Wait for the page to render (the position header), then assert the gated sections are absent.
    await expect(page.getByText('Risk & exit')).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('Why this fired')).toHaveCount(0);
    await expect(page.getByText('Opportunity', { exact: true })).toHaveCount(0);
  });

  test('the Fundamentals section renders metrics for a watchlisted symbol with data (FR-7)', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await watchlist(page, 'AAPL'); // AAPL watchlisted → the fundamentals branch renders
    await page.goto('/trader/positions/AAPL');

    await expect(page.getByRole('heading', { name: 'Fundamentals' })).toBeVisible({
      timeout: 30000,
    });
    // Metric labels + a value from FUNDAMENTALS_AAPL (P/E 31.40).
    await expect(page.getByText('P/E')).toBeVisible();
    await expect(page.getByText('31.40')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('ROE')).toBeVisible();
  });

  test('the Fundamentals section shows an explicit no-data state when the provider has none', async ({
    page,
  }) => {
    await addAuthCookie(page);
    // MSFT is held (so the page loads) and watchlisted here, but the mock has no fundamentals for
    // it → the section shows the explicit no-data message, never fabricated zeros.
    await watchlist(page, 'MSFT');
    await page.goto('/trader/positions/MSFT');

    await expect(page.getByRole('heading', { name: 'Fundamentals' })).toBeVisible({
      timeout: 30000,
    });
    await expect(page.getByText(/No fundamentals data for MSFT/)).toBeVisible({ timeout: 10000 });
  });
});

/** Route the browser's ListWatchlists to a single watchlist containing `symbol` (bound to a live
 *  strategy), so the FR-11 gate takes the watchlisted branch. */
async function watchlist(page: import('@playwright/test').Page, symbol: string): Promise<void> {
  await page.route('**/xstockstrat.portfolio.v1.PortfolioService/ListWatchlists', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        watchlists: [
          {
            watchlistId: 'wl-1',
            name: 'My list',
            symbols: [symbol],
            bindings: [{ symbol, strategyId: 'strat-live-001' }],
          },
        ],
      }),
    });
  });
}
