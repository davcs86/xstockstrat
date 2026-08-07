import { useQuery } from '@tanstack/react-query';
import { insightsPortfolioClient } from '@/lib/browserClients/insightsPortfolioClient';
import { useInvalidatingMutation } from './useInvalidatingMutation';

type ListWatchlistsResult = Awaited<ReturnType<typeof insightsPortfolioClient.listWatchlists>>;

const WATCHLISTS_KEY = ['watchlists'];

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
    }) =>
      insightsPortfolioClient.createWatchlist({
        name: input.name,
        description: input.description ?? '',
        symbols: input.symbols ?? [],
        bindings: input.bindings ?? [],
      }),
    [WATCHLISTS_KEY],
  );
}

export function useUpdateWatchlist() {
  return useInvalidatingMutation(
    (input: {
      watchlistId: string;
      name: string;
      description?: string;
      symbols?: string[];
      bindings?: WatchlistBindingInput[];
    }) =>
      insightsPortfolioClient.updateWatchlist({
        watchlistId: input.watchlistId,
        name: input.name,
        description: input.description ?? '',
        symbols: input.symbols ?? [],
        bindings: input.bindings ?? [],
      }),
    [WATCHLISTS_KEY],
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
  );
}

export function useRemoveWatchlistSymbols() {
  return useInvalidatingMutation(
    (input: { watchlistId: string; symbols: string[] }) =>
      insightsPortfolioClient.removeWatchlistSymbols(input),
    [WATCHLISTS_KEY],
  );
}
