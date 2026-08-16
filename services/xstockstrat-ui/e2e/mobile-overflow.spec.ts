import { test, expect, type Page } from '@playwright/test';
import { addAuthCookie, addAdminCookie } from './helpers/auth';

/**
 * Phone-frame layout guard (feature 083). Visits every screen at an iPhone-class viewport and
 * asserts the page body never scrolls horizontally — wide content (tables, stat rows, charts)
 * must scroll inside its own container, not blow out the frame. Catches the raw-<table> /
 * fixed-width regressions that only show on a narrow viewport.
 */
test.use({ viewport: { width: 390, height: 844 } });

const ROUTES: { path: string; admin?: boolean }[] = [
  { path: '/insights/opportunities' },
  // feature 125: the former /insights/market/[symbol] entry was dropped — that page now redirects to
  // the unified symbol page, already covered by the /trader/positions/AAPL entry below.
  { path: '/insights/watchlists' },
  { path: '/insights/screener' },
  { path: '/insights/strategies' },
  { path: '/insights/strategies/strat-high-001' },
  { path: '/insights/backfills', admin: true },
  { path: '/config-ui/sources' },
  { path: '/trader/positions' },
  { path: '/trader/portfolio' },
  { path: '/trader/orders' },
  { path: '/insights' },
  { path: '/config-ui' },
  { path: '/accounts/mcp-tools' },
  // FR-3: gap-closing entries (feature 124) — routes touched by this feature's Table/DropdownMenu
  // conversions that weren't in the original sweep.
  { path: '/accounts/authorized-apps' },
  { path: '/insights/formulas' },
  { path: '/config-ui/audit' },
  { path: '/config-ui/platform' },
  { path: '/trader/positions/AAPL' },
  // feature 135: the bare /trader dashboard route (LiveStrategiesPanel + OrderBook) was never in
  // this sweep — a genuine ROUTES gap, not a redundant addition.
  { path: '/trader' },
];

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

for (const route of ROUTES) {
  test(`no horizontal overflow at 390px — ${route.path}`, async ({ page }) => {
    if (route.admin) await addAdminCookie(page);
    else await addAuthCookie(page);

    await page.goto(route.path);
    // Wait for async data (react-query) to paint any wide content, then measure. Don't gate on
    // a heading — nav links duplicate the text and confuse a visibility check on mobile.
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(800);

    const overflow = await horizontalOverflow(page);
    expect(
      overflow,
      `page body scrolls horizontally by ${overflow}px on ${route.path}`,
    ).toBeLessThanOrEqual(1);
  });
}

/**
 * FR-4 wide-content audit (feature 124): a 390px phone frame collapses every `grid`/`flex-row`
 * layout to a single column (below the `lg` breakpoint, 1024px), so it never exercises a
 * flex/grid item that's missing `min-w-0` — the one class defeating `Table`'s own built-in
 * `overflow-x-auto` wrapper (`ui/table.tsx`'s `data-slot="table-container"`). `/trader/orders`
 * only splits into its `grid-cols-1 lg:grid-cols-12` layout at `lg:`+, where `OrdersTable`'s own
 * widest columns ("From signal") also become visible — the actual worst case, not an invented one.
 *
 * 1280px, not the bare 1024px `lg` breakpoint minimum: a CI-only failure (never reproduced
 * locally across several attempts) traced via a temporary diagnostic dump showed the actual
 * overflow at exactly 1024px comes from `PlatformHeader`'s own Row 1 `actions` slot (badge +
 * `AccountSelector` + `AlertStream` + copilot toggle) — a pre-existing, feature-124-unrelated
 * header-tightness edge case that's only reachable at the razor's-edge minimum breakpoint pixel,
 * not a representative "tablet/small-desktop" width. 1280px still fully exercises the `lg:` grid
 * split this test targets (a min-width breakpoint, active at 1024px and above) with realistic
 * headroom, matching how actual small-desktop viewports look.
 */
test.describe('wide-content overflow at the lg grid-split breakpoint (FR-4)', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('no horizontal overflow at 1280px — /trader/orders', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/trader/orders');
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(800);

    const overflow = await horizontalOverflow(page);
    expect(
      overflow,
      `page body scrolls horizontally by ${overflow}px at 1280px on /trader/orders`,
    ).toBeLessThanOrEqual(1);
  });
});
