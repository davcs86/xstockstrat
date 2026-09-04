'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Trash2, Search, Pencil } from 'lucide-react';
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
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import {
  useAddWatchlistSymbols,
  useRemoveWatchlistSymbols,
  useUpdateWatchlist,
  useUpdateWatchlistBinding,
  useUpdateWatchlistBindings,
  UNBOUND,
  toApiStrategyId,
} from '@/hooks/useWatchlists';
import { useStrategyDefinitions } from '@/hooks/useStrategyDefinitions';
import { useOpportunities } from '@/hooks/useOpportunities';
import { WatchlistReadiness } from '@/components/insights/WatchlistReadiness';
import { BASE_PATH_INSIGHTS } from '@/lib/basepath';

type Binding = { symbol: string; strategyId: string; source?: number };

type WatchlistLike = {
  watchlistId: string;
  name: string;
  description?: string;
  symbols: string[];
  // Authoritative (symbol, strategy) bindings; falls back to the flat `symbols` mirror for legacy lists.
  bindings?: Binding[];
  // A system-managed signals watchlist is delete-protected.
  systemManaged?: boolean;
  // Watchlist-level default strategy applied to new bare symbols at add time.
  defaultStrategyId?: string;
};

/**
 * Detail pane for the selected watchlist: symbol CRUD, per-symbol binding editor, and readiness
 * overlay. The opportunity queue hook is called above any early return to keep hook order stable.
 */
export function WatchlistDetail({
  watchlist,
  onDelete,
}: {
  watchlist: WatchlistLike;
  onDelete: (watchlistId: string) => void;
}) {
  const addSymbols = useAddWatchlistSymbols();
  const removeSymbols = useRemoveWatchlistSymbols();
  const updateWatchlist = useUpdateWatchlist();
  const updateBinding = useUpdateWatchlistBinding();
  const updateBindings = useUpdateWatchlistBindings();
  const { data: defs } = useStrategyDefinitions();
  const allStrategies = defs?.definitions ?? [];
  // Only live-enabled strategies are offered for a NEW binding; an already-bound strategy that is no
  // longer live stays visible so its binding doesn't appear to vanish.
  const liveStrategies = allStrategies.filter((s) => s.liveEnabled);
  const { data: oppData } = useOpportunities();
  const [symbolInput, setSymbolInput] = useState('');
  const [addStrategyId, setAddStrategyId] = useState(UNBOUND);
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(watchlist.name);
  // Bulk-select state lives here (not in WatchlistReadiness) so it resets for free when the pane is
  // remounted per watchlist via key={watchlistId}.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkStrategyId, setBulkStrategyId] = useState(UNBOUND);
  // Concurrency guard: disables every in-pane control while any of this component's mutations is in
  // flight, closing the write-pairings.
  const writeInFlight =
    addSymbols.isPending ||
    removeSymbols.isPending ||
    updateWatchlist.isPending ||
    updateBinding.isPending ||
    updateBindings.isPending;

  const inQueue = new Set((oppData?.opportunities ?? []).map((o) => o.symbol.toUpperCase()));

  // Authoritative bindings, else the flat mirror mapped to unbound. De-duped by symbol so a transient
  // double-entry can't emit duplicate React keys.
  const rawBindings: Binding[] = watchlist.bindings?.length
    ? watchlist.bindings
    : watchlist.symbols.map((s) => ({ symbol: s, strategyId: '' }));
  const bindings: Binding[] = Array.from(new Map(rawBindings.map((b) => [b.symbol, b])).values());

  function handleAddSymbol() {
    const raw = symbolInput.trim();
    if (!raw) return;
    // Allow comma/space-separated entry; server uppercases + de-dupes.
    const symbols = raw.split(/[\s,]+/).filter(Boolean);
    if (symbols.length === 0) return;
    const strategyId = toApiStrategyId(addStrategyId);
    addSymbols.mutate(
      {
        watchlistId: watchlist.watchlistId,
        symbols,
        bindings: symbols.map((s) => ({ symbol: s, strategyId })),
      },
      { onSuccess: () => setSymbolInput('') },
    );
  }

  // Re-bind one symbol via the targeted single-row RPC. Patches just this entry in the cache — no
  // replace-all, no full-list refetch.
  function setBinding(symbol: string, strategyId: string) {
    updateBinding.mutate({ watchlistId: watchlist.watchlistId, symbol, strategyId });
  }

  // Commit the rename only if the trimmed draft is non-empty and changed. Sends the FULL current
  // bindings/description unchanged.
  function commitRename() {
    const trimmed = nameDraft.trim();
    if (trimmed && trimmed !== watchlist.name) {
      updateWatchlist.mutate({
        watchlistId: watchlist.watchlistId,
        name: trimmed,
        description: watchlist.description ?? '',
        bindings,
      });
    }
    setIsEditingName(false);
  }

  function cancelRename() {
    setNameDraft(watchlist.name);
    setIsEditingName(false);
  }

  // Set the default strategy via a masked partial update (writes ONLY default_strategy_id; bindings/
  // name untouched). Existing edits deliberately omit updateMask.
  function setDefaultStrategy(v: string) {
    updateWatchlist.mutate({
      watchlistId: watchlist.watchlistId,
      updateMask: ['default_strategy_id'],
      defaultStrategyId: toApiStrategyId(v),
    });
  }

  // Bulk-remove the selected symbols in one call, then clear the selection.
  function handleBulkRemove() {
    if (selected.size === 0) return;
    removeSymbols.mutate(
      { watchlistId: watchlist.watchlistId, symbols: [...selected] },
      { onSuccess: () => setSelected(new Set()) },
    );
  }

  // Bulk-assign one strategy across the selection atomically, then clear.
  function handleBulkAssign() {
    if (selected.size === 0) return;
    updateBindings.mutate(
      {
        watchlistId: watchlist.watchlistId,
        symbols: [...selected],
        strategyId: toApiStrategyId(bulkStrategyId),
      },
      { onSuccess: () => setSelected(new Set()) },
    );
  }

  return (
    <div className="p-4">
      <div className="mb-3 flex items-start justify-between">
        <div>
          {isEditingName ? (
            <Input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') cancelRename();
              }}
              aria-label="Watchlist name"
              className="h-8 max-w-xs font-semibold"
              disabled={writeInFlight}
            />
          ) : (
            <div className="flex items-center gap-1.5">
              <h2 className="font-semibold">{watchlist.name}</h2>
              <button
                type="button"
                aria-label={`Rename ${watchlist.name}`}
                onClick={() => {
                  setNameDraft(watchlist.name);
                  setIsEditingName(true);
                }}
                disabled={writeInFlight}
              >
                <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </div>
          )}
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
          {/* A system-managed signals watchlist can't be deleted — omit the destructive affordance. */}
          {!watchlist.systemManaged && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" aria-label={`Delete ${watchlist.name}`}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogDescription>
                  Delete watchlist &quot;{watchlist.name}&quot;? This cannot be undone.
                </AlertDialogDescription>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => {
                    e.preventDefault();
                    onDelete(watchlist.watchlistId);
                  }}
                >
                  Confirm
                </AlertDialogAction>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      {bindings.length === 0 && <p className="mb-3 text-sm text-muted-foreground">No symbols</p>}

      <div className="flex items-center gap-2">
        <Input
          value={symbolInput}
          onChange={(e) => setSymbolInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAddSymbol()}
          placeholder="Add symbols (e.g. AAPL MSFT)"
          className="max-w-xs"
          disabled={writeInFlight}
        />
        <Select value={addStrategyId} onValueChange={setAddStrategyId} disabled={writeInFlight}>
          <SelectTrigger className="h-9 w-40 text-xs" aria-label="Strategy for new symbols">
            <SelectValue placeholder="Unbound" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={UNBOUND}>Unbound</SelectItem>
            {liveStrategies.map((s) => (
              <SelectItem key={s.strategyId} value={s.strategyId}>
                {s.displayName || s.strategyId}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" variant="default" onClick={handleAddSymbol} disabled={writeInFlight}>
          Add
        </Button>
      </div>

      {/* Watchlist-level default strategy: applied to new bare symbols at add time. */}
      <div className="mt-2 flex items-center gap-2" data-testid="default-strategy-control">
        <span className="text-xs text-muted-foreground">Default strategy for new symbols</span>
        <Select
          value={watchlist.defaultStrategyId || UNBOUND}
          onValueChange={setDefaultStrategy}
          disabled={writeInFlight}
        >
          <SelectTrigger className="h-8 w-40 text-xs" aria-label="Default strategy for new symbols">
            <SelectValue placeholder="None">
              {liveStrategies.find((s) => s.strategyId === watchlist.defaultStrategyId)
                ?.displayName ||
                watchlist.defaultStrategyId ||
                undefined}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={UNBOUND}>None</SelectItem>
            {liveStrategies.map((s) => (
              <SelectItem key={s.strategyId} value={s.strategyId}>
                {s.displayName || s.strategyId}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Bulk action bar, shown only when a selection exists. */}
      {selected.size > 0 && (
        <div
          className="mt-3 flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2"
          data-testid="bulk-action-bar"
        >
          <span className="text-xs text-muted-foreground" data-testid="bulk-selection-count">
            {selected.size} selected
          </span>
          <Button
            size="sm"
            variant="destructive"
            onClick={handleBulkRemove}
            disabled={writeInFlight}
            data-testid="bulk-remove"
          >
            Remove selected
          </Button>
          <div className="ml-auto flex items-center gap-2">
            <Select
              value={bulkStrategyId}
              onValueChange={setBulkStrategyId}
              disabled={writeInFlight}
            >
              <SelectTrigger
                className="h-8 w-40 text-xs"
                aria-label="Strategy for selected symbols"
              >
                <SelectValue placeholder="Unbound" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNBOUND}>Unbound</SelectItem>
                {liveStrategies.map((s) => (
                  <SelectItem key={s.strategyId} value={s.strategyId}>
                    {s.displayName || s.strategyId}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="default"
              onClick={handleBulkAssign}
              disabled={writeInFlight}
              data-testid="bulk-apply-strategy"
            >
              Apply strategy
            </Button>
          </div>
        </div>
      )}

      <WatchlistReadiness
        bindings={bindings}
        inQueue={inQueue}
        strategies={allStrategies}
        onRemoveSymbol={(symbol) =>
          removeSymbols.mutate({ watchlistId: watchlist.watchlistId, symbols: [symbol] })
        }
        onRebindSymbol={setBinding}
        disabled={writeInFlight}
        selected={selected}
        onSelectionChange={setSelected}
      />
    </div>
  );
}
