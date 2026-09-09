import { useQueries } from '@tanstack/react-query';
import { create } from '@bufbuild/protobuf';
import { insightsMarketDataClient } from '@/lib/browserClients/insightsMarketDataClient';
import { Timeframe } from '@xstockstrat/proto/common/v1/common_pb';
import {
  type SparklinePoint,
  SparklinePointSchema,
} from '@xstockstrat/proto/analysis/v1/analysis_pb';

const SPARKLINE_BARS = 20;
const SPARKLINE_STALE_MS = 120_000; // 2 min — matches the server-side live_enrich_ttl_seconds bump

/**
 * Async sparkline fetcher: loads the last N daily-bar closes per symbol via the insights BFF
 * `getBars`, decoupled from the `ListOpportunities` read path (latency M-1). Each symbol is an
 * independent React Query entry so re-renders are per-symbol and deduplication is automatic.
 *
 * Returns a stable `Map<symbol, SparklinePoint[]>` that the caller indexes by symbol; an in-flight
 * or failed symbol is simply absent (the card renders without a sparkline — progressive, not
 * blocking).
 */
export function useSparklines(symbols: string[]): Map<string, SparklinePoint[]> {
  const queries = useQueries({
    queries: symbols.map((symbol) => ({
      queryKey: ['sparkline', symbol],
      queryFn: async (): Promise<{ symbol: string; points: SparklinePoint[] }> => {
        const res = await insightsMarketDataClient.getBars({
          symbol,
          timeframeEnum: Timeframe.TIMEFRAME_1DAY,
          page: { pageSize: SPARKLINE_BARS },
        });
        // Map marketdata Bar.close → proper SparklinePoint messages.
        const points: SparklinePoint[] = res.bars.map((b) =>
          create(SparklinePointSchema, { close: b.close !== 0 ? b.close : undefined }),
        );
        return { symbol, points };
      },
      staleTime: SPARKLINE_STALE_MS,
      // Sparklines are cosmetic — never block the page and never retry aggressively.
      retry: 0,
      refetchOnWindowFocus: false,
    })),
  });

  // Build the lookup once per render; absent/errored/loading symbols are simply missing.
  const map = new Map<string, SparklinePoint[]>();
  for (const q of queries) {
    if (q.data) map.set(q.data.symbol, q.data.points);
  }
  return map;
}
