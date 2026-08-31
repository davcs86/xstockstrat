import { test, expect } from '@playwright/test';
import { addAuthCookie, BASE_URL } from '../helpers/auth';
import { SOURCE_ATTRIBUTION } from '../fixtures/attribution';

// Feature 029 — the /insights Signal Attribution table. Signed in as a normal user; the mock
// AnalysisService.getAttribution returns SOURCE_ATTRIBUTION (news win-rate 0.40, form4 0.65).

const ATTRIBUTION_PAGE = `${BASE_URL}/insights/attribution`;

test.describe('insights Signal Attribution (feature 029)', () => {
  test('AC-2: renders the per-source table and sorts by win rate', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto(ATTRIBUTION_PAGE);
    await expect(page.getByRole('heading', { name: 'Signal Attribution' })).toBeVisible();

    // Columns (FR-6). Generous timeout on the first: the route cold-compiles on first hit (dev).
    await expect(page.getByRole('columnheader', { name: 'Source' })).toBeVisible({ timeout: 30000 });
    for (const col of ['Trades', 'Win rate', 'Avg return %', 'Total P&L']) {
      await expect(page.getByRole('columnheader', { name: col })).toBeVisible();
    }
    // Both fixture rows render with their distinct source names.
    await expect(page.getByText('Form 4 Insider')).toBeVisible();
    await expect(page.getByText('Newsletter')).toBeVisible();

    const table = page.getByTestId('attribution-table');
    const firstDataRow = () => table.getByRole('row').nth(1); // row 0 is the header
    // Initial order mirrors the response: Newsletter (win rate 0.40) first.
    await expect(firstDataRow()).toContainText('Newsletter');

    // Sort by win rate (numeric → descending on the first click): form4 (0.65) rises to the top.
    await page.getByRole('button', { name: 'Win rate' }).click();
    await expect(firstDataRow()).toContainText('Form 4 Insider');
  });

  test('AC-8: exports the displayed rows to the clipboard as CSV', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await addAuthCookie(page);
    await page.goto(ATTRIBUTION_PAGE);
    await expect(page.getByText('Form 4 Insider')).toBeVisible({ timeout: 30000 });

    await page.getByTestId('attribution-copy').click();
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    const lines = clipboard.split('\n');
    // Header is exact (FR-7); one data line per displayed source (2 fixture rows).
    expect(lines[0]).toBe('source name,trades,win rate,avg return %,total P&L');
    expect(lines).toHaveLength(1 + SOURCE_ATTRIBUTION.attributions.length);
    expect(clipboard).toContain('Form 4 Insider');
    expect(clipboard).toContain('Newsletter');
  });

  test('AC/C-10(a): Attribution is reachable from the rendered shell nav', async ({ page }) => {
    await addAuthCookie(page);
    // Start on a sibling Engine-group page so the desktop Row-2 "Section" nav lists Engine's items
    // (including Attribution) — guards the "link renders but never routes" failure (060/058).
    await page.goto(`${BASE_URL}/insights/pnl-patterns`);
    const link = page
      .getByRole('navigation', { name: 'Section' })
      .getByRole('link', { name: 'Attribution' });
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/\/insights\/attribution$/);
    await expect(page.getByRole('heading', { name: 'Signal Attribution' })).toBeVisible();
  });
});
