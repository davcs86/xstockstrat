import { useMutation, useQuery } from '@tanstack/react-query';
import { analysisClient } from '@/lib/browserClients/analysisClient';
import { ConnectError } from '@connectrpc/connect';
import { ScreenResultStatus } from '@xstockstrat/proto/analysis/v1/analysis_pb';

export type ScreenSymbolsInput = Parameters<typeof analysisClient.screenSymbols>[0];
export type ScreenSymbolsResult = Awaited<ReturnType<typeof analysisClient.screenSymbols>>;

// On-demand screener scan — a mutation, not a polling query.
export function useScreenSymbols() {
  return useMutation<ScreenSymbolsResult, Error, ScreenSymbolsInput>({
    mutationFn: (req) => analysisClient.screenSymbols(req),
    onError: (err) => {
      if (err instanceof ConnectError) return err;
      return err;
    },
  });
}

function hasPendingRows(results: ScreenSymbolsResult['results'] | undefined): boolean {
  return (results ?? []).some((r) => r.status === ScreenResultStatus.INSUFFICIENT_DATA);
}

// Background data-readiness polling cadence. Plain TS constants, deliberately not a WatchConfig key
// (this cadence protects nothing shared).
export const POLL_INTERVAL_MS = 60_000;
export const MAX_POLL_ATTEMPTS = 5;

// Re-issues the same request while any row is INSUFFICIENT_DATA, up to the attempt cap. Bump
// `generation` per runScan() so a superseded in-flight poll gets a fresh cache entry, not a stale merge.
export function useScreenSymbolsPoll(
  req: ScreenSymbolsInput | null,
  generation: number,
  enabled: boolean,
) {
  return useQuery<ScreenSymbolsResult, Error>({
    queryKey: ['screen-symbols-poll', generation],
    queryFn: () => analysisClient.screenSymbols(req!),
    enabled: enabled && req !== null,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
    refetchIntervalInBackground: false,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data && !hasPendingRows(data.results)) return false;
      const attempts = query.state.dataUpdateCount + query.state.errorUpdateCount;
      if (attempts >= MAX_POLL_ATTEMPTS) return false;
      return POLL_INTERVAL_MS;
    },
  });
}
