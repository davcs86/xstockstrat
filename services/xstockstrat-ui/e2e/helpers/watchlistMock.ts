import { type Page } from '@playwright/test';

/**
 * Shared stateful in-memory mock of the PortfolioService watchlist RPCs (feature 058/097/098).
 *
 * The watchlists page (and, since feature 098, the screener's "Save as watchlist" / "Add top-N"
 * actions) drive React-Query invalidation after every mutation, so ListWatchlists must reflect the
 * latest state — a static fixture would not survive the create→add→remove→delete flow. Extracted
 * here so the screener and watchlists specs share one canonical mock (DRY guard rail) instead of two
 * byte-identical copies (test-data inventory, e2e/fixtures/INVENTORY.md).
 *
 * feature 097: a watchlist is now a set of `(symbol, strategyId)` **bindings**. The mock stores
 * bindings authoritatively and mirrors `symbols` for old readers; AddWatchlistSymbols keeps an
 * existing binding on a bare re-add (dedupe-keep-first — the fails-080 reset guard), and the new
 * UpdateWatchlist route replaces the binding set (the per-symbol strategy editor's write path).
 */
export type MockBinding = { symbol: string; strategyId: string; source?: number };
export type MockWatchlist = {
  watchlistId: string;
  userId: string;
  name: string;
  description: string;
  symbols: string[];
  bindings: MockBinding[];
  // feature 127 — system-managed signals watchlist (delete-protected, its entries source-tagged).
  systemManaged?: boolean;
};

export async function mockWatchlists(page: Page, seed: MockWatchlist[] = []): Promise<void> {
  const state: { lists: MockWatchlist[]; seq: number } = {
    lists: seed.map((w) => ({ ...w, bindings: w.bindings.map((b) => ({ ...b })) })),
    seq: seed.length,
  };

  // Uppercase + de-dupe by symbol, keeping the FIRST occurrence (existing binding wins on re-add).
  const normBindings = (bindings: MockBinding[]): MockBinding[] => {
    const out: MockBinding[] = [];
    for (const b of bindings) {
      const symbol = (b.symbol ?? '').trim().toUpperCase();
      if (symbol && !out.some((x) => x.symbol === symbol)) {
        out.push({ symbol, strategyId: b.strategyId ?? '', source: b.source });
      }
    }
    return out;
  };
  // A write carries `bindings` (authoritative) or the legacy flat `symbols` (mapped to unbound).
  const toBindings = (req: { bindings?: MockBinding[]; symbols?: string[] }): MockBinding[] =>
    req.bindings?.length
      ? req.bindings
      : (req.symbols ?? []).map((s) => ({ symbol: s, strategyId: '' }));
  const sync = (wl: MockWatchlist) => {
    wl.symbols = wl.bindings.map((b) => b.symbol);
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
    const bindings = normBindings(toBindings(req));
    const wl: MockWatchlist = {
      watchlistId: `wl-${state.seq}`,
      userId: 'test-user-001',
      name: req.name ?? '',
      description: req.description ?? '',
      symbols: bindings.map((b) => b.symbol),
      bindings,
    };
    state.lists.push(wl);
    return json(route, { watchlist: wl });
  });

  await page.route('**/xstockstrat.portfolio.v1.PortfolioService/UpdateWatchlist', (route) => {
    const req = JSON.parse(route.request().postData() ?? '{}');
    const wl = find(req.watchlistId);
    if (wl) {
      if (req.name !== undefined) wl.name = req.name;
      if (req.description !== undefined) wl.description = req.description;
      // Replace the binding set (the per-symbol re-bind write path — FR-6).
      wl.bindings = normBindings(toBindings(req));
      sync(wl);
    }
    return json(route, { watchlist: wl });
  });

  await page.route('**/xstockstrat.portfolio.v1.PortfolioService/AddWatchlistSymbols', (route) => {
    const req = JSON.parse(route.request().postData() ?? '{}');
    const wl = find(req.watchlistId);
    // Existing binding wins on a bare re-add (dedupe-keep-first) — never resets a strategyId.
    if (wl) {
      wl.bindings = normBindings([...wl.bindings, ...toBindings(req)]);
      sync(wl);
    }
    return json(route, { watchlist: wl });
  });

  await page.route(
    '**/xstockstrat.portfolio.v1.PortfolioService/RemoveWatchlistSymbols',
    (route) => {
      const req = JSON.parse(route.request().postData() ?? '{}');
      const wl = find(req.watchlistId);
      const drop = (req.symbols ?? []).map((s: string) => (s ?? '').trim().toUpperCase());
      if (wl) {
        wl.bindings = wl.bindings.filter((b) => !drop.includes(b.symbol));
        sync(wl);
      }
      return json(route, { watchlist: wl });
    },
  );

  // feature 167 — targeted single-symbol rebind: patch ONLY that row's strategyId, leave `source`
  // untouched, and return { binding, updated_at }. Models the server's single-row UPDATE ... RETURNING.
  await page.route(
    '**/xstockstrat.portfolio.v1.PortfolioService/UpdateWatchlistBinding',
    (route) => {
      const req = JSON.parse(route.request().postData() ?? '{}');
      const wl = find(req.watchlistId);
      const sym = (req.symbol ?? '').trim().toUpperCase();
      let binding: MockBinding | undefined;
      if (wl) {
        binding = wl.bindings.find((b) => b.symbol === sym);
        if (binding) {
          binding.strategyId = req.strategyId ?? ''; // single-column patch; source untouched
          sync(wl);
        }
      }
      // Happy-path e2e: the symbol exists. (A real server returns NOT_FOUND when absent.)
      // updated_at is a google.protobuf.Timestamp → Connect-JSON encodes it as an RFC3339 string
      // (NOT {seconds,nanos}); this raw page.route body must match that wire shape or the client's
      // response decode throws and the mutation never resolves.
      return json(route, { binding, updatedAt: new Date(0).toISOString() });
    },
  );

  await page.route('**/xstockstrat.portfolio.v1.PortfolioService/DeleteWatchlist', (route) => {
    const req = JSON.parse(route.request().postData() ?? '{}');
    state.lists = state.lists.filter((w) => w.watchlistId !== req.watchlistId);
    return json(route, {});
  });
}
