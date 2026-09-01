import { test, expect } from '@playwright/test';
import { addAdminCookie, addAuthCookie } from './helpers/auth';

/**
 * Nav-reachability (C-10(a), feature 083 Step 21). Closes the fails.md 2026-07-01 060 trap: a
 * screen must be reachable by WALKING the rendered Decide/Discover/Engine/Book (+ Settings)
 * shell — not by direct-URL — and the active tab/item must carry `aria-current="page"`. Admin
 * cookie so the admin-gated surfaces (e.g. Backfills) are exercised too.
 *
 * feature 124 (FR-10a): the shared `PlatformHeader`-level `Breadcrumb` landmark this spec used
 * to assert against was removed (moved into each page's own `PageBreadcrumb`, FR-10b) — the
 * active-screen assertion below now uses the `aria-current="page"` markers already present on
 * both the `Primary` and `Section` nav links (`PlatformHeader.tsx`), per design.md's Round 4
 * resolution.
 *
 * Scope (impl-spec P-06/F-05): nav reachability + active-marker presence only, against the
 * Step-20 placeholder/real routes. Per-screen CONTENT reachability (Signal detail, Backtest) is
 * re-asserted in Step 26 once the real screens land.
 */

const GROUPS: { tab: string; items: { label: string; href: string }[] }[] = [
  { tab: 'Decide', items: [{ label: 'Opportunities', href: '/insights/opportunities' }] },
  {
    tab: 'Discover',
    items: [
      { label: 'Watchlists', href: '/insights/watchlists' },
      { label: 'Screener', href: '/insights/screener' },
    ],
  },
  {
    tab: 'Engine',
    items: [
      { label: 'Strategies', href: '/insights/strategies' },
      { label: 'Formulas', href: '/insights/formulas' },
      { label: 'P&L Patterns', href: '/insights/pnl-patterns' },
      { label: 'Performance', href: '/insights/performance' },
      { label: 'Signal sources', href: '/config-ui/sources' },
      { label: 'Backfills', href: '/insights/backfills' },
    ],
  },
  {
    tab: 'Book',
    items: [
      { label: 'Exposure', href: '/trader/positions' },
      { label: 'Portfolio', href: '/trader/portfolio' },
      { label: 'Orders', href: '/trader/orders' },
    ],
  },
  {
    tab: 'Settings',
    items: [
      { label: 'Notifications', href: '/accounts/notifications' },
      { label: 'Accounts', href: '/trader/accounts' },
      { label: 'Config', href: '/config-ui' },
      { label: 'Audit log', href: '/config-ui/audit' },
      { label: 'Authorized apps', href: '/accounts/authorized-apps' },
      { label: 'MCP tools', href: '/accounts/mcp-tools' },
    ],
  },
];

test.describe('nav reachability', () => {
  test('every screen is reachable by walking the shell and the breadcrumb reflects it', async ({
    page,
  }) => {
    await addAdminCookie(page);
    await page.goto('/insights/opportunities');

    const primary = page.getByRole('navigation', { name: 'Primary' });
    const section = page.getByRole('navigation', { name: 'Section' });

    for (const group of GROUPS) {
      // Walk to the group from the rendered shell (not by direct URL).
      await primary.getByRole('link', { name: group.tab, exact: true }).click();
      await expect(primary.getByRole('link', { name: group.tab, exact: true })).toHaveAttribute(
        'aria-current',
        'page',
      );
      for (const item of group.items) {
        await section.getByRole('link', { name: item.label, exact: true }).click();
        await expect(page).toHaveURL(new RegExp(`${item.href}(/|$|\\?)`));
        // The route resolved (not a 404) and the active tab/item both carry aria-current="page".
        await expect(section.getByRole('link', { name: item.label, exact: true })).toHaveAttribute(
          'aria-current',
          'page',
        );
        await expect(primary.getByRole('link', { name: group.tab, exact: true })).toHaveAttribute(
          'aria-current',
          'page',
        );
      }
    }
  });

  test('the unified symbol page resolves to the Book group on both desktop and mobile (feature 125)', async ({
    page,
  }) => {
    await addAuthCookie(page);

    // Desktop: a dynamic route has no nav-menu link, so navigate directly and assert the Primary
    // "Book" tab carries aria-current="page" (resolveActive classifies /trader/positions/[symbol]
    // into Book once the old /insights/market special-case is gone — Step 23).
    await page.goto('/trader/positions/AAPL');
    await expect(
      page
        .getByRole('navigation', { name: 'Primary' })
        .getByRole('link', { name: 'Book', exact: true }),
    ).toHaveAttribute('aria-current', 'page', { timeout: 30000 });

    // Mobile: below the sm breakpoint the BottomTabBar renders; its "Book" tab must be active too.
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/trader/positions/AAPL');
    await expect(
      page.getByTestId('mobile-tab-bar').getByRole('link', { name: 'Book' }),
    ).toHaveAttribute('aria-current', 'page', { timeout: 30000 });
  });

  // feature 110 removed the `/insights/market/[symbol]` redirect stub (the orphaned signal-order-ticket
  // path). Its former redirect-to-`/trader/positions/[symbol]` test is gone with it; the live symbol
  // page's reachability + Book-tab active state is already covered by the sibling test above.
});
