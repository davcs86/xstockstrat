import { useMutation, useQuery } from '@tanstack/react-query';
import { analysisClient } from '@/lib/browserClients/analysisClient';
import { ConnectError } from '@connectrpc/connect';
import { ScreenResultStatus } from '@xstockstrat/proto/analysis/v1/analysis_pb';

export type ScreenSymbolsInput = Parameters<typeof analysisClient.screenSymbols>[0];
export type ScreenSymbolsResult = Awaited<ReturnType<typeof analysisClient.screenSymbols>>;

// On-demand screener scan (feature 060, FR-9) — a mutation, not a polling query.
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

// Feature 118 — background data-readiness polling. Plain TS constants (not a WatchConfig key),
// matching the `TOP_N` precedent in screener/page.tsx: this cadence protects nothing shared —
// see design.md § Chosen Approach for the cost analysis that ruled out a config key.
export const POLL_INTERVAL_MS = 60_000;
export const MAX_POLL_ATTEMPTS = 5;

// Re-issues the exact same ScreenSymbols request on an interval while any row is
// INSUFFICIENT_DATA, stopping once everything resolves or the attempt cap is hit. `generation`
// is the scan-generation guard (design.md): bump it on every new runScan() so a still-in-flight
// poll from a superseded scan gets a fresh query cache entry instead of merging stale data into
// the new scan's table.
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
