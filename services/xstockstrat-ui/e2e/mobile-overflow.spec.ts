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
  { path: '/insights/market/AAPL' },
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
