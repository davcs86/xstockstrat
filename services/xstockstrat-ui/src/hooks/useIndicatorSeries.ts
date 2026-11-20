import { useQuery } from '@tanstack/react-query';
import { analysisClient } from '@/lib/browserClients/analysisClient';

export type IndicatorSeriesInput = Parameters<typeof analysisClient.getIndicatorSeries>[0];

// Cross-segment `/insights/api` client (sanctioned exception). The page sends the drawn window plus its
// history prefix, so the server never re-fetches bars; the last bar's time keys the cache.
export function useIndicatorSeries(req: {
  strategyId: string;
  symbol: string;
  closes: number[];
  times: IndicatorSeriesInput['times'];
}) {
  const enabled = Boolean(req.strategyId) && req.closes.length > 0 && (req.times?.length ?? 0) > 0;
  return useQuery({
    queryKey: [
      'indicator-series',
      req.strategyId,
      req.symbol,
      req.closes.length,
      String(req.times?.at(-1)?.seconds ?? ''),
    ],
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
