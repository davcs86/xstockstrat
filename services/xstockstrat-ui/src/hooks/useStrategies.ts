import { useQuery } from '@tanstack/react-query';
import { analysisClient } from '@/lib/browserClients/analysisClient';
import { isNotFoundError } from '@/lib/scoreDisplay';

type ListStrategiesResult = Awaited<ReturnType<typeof analysisClient.listStrategies>>;
type GetStrategyReportResult = Awaited<ReturnType<typeof analysisClient.getStrategyReport>>;
type ListBacktestsResult = Awaited<ReturnType<typeof analysisClient.listBacktests>>;
type GetBacktestResult = Awaited<ReturnType<typeof analysisClient.getBacktest>>;

export function useStrategies(): {
  data: ListStrategiesResult | undefined;
  isLoading: boolean;
  error: Error | null;
} {
  return useQuery({
    queryKey: ['analysis-strategies'],
    queryFn: () => analysisClient.listStrategies({ page: { pageSize: 50 } }),
    refetchInterval: 30_000,
  });
}

export function useStrategyReport(strategyId: string | undefined): {
  data: GetStrategyReportResult | undefined;
  isLoading: boolean;
  error: Error | null;
} {
  return useQuery({
    queryKey: ['analysis-report', strategyId],
    queryFn: () => analysisClient.getStrategyReport({ strategyId: strategyId! }),
    enabled: !!strategyId,
    // feature 065: an unscored strategy now answers NOT_FOUND (derived grade cleared / never
    // earned). That is a terminal state, not a transient error — do not retry it; the detail page
    // renders a cleared-grade card. Any other error still gets the global one retry.
    retry: (failureCount, err) => !isNotFoundError(err) && failureCount < 1,
  });
}

// Durable backtest run history for a strategy (analysis.backtest_runs), newest first.
export function useBacktestHistory(strategyId: string | undefined): {
  data: ListBacktestsResult | undefined;
  isLoading: boolean;
  error: Error | null;
} {
  return useQuery({
    queryKey: ['analysis-backtests', strategyId],
    queryFn: () => analysisClient.listBacktests({ strategyId: strategyId! }),
    enabled: !!strategyId,
  });
}

// feature 068: the persisted full result of one past run (analysis.backtest_details).
// NOT_FOUND is the terminal legacy/evicted/insufficient state, not a transient error —
// the page renders the "no detailed data" empty state for it (FR-6).
export function useBacktestDetail(backtestId: string | undefined): {
  data: GetBacktestResult | undefined;
  isLoading: boolean;
  error: Error | null;
  isNotFound: boolean;
} {
  const query = useQuery({
    queryKey: ['analysis-backtest-detail', backtestId],
    queryFn: () => analysisClient.getBacktest({ backtestId: backtestId! }),
    enabled: !!backtestId,
    retry: (failureCount, err) => !isNotFoundError(err) && failureCount < 1,
  });
  return { ...query, isNotFound: isNotFoundError(query.error) };
}
