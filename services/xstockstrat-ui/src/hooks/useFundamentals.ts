import { useQuery } from '@tanstack/react-query';
import { marketDataClient } from '@/lib/browserClients/marketDataClient';

/**
 * Fundamentals ratios/metrics for a symbol (feature 125, FR-7) — GetFundamentals on
 * MarketDataService, a read-through cache over the active provider. A symbol with no data does NOT
 * surface as NotFound: the backend wraps the miss as UNAVAILABLE (no FMP row), FAILED_PRECONDITION
 * (fundamentals disabled), or RESOURCE_EXHAUSTED (quota, no cache) — so callers must treat ANY error
 * as the explicit no-data state (never special-case NotFound like the rest of this page). `retry:
 * false` because none of those errors is transient enough to warrant a retry on a page-load read.
 */
export function useFundamentals(symbol: string) {
  return useQuery({
    queryKey: ['fundamentals', symbol],
    queryFn: () => marketDataClient.getFundamentals({ symbol }),
    enabled: Boolean(symbol),
    retry: false,
  });
}
