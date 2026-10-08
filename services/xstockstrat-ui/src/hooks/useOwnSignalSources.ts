import { useQuery } from '@tanstack/react-query';
import { insightsIngestClient } from '@/lib/browserClients/insightsIngestClient';
import type { SignalSource } from '@xstockstrat/proto/ingest/v1/ingest_pb';

/** Owner id of platform-held sources — read-only to every user. */
export const SYSTEM_SOURCE_OWNER = 'system';

/** The caller's own sources plus system sources (incl. inactive), via the insights BFF. */
export function useOwnSignalSources(): {
  sources: SignalSource[];
  isLoading: boolean;
  error: Error | null;
} {
  const { data, isLoading, error } = useQuery({
    queryKey: ['signal-sources', 'own'],
    queryFn: () => insightsIngestClient.listSignalSources({ includeInactive: true }),
  });
  return { sources: data?.sources ?? [], isLoading, error };
}
