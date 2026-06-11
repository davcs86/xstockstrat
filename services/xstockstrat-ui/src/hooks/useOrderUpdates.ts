'use client';
import { useEffect, useState } from 'react';
import { tradingClient } from '@/lib/browserClients/tradingClient';
import type { Order, OrderStatus as PbOrderStatus } from '@xstockstrat/proto/trading/v1/trading_pb';

// useOrderUpdates consumes the server-streaming StreamOrderUpdates RPC (mirroring
// AlertStream's useEffect + AbortController pattern) and merges pushed Order updates into
// local state keyed by orderId, so a list can reflect live status/fill transitions without
// a manual refetch (FR-5/FR-6). userId is injected by the BFF from the verified session.
export function useOrderUpdates(statusFilter: PbOrderStatus[] = []): Record<string, Order> {
  const [updates, setUpdates] = useState<Record<string, Order>>({});

  // Serialize the filter so a new array identity on each render does not re-subscribe.
  const filterKey = JSON.stringify(statusFilter);

  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      try {
        const stream = tradingClient.streamOrderUpdates(
          { statusFilter },
          { signal: ctrl.signal },
        );
        for await (const order of stream) {
          setUpdates((prev) => ({ ...prev, [order.orderId]: order }));
        }
      } catch {
        // Stream aborted (unmount) or interrupted — silent stop, matches AlertStream.
      }
    })();
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  return updates;
}
