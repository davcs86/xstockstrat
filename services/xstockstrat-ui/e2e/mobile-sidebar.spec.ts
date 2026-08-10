import { test, expect } from '@playwright/test';
import { addAuthCookie, addAdminCookie } from './helpers/auth';

/**
 * Mobile offcanvas nav (feature 124, FR-11b). The hamburger trigger on Row 1 now opens a real
 * shadcn `Sidebar collapsible="offcanvas"` (vendored Step 15) instead of the old `Sheet`+
 * `Accordion` combo — same NAV_GROUPS content, same single-open-group behavior, same admin-only
 * gating and close-on-navigate, new underlying primitive. Runs at an iPhone-class viewport
 * (mobile.spec.ts's convention).
 */
test.use({ viewport: { width: 390, height: 844 } });

/** Expands a group trigger only if it isn't already open (the Decide group starts expanded on
 *  /insights/opportunities — clicking an already-open trigger toggles it closed). */
async function openGroup(panel: import('@playwright/test').Locator, name: string): Promise<void> {
  const trigger = panel.getByRole('button', { name });
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') {
    await trigger.click();
  }
}

test.describe('Mobile offcanvas sidebar (FR-11b)', () => {
  test('trigger opens the panel and every non-admin-visible group/item is reachable', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await page.goto('/insights/opportunities');

    await page.getByRole('button', { name: 'Open menu' }).click();
    const panel = page.getByRole('dialog');
    await expect(panel).toBeVisible();

    for (const [group, items] of [
      ['Decide', ['Opportunities']],
      ['Discover', ['Watchlists', 'Screener']],
      ['Engine', ['Strategies', 'Formulas', 'Signal sources']],
      ['Book', ['Exposure', 'Portfolio', 'Orders']],
      [
        'Settings',
        [
          'Trader home',
          'Insights home',
          'Accounts',
          'Config',
          'Audit log',
          'Authorized apps',
          'MCP tools',
        ],
      ],
    ] as const) {
      await openGroup(panel, group);
      for (const item of items) {
        await expect(panel.getByRole('link', { name: item })).toBeVisible();
      }
    }
  });

  test('non-admin session never renders Backfills', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/insights/opportunities');
    await page.getByRole('button', { name: 'Open menu' }).click();
    const panel = page.getByRole('dialog');
    await openGroup(panel, 'Engine');
    await expect(panel.getByRole('link', { name: 'Strategies' })).toBeVisible();
    await expect(panel.getByRole('link', { name: 'Backfills' })).toHaveCount(0);
  });

  test('admin session renders Backfills', async ({ page }) => {
    await addAdminCookie(page);
    await page.goto('/insights/opportunities');
    await page.getByRole('button', { name: 'Open menu' }).click();
    const panel = page.getByRole('dialog');
    await openGroup(panel, 'Engine');
    await expect(panel.getByRole('link', { name: 'Backfills' })).toBeVisible();
  });

  test('clicking a nav link navigates and closes the panel', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/insights/opportunities');
    await page.getByRole('button', { name: 'Open menu' }).click();
    const panel = page.getByRole('dialog');
    await openGroup(panel, 'Book');
    await panel.getByRole('link', { name: 'Exposure' }).click();
    await expect(page).toHaveURL(/\/trader\/positions$/);
    await expect(panel).toBeHidden();
  });

  test('only one group is expanded at a time', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/insights/opportunities');
    await page.getByRole('button', { name: 'Open menu' }).click();
    const panel = page.getByRole('dialog');

    await openGroup(panel, 'Discover');
    await expect(panel.getByRole('link', { name: 'Watchlists' })).toBeVisible();

    await openGroup(panel, 'Book');
    await expect(panel.getByRole('link', { name: 'Exposure' })).toBeVisible();
    await expect(panel.getByRole('link', { name: 'Watchlists' })).toBeHidden();
  });

  test('the active route highlights its group and item', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/insights/opportunities');
    await page.getByRole('button', { name: 'Open menu' }).click();
    const panel = page.getByRole('dialog');

    await expect(panel.getByRole('button', { name: 'Decide' })).toHaveClass(/bg-accent/);
    await expect(panel.getByRole('link', { name: 'Opportunities' })).toHaveAttribute(
      'data-active',
      'true',
    );
  });

  test('a group trigger flips data-state and rotates its chevron on expand', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/insights/opportunities');
    await page.getByRole('button', { name: 'Open menu' }).click();
    const panel = page.getByRole('dialog');

    const trigger = panel.getByRole('button', { name: 'Discover' });
    const chevron = trigger.locator('svg').last();
    await expect(trigger).toHaveAttribute('data-state', 'closed');
    await expect(chevron).not.toHaveClass(/rotate-90/);

    await trigger.click();
    await expect(trigger).toHaveAttribute('data-state', 'open');
    await expect(chevron).toHaveClass(/rotate-90/);
  });

  test('sub-items render via SidebarMenuSub once a group is expanded', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/insights/opportunities');
    await page.getByRole('button', { name: 'Open menu' }).click();
    const panel = page.getByRole('dialog');

    await openGroup(panel, 'Discover');
    await expect(panel.locator('[data-slot="sidebar-menu-sub"]')).toBeVisible();
  });

  test('Navigate and Settings section labels render', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/insights/opportunities');
    await page.getByRole('button', { name: 'Open menu' }).click();
    const panel = page.getByRole('dialog');

    await expect(
      panel.locator('[data-slot="sidebar-group-label"]', { hasText: 'Navigate' }),
    ).toBeVisible();
    await expect(
      panel.locator('[data-slot="sidebar-group-label"]', { hasText: 'Settings' }),
    ).toBeVisible();
  });
});
