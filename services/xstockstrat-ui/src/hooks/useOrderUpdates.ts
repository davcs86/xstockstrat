'use client';
import { useState } from 'react';
import { tradingClient } from '@/lib/browserClients/tradingClient';
import { useReconnectingStream } from '@/hooks/useReconnectingStream';
import type { Order, OrderStatus as PbOrderStatus } from '@xstockstrat/proto/trading/v1/trading_pb';

// Server-streaming StreamOrderUpdates merged into state keyed by orderId. userId is injected by the
// BFF from the verified session.
export function useOrderUpdates(statusFilter: PbOrderStatus[] = []): {
  updates: Record<string, Order>;
  disconnected: boolean;
  terminal: string | null;
} {
  const [updates, setUpdates] = useState<Record<string, Order>>({});

  // Serialize the filter so a new array identity on each render does not re-subscribe.
  const filterKey = JSON.stringify(statusFilter);

  const { disconnected, terminal } = useReconnectingStream<Order>(
    filterKey,
    (signal) => tradingClient.streamOrderUpdates({ statusFilter }, { signal }),
    (order) => setUpdates((prev) => ({ ...prev, [order.orderId]: order })),
  );

  return { updates, disconnected, terminal };
}
