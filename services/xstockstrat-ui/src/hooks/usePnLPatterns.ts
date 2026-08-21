import { useQuery } from '@tanstack/react-query';
import { analysisClient } from '@/lib/browserClients/analysisClient';

/**
 * feature 042 — P&L pattern attribution. Read-only query against the insights BFF
 * (AnalysisService.QueryPnLPatterns), which resolves the ranked positive/negative factors
 * server-side. Scoped by symbol (and optionally limit); strategy/time filters are additive.
 */
type QueryPnLPatternsResult = Awaited<ReturnType<typeof analysisClient.queryPnLPatterns>>;

export function usePnLPatterns(symbol: string, limit = 10) {
  return useQuery<QueryPnLPatternsResult, Error>({
    queryKey: ['pnl-patterns', symbol, limit],
    queryFn: () => analysisClient.queryPnLPatterns({ symbol, limit }),
    enabled: Boolean(symbol),
  });
}
