import { useQuery } from '@tanstack/react-query';
import { analysisClient } from '@/lib/browserClients/analysisClient';

type ListStrategiesResult = Awaited<ReturnType<typeof analysisClient.listStrategies>>;
type GetStrategyReportResult = Awaited<ReturnType<typeof analysisClient.getStrategyReport>>;

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
  });
}
