import { useQuery } from '@tanstack/react-query';
import { analysisClient } from '@/lib/browserClients/analysisClient';
import { useInvalidatingMutation } from '@/hooks/useInvalidatingMutation';
import type { OpportunityAction } from '@xstockstrat/proto/analysis/v1/analysis_pb';

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

/**
 * feature 097 — persist a per-user disposition (SNOOZE / DISMISS / TAKE) against the
 * server-authoritative `opportunityKey`. On success it invalidates `['opportunities']` so the
 * server-filtered read drops the row — the disposition survives reload and syncs across devices
 * (FR-5, AC-3), unlike the transient client-side `Set` it replaces. `snoozeUntil` is optional;
 * omit it to let the server apply its bounded `analysis.opportunity.snooze_default_hours` default.
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

/** Per-symbol readiness (traced condition leaves) for a strategy. Enabled only with a strategy. */
export function useReadiness(strategyId: string, symbols: string[]) {
  return useQuery<EvaluateReadinessResult, Error>({
    queryKey: ['readiness', strategyId, [...symbols].sort()],
    queryFn: () => analysisClient.evaluateReadiness({ strategyId, symbols }),
    enabled: Boolean(strategyId) && symbols.length > 0,
  });
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
