import { useQuery } from '@tanstack/react-query';
import { timestampFromDate } from '@bufbuild/protobuf/wkt';
import { analysisClient } from '@/lib/browserClients/analysisClient';

/**
 * Per-source signal-performance attribution. Read-only GetAttribution query, owner-scoped
 * server-side from the x-user-id header. Optional [start, end] window and a source_id filter.
 */
type GetAttributionResult = Awaited<ReturnType<typeof analysisClient.getAttribution>>;

export function useSignalAttribution(params: { start?: Date; end?: Date; sourceId?: string }) {
  const { start, end, sourceId = '' } = params;
  return useQuery<GetAttributionResult, Error>({
    queryKey: ['signal-attribution', start?.toISOString() ?? '', end?.toISOString() ?? '', sourceId],
    queryFn: () =>
      analysisClient.getAttribution({
        start: start ? timestampFromDate(start) : undefined,
        end: end ? timestampFromDate(end) : undefined,
        sourceId,
      }),
  });
}
