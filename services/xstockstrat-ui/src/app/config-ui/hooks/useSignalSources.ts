import { useQuery } from '@tanstack/react-query';
import { ingestClient } from '@/lib/browserClients/ingestClient';
import { configClient } from '@/lib/browserClients/configClient';
import type { SignalSource } from '@xstockstrat/proto/ingest/v1/ingest_pb';

export function useSignalSources(): {
  sources: SignalSource[];
  weights: Record<string, number>;
  isLoading: boolean;
  error: Error | null;
} {
  const { data, isLoading, error } = useQuery({
    queryKey: ['signal-sources'],
    queryFn: async () => {
      const [s, c] = await Promise.all([
        ingestClient.listSignalSources({ includeInactive: true }),
        configClient.listKeys({ namespace: 'analysis', environment: 1, tradingMode: 1 }),
      ]);
      const weightKey = (c.keys ?? []).find((k) => k.key === 'analysis.signals.source_weights');
      let weights: Record<string, number> = {};
      if (weightKey) {
        // currentValue is the live value_data (what an admin edit actually wrote);
        // defaultValue is just the seed metadata and never reflects a saved edit (CONFIG-2).
        try {
          weights = JSON.parse(weightKey.currentValue);
        } catch {
          /* no-op */
        }
      }
      return { sources: s.sources ?? [], weights };
    },
  });
  return { sources: data?.sources ?? [], weights: data?.weights ?? {}, isLoading, error };
}
