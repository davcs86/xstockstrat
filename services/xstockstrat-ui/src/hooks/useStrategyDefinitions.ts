import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MessageInitShape } from '@bufbuild/protobuf';
import { analysisClient } from '@/lib/browserClients/analysisClient';
import {
  StrategyDefinitionSchema,
  StrategyOperation,
} from '@xstockstrat/proto/analysis/v1/analysis_pb';

/** Partial init shape accepted by the typed client for a StrategyDefinition. */
export type StrategyDefinitionInit = MessageInitShape<typeof StrategyDefinitionSchema>;

/**
 * List full strategy definitions (authoring view) via the insights BFF.
 * Distinct from `useStrategies` (ListStrategies score cards) — this carries
 * `active` / `live_enabled` and the component/rule definitions.
 */
export function useStrategyDefinitions(includeInactive = false) {
  return useQuery({
    queryKey: ['analysis-strategy-definitions', includeInactive],
    queryFn: () => analysisClient.listStrategyDefinitions({ includeInactive }),
  });
}

/** Fetch a single strategy definition by id (for the edit form / detail view). */
export function useGetStrategy(strategyId?: string) {
  return useQuery({
    queryKey: ['analysis-strategy-def', strategyId],
    queryFn: () => analysisClient.getStrategy({ strategyId: strategyId! }),
    enabled: !!strategyId,
  });
}

/** Register / update / deactivate a strategy (admin-gated server-side in the insights BFF). */
export function useManageStrategy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      operation,
      definition,
      updateMask,
    }: {
      operation: StrategyOperation;
      definition: StrategyDefinitionInit;
      // feature 132: an optional field-mask for a partial (masked) update — the wizard leaves it
      // undefined (full replace, unchanged), the Symbol-page mute control sets it to
      // ['denied_symbols'] so it touches only the deny list.
      updateMask?: string[];
    }) =>
      analysisClient.manageStrategy({
        operation,
        definition,
        ...(updateMask ? { updateMask: { paths: updateMask } } : {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['analysis-strategy-definitions'] });
      qc.invalidateQueries({ queryKey: ['analysis-strategies'] });
      qc.invalidateQueries({ queryKey: ['analysis-strategy-def'] });
    },
  });
}

/**
 * Toggle live evaluation from the insights segment (routes through `/insights/api`).
 * Named distinctly from the trader-side `useSetStrategyLive` (which uses `/trader/api`).
 */
export function useSetStrategyLiveInsights() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ strategyId, liveEnabled }: { strategyId: string; liveEnabled: boolean }) =>
      analysisClient.setStrategyLive({ strategyId, liveEnabled }),
    onSuccess: (_data, { strategyId }) => {
      qc.invalidateQueries({ queryKey: ['analysis-strategy-definitions'] });
      qc.invalidateQueries({ queryKey: ['analysis-strategy-def', strategyId] });
    },
  });
}
