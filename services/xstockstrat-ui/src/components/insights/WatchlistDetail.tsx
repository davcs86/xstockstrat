'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Trash2, X, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  useAddWatchlistSymbols,
  useRemoveWatchlistSymbols,
  useUpdateWatchlist,
  type WatchlistBindingInput,
} from '@/hooks/useWatchlists';
import { useStrategyDefinitions } from '@/hooks/useStrategyDefinitions';
import { useOpportunities } from '@/hooks/useOpportunities';
import { WatchlistReadiness } from '@/components/insights/WatchlistReadiness';
import { BASE_PATH_INSIGHTS } from '@/lib/basepath';

type Binding = { symbol: string; strategyId: string };

type WatchlistLike = {
  watchlistId: string;
  name: string;
  description?: string;
  symbols: string[];
  // feature 097 — authoritative (symbol, strategy) bindings; falls back to the deprecated flat
  // `symbols` mirror for a legacy list that predates the shape change (FR-6).
  bindings?: Binding[];
};

// Radix Select forbids an empty-string item value, so an unbound symbol uses this sentinel.
const UNBOUND = '__unbound__';

/**
 * Detail pane for the selected watchlist (feature 098, per-symbol bindings by feature 097). Owns
 * the symbol-chip CRUD, an inline per-symbol strategy binding editor, the "Build from screener"
 * link, and the readiness overlay. The opportunity queue is polled once here and passed to
 * WatchlistReadiness as an upper-cased set so a watched name currently on the queue is marked
 * "in queue" (FR-11) — the hook is called above any early return to keep hook order stable.
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
  const updateWatchlist = useUpdateWatchlist();
  const { data: defs } = useStrategyDefinitions();
  const allStrategies = defs?.definitions ?? [];
  // Only live-enabled strategies are offered for a NEW binding — `active` alone (the fetch
  // default) also admits paused/never-enabled/test strategies. An already-bound strategy that
  // is no longer live stays visible (labeled) so its existing binding doesn't appear to vanish.
  const liveStrategies = allStrategies.filter((s) => s.liveEnabled);
  function strategyOptions(boundStrategyId: string) {
    if (!boundStrategyId || liveStrategies.some((s) => s.strategyId === boundStrategyId)) {
      return liveStrategies;
    }
    const bound = allStrategies.find((s) => s.strategyId === boundStrategyId);
    return bound ? [...liveStrategies, bound] : liveStrategies;
  }
  const { data: oppData } = useOpportunities();
  const [symbolInput, setSymbolInput] = useState('');

  const inQueue = new Set((oppData?.opportunities ?? []).map((o) => o.symbol.toUpperCase()));

  // Authoritative bindings, else the deprecated flat mirror mapped to unbound (FR-6). De-duped by
  // symbol so a transient double-entry (mid mutation+refetch) can never emit duplicate React keys.
  const rawBindings: Binding[] = watchlist.bindings?.length
    ? watchlist.bindings
    : watchlist.symbols.map((s) => ({ symbol: s, strategyId: '' }));
  const bindings: Binding[] = Array.from(new Map(rawBindings.map((b) => [b.symbol, b])).values());

  function handleAddSymbol() {
    const raw = symbolInput.trim();
    if (!raw) return;
    // Allow comma/space-separated entry; server uppercases + de-dupes. Added unbound.
    const symbols = raw.split(/[\s,]+/).filter(Boolean);
    if (symbols.length === 0) return;
    addSymbols.mutate(
      { watchlistId: watchlist.watchlistId, symbols },
      { onSuccess: () => setSymbolInput('') },
    );
  }

  // Re-bind one symbol's strategy. Sends the FULL updated binding set via UpdateWatchlist
  // (replace semantics) so no other symbol's `strategyId` is reset — the fails-080 trap (FR-6).
  function setBinding(symbol: string, strategyId: string) {
    const next: WatchlistBindingInput[] = bindings.map((b) =>
      b.symbol === symbol ? { symbol: b.symbol, strategyId } : b,
    );
    updateWatchlist.mutate({
      watchlistId: watchlist.watchlistId,
      name: watchlist.name,
      description: watchlist.description ?? '',
      bindings: next,
    });
  }

  return (
    <div className="p-4">
      <div className="mb-3 flex items-start justify-between">
        <div>
          <h2 className="font-semibold">{watchlist.name}</h2>
          {watchlist.description && (
            <p className="text-sm text-muted-foreground">{watchlist.description}</p>
          )}
          <p className="text-xs text-muted-foreground">{bindings.length} symbols</p>
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

      {/* Per-symbol rows: symbol chip + remove + an inline strategy-binding Select (FR-6). */}
      <div className="mb-3 space-y-1.5" data-testid="symbol-list">
        {bindings.length === 0 && <span className="text-sm text-muted-foreground">No symbols</span>}
        {bindings.map((b) => (
          <div
            key={b.symbol}
            className="flex items-center gap-2"
            data-testid={`binding-${b.symbol}`}
          >
            <Badge variant="info" className="gap-1">
              {b.symbol}
              <button
                type="button"
                aria-label={`Remove ${b.symbol}`}
                onClick={() =>
                  removeSymbols.mutate({ watchlistId: watchlist.watchlistId, symbols: [b.symbol] })
                }
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
            <Select
              value={b.strategyId || UNBOUND}
              onValueChange={(v) => setBinding(b.symbol, v === UNBOUND ? '' : v)}
            >
              <SelectTrigger className="h-7 w-48 text-xs" aria-label={`Strategy for ${b.symbol}`}>
                <SelectValue placeholder="Bind a strategy…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNBOUND}>Unbound</SelectItem>
                {strategyOptions(b.strategyId).map((s) => (
                  <SelectItem key={s.strategyId} value={s.strategyId}>
                    {s.displayName || s.strategyId}
                    {!s.liveEnabled ? ' (non-live)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
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

      <WatchlistReadiness bindings={bindings} inQueue={inQueue} />
    </div>
  );
}
