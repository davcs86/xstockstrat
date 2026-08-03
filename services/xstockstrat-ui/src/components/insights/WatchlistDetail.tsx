'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Trash2, X, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAddWatchlistSymbols, useRemoveWatchlistSymbols } from '@/hooks/useWatchlists';
import { useOpportunities } from '@/hooks/useOpportunities';
import { WatchlistReadiness } from '@/components/insights/WatchlistReadiness';
import { BASE_PATH_INSIGHTS } from '@/lib/basepath';

type WatchlistLike = {
  watchlistId: string;
  name: string;
  description?: string;
  symbols: string[];
};

/**
 * Detail pane for the selected watchlist (feature 098). Owns the symbol-chip CRUD, the
 * "Build from screener" link, and the readiness overlay. The opportunity queue is polled once here
 * (a single poller for the selected list) and passed to WatchlistReadiness as an upper-cased set so
 * a watched name currently on the queue is marked "in queue" (FR-11) — the hook is called above any
 * early return to keep hook order stable.
 */
export function WatchlistDetail({
  watchlist,
  onDelete,
}: {
  watchlist: WatchlistLike;
  onDelete: (watchlistId: string, name: string) => void;
}) {
  const addSymbols = useAddWatchlistSymbols();
  const removeSymbols = useRemoveWatchlistSymbols();
  const { data: oppData } = useOpportunities();
  const [symbolInput, setSymbolInput] = useState('');

  const inQueue = new Set((oppData?.opportunities ?? []).map((o) => o.symbol.toUpperCase()));

  function handleAddSymbol() {
    const raw = symbolInput.trim();
    if (!raw) return;
    // Allow comma/space-separated entry; server uppercases + de-dupes.
    const symbols = raw.split(/[\s,]+/).filter(Boolean);
    if (symbols.length === 0) return;
    addSymbols.mutate(
      { watchlistId: watchlist.watchlistId, symbols },
      { onSuccess: () => setSymbolInput('') },
    );
  }

  return (
    <div className="p-4">
      <div className="mb-3 flex items-start justify-between">
        <div>
          <h2 className="font-semibold">{watchlist.name}</h2>
          {watchlist.description && (
            <p className="text-sm text-muted-foreground">{watchlist.description}</p>
          )}
          <p className="text-xs text-muted-foreground">{watchlist.symbols.length} symbols</p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild size="sm" variant="secondary" data-testid="build-from-screener">
            <Link href={`${BASE_PATH_INSIGHTS}/screener`}>
              <Search className="mr-1 h-4 w-4" />
              Build from screener
            </Link>
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => onDelete(watchlist.watchlistId, watchlist.name)}
            aria-label={`Delete ${watchlist.name}`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5" data-testid="symbol-list">
        {watchlist.symbols.length === 0 && (
          <span className="text-sm text-muted-foreground">No symbols</span>
        )}
        {watchlist.symbols.map((sym) => (
          <Badge key={sym} variant="info" className="gap-1">
            {sym}
            <button
              type="button"
              aria-label={`Remove ${sym}`}
              onClick={() =>
                removeSymbols.mutate({ watchlistId: watchlist.watchlistId, symbols: [sym] })
              }
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <Input
          value={symbolInput}
          onChange={(e) => setSymbolInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAddSymbol()}
          placeholder="Add symbols (e.g. AAPL MSFT)"
          className="max-w-xs"
        />
        <Button size="sm" variant="default" onClick={handleAddSymbol}>
          Add
        </Button>
      </div>

      <WatchlistReadiness symbols={watchlist.symbols} inQueue={inQueue} />
    </div>
  );
}
