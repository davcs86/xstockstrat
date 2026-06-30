import { tradingClient } from '@/lib/browserClients/tradingClient';
import type { Order } from '@xstockstrat/proto/trading/v1/trading_pb';
import { useInvalidatingMutation } from './useInvalidatingMutation';

type PlaceOrderInput = Parameters<typeof tradingClient.placeOrder>[0];

export function usePlaceOrder() {
  return useInvalidatingMutation<PlaceOrderInput, Order>(
    (req) => tradingClient.placeOrder(req),
    [['orders']],
  );
}
