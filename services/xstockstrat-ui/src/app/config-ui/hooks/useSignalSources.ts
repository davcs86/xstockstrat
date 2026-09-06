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
    // Reliability weight lives on each SignalSource (reliability_weight) — one RPC, no listKeys parse.
    queryFn: async () => {
      const s = await ingestClient.listSignalSources({ includeInactive: true });
      return { sources: s.sources ?? [] };
    },
  });
  return { sources: data?.sources ?? [], isLoading, error };
}
