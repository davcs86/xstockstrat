import { tradingClient } from '@/lib/browserClients/tradingClient';
import type { Order } from '@xstockstrat/proto/trading/v1/trading_pb';
import { useInvalidatingMutation } from './useInvalidatingMutation';

type ConfirmOrderInput = Parameters<typeof tradingClient.confirmOrder>[0];

// confirmOrder RPC (offline accounts only); invalidates orders + portfolio queries on success.
export function useConfirmOrder() {
  return useInvalidatingMutation<ConfirmOrderInput, Order>(
    (req) => tradingClient.confirmOrder(req),
    (req) =>
      req.orderId
        ? [['orders'], ['order', req.orderId], ['portfolios'], ['positions']]
        : [['orders'], ['portfolios'], ['positions']],
  );
}
