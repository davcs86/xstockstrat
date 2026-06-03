import { useMutation, useQueryClient } from '@tanstack/react-query';
import { tradingClient } from '@/lib/browserClients/tradingClient';
import type { Order } from '@xstockstrat/proto/trading/v1/trading_pb';
import { ConnectError } from '@connectrpc/connect';

type PlaceOrderInput = Parameters<typeof tradingClient.placeOrder>[0];

export function usePlaceOrder() {
  const queryClient = useQueryClient();
  return useMutation<Order, Error, PlaceOrderInput>({
    mutationFn: (req) => tradingClient.placeOrder(req),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
    onError: (err) => {
      if (err instanceof ConnectError) return err;
      return err;
    },
  });
}
