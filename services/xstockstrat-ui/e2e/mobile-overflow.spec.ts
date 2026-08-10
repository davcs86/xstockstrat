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

/**
 * FR-4 wide-content audit (feature 124): a 390px phone frame collapses every `grid`/`flex-row`
 * layout to a single column (below the `lg` breakpoint, 1024px), so it never exercises a
 * flex/grid item that's missing `min-w-0` — the one class defeating `Table`'s own built-in
 * `overflow-x-auto` wrapper (`ui/table.tsx`'s `data-slot="table-container"`). `/trader/orders`
 * only splits into its `grid-cols-1 lg:grid-cols-12` layout at `lg:`+, where `OrdersTable`'s own
 * widest columns ("From signal") also become visible — the actual worst case, not an invented one.
 */
test.describe('wide-content overflow at the lg grid-split breakpoint (FR-4)', () => {
  test.use({ viewport: { width: 1024, height: 900 } });

  test('no horizontal overflow at 1024px — /trader/orders', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/trader/orders');
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(800);

    const overflow = await horizontalOverflow(page);

    // TEMP DIAGNOSTIC (feature 124): this test fails only in CI (18px), never locally — dump the
    // real offending elements from the actual CI browser so the cause can be pinpointed instead
    // of guessed at. Remove once root-caused.
    if (overflow > 1) {
      const diag = await page.evaluate(() => {
        const clientWidth = document.documentElement.clientWidth;
        const offenders: { tag: string; id: string; cls: string; right: number }[] = [];
        document.querySelectorAll('body *').forEach((el) => {
          const rect = el.getBoundingClientRect();
          if (rect.right > clientWidth + 1 && rect.width > 0) {
            // Skip elements nested inside their own horizontal-scroll container — expected.
            let scrollable = false;
            let p: HTMLElement | null = el.parentElement;
            while (p) {
              const cs = getComputedStyle(p);
              if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') {
                scrollable = true;
                break;
              }
              p = p.parentElement;
            }
            if (!scrollable) {
              offenders.push({
                tag: el.tagName,
                id: (el as HTMLElement).id,
                cls: (el as HTMLElement).className?.toString().slice(0, 100) ?? '',
                right: rect.right,
              });
            }
          }
        });
        offenders.sort((a, b) => b.right - a.right);
        return {
          clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
          offenders: offenders.slice(0, 10),
        };
      });
      // eslint-disable-next-line no-console
      console.log('OVERFLOW_DIAG', JSON.stringify(diag, null, 2));
    }

    expect(
      overflow,
      `page body scrolls horizontally by ${overflow}px at 1024px on /trader/orders`,
    ).toBeLessThanOrEqual(1);
  });
});
