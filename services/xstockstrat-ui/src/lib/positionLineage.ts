import type { ledgerClient } from '@/lib/browserClients/ledgerClient';
import type { tradingClient } from '@/lib/browserClients/tradingClient';
import type { EnvironmentMode } from '@/context/AccountContext';
import { toPbTradingMode } from '@/lib/tradingMode';

export const LINEAGE_MAX_ORDERS = 50;
const LINEAGE_CONCURRENCY = 3;

type LineageDeps = {
  listOrders: typeof tradingClient.listOrders;
  queryEvents: typeof ledgerClient.queryEvents;
};
type LineageEvent = Awaited<ReturnType<typeof ledgerClient.queryEvents>>['events'][number];

// Fills are read per order from the caller-pinned ListOrders set, never from a platform-wide ledger page.
export async function fetchPositionLineage(
  deps: LineageDeps,
  args: { symbol: string; accountId: string | null; mode: EnvironmentMode | null },
): Promise<{ events: LineageEvent[]; truncated: boolean }> {
  const resp = await deps.listOrders({
    symbol: args.symbol,
    ...(args.accountId ? { accountId: args.accountId } : {}),
    tradingMode: toPbTradingMode(args.mode),
    page: { pageSize: LINEAGE_MAX_ORDERS + 1, pageToken: '' },
  });
  const truncated = resp.orders.length > LINEAGE_MAX_ORDERS;
  const orders = resp.orders.slice(0, LINEAGE_MAX_ORDERS);

  const results: LineageEvent[][] = new Array(orders.length);
  let next = 0;
  const worker = async () => {
    while (next < orders.length) {
      const i = next++;
      const r = await deps.queryEvents({
        streamKey: orders[i].orderId,
        eventType: 'order.filled',
        sourceService: 'xstockstrat-trading',
        page: { pageSize: 10, pageToken: '' },
      });
      results[i] = r.events;
    }
  };
  await Promise.all(Array.from({ length: Math.min(LINEAGE_CONCURRENCY, orders.length) }, worker));
  return { events: results.flat(), truncated };
}
