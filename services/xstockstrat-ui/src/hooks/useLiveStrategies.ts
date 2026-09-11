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
      // The live loop tags each alert with `strategy_id:<id>`.
      const tag = `strategy_id:${strategyId}`;
      return resp.alerts.filter((a) => a.tags.includes(tag)).slice(0, 10);
    },
    enabled: !!strategyId,
    refetchInterval: 60_000,
  });
}

interface MeResponse {
  userId?: string;
  isAdmin?: boolean;
}

const ME_QUERY_KEY = ['auth-me'];

function useMeQuery() {
  return useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: async (): Promise<MeResponse> => {
      const res = await fetch('/api/auth/me', { credentials: 'include' });
      if (!res.ok) return {};
      return (await res.json()) as MeResponse;
    },
    staleTime: 5 * 60_000,
  });
}

/**
 * Client-readable admin signal. The JWT is httpOnly, so the page can't read roles directly; this
 * calls /api/auth/me, which derives `isAdmin` server-side from the session cookie. The toggle is
 * also gated server-side in the BFF (defense-in-depth).
 */
export function useIsAdmin() {
  const { data, ...rest } = useMeQuery();
  return { data: data?.isAdmin ?? false, ...rest };
}

/** Current session's user ID, derived server-side from the httpOnly JWT cookie. */
export function useCurrentUserId() {
  const { data, ...rest } = useMeQuery();
  return { data: data?.userId ?? null, ...rest };
}
