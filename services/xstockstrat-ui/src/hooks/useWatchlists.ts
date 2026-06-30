import { useQuery } from '@tanstack/react-query';
import { insightsPortfolioClient } from '@/lib/browserClients/insightsPortfolioClient';
import { useInvalidatingMutation } from './useInvalidatingMutation';

type ListWatchlistsResult = Awaited<ReturnType<typeof insightsPortfolioClient.listWatchlists>>;

const WATCHLISTS_KEY = ['watchlists'];

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
    (input: { name: string; description?: string; symbols?: string[] }) =>
      insightsPortfolioClient.createWatchlist({
        name: input.name,
        description: input.description ?? '',
        symbols: input.symbols ?? [],
      }),
    [WATCHLISTS_KEY],
  );
}

export function useUpdateWatchlist() {
  return useInvalidatingMutation(
    (input: { watchlistId: string; name: string; description?: string; symbols?: string[] }) =>
      insightsPortfolioClient.updateWatchlist({
        watchlistId: input.watchlistId,
        name: input.name,
        description: input.description ?? '',
        symbols: input.symbols ?? [],
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
    (input: { watchlistId: string; symbols: string[] }) =>
      insightsPortfolioClient.addWatchlistSymbols(input),
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
