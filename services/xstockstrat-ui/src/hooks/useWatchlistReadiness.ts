import { useQuery } from '@tanstack/react-query';
import { ReadinessState } from '@xstockstrat/proto/analysis/v1/analysis_pb';
import { analysisClient } from '@/lib/browserClients/analysisClient';

type GetWatchlistReadinessResult = Awaited<ReturnType<typeof analysisClient.getWatchlistReadiness>>;
export type WatchlistReadinessRow = GetWatchlistReadinessResult['rows'][number];

// Poll cadence — matches feature-177's 30s readiness staleness window (the cadence the removed
// per-strategy useQueries fan-out used).
export const WATCHLIST_READINESS_POLL_MS = 30_000;
// Page size — a UI constant (not a config key), mirrors the backend GetWatchlistReadiness default.
export const WATCHLIST_READINESS_PAGE_SIZE = 25;

/**
 * Feature 181: the cache-first watchlist readiness decoration for one keyset page of a watchlist's
 * bound (symbol, strategy) pairs. Its own query key `['watchlistReadiness', watchlistId, pageToken]`
 * — disjoint from `['watchlists']` so the feature-167 single-row cache patch (@AC-6) is never
 * disturbed. `pagePairs` is the visible page's bound (symbol, strategyId) rows, derived from the
 * `['watchlists']` bindings (no data dependency); the poll stays alive while any of THOSE rendered
 * pairs is missing/PENDING/UNKNOWN — so a symbol just added to `['watchlists']` (no readiness row
 * yet) keeps polling instead of hanging on a Skeleton (design Round-3 Obj 6 / Round-4 recovery),
 * and stops once every rendered pair is RESOLVED.
 */
export function useWatchlistReadiness(
  watchlistId: string,
  pageToken: string,
  pagePairs: { symbol: string; strategyId: string }[],
) {
  return useQuery({
    queryKey: ['watchlistReadiness', watchlistId, pageToken],
    queryFn: () =>
      analysisClient.getWatchlistReadiness({
        watchlistId,
        page: { pageSize: WATCHLIST_READINESS_PAGE_SIZE, pageToken },
      }),
    enabled: Boolean(watchlistId),
    staleTime: WATCHLIST_READINESS_POLL_MS,
    refetchInterval: (query) => {
      const map = readinessRowMap(query.state.data?.rows);
      const pending = pagePairs.some((p) => {
        const rr = map.get(readinessRowKey(p.symbol, p.strategyId));
        return !rr || rr.state === ReadinessState.PENDING || rr.state === ReadinessState.UNKNOWN;
      });
      return pending ? WATCHLIST_READINESS_POLL_MS : false;
    },
  });
}

/** Build a `${SYMBOL}|${strategyId}` → row map for joining decorated readiness onto binding rows. */
export function readinessRowKey(symbol: string, strategyId: string): string {
  return `${symbol.toUpperCase()}|${strategyId}`;
}

/**
 * Decode the server's opaque keyset page token (urlsafe-base64 of `symbol\x00strategy_id`) back to
 * `[symbol, strategyId]` so the client can slice its own `['watchlists']` bindings to the SAME page
 * the server decorated. Empty/garbage → null (first page); never throws.
 */
export function decodePairToken(token: string): [string, string] | null {
  if (!token) return null;
  try {
    const raw = atob(token.replace(/-/g, '+').replace(/_/g, '/'));
    const i = raw.indexOf('\x00');
    return i < 0 ? [raw, ''] : [raw.slice(0, i), raw.slice(i + 1)];
  } catch {
    return null;
  }
}

export function readinessRowMap(
  rows: WatchlistReadinessRow[] | undefined,
): Map<string, WatchlistReadinessRow> {
  const m = new Map<string, WatchlistReadinessRow>();
  for (const r of rows ?? []) m.set(readinessRowKey(r.symbol, r.strategyId), r);
  return m;
}
