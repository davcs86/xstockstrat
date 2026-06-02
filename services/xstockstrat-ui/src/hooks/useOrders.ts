import { useQuery } from '@tanstack/react-query';
import { tradingClient } from '@/lib/browserClients/tradingClient';
import { TradingMode as PbTradingMode } from '@xstockstrat/proto/common/v1/common_pb';
import type { ListOrdersResponse } from '@xstockstrat/proto/trading/v1/trading_pb';

export function useOrders(mode: 'paper' | 'live', selectedAccountId: string | null): {
  data: ListOrdersResponse | undefined;
  isLoading: boolean;
  error: Error | null;
} {
  const toPbMode = (m: 'paper' | 'live') =>
    m === 'live' ? PbTradingMode.LIVE : PbTradingMode.PAPER;
  return useQuery({
    queryKey: ['orders', mode, selectedAccountId],
    queryFn: () => tradingClient.listOrders({ tradingMode: toPbMode(mode), page: { pageSize: 50 } }),
    refetchInterval: 5_000,
  });
}

export function useOrder(orderId: string | null | undefined): {
  data: Awaited<ReturnType<typeof tradingClient.getOrder>> | undefined;
  isLoading: boolean;
  error: Error | null;
} {
  return useQuery({
    queryKey: ['order', orderId],
    queryFn: () => tradingClient.getOrder({ orderId: orderId! }),
    enabled: !!orderId,
    refetchInterval: 5_000,
  });
}
