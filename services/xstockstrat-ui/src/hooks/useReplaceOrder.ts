import { tradingClient } from '@/lib/browserClients/tradingClient';
import type { Order } from '@xstockstrat/proto/trading/v1/trading_pb';
import { useInvalidatingMutation } from './useInvalidatingMutation';

type ReplaceOrderInput = Parameters<typeof tradingClient.replaceOrder>[0];

export function useReplaceOrder() {
  return useInvalidatingMutation<ReplaceOrderInput, Order>(
    (req) => tradingClient.replaceOrder(req),
    (req) => (req.orderId ? [['orders'], ['order', req.orderId]] : [['orders']]),
  );
}
