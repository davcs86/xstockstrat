import { test, expect } from '@playwright/test';
import { addAuthCookie, addAdminCookie } from './helpers/auth';

/**
 * Non-happy-path states (feature 083, Step 29/30 · FR-17/18). Every data screen renders a
 * loading skeleton, a specific empty copy, and a per-card error; destructive actions stay gated
 * behind a typed confirm. Exercised on the Decide → Opportunities screen (skeleton/empty/error)
 * and the admin Backfills delete panel (destructive-confirm), driven by page.route.
 */

const LIST_OPPS = '**/xstockstrat.analysis.v1.AnalysisService/ListOpportunities';

test.describe('Non-happy states — Opportunities', () => {
  test.beforeEach(async ({ page }) => {
    await addAuthCookie(page);
  });

  test('shows a loading skeleton before data arrives', async ({ page }) => {
    await page.route(LIST_OPPS, async (route) => {
      // Delay so the skeleton is observable, then return one row.
      await new Promise((r) => setTimeout(r, 800));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          opportunities: [
            {
              symbol: 'AAPL',
              action: 1,
              conviction: 0.8,
              passingConditions: 3,
              totalConditions: 4,
              thesis: 'x',
              strategyId: '',
              source: 'screener',
            },
          ],
        }),
      });
    });
    await page.goto('/insights/opportunities');
    await expect(page.getByTestId('opportunities-loading-desktop')).toBeVisible({ timeout: 5000 });
    // Skeleton is replaced by the conviction cards once data resolves.
    await expect(page.getByTestId('opportunity-card').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('opportunities-loading-desktop')).toBeHidden();
  });

  test('shows the empty state when no opportunities match', async ({ page }) => {
    await page.route(LIST_OPPS, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ opportunities: [] }),
      });
    });
    await page.goto('/insights/opportunities');
    // Both the desktop card and the mobile block carry an empty-state; assert the visible one.
    const empty = page.locator('[data-testid="empty-state"]:visible');
    await expect(empty).toBeVisible({ timeout: 10000 });
    await expect(empty).toContainText('No opportunities match the filter');
  });

  test('shows a per-card error when the RPC fails', async ({ page }) => {
    await page.route(LIST_OPPS, async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'internal', message: 'boom' }),
      });
    });
    await page.goto('/insights/opportunities');
    await expect(
      page.locator('text=Failed to load opportunities.').locator('visible=true'),
    ).toBeVisible({
      timeout: 15000,
    });
  });
});

test.describe('Non-happy states — destructive confirm', () => {
  test('Backfills whole-symbol delete stays gated until the typed confirmations match', async ({
    page,
  }) => {
    await addAdminCookie(page);
    await page.goto('/insights/backfills');
    // The delete form now lives in the Delete tab.
    await expect(page.getByRole('heading', { name: 'Backfills' })).toBeVisible({ timeout: 10000 });
    await page.getByRole('tab', { name: 'Delete' }).click();

    const deleteBtn = page.getByRole('button', { name: 'Delete data' });
    await expect(deleteBtn).toBeVisible({ timeout: 10000 });
    // Disabled with no input.
    await expect(deleteBtn).toBeDisabled();

    // Symbol + matching confirm, but no "DELETE ALL" (empty range = whole-symbol) → still gated.
    await page.getByPlaceholder('Symbol', { exact: true }).fill('AAPL');
    await page.getByPlaceholder('Type "AAPL" to confirm').fill('AAPL');
    await expect(deleteBtn).toBeDisabled();

    // The whole-symbol confirmation unlocks it.
    await page.getByPlaceholder('Whole-symbol delete — type "DELETE ALL"').fill('DELETE ALL');
    await expect(deleteBtn).toBeEnabled();
  });
});
