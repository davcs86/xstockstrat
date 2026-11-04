import { useMutation } from '@tanstack/react-query';
import { analysisClient } from '@/lib/browserClients/analysisClient';
import { insightsIngestClient } from '@/lib/browserClients/insightsIngestClient';

type RunBacktestInput = Parameters<typeof analysisClient.runBacktest>[0];
type BacktestResult = Awaited<ReturnType<typeof analysisClient.runBacktest>>;

export function useRunBacktest() {
  return useMutation<BacktestResult, Error, RunBacktestInput>({
    mutationFn: (req) => analysisClient.runBacktest(req),
    meta: { errorHandled: true },
  });
}

type TriggerBackfillInput = Parameters<typeof insightsIngestClient.triggerBackfill>[0];
type TriggerBackfillResult = Awaited<ReturnType<typeof insightsIngestClient.triggerBackfill>>;

// Fills a data-coverage gap surfaced by a backtest by triggering a marketdata backfill over the missing range.
export function useTriggerBackfill() {
  return useMutation<TriggerBackfillResult, Error, TriggerBackfillInput>({
    mutationFn: (req) => insightsIngestClient.triggerBackfill(req),
  });
}
