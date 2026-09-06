import { useQuery } from '@tanstack/react-query';
import { marketDataClient } from '@/lib/browserClients/marketDataClient';

/**
 * Fundamentals ratios/metrics for a symbol — GetFundamentals on MarketDataService. A no-data symbol
 * does NOT surface as NotFound: the backend wraps the miss as UNAVAILABLE / FAILED_PRECONDITION /
 * RESOURCE_EXHAUSTED, so callers must treat ANY error as the no-data state (never special-case
 * NotFound). `retry: false` — none of those errors is transient.
 */
export function useFundamentals(symbol: string) {
  return useQuery({
    queryKey: ['fundamentals', symbol],
    queryFn: () => marketDataClient.getFundamentals({ symbol }),
    enabled: Boolean(symbol),
    retry: false,
  });
}
