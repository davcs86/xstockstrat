import { useQuery } from '@tanstack/react-query';
import type { JsonObject } from '@bufbuild/protobuf';
import { ledgerClient } from '@/lib/browserClients/ledgerClient';

// order.filled ledger events (source_service "trading"), joined client-side on symbol/account_id/
// trading_mode — where trading_mode is the proto enum String() form ("TRADING_MODE_PAPER"/"_LIVE").
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
