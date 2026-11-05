import { useQuery } from '@tanstack/react-query';
import { ledgerClient } from '@/lib/browserClients/ledgerClient';
import { tradingClient } from '@/lib/browserClients/tradingClient';
import { fetchPositionLineage } from '@/lib/positionLineage';
import type { EnvironmentMode } from '@/context/AccountContext';

// Lineage is read per order from the caller's own ListOrders set; never a platform-wide ledger page.
export function usePositionLineage(
  symbol: string | null,
  accountId: string | null,
  mode: EnvironmentMode | null,
) {
  return useQuery({
    queryKey: ['position-lineage', symbol, accountId, mode],
    enabled: !!symbol,
    staleTime: 60_000,
    queryFn: () =>
      fetchPositionLineage(
        {
          listOrders: tradingClient.listOrders.bind(tradingClient),
          queryEvents: ledgerClient.queryEvents.bind(ledgerClient),
        },
        { symbol: symbol as string, accountId, mode },
      ),
  });
}
