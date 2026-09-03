import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { insightsPortfolioClient } from '@/lib/browserClients/insightsPortfolioClient';
import { useInvalidatingMutation } from './useInvalidatingMutation';

type ListWatchlistsResult = Awaited<ReturnType<typeof insightsPortfolioClient.listWatchlists>>;

const WATCHLISTS_KEY = ['watchlists'];
// Shared mutationKey for every per-symbol/rename write (add/remove/rebind/rename) — lets an
// ancestor that never remounts (page.tsx) detect an in-flight write via `useIsMutating`, even one
// started by a WatchlistDetail instance that has since unmounted on a watchlist switch (design.md
// §5 Layer 2). Deliberately NOT per-watchlist ([..., watchlistId]) — watchlistId is only known at
// `.mutate()` call time, not at this hook-definition time.
export const WATCHLIST_WRITE_KEY = ['watchlist-write'];

/**
 * feature 097 — a per-symbol `(symbol, strategyId)` binding (FR-6). The write path carries
 * `bindings` (authoritative) so a bare-`symbols` write never resets a symbol's `strategyId` to ''
 * (the fails-080 reset trap). `strategyId: ''` = a watched-but-unbound symbol.
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
      // feature 170 — watchlist-level default strategy applied to initial bare symbols at add time.
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
 * feature 097 replace-all update, extended with the feature-170 field mask. Pass `updateMask` (proto
 * field-name paths, e.g. `['default_strategy_id']`) for a PARTIAL update that writes only those
 * scalar fields and leaves bindings untouched; omit it for the legacy replace-all of
 * name/description/bindings. `defaultStrategyId` is only persisted on the masked path — the backend
 * rejects it without a mask. Existing name/binding edits MUST omit `updateMask` to stay on the
 * legacy path (design.md Open Risk — asserted by the e2e mask-discipline spy).
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
 * feature 167 — targeted single-symbol rebind. A plain (non-invalidating) useMutation: on success it
 * PATCHES just the one binding in the cached ['watchlists'] list from the RPC's returned
 * WatchlistBinding (carrying `source`), with NO invalidateQueries → no listWatchlists refetch (AC-6).
 * Carries mutationKey WATCHLIST_WRITE_KEY so the Layer-2 `useIsMutating` guard still serializes it
 * against rename/remove (design.md §5 Layer 2).
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
      // NO invalidateQueries(['watchlists']) — the whole point of AC-6.
    },
  });
}

/**
 * feature 170 — atomic bulk rebind. One transactional RPC assigns `strategyId` across all `symbols`;
 * on success it PATCHES every changed row in the cached ['watchlists'] list from the response
 * `bindings` array, with NO invalidateQueries → no listWatchlists refetch (preserves AC-6). Carries
 * WATCHLIST_WRITE_KEY so the Layer-2 in-flight guard serializes it against other writes.
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
      // NO invalidateQueries(['watchlists']) — bulk patch mirrors the single-row AC-6 guarantee.
    },
  });
}
