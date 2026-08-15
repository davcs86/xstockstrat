import { useQuery } from '@tanstack/react-query';
import { ingestClient } from '@/lib/browserClients/ingestClient';
import type { SignalSource } from '@xstockstrat/proto/ingest/v1/ingest_pb';

export function useSignalSources(): {
  sources: SignalSource[];
  isLoading: boolean;
  error: Error | null;
} {
  const { data, isLoading, error } = useQuery({
    queryKey: ['signal-sources'],
    // feature 134: the reliability weight now lives on each SignalSource as `reliabilityWeight`
    // (ingest.SignalSource.reliability_weight), so the former `analysis.signals.source_weights`
    // config combine is gone — one RPC, no listKeys parse.
    queryFn: async () => {
      const s = await ingestClient.listSignalSources({ includeInactive: true });
      return { sources: s.sources ?? [] };
    },
  });
  return { sources: data?.sources ?? [], isLoading, error };
}
