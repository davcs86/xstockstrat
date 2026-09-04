import { useQuery } from '@tanstack/react-query';
import { analysisClient } from '@/lib/browserClients/analysisClient';

export type IndicatorSeriesInput = Parameters<typeof analysisClient.getIndicatorSeries>[0];

// Cross-segment `/insights/api` client (sanctioned exception). The page passes the exact closes+times
// it drew, so the panels' x-axis is parity-aligned and the server never re-fetches bars.
export function useIndicatorSeries(req: {
  strategyId: string;
  symbol: string;
  closes: number[];
  times: IndicatorSeriesInput['times'];
}) {
  const enabled = Boolean(req.strategyId) && req.closes.length > 0 && (req.times?.length ?? 0) > 0;
  return useQuery({
    queryKey: ['indicator-series', req.strategyId, req.symbol, req.closes.length],
    queryFn: () =>
      analysisClient.getIndicatorSeries({
        strategyId: req.strategyId,
        symbol: req.symbol,
        closes: req.closes,
        times: req.times,
      }),
    enabled,
  });
}
