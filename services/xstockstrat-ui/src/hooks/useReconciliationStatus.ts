import { useQuery } from '@tanstack/react-query';
import type { JsonObject } from '@bufbuild/protobuf';
import { ledgerClient } from '@/lib/browserClients/ledgerClient';

// useReconciliationStatus reads the most recent reconciliation.*/order_intent.* ledger events for
// an account (feature 102). QueryEventsRequest.event_type is an exact-match filter, not a prefix
// filter (ledger.proto:56) — fetch by stream_key alone and filter client-side, mirroring
// usePositionLineage's existing shape. The ledger's real queryEvents handler orders results
// `ORDER BY recorded_at ASC` (oldest-first) — the opposite of design.md's assumed shape — so the
// most recent event is the LAST element, not the first.
export function useReconciliationStatus(accountId: string | null) {
  return useQuery({
    queryKey: ['reconciliation-status', accountId],
    enabled: !!accountId,
    queryFn: async () => {
      const resp = await ledgerClient.queryEvents({
        streamKey: `account:${accountId}`,
        page: { pageSize: 50, pageToken: '' },
      });
      const relevant = resp.events.filter(
        (e) => e.eventType.startsWith('reconciliation.') || e.eventType.startsWith('order_intent.'),
      );
      const mostRecentMismatch = [...relevant]
        .reverse()
        .find((e) => e.eventType === 'reconciliation.mismatch_found');
      const lastTick = relevant[relevant.length - 1]; // oldest-first order — the last element is most recent
      return {
        lastReconciledAt: lastTick
          ? new Date(Number((lastTick.payload as JsonObject)?.tick_at ?? 0))
          : null,
        hasUnresolvedMismatch: !!mostRecentMismatch,
      };
    },
    refetchInterval: 10_000,
  });
}
