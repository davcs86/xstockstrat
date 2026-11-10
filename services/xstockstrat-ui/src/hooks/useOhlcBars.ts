import { useQuery } from '@tanstack/react-query';
import { insightsMarketDataClient } from '@/lib/browserClients/insightsMarketDataClient';
import { selectOhlcBar, type OhlcData } from '@/lib/protoTime';
export type { OhlcData } from '@/lib/protoTime';

// A 14-day window always holds the previous session's bar across long weekends/holidays.
const OHLC_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const OHLC_MAX_BARS = 20;
const OHLC_STALE_MS = 120_000; // 2 min — matches the server-side live_enrich_ttl_seconds bump

/**
 * Fetches the previous trading day's OHLC bar for every symbol in ONE insights-BFF `batchGetBars`
 * call. Must never fan out per symbol: a page-sized burst of `getBars` queues on marketdata's
 * 2-connection DB pool and starves the Symbol page's chart past the 30s BFF deadline.
 */
export function useOhlcBars(symbols: string[]): Map<string, OhlcData | undefined> {
  const sorted = [...new Set(symbols)].sort();
  const { data } = useQuery({
    queryKey: ['ohlcBars', sorted],
    enabled: sorted.length > 0,
    queryFn: async (): Promise<Map<string, OhlcData | undefined>> => {
      const end = new Date();
      const res = await insightsMarketDataClient.batchGetBars({
        symbols: sorted,
        timeframe: '1d',
        start: { seconds: BigInt(Math.floor((end.getTime() - OHLC_WINDOW_MS) / 1000)), nanos: 0 },
        end: { seconds: BigInt(Math.floor(end.getTime() / 1000)), nanos: 0 },
        maxBarsPerSymbol: OHLC_MAX_BARS,
        allowPartial: true,
      });
      const map = new Map<string, OhlcData | undefined>();
      for (const r of res.results) map.set(r.symbol, selectOhlcBar(r.bars));
      return map;
    },
    staleTime: OHLC_STALE_MS,
    retry: 0,
    refetchOnWindowFocus: false,
  });
  return data ?? EMPTY;
}

const EMPTY: Map<string, OhlcData | undefined> = new Map();
