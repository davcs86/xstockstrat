import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { insightsPortfolioClient } from '@/lib/browserClients/insightsPortfolioClient';

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
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; description?: string; symbols?: string[] }) =>
      insightsPortfolioClient.createWatchlist({
        name: input.name,
        description: input.description ?? '',
        symbols: input.symbols ?? [],
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: WATCHLISTS_KEY }),
  });
}

export function useUpdateWatchlist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      watchlistId: string;
      name: string;
      description?: string;
      symbols?: string[];
    }) =>
      insightsPortfolioClient.updateWatchlist({
        watchlistId: input.watchlistId,
        name: input.name,
        description: input.description ?? '',
        symbols: input.symbols ?? [],
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: WATCHLISTS_KEY }),
  });
}

export function useDeleteWatchlist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (watchlistId: string) =>
      insightsPortfolioClient.deleteWatchlist({ watchlistId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: WATCHLISTS_KEY }),
  });
}

export function useAddWatchlistSymbols() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { watchlistId: string; symbols: string[] }) =>
      insightsPortfolioClient.addWatchlistSymbols(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: WATCHLISTS_KEY }),
  });
}

export function useRemoveWatchlistSymbols() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { watchlistId: string; symbols: string[] }) =>
      insightsPortfolioClient.removeWatchlistSymbols(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: WATCHLISTS_KEY }),
  });
}
