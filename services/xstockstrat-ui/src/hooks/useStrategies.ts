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
    // An unscored strategy answers NOT_FOUND (terminal, not transient) — don't retry it; other
    // errors still get the global one retry.
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

// Persisted full result of one past run. NOT_FOUND is terminal (legacy/evicted/insufficient), not
// transient — don't retry it.
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
