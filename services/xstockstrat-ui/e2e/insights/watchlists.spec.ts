import { test, expect, type Page } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';
import { mockWatchlists } from '../helpers/watchlistMock';

/**
 * Watchlists (insights) — feature 058/098, per-symbol `(symbol, strategy)` bindings by feature 097.
 * The transient whole-list readiness strategy picker is replaced by an inline per-symbol strategy
 * Select; readiness evaluates each symbol against its own bound strategy (unbound → not evaluated).
 */
async function createList(page: Page, name: string) {
  // Creation now happens in a modal opened from the header "New watchlist" button.
  await page.getByRole('button', { name: 'New watchlist' }).click();
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

    // Delete the list — opens an AlertDialog (feature 121, FR-4) rather than a native
    // window.confirm — click the trigger, then the dialog's own Confirm action.
    await page.getByRole('button', { name: 'Delete My List' }).click();
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByRole('heading', { name: 'My List' })).toHaveCount(0, { timeout: 5000 });
    await expect(
      page.getByText('No watchlists yet. Use “New watchlist” to create one.'),
    ).toBeVisible({
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

    // Alignment regression guard: the "in queue" badge on this row must NOT push the row's
    // controls (Select + Remove X) off the right edge of the readiness card. `toBeVisible()`
    // above does not catch overflow-clipping, so assert the Remove button's right edge stays
    // within the card's own right edge — the horizontal-scroll container the row lives in.
    const cardBox = await readiness.locator('.overflow-x-auto').boundingBox();
    const removeBox = await row.getByLabel('Remove AAPL').boundingBox();
    expect(cardBox).not.toBeNull();
    expect(removeBox).not.toBeNull();
    expect(removeBox!.x + removeBox!.width).toBeLessThanOrEqual(cardBox!.x + cardBox!.width + 1);

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
    const addStrategySelect = page.getByLabel('Strategy for new symbols', { exact: true });
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

  test('inline rename + watchlist-switch resets local state (FR-4, AC-3)', async ({ page }) => {
    await addAuthCookie(page);
    await mockWatchlists(page);
    await page.goto('/insights/watchlists');

    await createList(page, 'Original Name');
    await addSymbols(page, 'AAPL');
    await bindStrategy(page, 'AAPL');

    // Commit a rename — the header updates and the bound symbol's binding survives (fails-080
    // invariant: rename sends the full current bindings array, never a partial one).
    await page.getByRole('button', { name: /^Rename /i }).click();
    const nameField = page.getByLabel('Watchlist name', { exact: true });
    await nameField.fill('Renamed List');
    await nameField.press('Enter');
    await expect(page.getByRole('heading', { name: 'Renamed List' })).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByTestId('readiness-row-AAPL')).toBeVisible();

    // Cancel: open the rename control again, type a different draft, press Escape — no mutation.
    await page.getByRole('button', { name: /^Rename /i }).click();
    await page.getByLabel('Watchlist name', { exact: true }).fill('Should Not Save');
    await page.getByLabel('Watchlist name', { exact: true }).press('Escape');
    await expect(page.getByRole('heading', { name: 'Renamed List' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Should Not Save' })).toHaveCount(0);

    // Switch-reset: create a second list (selects it), pick a strategy in its add-time picker
    // without adding, then switch back to the first list — the rename control must be back in
    // display mode (not stuck mid-edit) and the add-time picker back to "Unbound" (the
    // key={selected.watchlistId} remount closes both leaks in one mechanism, design.md §4).
    await createList(page, 'Second List');
    await page.getByLabel('Strategy for new symbols', { exact: true }).click();
    await page.getByRole('option', { name: 'Live Test Strategy' }).click();

    const master = page.getByTestId('watchlist-master');
    await master.getByRole('button', { name: /Renamed List/ }).click();
    await expect(page.getByRole('heading', { name: 'Renamed List' })).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByRole('button', { name: /^Rename /i })).toBeVisible();
    await expect(page.getByLabel('Watchlist name', { exact: true })).toHaveCount(0);
    await expect(page.getByLabel('Strategy for new symbols', { exact: true })).toHaveText(
      'Unbound',
    );
  });

  test('concurrency guard disables controls while a write is in flight (Layers 1 and 2)', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await mockWatchlists(page);
    await page.goto('/insights/watchlists');

    await createList(page, 'Concurrency List');
    await addSymbols(page, 'AAPL');
    // A second list to exercise Layer 2 against — the master-list's *other* button.
    await createList(page, 'Other List');

    // Register the delaying override AFTER mockWatchlists so it wins interception order.
    let releaseResponse: () => void = () => {};
    const delayed = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    // feature 167: a per-symbol rebind now uses UpdateWatchlistBinding (not UpdateWatchlist), so hold
    // THAT response to observe the in-flight guard. updated_at is a Timestamp → RFC3339 string.
    await page.route(
      '**/xstockstrat.portfolio.v1.PortfolioService/UpdateWatchlistBinding',
      async (route) => {
        await delayed;
        const req = JSON.parse(route.request().postData() ?? '{}');
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            binding: { symbol: req.symbol, strategyId: req.strategyId },
            updatedAt: new Date(0).toISOString(),
          }),
        });
      },
    );

    const master = page.getByTestId('watchlist-master');
    await master.getByRole('button', { name: /Concurrency List/ }).click();

    // Layer 1: trigger a rebind (don't await its internal round-trip assertion) — while the
    // UpdateWatchlist request is held, the add-row's Input and the bound row's remove button must
    // both be disabled.
    const select = page.getByTestId('readiness-row-AAPL').getByLabel('Strategy for AAPL');
    await select.click();
    await page.getByRole('option', { name: 'Live Test Strategy' }).click();

    await expect(page.getByPlaceholder('Add symbols (e.g. AAPL MSFT)')).toBeDisabled();
    await expect(page.getByLabel('Remove AAPL')).toBeDisabled();

    // Layer 2: the master-list's *other* watchlist-select button must also be disabled while the
    // write and its refetch are settling — the ancestor (page.tsx) sees it even though it never
    // remounts.
    const otherButton = master.getByRole('button', { name: /Other List/ });
    await expect(otherButton).toBeDisabled();

    // Release the delayed response — both layers must re-enable once the write and its refetch
    // (the isFetching clause) resolve.
    releaseResponse();
    await expect(page.getByPlaceholder('Add symbols (e.g. AAPL MSFT)')).toBeEnabled({
      timeout: 5000,
    });
    await expect(page.getByLabel('Remove AAPL')).toBeEnabled();
    await expect(otherButton).toBeEnabled({ timeout: 5000 });
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

  // feature 127 — a system-managed signals watchlist is delete-protected (AC-7 UI half) and its
  // agent/signal-sourced entries carry a provenance badge; manual entries do not (AC-8).
  test('system-managed watchlist: no delete affordance, signal-provenance badge (AC-7/AC-8)', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await mockWatchlists(page, [
      {
        watchlistId: 'wl-sys',
        userId: 'test-user-001',
        name: 'Signals',
        description: '',
        symbols: ['NVDA', 'MSFT'],
        systemManaged: true,
        bindings: [
          { symbol: 'NVDA', strategyId: '', source: 2 }, // WATCHLIST_ENTRY_SOURCE_SIGNAL
          { symbol: 'MSFT', strategyId: '', source: 1 }, // WATCHLIST_ENTRY_SOURCE_MANUAL
        ],
      },
    ]);
    await page.goto('/insights/watchlists');
    await expect(page.getByRole('heading', { name: 'Watchlists' })).toBeVisible({ timeout: 5000 });

    // Select the seeded system list from the master column.
    await page
      .getByTestId('watchlist-master')
      .getByRole('button', { name: /Signals/ })
      .click();
    await expect(page.getByRole('heading', { name: 'Signals' })).toBeVisible({ timeout: 5000 });

    // AC-7 (UI half): the destructive delete affordance is absent, while rename + add-symbol +
    // per-row remove stay available (an empty system list is fine; only delete is protected).
    await expect(page.getByRole('button', { name: 'Delete Signals' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Rename /i })).toBeVisible();
    await expect(page.getByPlaceholder('Add symbols (e.g. AAPL MSFT)')).toBeEnabled();
    await expect(page.getByTestId('readiness-row-NVDA').getByLabel('Remove NVDA')).toBeEnabled();

    // AC-8: the SIGNAL-sourced NVDA row shows the provenance badge; the MANUAL MSFT row does not.
    await expect(
      page.getByTestId('readiness-row-NVDA').getByTestId('signal-source-badge'),
    ).toBeVisible();
    await expect(
      page.getByTestId('readiness-row-MSFT').getByTestId('signal-source-badge'),
    ).toHaveCount(0);
  });

  // feature 155 (FR-1/FR-2) — color + icon state cues, the in-queue cue, and the firing-row jump.
  test('readiness rows show icon + color + text state cues (AC-1/2/4)', async ({ page }) => {
    await addAuthCookie(page);
    await mockWatchlists(page);
    await page.goto('/insights/watchlists');

    await createList(page, 'Cues');
    await addSymbols(page, 'READY1 WATCH1 QUIET1 NODATA1');
    for (const sym of ['READY1', 'WATCH1', 'QUIET1', 'NODATA1']) {
      await bindStrategy(page, sym);
    }

    const readiness = page.getByTestId('watchlist-readiness');

    // AC-1 firing (3/3): buy/green cue icon + "firing" text (icon never the sole differentiator).
    const ready = readiness.getByTestId('readiness-row-READY1');
    await expect(ready.getByTestId('readiness-cue-firing')).toBeVisible({ timeout: 5000 });
    await expect(
      ready.getByTestId('readiness-cue-firing').getByRole('img', { name: 'firing' }),
    ).toBeVisible();
    await expect(ready.getByTestId('readiness-cue-firing')).toContainText('firing');

    // AC-2 watching (1/3): paper/amber cue icon + the dynamic "2 away" text.
    const watch = readiness.getByTestId('readiness-row-WATCH1');
    await expect(watch.getByTestId('readiness-cue-watching')).toBeVisible();
    await expect(watch.getByTestId('readiness-cue-watching')).toContainText('2 away');

    // AC-4 quiet (0/3): FIX B — a 0-passing evaluated row now reads "quiet" (icon + text), not
    // "N away", so watching and quiet are distinguishable by text, not only icon/color.
    const quiet = readiness.getByTestId('readiness-row-QUIET1');
    await expect(quiet.getByTestId('readiness-cue-quiet')).toBeVisible();
    await expect(quiet.getByTestId('readiness-cue-quiet')).toContainText('quiet');
    await expect(
      quiet.getByTestId('readiness-cue-quiet').getByRole('img', { name: 'quiet' }),
    ).toBeVisible();

    // AC-4 no-data (0/0): cue icon + "no data" text.
    const nodata = readiness.getByTestId('readiness-row-NODATA1');
    await expect(nodata.getByTestId('readiness-cue-nodata')).toBeVisible();
    await expect(nodata.getByTestId('readiness-cue-nodata')).toContainText('no data');
  });

  test('in-queue rows carry the shared in-queue cue icon (AC-3)', async ({ page }) => {
    await addAuthCookie(page);
    await mockWatchlists(page);
    await page.goto('/insights/watchlists');

    await createList(page, 'Queue');
    await addSymbols(page, 'AAPL'); // AAPL is on the opportunity queue (OPPORTUNITIES fixture)
    await bindStrategy(page, 'AAPL');

    const badge = page
      .getByTestId('watchlist-readiness')
      .getByTestId('readiness-row-AAPL')
      .getByTestId('in-queue');
    await expect(badge).toBeVisible({ timeout: 5000 });
    await expect(badge).toContainText('in queue');
    // Same IN_QUEUE_CUE render the Opportunities surface uses (Step 6) — the icon is present.
    await expect(badge.getByRole('img', { name: 'in queue' })).toBeVisible();
  });

  test('firing row jumps to the symbol detail; non-firing does not (AC-5/6)', async ({ page }) => {
    await addAuthCookie(page);
    await mockWatchlists(page);
    await page.goto('/insights/watchlists');

    await createList(page, 'Jump');
    await addSymbols(page, 'READY1 WATCH1');
    await bindStrategy(page, 'READY1');
    await bindStrategy(page, 'WATCH1');

    const readiness = page.getByTestId('watchlist-readiness');

    // AC-5: the firing READY1 row exposes a jump straight to its order/position detail.
    const jump = readiness.getByTestId('readiness-row-READY1').getByTestId('jump-READY1');
    await expect(jump).toBeVisible({ timeout: 5000 });
    await expect(jump).toHaveAttribute('href', '/trader/positions/READY1?strategy=strat-live-001');

    // AC-6: the non-firing WATCH1 row shows no jump.
    await expect(
      readiness.getByTestId('readiness-row-WATCH1').getByTestId('jump-WATCH1'),
    ).toHaveCount(0);
  });

  // feature 167 — a single-symbol rebind patches only the changed row and does NOT refetch the
  // whole list (the ['watchlists'] key is not invalidated).
  test('rebinding one symbol patches only that row without a full-list refetch (feature 167, AC-6)', async ({
    page,
  }) => {
    await addAuthCookie(page);
    // A big list "loaded with 200 symbols in the query cache". Only AAPL/MSFT are bound (so exactly
    // two rows evaluate); the 198 filler symbols are unbound — they still populate the cached list a
    // full refetch would have to re-pull, without triggering 198 EvaluateReadiness calls.
    const filler = Array.from({ length: 198 }, (_, i) => ({ symbol: `SYM${i}`, strategyId: '' }));
    await mockWatchlists(page, [
      {
        watchlistId: 'wl-1',
        userId: 'test-user-001',
        name: 'Big List',
        description: '',
        symbols: ['AAPL', 'MSFT', ...filler.map((b) => b.symbol)],
        bindings: [
          { symbol: 'AAPL', strategyId: 'strat-live-001' },
          { symbol: 'MSFT', strategyId: 'strat-live-001' },
          ...filler,
        ],
      },
    ]);

    // Count the two RPCs before navigating so the initial ListWatchlists is captured too.
    // The connect path is `…xstockstrat.portfolio.v1.PortfolioService/<Method>` — a DOT precedes
    // `PortfolioService`, so match on the `/<Method>` segment (both method names are unique).
    let listCalls = 0;
    let bindCalls = 0;
    page.on('request', (r) => {
      if (r.url().includes('/ListWatchlists')) listCalls += 1;
      if (r.url().includes('/UpdateWatchlistBinding')) bindCalls += 1;
    });

    await page.goto('/insights/watchlists');
    // Generous: the 200-row list renders + AAPL/MSFT evaluate readiness; on the dev server the route
    // also cold-compiles on first hit. CI's production build is far faster.
    await expect(page.getByTestId('readiness-row-MSFT')).toBeVisible({ timeout: 30000 });
    // Both bound rows show their initial strategy.
    const msftSelect = page.getByTestId('readiness-row-MSFT').getByLabel('Strategy for MSFT');
    const aaplSelect = page.getByTestId('readiness-row-AAPL').getByLabel('Strategy for AAPL');
    await expect(msftSelect).toContainText('Live Test Strategy', { timeout: 5000 });
    await expect(aaplSelect).toContainText('Live Test Strategy');
    const baseline = listCalls;

    // Rebind MSFT to the OTHER live strategy via the targeted single-row RPC.
    await bindStrategy(page, 'MSFT', 'Deny List Strategy');

    // The MSFT row shows the new strategy…
    await expect(msftSelect).toContainText('Deny List Strategy');
    // …via exactly one UpdateWatchlistBinding request…
    expect(bindCalls).toBe(1);
    // …with NO ListWatchlists refetch after the rebind (the cache was patched, not invalidated)…
    expect(listCalls).toBe(baseline);
    // …and a sampled other row is untouched.
    await expect(aaplSelect).toContainText('Live Test Strategy');
  });

  // ── feature 170: bulk operations + default strategy ─────────────────────────

  const seedMomentum = {
    watchlistId: 'wl-b1',
    userId: 'test-user-001',
    name: 'Momentum',
    description: '',
    symbols: ['AAPL', 'MSFT', 'NVDA', 'TSLA'],
    bindings: [
      { symbol: 'AAPL', strategyId: '' },
      { symbol: 'MSFT', strategyId: '' },
      { symbol: 'NVDA', strategyId: '' },
      { symbol: 'TSLA', strategyId: '' },
    ],
  };
  const openList = async (page: Page, name: string) => {
    await page
      .getByTestId('watchlist-master')
      .getByRole('button', { name: new RegExp(name) })
      .click();
    await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: 5000 });
  };

  test('bulk-remove selected symbols in one action (feature 170, AC-1)', async ({ page }) => {
    await addAuthCookie(page);
    await mockWatchlists(page, [seedMomentum]);
    await page.goto('/insights/watchlists');
    await openList(page, 'Momentum');
    await expect(page.getByTestId('readiness-row-AAPL')).toBeVisible({ timeout: 5000 });

    await page.getByTestId('select-MSFT').click();
    await page.getByTestId('select-TSLA').click();
    await expect(page.getByTestId('bulk-selection-count')).toHaveText('2 selected');

    const reqP = page.waitForRequest((r) => r.url().endsWith('/RemoveWatchlistSymbols'));
    await page.getByTestId('bulk-remove').click();
    const body = JSON.parse((await reqP).postData() ?? '{}');
    expect((body.symbols ?? []).slice().sort()).toEqual(['MSFT', 'TSLA']);

    await expect(page.getByTestId('readiness-row-MSFT')).toHaveCount(0, { timeout: 5000 });
    await expect(page.getByTestId('readiness-row-TSLA')).toHaveCount(0);
    await expect(page.getByTestId('readiness-row-AAPL')).toBeVisible();
    await expect(page.getByTestId('readiness-row-NVDA')).toBeVisible();
    // Selection cleared → the bulk bar is gone (AC-1).
    await expect(page.getByTestId('bulk-action-bar')).toHaveCount(0);
  });

  test('bulk-assign one strategy across the selection atomically (feature 170, AC-2)', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await mockWatchlists(page, [seedMomentum]);
    await page.goto('/insights/watchlists');
    await openList(page, 'Momentum');

    await page.getByTestId('select-AAPL').click();
    await page.getByTestId('select-MSFT').click();
    await page.getByLabel('Strategy for selected symbols').click();
    await page.getByRole('option', { name: 'Live Test Strategy' }).click();

    const reqP = page.waitForRequest((r) => r.url().endsWith('/UpdateWatchlistBindings'));
    await page.getByTestId('bulk-apply-strategy').click();
    const body = JSON.parse((await reqP).postData() ?? '{}');
    // One atomic call carrying the whole selection and the chosen strategy.
    expect((body.symbols ?? []).slice().sort()).toEqual(['AAPL', 'MSFT']);
    expect(body.strategyId).toBe('strat-live-001');
    await expect(page.getByTestId('bulk-action-bar')).toHaveCount(0);
  });

  test('bulk-assign the unbound sentinel clears strategy on the selection (feature 170, AC-3)', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await mockWatchlists(page, [seedMomentum]);
    await page.goto('/insights/watchlists');
    await openList(page, 'Momentum');

    await page.getByTestId('select-AAPL').click();
    await page.getByTestId('select-MSFT').click();
    // The bulk Select defaults to "Unbound"; pick it explicitly to prove the sentinel → '' path.
    await page.getByLabel('Strategy for selected symbols').click();
    await page.getByRole('option', { name: 'Unbound' }).click();

    const reqP = page.waitForRequest((r) => r.url().endsWith('/UpdateWatchlistBindings'));
    await page.getByTestId('bulk-apply-strategy').click();
    const body = JSON.parse((await reqP).postData() ?? '{}');
    expect((body.symbols ?? []).slice().sort()).toEqual(['AAPL', 'MSFT']);
    // Connect-JSON omits an empty string field, so strategyId is either '' or absent — both = unbind.
    expect(body.strategyId ?? '').toBe('');
  });

  test('set/read the watchlist default strategy via a masked update; edits stay unmasked (feature 170, AC-6)', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await mockWatchlists(page, [seedMomentum]);
    await page.goto('/insights/watchlists');
    await openList(page, 'Momentum');

    const control = page.getByTestId('default-strategy-control');
    await control.getByLabel('Default strategy for new symbols').click();
    const defReqP = page.waitForRequest((r) => r.url().endsWith('/UpdateWatchlist'));
    await page.getByRole('option', { name: 'Live Test Strategy' }).click();
    const defBody = JSON.parse((await defReqP).postData() ?? '{}');
    // A masked partial update: FieldMask serializes to a canonical comma-joined camelCase STRING.
    expect(typeof defBody.updateMask).toBe('string');
    expect(defBody.updateMask).toContain('defaultStrategyId');
    expect(defBody.defaultStrategyId).toBe('strat-live-001');
    // After the round-trip the control reflects the persisted default.
    await expect(control).toContainText('Live Test Strategy', { timeout: 5000 });

    // Mask discipline (design Open Risk): a legacy rename must NOT carry update_mask.
    await page.getByRole('button', { name: /^Rename / }).click();
    const nameInput = page.getByLabel('Watchlist name');
    await nameInput.fill('Momentum 2');
    const renameReqP = page.waitForRequest((r) => r.url().endsWith('/UpdateWatchlist'));
    await nameInput.press('Enter');
    const renameBody = JSON.parse((await renameReqP).postData() ?? '{}');
    expect(renameBody.updateMask ?? '').toBe('');
  });

  test('switching the active watchlist clears the pending selection (feature 170, AC-13)', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await mockWatchlists(page, [
      seedMomentum,
      {
        watchlistId: 'wl-b2',
        userId: 'test-user-001',
        name: 'Breakouts',
        description: '',
        symbols: ['GOOG', 'AMZN'],
        bindings: [
          { symbol: 'GOOG', strategyId: '' },
          { symbol: 'AMZN', strategyId: '' },
        ],
      },
    ]);
    await page.goto('/insights/watchlists');
    await openList(page, 'Momentum');
    await page.getByTestId('select-AAPL').click();
    await page.getByTestId('select-MSFT').click();
    await expect(page.getByTestId('bulk-action-bar')).toBeVisible();

    // Switch to the other list — the detail remounts (key={watchlistId}), so selection resets.
    await openList(page, 'Breakouts');
    await expect(page.getByTestId('readiness-row-GOOG')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('bulk-action-bar')).toHaveCount(0);
    await expect(page.getByTestId('select-GOOG')).not.toBeChecked();
    await expect(page.getByTestId('select-AMZN')).not.toBeChecked();
  });
});
