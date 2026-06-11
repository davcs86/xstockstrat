import { useQuery } from '@tanstack/react-query';
import { tradingClient } from '@/lib/browserClients/tradingClient';
import { TradingMode as PbTradingMode } from '@xstockstrat/proto/common/v1/common_pb';
import type { OrderSide as PbOrderSide, OrderType as PbOrderType, OrderStatus as PbOrderStatus } from '@xstockstrat/proto/trading/v1/trading_pb';
import type { ListOrdersResponse } from '@xstockstrat/proto/trading/v1/trading_pb';

type ListOrdersInput = Parameters<typeof tradingClient.listOrders>[0];

// OrderFilters are the server-side filters (FR-2) forwarded to ListOrders. An empty
// string or undefined enum means "no filter on this dimension" (matches the gRPC service
// semantics). `range`/`status` are existing request fields; the four additive filters
// (symbol/side/orderType/accountId) landed in Steps 1–5.
export interface OrderFilters {
  symbol?: string;
  side?: PbOrderSide;
  orderType?: PbOrderType;
  status?: PbOrderStatus;
  accountId?: string;
  range?: ListOrdersInput['range'];
  pageSize?: number;
  pageToken?: string;
}

export function useOrders(
  mode: 'paper' | 'live',
  selectedAccountId: string | null,
  filters?: OrderFilters,
): {
  data: ListOrdersResponse | undefined;
  isLoading: boolean;
  error: Error | null;
} {
  const toPbMode = (m: 'paper' | 'live') =>
    m === 'live' ? PbTradingMode.LIVE : PbTradingMode.PAPER;
  return useQuery({
    queryKey: ['orders', mode, selectedAccountId, filters],
    queryFn: () =>
      tradingClient.listOrders({
        tradingMode: toPbMode(mode),
        page: { pageSize: filters?.pageSize ?? 50, pageToken: filters?.pageToken ?? '' },
        ...(filters?.symbol ? { symbol: filters.symbol } : {}),
        ...(filters?.side !== undefined ? { side: filters.side } : {}),
        ...(filters?.orderType !== undefined ? { orderType: filters.orderType } : {}),
        ...(filters?.accountId ? { accountId: filters.accountId } : {}),
        ...(filters?.status !== undefined ? { status: filters.status } : {}),
        ...(filters?.range ? { range: filters.range } : {}),
      }),
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
