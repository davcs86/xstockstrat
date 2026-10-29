import { MutationCache, QueryClient } from '@tanstack/react-query';
import { errMessage } from '@/lib/errMessage';
import { reportMutationError, shouldReportMutationError } from '@/lib/mutationErrorStore';

export const normalizerConfig = {
  getNormalizationObjectKey: (obj: Record<string, unknown>) => {
    if (typeof obj.orderId === 'string' && obj.orderId) return `order:${obj.orderId}`;
    if (typeof obj.strategyId === 'string' && obj.strategyId) return `strategy:${obj.strategyId}`;
    return undefined;
  },
};

export function createQueryClient(): QueryClient {
  return new QueryClient({
    mutationCache: new MutationCache({
      onError: (error, _vars, _ctx, mutation) => {
        if (shouldReportMutationError(mutation.options.meta))
          reportMutationError(errMessage(error));
      },
    }),
    defaultOptions: {
      queries: { staleTime: 5_000, retry: 1 },
    },
  });
}
