import { useQuery } from '@tanstack/react-query';
import { insightsIngestClient } from '@/lib/browserClients/insightsIngestClient';
import type { SignalSource } from '@xstockstrat/proto/ingest/v1/ingest_pb';

/**
 * Live (active) signal sources for the strategy wizard's Signal Params step
 * (`includeInactive: false`).
 */
export function useInsightsSignalSources(): {
  sources: SignalSource[];
  isLoading: boolean;
  error: Error | null;
} {
  const { data, isLoading, error } = useQuery({
    queryKey: ['insights-signal-sources'],
    queryFn: () => insightsIngestClient.listSignalSources({ includeInactive: false }),
  });
  return { sources: data?.sources ?? [], isLoading, error };
}
