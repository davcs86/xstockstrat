import { useMutation, useQueryClient } from '@tanstack/react-query';
import { tradingClient } from '@/lib/browserClients/tradingClient';
import type { CancelOrderResponse } from '@xstockstrat/proto/trading/v1/trading_pb';

type CancelOrderInput = Parameters<typeof tradingClient.cancelOrder>[0];

// useCancelOrder mirrors usePlaceOrder: it calls the BFF cancelOrder RPC and invalidates the
// orders list + single-order query on success. Live status transitions also arrive via the
// useOrderUpdates stream (FR-5/FR-6), so the row reflects CANCELED without a manual refresh.
export function useCancelOrder() {
  const queryClient = useQueryClient();
  return useMutation<CancelOrderResponse, Error, CancelOrderInput>({
    mutationFn: (req) => tradingClient.cancelOrder(req),
    onSuccess: (_data, req) => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      if (req.orderId) {
        queryClient.invalidateQueries({ queryKey: ['order', req.orderId] });
      }
    },
  });
}
