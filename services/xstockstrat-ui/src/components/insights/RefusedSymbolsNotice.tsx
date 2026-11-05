'use client';
import type { UnservableReason } from '@xstockstrat/proto/common/v1/common_pb';
import { CardNotice } from '@/components/shared/CardNotice';
import { UNSERVABLE_REASON } from '@/lib/opportunityShared';

/** Lists the symbols a watchlist write refused (not added), each with its reason. */
export function RefusedSymbolsNotice({
  refused,
}: {
  refused: { symbol: string; reason: UnservableReason }[];
}) {
  if (refused.length === 0) return null;
  return (
    <div data-testid="watchlist-refused-notice" className="mt-2">
      <CardNotice variant="muted">
        <p>Not added:</p>
        <ul className="list-disc pl-5">
          {refused.map((r) => (
            <li key={r.symbol}>
              <span className="font-medium">{r.symbol}</span> — {UNSERVABLE_REASON[r.reason]}
            </li>
          ))}
        </ul>
        <p>A new or mistyped ticker is refused until the asset list refreshes (up to 24h).</p>
      </CardNotice>
    </div>
  );
}
