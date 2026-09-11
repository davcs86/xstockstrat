import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { analysisClient } from '@/lib/browserClients/analysisClient';
import { useInvalidatingMutation } from '@/hooks/useInvalidatingMutation';
import { isNotFoundError } from '@/lib/scoreDisplay';
import type { OpportunityAction, ReadinessRule } from '@xstockstrat/proto/analysis/v1/analysis_pb';

/**
 * Decide-surface read-only hooks (insights BFF). ListOpportunities takes the user from the
 * x-user-id header, so the request carries only the min-conviction filter.
 */

type EvaluateReadinessResult = Awaited<ReturnType<typeof analysisClient.evaluateReadiness>>;

/**
 * Ranked opportunity queue with infinite pagination, polled every 15s (feature 187).
 * Returns `useInfiniteQuery` — consumers flatten via `data?.pages.flatMap(p => p.opportunities)`.
 * Response-level signals (`computing`, `computeFailed`) ride on page 0.
 */
export function useOpportunities(minConviction = 0) {
  return useInfiniteQuery({
    queryKey: ['opportunities', minConviction],
    queryFn: ({ pageParam }) =>
      analysisClient.listOpportunities({
        minConviction,
        page: { pageSize: 50, pageToken: pageParam ?? '' },
      }),
    initialPageParam: '',
    getNextPageParam: (lastPage) => {
      // Stop paging when the queue is still computing or has failed (feature 185 AC-6/AC-7).
      if (lastPage.computing || lastPage.computeFailed) return undefined;
      return lastPage.page?.nextPageToken || undefined;
    },
    refetchInterval: 15_000,
  });
}

/**
 * Persist a per-user disposition (SNOOZE / DISMISS / TAKE) against the server-authoritative
 * `opportunityKey`. On success it invalidates `['opportunities']` so the server-filtered read drops
 * the row. `snoozeUntil` is optional — omit it to let the server apply its bounded
 * `analysis.opportunity.snooze_default_hours` default.
 */
export interface SetOpportunityActionInput {
  opportunityKey: string;
  action: OpportunityAction;
  snoozeUntil?: { seconds: bigint; nanos: number };
}

export function useSetOpportunityAction() {
  return useInvalidatingMutation<SetOpportunityActionInput, unknown>(
    (input) => analysisClient.setOpportunityAction(input),
    [['opportunities']],
  );
}

/**
 * Per-symbol readiness (traced condition leaves) for a strategy. Enabled only with a strategy.
 * `rule` selects the entry (default) or exit rule tree, and is part of the query key so entry/exit
 * results cache separately.
 */
export function useReadiness(strategyId: string, symbols: string[], rule?: ReadinessRule) {
  // A stale/deleted `?strategy=` param makes EvaluateReadiness abort NOT_FOUND — expected, not
  // retriable.
  const query = useQuery<EvaluateReadinessResult, Error>({
    queryKey: ['readiness', strategyId, [...symbols].sort(), rule ?? 0],
    queryFn: () => analysisClient.evaluateReadiness({ strategyId, symbols, rule }),
    enabled: Boolean(strategyId) && symbols.length > 0,
    retry: (failureCount, err) => !isNotFoundError(err) && failureCount < 1,
  });
  return { ...query, isNotFound: isNotFoundError(query.error) };
}

type StrategyAnalyticsResult = Awaited<ReturnType<typeof analysisClient.getStrategyAnalytics>>;

/** Per-strategy analytics (expectancy / hit-rate / max-DD / signals / taken / queue-share). */
export function useStrategyAnalytics(strategyId?: string) {
  return useQuery<StrategyAnalyticsResult, Error>({
    queryKey: ['strategy-analytics', strategyId],
    queryFn: () => analysisClient.getStrategyAnalytics({ strategyId: strategyId! }),
    enabled: Boolean(strategyId),
  });
}
