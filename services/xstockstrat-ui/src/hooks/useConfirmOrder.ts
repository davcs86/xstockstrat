import { tradingClient } from '@/lib/browserClients/tradingClient';
import type { Order } from '@xstockstrat/proto/trading/v1/trading_pb';
import { useInvalidatingMutation } from './useInvalidatingMutation';

type ConfirmOrderInput = Parameters<typeof tradingClient.confirmOrder>[0];

// useConfirmOrder calls the BFF confirmOrder RPC (offline accounts only, feature 157) and
// invalidates the orders list, the single-order query, and the portfolio queries on success so the
// confirmed fill and the recomputed positions/realized P&L are reflected.
export function useConfirmOrder() {
  return useInvalidatingMutation<ConfirmOrderInput, Order>(
    (req) => tradingClient.confirmOrder(req),
    (req) =>
      req.orderId
        ? [['orders'], ['order', req.orderId], ['portfolios'], ['positions']]
        : [['orders'], ['portfolios'], ['positions']],
  );
}
