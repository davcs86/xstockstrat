import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';

/**
 * Symbol page section-nav (feature 139) — the sticky segmented anchor-nav on
 * `/trader/positions/[symbol]`. All sections stay mounted (see position-detail.spec.ts for the
 * content assertions); these cases cover the nav's own behavior: inbound `#hash` deep-link, the
 * `?strategy=` non-regression under a bare-hash `history.replaceState`, and the scroll-spy that
 * keeps the active chip truthful during free scroll. Domain data comes from the shared mock
 * backend's AAPL fixtures (e2e/fixtures/positions.ts) — no inline domain literals.
 */
test.describe('Symbol section nav', () => {
  test('an inbound #hash deep-links to that group on load', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/trader/positions/AAPL#analysis');

    const nav = page.getByRole('navigation', { name: 'Symbol navigation' });
    await expect(nav).toBeVisible({ timeout: 30000 });
    // The mount effect reads window.location.hash and activates that group (a ToggleGroup
    // type="single" renders radios — the active one is checked).
    await expect(nav.getByRole('radio', { name: 'Analysis', exact: true })).toBeChecked({
      timeout: 10000,
    });
  });

  test('a bare-#hash nav click preserves the ?strategy= query seed (AC-4)', async ({ page }) => {
    await addAuthCookie(page);
    await watchlist(page, 'AAPL', 'strat-live-001'); // watchlisted → the Readiness branch renders
    await page.goto('/trader/positions/AAPL?strategy=strat-live-001#overview');

    // The ?strategy= seed still reaches SignalReadiness (read on mount via useSearchParams) — the
    // hash never touched the query string.
    await expect(page.getByTestId('signal-readiness').getByText('Why this fired')).toBeVisible({
      timeout: 30000,
    });
    await expect(page.getByText('2/3 conditions')).toBeVisible({ timeout: 10000 });

    // Clicking another chip writes history.replaceState(null,'','#id') — a BARE hash — so the
    // ?strategy= query must survive in the URL.
    await page
      .getByRole('navigation', { name: 'Symbol navigation' })
      .getByRole('radio', { name: 'Analysis', exact: true })
      .click();
    await expect
      .poll(() => new URL(page.url()).searchParams.get('strategy'), { timeout: 10000 })
      .toBe('strat-live-001');
    // And the readiness seed is undisturbed.
    await expect(page.getByText('2/3 conditions')).toBeVisible();
  });

  test('scroll-spy flips the active chip as a lower section scrolls into view (FR-2)', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await page.goto('/trader/positions/AAPL');

    const nav = page.getByRole('navigation', { name: 'Symbol navigation' });
    await expect(nav).toBeVisible({ timeout: 30000 });
    // Overview is active (checked) at the top of the page.
    await expect(nav.getByRole('radio', { name: 'Overview', exact: true })).toBeChecked();

    // Scroll a lower section into view WITHOUT clicking a chip — the scroll-spy must flip the active
    // chip to that group on its own (that is what makes FR-2 true under free scroll). Target Trade
    // (the second section): with Research + Analysis below it, the page always has room to scroll its
    // top clearly ABOVE the offset line (60px above, past both the 93/129px breakpoint insets) so the
    // "scrolled-past" read is unambiguous, never a knife-edge on the offset line. A radiogroup is
    // single-select, so this checked assertion also proves Overview is no longer active.
    await page.evaluate(() => {
      const el = document.getElementById('trade');
      if (el) window.scrollTo(0, window.scrollY + el.getBoundingClientRect().top - 60);
    });
    await expect(nav.getByRole('radio', { name: 'Trade', exact: true })).toBeChecked({
      timeout: 10000,
    });
  });
});

/** Route the browser's ListWatchlists to a single watchlist containing `symbol` (bound to
 *  `strategyId`) so the FR-11 gate takes the watchlisted branch (mirrors position-detail.spec.ts). */
async function watchlist(page: Page, symbol: string, strategyId = 'strat-live-001'): Promise<void> {
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
            bindings: [{ symbol, strategyId }],
          },
        ],
      }),
    });
  });
}
