import { useQueries } from '@tanstack/react-query';
import { insightsMarketDataClient } from '@/lib/browserClients/insightsMarketDataClient';
import { Timeframe } from '@xstockstrat/proto/common/v1/common_pb';
import { selectOhlcBar } from '@/lib/protoTime';
export type { OhlcData } from '@/lib/protoTime';

const OHLC_BAR_COUNT = 2;
const OHLC_STALE_MS = 120_000; // 2 min — matches the server-side live_enrich_ttl_seconds bump

/**
 * Fetches the previous trading day's OHLC bar per symbol via the insights BFF `getBars`.
 * Each symbol is an independent React Query entry so re-renders are per-symbol and deduplication
 * is automatic. Returns a stable `Map<symbol, OhlcData | undefined>`.
 */
export function useOhlcBars(
  symbols: string[],
): Map<string, import('@/lib/protoTime').OhlcData | undefined> {
  const queries = useQueries({
    queries: symbols.map((symbol) => ({
      queryKey: ['ohlcBar', symbol],
      queryFn: async (): Promise<{
        symbol: string;
        data: import('@/lib/protoTime').OhlcData | undefined;
      }> => {
        const res = await insightsMarketDataClient.getBars({
          symbol,
          timeframeEnum: Timeframe.TIMEFRAME_1DAY,
          page: { pageSize: OHLC_BAR_COUNT },
        });
        const data = selectOhlcBar(res.bars);
        return { symbol, data };
      },
      staleTime: OHLC_STALE_MS,
      retry: 0,
      refetchOnWindowFocus: false,
    })),
  });

  const map = new Map<string, import('@/lib/protoTime').OhlcData | undefined>();
  for (const q of queries) {
    if (q.data) map.set(q.data.symbol, q.data.data);
  }
  return map;
}
