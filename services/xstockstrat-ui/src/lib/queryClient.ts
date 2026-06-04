import { QueryClient } from '@tanstack/react-query';

export const normalizerConfig = {
  getNormalizationObjectKey: (obj: Record<string, unknown>) => {
    if (typeof obj.orderId === 'string' && obj.orderId) return `order:${obj.orderId}`;
    if (typeof obj.strategyId === 'string' && obj.strategyId) return `strategy:${obj.strategyId}`;
    return undefined;
  },
};

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 5_000, retry: 1 },
    },
  });
}
