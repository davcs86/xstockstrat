import { useQuery } from '@tanstack/react-query';
import { analysisClient } from '@/lib/browserClients/analysisClient';

/**
 * feature 083 — Decide surface data hooks. All read-only queries against the insights BFF
 * (AnalysisService). ListOpportunities takes the user from the propagated x-user-id header,
 * so the request carries only the min-conviction filter.
 */

type ListOpportunitiesResult = Awaited<ReturnType<typeof analysisClient.listOpportunities>>;
type EvaluateReadinessResult = Awaited<ReturnType<typeof analysisClient.evaluateReadiness>>;

/** Ranked opportunity queue, polled every 15s. */
export function useOpportunities(minConviction = 0) {
  return useQuery<ListOpportunitiesResult, Error>({
    queryKey: ['opportunities', minConviction],
    queryFn: () => analysisClient.listOpportunities({ minConviction }),
    refetchInterval: 15_000,
  });
}

/** Per-symbol readiness (traced condition leaves) for a strategy. Enabled only with a strategy. */
export function useReadiness(strategyId: string, symbols: string[]) {
  return useQuery<EvaluateReadinessResult, Error>({
    queryKey: ['readiness', strategyId, [...symbols].sort()],
    queryFn: () => analysisClient.evaluateReadiness({ strategyId, symbols }),
    enabled: Boolean(strategyId) && symbols.length > 0,
  });
}
