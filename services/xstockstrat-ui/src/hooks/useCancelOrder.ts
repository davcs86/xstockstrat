import { tradingClient } from '@/lib/browserClients/tradingClient';
import type { CancelOrderResponse } from '@xstockstrat/proto/trading/v1/trading_pb';
import { useInvalidatingMutation } from './useInvalidatingMutation';

type CancelOrderInput = Parameters<typeof tradingClient.cancelOrder>[0];

// cancelOrder RPC; invalidates orders + single-order queries. Live CANCELED also arrives via the
// useOrderUpdates stream, so the row updates without a manual refresh.
export function useCancelOrder() {
  return useInvalidatingMutation<CancelOrderInput, CancelOrderResponse>(
    (req) => tradingClient.cancelOrder(req),
    (req) => (req.orderId ? [['orders'], ['order', req.orderId]] : [['orders']]),
  );
}
