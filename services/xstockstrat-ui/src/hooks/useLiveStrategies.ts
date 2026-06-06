import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { traderAnalysisClient } from '@/lib/browserClients/traderAnalysisClient';
import { notifyClient } from '@/lib/browserClients/notifyClient';

export function useLiveStrategyDefinitions() {
  return useQuery({
    queryKey: ['trader-strategy-definitions'],
    queryFn: () => traderAnalysisClient.listStrategyDefinitions({ includeInactive: false }),
    refetchInterval: 30_000,
  });
}

export function useSetStrategyLive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ strategyId, liveEnabled }: { strategyId: string; liveEnabled: boolean }) =>
      traderAnalysisClient.setStrategyLive({ strategyId, liveEnabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['trader-strategy-definitions'] }),
  });
}

export function useStrategyAlerts(strategyId: string) {
  return useQuery({
    queryKey: ['strategy-alerts', strategyId],
    queryFn: async () => {
      const resp = await notifyClient.listAlerts({ categories: ['strategy'], limit: 50 });
      // The live loop tags each alert with `strategy_id:<id>` (robust string filter).
      const tag = `strategy_id:${strategyId}`;
      return resp.alerts.filter((a) => a.tags.includes(tag)).slice(0, 10);
    },
    enabled: !!strategyId,
    refetchInterval: 60_000,
  });
}

/**
 * Client-readable admin signal. The JWT is httpOnly, so the page cannot read roles
 * directly; this calls the lightweight /trader/api-adjacent /api/auth/me route which
 * derives `isAdmin` server-side from the session cookie. The toggle is also gated
 * server-side in the BFF (defense-in-depth).
 */
export function useIsAdmin() {
  return useQuery({
    queryKey: ['auth-is-admin'],
    queryFn: async (): Promise<boolean> => {
      const res = await fetch('/api/auth/me', { credentials: 'include' });
      if (!res.ok) return false;
      const data = (await res.json()) as { isAdmin?: boolean };
      return data.isAdmin ?? false;
    },
    staleTime: 5 * 60_000,
  });
}
