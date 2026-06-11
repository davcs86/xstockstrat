import { useMutation, useQueryClient } from '@tanstack/react-query';
import { tradingClient } from '@/lib/browserClients/tradingClient';
import type { Order } from '@xstockstrat/proto/trading/v1/trading_pb';

type ReplaceOrderInput = Parameters<typeof tradingClient.replaceOrder>[0];

// useReplaceOrder mirrors usePlaceOrder: it calls the BFF replaceOrder RPC and invalidates
// the orders list + the single-order query on success so the UI reflects the change.
export function useReplaceOrder() {
  const queryClient = useQueryClient();
  return useMutation<Order, Error, ReplaceOrderInput>({
    mutationFn: (req) => tradingClient.replaceOrder(req),
    onSuccess: (_data, req) => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      if (req.orderId) {
        queryClient.invalidateQueries({ queryKey: ['order', req.orderId] });
      }
    },
  });
}
