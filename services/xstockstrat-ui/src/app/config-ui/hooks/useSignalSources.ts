import { useQuery } from '@tanstack/react-query';
import { ingestClient } from '@/lib/browserClients/ingestClient';
import type { SignalSource } from '@xstockstrat/proto/ingest/v1/ingest_pb';

/**
 * Admin read-only view of one owner's sources (FR-13). The backend honours `ownerUserId` only for an
 * admin and audits every foreign read; nothing is fetched until an owner is selected.
 */
export function useSignalSources(ownerUserId: string): {
  sources: SignalSource[];
  isLoading: boolean;
  error: Error | null;
} {
  const { data, isLoading, error } = useQuery({
    queryKey: ['signal-sources', 'admin', ownerUserId],
    enabled: ownerUserId !== '',
    queryFn: () => ingestClient.listSignalSources({ includeInactive: true, ownerUserId }),
  });
  return { sources: data?.sources ?? [], isLoading, error };
}
