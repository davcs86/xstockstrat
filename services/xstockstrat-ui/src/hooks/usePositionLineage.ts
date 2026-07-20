import { useQuery } from '@tanstack/react-query';
import type { JsonObject } from '@bufbuild/protobuf';
import { ledgerClient } from '@/lib/browserClients/ledgerClient';

// usePositionLineage returns the order.filled ledger events that built a given position,
// joined client-side on payload.symbol / account_id / trading_mode. The lineage source is the
// ledger order.filled event (source_service "trading"); trading_mode in the payload is the proto
// enum String() form ("TRADING_MODE_PAPER" / "TRADING_MODE_LIVE"). Disabled until a symbol is set.
export function usePositionLineage(
  symbol: string | null,
  accountId: string | null,
  mode: 'paper' | 'live',
) {
  return useQuery({
    queryKey: ['position-lineage', symbol, accountId, mode],
    enabled: !!symbol,
    queryFn: async () => {
      const resp = await ledgerClient.queryEvents({
        eventType: 'order.filled',
        sourceService: 'trading',
        page: { pageSize: 100, pageToken: '' },
      });
      const modeStr = mode === 'live' ? 'TRADING_MODE_LIVE' : 'TRADING_MODE_PAPER';
      return resp.events.filter((e) => {
        const p = (e.payload ?? {}) as JsonObject;
        return (
          p.symbol === symbol &&
          (!accountId || p.account_id === accountId) &&
          (p.trading_mode === undefined || p.trading_mode === modeStr)
        );
      });
    },
  });
}
