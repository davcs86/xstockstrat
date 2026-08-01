import { test, expect } from '@playwright/test';
import { addAdminCookie } from './helpers/auth';

/**
 * Nav-reachability (C-10(a), feature 083 Step 21). Closes the fails.md 2026-07-01 060 trap: a
 * screen must be reachable by WALKING the rendered Decide/Discover/Engine/Book (+ Settings)
 * shell — not by direct-URL — and the breadcrumb must reflect the active screen. Admin cookie
 * so the admin-gated surfaces (e.g. Backfills) are exercised too.
 *
 * Scope (impl-spec P-06/F-05): nav reachability + breadcrumb presence only, against the Step-20
 * placeholder/real routes. Per-screen CONTENT reachability (Signal detail, Backtest) is
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
      for (const item of group.items) {
        await section.getByRole('link', { name: item.label, exact: true }).click();
        await expect(page).toHaveURL(new RegExp(`${item.href}(/|$|\\?)`));
        // The route resolved (not a 404) and the breadcrumb reflects the active screen.
        await expect(page.getByLabel('Breadcrumb')).toContainText(item.label);
        await expect(page.getByLabel('Breadcrumb')).toContainText(group.tab);
      }
    }
  });
});
