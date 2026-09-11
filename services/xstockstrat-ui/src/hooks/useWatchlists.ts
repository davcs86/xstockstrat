import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { insightsPortfolioClient } from '@/lib/browserClients/insightsPortfolioClient';
import { useInvalidatingMutation } from './useInvalidatingMutation';

type ListWatchlistsResult = Awaited<ReturnType<typeof insightsPortfolioClient.listWatchlists>>;

const WATCHLISTS_KEY = ['watchlists'];
// Shared mutationKey for every per-symbol/rename write, so `useIsMutating` still sees an in-flight
// write after the originating child unmounts. NOT per-watchlist — watchlistId is only known at mutate time.
export const WATCHLIST_WRITE_KEY = ['watchlist-write'];

/**
 * A per-symbol `(symbol, strategyId)` binding. The write path carries `bindings` (authoritative) so
 * a bare-`symbols` write never resets a symbol's `strategyId` to ''. `strategyId: ''` = unbound.
 */
export type WatchlistBindingInput = { symbol: string; strategyId: string };

// Radix Select forbids an empty-string item value, so an unbound symbol uses this sentinel.
export const UNBOUND = '__unbound__';
export function toApiStrategyId(v: string): string {
  return v === UNBOUND ? '' : v;
}

/** List the calling user's watchlists (ownership scoped server-side by x-user-id). */
export function useWatchlists(): {
  data: ListWatchlistsResult | undefined;
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
} {
  return useQuery({
    queryKey: WATCHLISTS_KEY,
    queryFn: () => insightsPortfolioClient.listWatchlists({ page: { pageSize: 50 } }),
  });
}

export function useCreateWatchlist() {
  return useInvalidatingMutation(
    (input: {
      name: string;
      description?: string;
      symbols?: string[];
      bindings?: WatchlistBindingInput[];
      // Watchlist-level default strategy applied to initial bare symbols at add time.
      defaultStrategyId?: string;
    }) =>
      insightsPortfolioClient.createWatchlist({
        name: input.name,
        description: input.description ?? '',
        symbols: input.symbols ?? [],
        bindings: input.bindings ?? [],
        defaultStrategyId: input.defaultStrategyId ?? '',
      }),
    [WATCHLISTS_KEY],
  );
}

/**
 * Replace-all update, with a field mask. Pass `updateMask` (proto field-name paths, e.g.
 * `['default_strategy_id']`) for a PARTIAL update of only those scalar fields, leaving bindings
 * untouched; omit it for the replace-all of name/description/bindings. `defaultStrategyId` persists
 * only on the masked path (the backend rejects it without a mask), so name/binding edits MUST omit
 * `updateMask`.
 */
export function useUpdateWatchlist() {
  return useInvalidatingMutation(
    (input: {
      watchlistId: string;
      name?: string;
      description?: string;
      symbols?: string[];
      bindings?: WatchlistBindingInput[];
      defaultStrategyId?: string;
      updateMask?: string[];
    }) =>
      insightsPortfolioClient.updateWatchlist({
        watchlistId: input.watchlistId,
        name: input.name ?? '',
        description: input.description ?? '',
        symbols: input.symbols ?? [],
        bindings: input.bindings ?? [],
        defaultStrategyId: input.defaultStrategyId ?? '',
        updateMask: input.updateMask ? { paths: input.updateMask } : undefined,
      }),
    [WATCHLISTS_KEY],
    { mutationKey: WATCHLIST_WRITE_KEY },
  );
}

export function useDeleteWatchlist() {
  return useInvalidatingMutation(
    (watchlistId: string) => insightsPortfolioClient.deleteWatchlist({ watchlistId }),
    [WATCHLISTS_KEY],
  );
}

export function useAddWatchlistSymbols() {
  return useInvalidatingMutation(
    (input: { watchlistId: string; symbols: string[]; bindings?: WatchlistBindingInput[] }) =>
      insightsPortfolioClient.addWatchlistSymbols({
        watchlistId: input.watchlistId,
        symbols: input.symbols,
        bindings: input.bindings ?? [],
      }),
    [WATCHLISTS_KEY],
    { mutationKey: WATCHLIST_WRITE_KEY },
  );
}

export function useRemoveWatchlistSymbols() {
  return useInvalidatingMutation(
    (input: { watchlistId: string; symbols: string[] }) =>
      insightsPortfolioClient.removeWatchlistSymbols(input),
    [WATCHLISTS_KEY],
    { mutationKey: WATCHLIST_WRITE_KEY },
  );
}

/**
 * Targeted single-symbol rebind. Patches the one binding in the cached ['watchlists'] list from the
 * RPC result, NO invalidateQueries (no refetch). WATCHLIST_WRITE_KEY serializes it against rename/remove.
 */
export function useUpdateWatchlistBinding() {
  const queryClient = useQueryClient();
  return useMutation<
    Awaited<ReturnType<typeof insightsPortfolioClient.updateWatchlistBinding>>,
    Error,
    { watchlistId: string; symbol: string; strategyId: string }
  >({
    mutationKey: WATCHLIST_WRITE_KEY,
    mutationFn: (input) =>
      insightsPortfolioClient.updateWatchlistBinding({
        watchlistId: input.watchlistId,
        symbol: input.symbol,
        strategyId: input.strategyId,
      }),
    onSuccess: (result, input) => {
      const patched = result.binding;
      if (!patched) return;
      queryClient.setQueryData(WATCHLISTS_KEY, (old: ListWatchlistsResult | undefined) => {
        if (!old) return old;
        return {
          ...old,
          watchlists: old.watchlists.map((wl) =>
            wl.watchlistId === input.watchlistId
              ? {
                  ...wl,
                  bindings: wl.bindings.map((b) => (b.symbol === patched.symbol ? patched : b)),
                }
              : wl,
          ),
        };
      });
      // NO invalidateQueries(['watchlists']) — patch the cache, never refetch.
    },
  });
}

/**
 * Atomic bulk rebind. One transactional RPC assigns `strategyId` across all `symbols`; patches every
 * changed row in the cached ['watchlists'] list, NO invalidateQueries. WATCHLIST_WRITE_KEY serializes it.
 */
export function useUpdateWatchlistBindings() {
  const queryClient = useQueryClient();
  return useMutation<
    Awaited<ReturnType<typeof insightsPortfolioClient.updateWatchlistBindings>>,
    Error,
    { watchlistId: string; symbols: string[]; strategyId: string }
  >({
    mutationKey: WATCHLIST_WRITE_KEY,
    mutationFn: (input) =>
      insightsPortfolioClient.updateWatchlistBindings({
        watchlistId: input.watchlistId,
        symbols: input.symbols,
        strategyId: input.strategyId,
      }),
    onSuccess: (result, input) => {
      const changed = new Map(result.bindings.map((b) => [b.symbol, b]));
      if (changed.size === 0) return;
      queryClient.setQueryData(WATCHLISTS_KEY, (old: ListWatchlistsResult | undefined) => {
        if (!old) return old;
        return {
          ...old,
          watchlists: old.watchlists.map((wl) =>
            wl.watchlistId === input.watchlistId
              ? { ...wl, bindings: wl.bindings.map((b) => changed.get(b.symbol) ?? b) }
              : wl,
          ),
        };
      });
      // NO invalidateQueries(['watchlists']) — bulk patch mirrors the single-row cache-patch guarantee.
    },
  });
}
