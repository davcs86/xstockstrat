import { test, expect, type Page } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';
import { mockWatchlists } from '../helpers/watchlistMock';

/**
 * Watchlists (insights) — feature 058/098, per-symbol `(symbol, strategy)` bindings by feature 097.
 * The transient whole-list readiness strategy picker is replaced by an inline per-symbol strategy
 * Select; readiness evaluates each symbol against its own bound strategy (unbound → not evaluated).
 */
async function createList(page: Page, name: string) {
  await page.getByPlaceholder('e.g. Tech Large-Cap').fill(name);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: 5000 });
}

async function addSymbols(page: Page, entry: string) {
  await page.getByPlaceholder('Add symbols (e.g. AAPL MSFT)').fill(entry);
  await page.getByRole('button', { name: 'Add' }).click();
}

/** Bind a symbol's inline strategy Select to a strategy (persisted via UpdateWatchlist).
 * Waits for the mutation+refetch round-trip (the trigger reflects the selection) before returning,
 * so binding several symbols in a row can't send a stale binding set that resets an earlier one. */
async function bindStrategy(page: Page, symbol: string, optionName = 'Live Test Strategy') {
  const select = page.getByTestId(`readiness-row-${symbol}`).getByLabel(`Strategy for ${symbol}`);
  await select.click();
  await page.getByRole('option', { name: optionName }).click();
  await expect(select).toContainText(optionName, { timeout: 5000 });
}

test.describe('Watchlists (insights)', () => {
  test('create a list, add two symbols, remove one, delete the list', async ({ page }) => {
    await addAuthCookie(page);
    await mockWatchlists(page);
    await page.goto('/insights/watchlists');

    await expect(page.getByRole('heading', { name: 'Watchlists' })).toBeVisible({ timeout: 5000 });
    await createList(page, 'My List');

    // Add two symbols (lowercase input proves server-side uppercase via the mock).
    await addSymbols(page, 'aapl msft');
    await expect(page.getByTestId('readiness-row-AAPL')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('readiness-row-MSFT')).toBeVisible({ timeout: 5000 });

    // Remove one.
    await page.getByRole('button', { name: 'Remove AAPL' }).click();
    await expect(page.getByTestId('readiness-row-AAPL')).toHaveCount(0, { timeout: 5000 });
    await expect(page.getByTestId('readiness-row-MSFT')).toBeVisible();

    // Delete the list (confirm() auto-accepted).
    page.on('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Delete My List' }).click();
    await expect(page.getByRole('heading', { name: 'My List' })).toHaveCount(0, { timeout: 5000 });
    await expect(page.getByText('No watchlists yet. Create one above.')).toBeVisible({
      timeout: 5000,
    });
  });

  test('per-symbol strategy binding drives that symbol’s readiness and persists (feature 097)', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await mockWatchlists(page);
    await page.goto('/insights/watchlists');

    await createList(page, 'Ready List');
    await addSymbols(page, 'AAPL');

    const readiness = page.getByTestId('watchlist-readiness');
    await expect(readiness).toBeVisible({ timeout: 5000 });
    // Unbound until a strategy is chosen — never a fabricated binding (P-03).
    await expect(page.getByTestId('unbound-AAPL')).toBeVisible();

    // Bind AAPL to a strategy → EvaluateReadiness runs for AAPL against that strategy.
    await bindStrategy(page, 'AAPL');
    await expect(readiness.getByTestId('readiness-row-AAPL')).toBeVisible({ timeout: 5000 });
    // 2 of 3 conditions pass → "1 away"; AAPL is on the opportunity queue → "in queue".
    await expect(readiness.getByText('1 away')).toBeVisible();
    await expect(readiness.getByTestId('in-queue')).toBeVisible();

    // Relocated row controls (FR-1/FR-2) must render visibly, not clipped by the row's
    // fixed-width columns (design.md round-4: the w-32 Select width is an estimate to verify).
    const row = readiness.getByTestId('readiness-row-AAPL');
    await expect(row.getByLabel('Strategy for AAPL')).toBeVisible();
    await expect(row.getByLabel('Remove AAPL')).toBeVisible();
    const box = await row.boundingBox();
    expect(box).not.toBeNull();

    // The binding is persisted: a reload re-fetches it (the Select keeps its strategy, still evaluated).
    await page.reload();
    await expect(readiness.getByTestId('readiness-row-AAPL')).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId('unbound-AAPL')).toHaveCount(0);
  });

  test('add-time strategy picker binds a new symbol in one call (FR-3, AC-2)', async ({ page }) => {
    await addAuthCookie(page);
    await mockWatchlists(page);
    await page.goto('/insights/watchlists');

    await createList(page, 'Picker List');

    // Bound add: choose a strategy in the add-time picker before adding — the symbol should land
    // already evaluated, proving the single-call add-already-bound path (no separate rebind step).
    const addStrategySelect = page.getByLabel('Strategy for new symbols');
    await addStrategySelect.click();
    await page.getByRole('option', { name: 'Live Test Strategy' }).click();
    await page.getByPlaceholder('Add symbols (e.g. AAPL MSFT)').fill('AAPL');
    await page.getByRole('button', { name: 'Add' }).click();
    await expect(page.getByTestId('readiness-row-AAPL')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('unbound-AAPL')).toHaveCount(0);

    // Default unbound add: the picker is explicitly reset to "Unbound" — it is NOT reset
    // automatically after a successful add (design.md §3: a repeat add keeps the active choice) —
    // reproduces today's default only when the user actually leaves/sets it to Unbound.
    await addStrategySelect.click();
    await page.getByRole('option', { name: 'Unbound' }).click();
    await page.getByPlaceholder('Add symbols (e.g. AAPL MSFT)').fill('MSFT');
    await page.getByRole('button', { name: 'Add' }).click();
    await expect(page.getByTestId('unbound-MSFT')).toBeVisible({ timeout: 5000 });
  });

  test('strategy binding picker excludes non-live strategies (disabled strategies must not be usable)', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await mockWatchlists(page);
    await page.goto('/insights/watchlists');

    await createList(page, 'Filtered List');
    await addSymbols(page, 'AAPL');

    const select = page.getByTestId('readiness-row-AAPL').getByLabel('Strategy for AAPL');
    await select.click();
    await expect(page.getByRole('option', { name: 'Live Test Strategy' })).toBeVisible();
    // "Inactive Strategy" (liveEnabled: false in the fixture) must not be a selectable option.
    await expect(page.getByRole('option', { name: 'Inactive Strategy' })).toHaveCount(0);
  });

  test('master-detail: selecting a list swaps the detail pane (feature 098)', async ({ page }) => {
    await addAuthCookie(page);
    await mockWatchlists(page);
    await page.goto('/insights/watchlists');
    await expect(page.getByRole('heading', { name: 'Watchlists' })).toBeVisible({ timeout: 5000 });

    await createList(page, 'Alpha');
    await createList(page, 'Beta'); // create auto-selects the newest

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

  test('readiness rollup buckets sum to the bound symbol count (feature 098, AC-6)', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await mockWatchlists(page);
    await page.goto('/insights/watchlists');

    // One symbol per bucket (ready / watching / quiet / no-data) via the mock bucket overrides.
    await createList(page, 'Buckets');
    await addSymbols(page, 'READY1 WATCH1 QUIET1 NODATA1');
    // Bind all four to the same strategy so they enter the readiness roll-up.
    for (const sym of ['READY1', 'WATCH1', 'QUIET1', 'NODATA1']) {
      await bindStrategy(page, sym);
    }

    const readiness = page.getByTestId('watchlist-readiness');
    const rollup = readiness.getByTestId('readiness-rollup');
    // 1 ready · 1 watching · 1 quiet · 1 no-data — the four counts sum to the 4 bound symbols.
    await expect(rollup).toContainText('1 ready', { timeout: 5000 });
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
    await createList(page, 'NoQuotes');

    // The live-quote surfaces (LAST/CHG columns, a Quotes tab) belong to 099-watchlist-live-quotes.
    await expect(page.getByRole('columnheader', { name: 'LAST' })).toHaveCount(0);
    await expect(page.getByRole('columnheader', { name: /CHG/ })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Quotes' })).toHaveCount(0);
  });
});
