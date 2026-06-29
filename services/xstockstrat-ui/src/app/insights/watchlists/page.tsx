'use client';
import { useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { AppShell } from '@/components/insights/AppShell';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  useWatchlists,
  useCreateWatchlist,
  useDeleteWatchlist,
  useAddWatchlistSymbols,
  useRemoveWatchlistSymbols,
} from '@/hooks/useWatchlists';

export default function WatchlistsPage() {
  const { data, isLoading, error } = useWatchlists();
  const createWl = useCreateWatchlist();
  const deleteWl = useDeleteWatchlist();
  const addSymbols = useAddWatchlistSymbols();
  const removeSymbols = useRemoveWatchlistSymbols();

  const [newName, setNewName] = useState('');
  // Per-watchlist "add symbol" input state, keyed by watchlist id.
  const [symbolInputs, setSymbolInputs] = useState<Record<string, string>>({});

  function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    createWl.mutate({ name }, { onSuccess: () => setNewName('') });
  }

  function handleAddSymbol(watchlistId: string) {
    const raw = (symbolInputs[watchlistId] ?? '').trim();
    if (!raw) return;
    // Allow comma/space-separated entry; server uppercases + de-dupes.
    const symbols = raw.split(/[\s,]+/).filter(Boolean);
    if (symbols.length === 0) return;
    addSymbols.mutate(
      { watchlistId, symbols },
      { onSuccess: () => setSymbolInputs((s) => ({ ...s, [watchlistId]: '' })) },
    );
  }

  function handleDelete(watchlistId: string, name: string) {
    if (!window.confirm(`Delete watchlist "${name}"? This cannot be undone.`)) return;
    deleteWl.mutate(watchlistId);
  }

  const watchlists = data?.watchlists ?? [];

  return (
    <AppShell>
      <div className="p-4 sm:p-6">
        <div className="mb-6">
          <h1 className="text-xl font-bold tracking-tight">Watchlists</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Named symbol sets you own. Use them to scope screeners and scans.
          </p>
        </div>

        <Card className="mb-6">
          <CardContent className="flex items-end gap-2 p-4">
            <div className="flex-1">
              <label className="text-xs text-muted-foreground" htmlFor="new-watchlist">
                New watchlist name
              </label>
              <Input
                id="new-watchlist"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                placeholder="e.g. Tech Large-Cap"
              />
            </div>
            <Button onClick={handleCreate} disabled={createWl.isPending || !newName.trim()}>
              <Plus className="h-4 w-4 mr-1.5" />
              Create
            </Button>
          </CardContent>
        </Card>

        {createWl.error && (
          <p className="text-sm text-destructive mb-4">{(createWl.error as Error).message}</p>
        )}

        {isLoading && <p className="text-sm text-muted-foreground">Loading watchlists…</p>}
        {error && <p className="text-sm text-destructive">Failed to load watchlists.</p>}
        {!isLoading && !error && watchlists.length === 0 && (
          <p className="text-sm text-muted-foreground">No watchlists yet. Create one above.</p>
        )}

        <div className="space-y-4">
          {watchlists.map((wl) => (
            <Card key={wl.watchlistId}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h2 className="font-semibold">{wl.name}</h2>
                    {wl.description && (
                      <p className="text-sm text-muted-foreground">{wl.description}</p>
                    )}
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleDelete(wl.watchlistId, wl.name)}
                    aria-label={`Delete ${wl.name}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                <div className="flex flex-wrap gap-1.5 mb-3" data-testid="symbol-list">
                  {wl.symbols.length === 0 && (
                    <span className="text-sm text-muted-foreground">No symbols</span>
                  )}
                  {wl.symbols.map((sym) => (
                    <Badge key={sym} variant="info" className="gap-1">
                      {sym}
                      <button
                        type="button"
                        aria-label={`Remove ${sym}`}
                        onClick={() =>
                          removeSymbols.mutate({ watchlistId: wl.watchlistId, symbols: [sym] })
                        }
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>

                <div className="flex items-center gap-2">
                  <Input
                    value={symbolInputs[wl.watchlistId] ?? ''}
                    onChange={(e) =>
                      setSymbolInputs((s) => ({ ...s, [wl.watchlistId]: e.target.value }))
                    }
                    onKeyDown={(e) => e.key === 'Enter' && handleAddSymbol(wl.watchlistId)}
                    placeholder="Add symbols (e.g. AAPL MSFT)"
                    className="max-w-xs"
                  />
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() => handleAddSymbol(wl.watchlistId)}
                  >
                    Add
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
