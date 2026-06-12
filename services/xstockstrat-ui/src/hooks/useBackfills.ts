import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { insightsIngestClient } from '@/lib/browserClients/insightsIngestClient';
import { insightsMarketDataClient } from '@/lib/browserClients/insightsMarketDataClient';
import { BackfillStatus } from '@xstockstrat/proto/ingest/v1/ingest_pb';

// Re-export the create-form trigger hook so the Backfills page imports everything from one module.
export { useTriggerBackfill } from '@/hooks/useBacktest';

const JOBS_KEY = ['insights-backfill-jobs'] as const;

type ListJobsInput = Parameters<typeof insightsIngestClient.listBackfillJobs>[0];

// Terminal job states never change, so polling can stop for them (FR-2/FR-3).
function isTerminal(status: BackfillStatus): boolean {
  return (
    status === BackfillStatus.COMPLETED ||
    status === BackfillStatus.FAILED ||
    status === BackfillStatus.PARTIAL ||
    status === BackfillStatus.CANCELED
  );
}

// Lists backfill jobs, optionally narrowed by status and/or symbol (FR-3). Polls on an interval
// so live status/progress is reflected without a manual refresh (FR-2/FR-6).
export function useBackfillJobs(filter: Partial<ListJobsInput> = {}) {
  return useQuery({
    queryKey: [...JOBS_KEY, filter],
    queryFn: () => insightsIngestClient.listBackfillJobs(filter as ListJobsInput),
    refetchInterval: 4000,
  });
}

// Polls a single job's status for live progress while it is non-terminal (FR-2). Once the job
// reaches a terminal state, polling stops.
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

// Cancels a QUEUED/RUNNING job (admin only — gated by the BFF and ingest server). Refreshes the
// jobs list on success so the CANCELED state shows immediately (FR-4).
export function useCancelBackfill() {
  const qc = useQueryClient();
  return useMutation<CancelResult, Error, CancelInput>({
    mutationFn: (req) => insightsIngestClient.cancelBackfill(req),
    onSuccess: () => qc.invalidateQueries({ queryKey: JOBS_KEY }),
  });
}

type DeleteInput = Parameters<typeof insightsMarketDataClient.deleteBackfilledData>[0];
type DeleteResult = Awaited<ReturnType<typeof insightsMarketDataClient.deleteBackfilledData>>;

// Scoped delete of backfilled OHLCV bars (admin only — gated by the BFF and marketdata server,
// FR-5). Refreshes the jobs list afterwards so coverage-derived views update.
export function useDeleteBackfilledData() {
  const qc = useQueryClient();
  return useMutation<DeleteResult, Error, DeleteInput>({
    mutationFn: (req) => insightsMarketDataClient.deleteBackfilledData(req),
    onSuccess: () => qc.invalidateQueries({ queryKey: JOBS_KEY }),
  });
}
