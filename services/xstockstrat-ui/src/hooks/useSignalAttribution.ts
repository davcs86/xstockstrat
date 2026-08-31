import { useQuery } from '@tanstack/react-query';
import { timestampFromDate } from '@bufbuild/protobuf/wkt';
import { analysisClient } from '@/lib/browserClients/analysisClient';

/**
 * feature 029 — per-source signal-performance attribution. Read-only query against the insights BFF
 * (AnalysisService.GetAttribution), owner-scoped server-side from the propagated x-user-id header.
 * Optional [start, end] window (Date → protobuf-es Timestamp) and a source_id slug filter.
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
