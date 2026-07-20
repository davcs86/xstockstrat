import { tradingClient } from '@/lib/browserClients/tradingClient';
import type { CancelOrderResponse } from '@xstockstrat/proto/trading/v1/trading_pb';
import { useInvalidatingMutation } from './useInvalidatingMutation';

type CancelOrderInput = Parameters<typeof tradingClient.cancelOrder>[0];

// useCancelOrder calls the BFF cancelOrder RPC and invalidates the orders list + single-order
// query on success. Live status transitions also arrive via the useOrderUpdates stream
// (FR-5/FR-6), so the row reflects CANCELED without a manual refresh.
export function useCancelOrder() {
  return useInvalidatingMutation<CancelOrderInput, CancelOrderResponse>(
    (req) => tradingClient.cancelOrder(req),
    (req) => (req.orderId ? [['orders'], ['order', req.orderId]] : [['orders']]),
  );
}
