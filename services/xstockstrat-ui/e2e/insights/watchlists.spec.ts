import { test, expect } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';
import { mockWatchlists } from '../helpers/watchlistMock';

test.describe('Watchlists (insights)', () => {
  test('create a list, add two symbols, remove one, delete the list', async ({ page }) => {
    await addAuthCookie(page);
    await mockWatchlists(page);
    await page.goto('/insights/watchlists');

    await expect(page.getByRole('heading', { name: 'Watchlists' })).toBeVisible({ timeout: 5000 });

    // Create.
    await page.getByPlaceholder('e.g. Tech Large-Cap').fill('My List');
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByRole('heading', { name: 'My List' })).toBeVisible({ timeout: 5000 });

    // Add two symbols (lowercase input proves server-side uppercase via the mock).
    await page.getByPlaceholder('Add symbols (e.g. AAPL MSFT)').fill('aapl msft');
    await page.getByRole('button', { name: 'Add' }).click();
    await expect(page.getByText('AAPL', { exact: true })).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('MSFT', { exact: true })).toBeVisible({ timeout: 5000 });

    // Remove one.
    await page.getByRole('button', { name: 'Remove AAPL' }).click();
    await expect(page.getByText('AAPL', { exact: true })).toHaveCount(0, { timeout: 5000 });
    await expect(page.getByText('MSFT', { exact: true })).toBeVisible();

    // Delete the list (confirm() auto-accepted).
    page.on('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Delete My List' }).click();
    await expect(page.getByRole('heading', { name: 'My List' })).toHaveCount(0, { timeout: 5000 });
    await expect(page.getByText('No watchlists yet. Create one above.')).toBeVisible({
      timeout: 5000,
    });
  });

  test('per-watchlist readiness against a chosen strategy (feature 083)', async ({ page }) => {
    await addAuthCookie(page);
    await mockWatchlists(page);
    await page.goto('/insights/watchlists');

    await page.getByPlaceholder('e.g. Tech Large-Cap').fill('Ready List');
    await page.getByRole('button', { name: 'Create' }).click();
    await page.getByPlaceholder('Add symbols (e.g. AAPL MSFT)').fill('AAPL');
    await page.getByRole('button', { name: 'Add' }).click();

    const readiness = page.getByTestId('watchlist-readiness');
    await expect(readiness).toBeVisible({ timeout: 5000 });

    // Choose a strategy → EvaluateReadiness runs over the watchlist symbols.
    await page.getByLabel('Readiness strategy').click();
    await page.getByRole('option', { name: 'Live Test Strategy' }).click();

    await expect(readiness.getByText('AAPL')).toBeVisible({ timeout: 5000 });
    // 2 of 3 conditions pass → "1 away" (readiness bar + blocking-condition row).
    await expect(readiness.getByText('1 away')).toBeVisible();
    // AAPL is on the opportunity queue → marked "in queue" (feature 098, FR-11).
    await expect(readiness.getByTestId('in-queue')).toBeVisible();
  });

  test('master-detail: selecting a list swaps the detail pane (feature 098)', async ({ page }) => {
    await addAuthCookie(page);
    await mockWatchlists(page);
    await page.goto('/insights/watchlists');
    await expect(page.getByRole('heading', { name: 'Watchlists' })).toBeVisible({ timeout: 5000 });

    // Create two lists — create auto-selects the newest, so its detail is immediately interactive.
    await page.getByPlaceholder('e.g. Tech Large-Cap').fill('Alpha');
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByRole('heading', { name: 'Alpha' })).toBeVisible({ timeout: 5000 });

    await page.getByPlaceholder('e.g. Tech Large-Cap').fill('Beta');
    await page.getByRole('button', { name: 'Create' }).click();
    // Auto-selected the newly created "Beta" (its detail heading shows without any manual click).
    await expect(page.getByRole('heading', { name: 'Beta' })).toBeVisible({ timeout: 5000 });

    // The master column lists both; selecting Alpha swaps the detail heading back.
    const master = page.getByTestId('watchlist-master');
    await master.getByRole('button', { name: /Alpha/ }).click();
    await expect(page.getByRole('heading', { name: 'Alpha' })).toBeVisible({ timeout: 5000 });

    // "Build from screener" resolves to the registered same-segment route (C-10(a)).
    await expect(page.getByTestId('build-from-screener')).toHaveAttribute(
      'href',
      '/insights/screener',
    );
  });

  test('readiness rollup buckets sum to the requested symbol count (feature 098, AC-6)', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await mockWatchlists(page);
    await page.goto('/insights/watchlists');

    // One symbol per bucket (ready / watching / quiet / no-data) via the mock bucket overrides.
    await page.getByPlaceholder('e.g. Tech Large-Cap').fill('Buckets');
    await page.getByRole('button', { name: 'Create' }).click();
    await page
      .getByPlaceholder('Add symbols (e.g. AAPL MSFT)')
      .fill('READY1 WATCH1 QUIET1 NODATA1');
    await page.getByRole('button', { name: 'Add' }).click();

    const readiness = page.getByTestId('watchlist-readiness');
    await expect(readiness).toBeVisible({ timeout: 5000 });
    await page.getByLabel('Readiness strategy').click();
    await page.getByRole('option', { name: 'Live Test Strategy' }).click();

    // Single "Evaluated against" caption — not a per-row STRATEGY column.
    await expect(readiness.getByTestId('evaluated-against')).toContainText('Live Test Strategy');

    // 1 ready · 1 watching · 1 quiet · 1 no-data — the four counts sum to the 4 requested symbols.
    const rollup = readiness.getByTestId('readiness-rollup');
    await expect(rollup).toContainText('1 ready');
    await expect(rollup).toContainText('1 watching');
    await expect(rollup).toContainText('1 quiet');
    await expect(rollup).toContainText('1 no-data');
    // The un-evaluable symbol renders "no data", never "0 away".
    await expect(readiness.getByText('no data')).toBeVisible();
  });

  test('no LAST / CHG / Quotes livestream UI is present (feature 098, AC-8 — deferred to 099)', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await mockWatchlists(page);
    await page.goto('/insights/watchlists');
    await page.getByPlaceholder('e.g. Tech Large-Cap').fill('NoQuotes');
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByRole('heading', { name: 'NoQuotes' })).toBeVisible({ timeout: 5000 });

    // The live-quote surfaces (LAST/CHG columns, a Quotes tab) belong to 099-watchlist-live-quotes.
    await expect(page.getByRole('columnheader', { name: 'LAST' })).toHaveCount(0);
    await expect(page.getByRole('columnheader', { name: /CHG/ })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Quotes' })).toHaveCount(0);
  });
});
