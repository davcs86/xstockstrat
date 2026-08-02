import { type Page } from '@playwright/test';

/**
 * Shared stateful in-memory mock of the PortfolioService watchlist RPCs (feature 058/097).
 *
 * The watchlists page (and, since feature 097, the screener's "Save as watchlist" / "Add top-N"
 * actions) drive React-Query invalidation after every mutation, so ListWatchlists must reflect the
 * latest state — a static fixture would not survive the create→add→remove→delete flow. Extracted
 * here so the screener and watchlists specs share one canonical mock (DRY guard rail) instead of two
 * byte-identical copies (test-data inventory, e2e/fixtures/INVENTORY.md).
 */
export type MockWatchlist = {
  watchlistId: string;
  userId: string;
  name: string;
  description: string;
  symbols: string[];
};

export async function mockWatchlists(page: Page): Promise<void> {
  const state: { lists: MockWatchlist[]; seq: number } = { lists: [], seq: 0 };

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
    const wl: MockWatchlist = {
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

  await page.route(
    '**/xstockstrat.portfolio.v1.PortfolioService/RemoveWatchlistSymbols',
    (route) => {
      const req = JSON.parse(route.request().postData() ?? '{}');
      const wl = find(req.watchlistId);
      const drop = norm(req.symbols ?? []);
      if (wl) wl.symbols = wl.symbols.filter((s) => !drop.includes(s));
      return json(route, { watchlist: wl });
    },
  );

  await page.route('**/xstockstrat.portfolio.v1.PortfolioService/DeleteWatchlist', (route) => {
    const req = JSON.parse(route.request().postData() ?? '{}');
    state.lists = state.lists.filter((w) => w.watchlistId !== req.watchlistId);
    return json(route, {});
  });
}
