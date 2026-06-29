import { test, expect, type Page } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';

// Stateful in-memory mock of the PortfolioService watchlist RPCs. The page drives
// React-Query invalidation after every mutation, so ListWatchlists must reflect the
// latest state — a static fixture would not survive the create→add→remove→delete flow.
type Watchlist = { watchlistId: string; userId: string; name: string; description: string; symbols: string[] };

async function mockWatchlists(page: Page): Promise<void> {
  const state: { lists: Watchlist[]; seq: number } = { lists: [], seq: 0 };

  const norm = (syms: string[]): string[] => {
    const out: string[] = [];
    for (const s of syms) {
      const u = (s ?? '').trim().toUpperCase();
      if (u && !out.includes(u)) out.push(u);
    }
    return out;
  };
  const find = (id: string) => state.lists.find((w) => w.watchlistId === id);
  const json = (route: Parameters<Parameters<Page['route']>[1]>[0], body: unknown) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

  await page.route('**/xstockstrat.portfolio.v1.PortfolioService/ListWatchlists', (route) =>
    json(route, { watchlists: state.lists, page: {} }),
  );

  await page.route('**/xstockstrat.portfolio.v1.PortfolioService/CreateWatchlist', (route) => {
    const req = JSON.parse(route.request().postData() ?? '{}');
    state.seq += 1;
    const wl: Watchlist = {
      watchlistId: `wl-${state.seq}`,
      userId: 'test-user-001',
      name: req.name ?? '',
      description: req.description ?? '',
      symbols: norm(req.symbols ?? []),
    };
    state.lists.push(wl);
    return json(route, { watchlist: wl });
  });

  await page.route('**/xstockstrat.portfolio.v1.PortfolioService/AddWatchlistSymbols', (route) => {
    const req = JSON.parse(route.request().postData() ?? '{}');
    const wl = find(req.watchlistId);
    if (wl) wl.symbols = norm([...wl.symbols, ...(req.symbols ?? [])]);
    return json(route, { watchlist: wl });
  });

  await page.route('**/xstockstrat.portfolio.v1.PortfolioService/RemoveWatchlistSymbols', (route) => {
    const req = JSON.parse(route.request().postData() ?? '{}');
    const wl = find(req.watchlistId);
    const drop = norm(req.symbols ?? []);
    if (wl) wl.symbols = wl.symbols.filter((s) => !drop.includes(s));
    return json(route, { watchlist: wl });
  });

  await page.route('**/xstockstrat.portfolio.v1.PortfolioService/DeleteWatchlist', (route) => {
    const req = JSON.parse(route.request().postData() ?? '{}');
    state.lists = state.lists.filter((w) => w.watchlistId !== req.watchlistId);
    return json(route, {});
  });
}

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
    await expect(page.getByText('No watchlists yet. Create one above.')).toBeVisible({ timeout: 5000 });
  });
});
