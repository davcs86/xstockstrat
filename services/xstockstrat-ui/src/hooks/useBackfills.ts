import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { insightsIngestClient } from '@/lib/browserClients/insightsIngestClient';
import { insightsMarketDataClient } from '@/lib/browserClients/insightsMarketDataClient';
import { BackfillStatus } from '@xstockstrat/proto/ingest/v1/ingest_pb';

export { useTriggerBackfill } from '@/hooks/useBacktest';

const JOBS_KEY = ['insights-backfill-jobs'] as const;

type ListJobsInput = Parameters<typeof insightsIngestClient.listBackfillJobs>[0];

// Terminal job states never change, so polling can stop for them.
function isTerminal(status: BackfillStatus): boolean {
  return (
    status === BackfillStatus.COMPLETED ||
    status === BackfillStatus.FAILED ||
    status === BackfillStatus.PARTIAL ||
    status === BackfillStatus.CANCELED
  );
}

export function useBackfillJobs(filter: Partial<ListJobsInput> = {}) {
  return useQuery({
    queryKey: [...JOBS_KEY, filter],
    queryFn: () => insightsIngestClient.listBackfillJobs(filter as ListJobsInput),
    refetchInterval: 4000,
  });
}

export function useBackfillStatus(jobId: string | undefined) {
  return useQuery({
    queryKey: ['insights-backfill-status', jobId],
    queryFn: () => insightsIngestClient.getBackfillStatus({ jobId: jobId! }),
    enabled: !!jobId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status !== undefined && isTerminal(status) ? false : 4000;
    },
  });
}

type CancelInput = Parameters<typeof insightsIngestClient.cancelBackfill>[0];
type CancelResult = Awaited<ReturnType<typeof insightsIngestClient.cancelBackfill>>;

// Admin only — gated by the BFF and ingest server.
export function useCancelBackfill() {
  const qc = useQueryClient();
  return useMutation<CancelResult, Error, CancelInput>({
    mutationFn: (req) => insightsIngestClient.cancelBackfill(req),
    onSuccess: () => qc.invalidateQueries({ queryKey: JOBS_KEY }),
  });
}

type DeleteInput = Parameters<typeof insightsMarketDataClient.deleteBackfilledData>[0];
type DeleteResult = Awaited<ReturnType<typeof insightsMarketDataClient.deleteBackfilledData>>;

// Admin only — gated by the BFF and marketdata server.
export function useDeleteBackfilledData() {
  const qc = useQueryClient();
  return useMutation<DeleteResult, Error, DeleteInput>({
    mutationFn: (req) => insightsMarketDataClient.deleteBackfilledData(req),
    onSuccess: () => qc.invalidateQueries({ queryKey: JOBS_KEY }),
  });
}
