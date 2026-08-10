'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useIsMutating } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { AppShell } from '@/components/insights/AppShell';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/components/ui/utils';
import {
  useWatchlists,
  useCreateWatchlist,
  useDeleteWatchlist,
  WATCHLIST_WRITE_KEY,
} from '@/hooks/useWatchlists';
import { WatchlistDetail } from '@/components/insights/WatchlistDetail';

export default function WatchlistsPage() {
  const { data, isLoading, isFetching, error } = useWatchlists();
  const createWl = useCreateWatchlist();
  const deleteWl = useDeleteWatchlist();
  // Layer 2 of the concurrency guard (design.md §5) — closes the race a WatchlistDetail-per-switch
  // `key` remount would otherwise reopen: since page.tsx is never remounted, this sees an in-flight
  // write even if the WatchlistDetail instance that started it has since unmounted. The
  // `|| isFetching` clause closes the residual window between a mutation settling and its
  // invalidated `['watchlists']` query actually refetching (useIsMutating alone only covers the
  // RPC's own duration).
  const anyWatchlistWriteInFlight =
    useIsMutating({ mutationKey: WATCHLIST_WRITE_KEY }) > 0 || isFetching;

  const [newName, setNewName] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // A just-created list id we want to select as soon as it lands in the refetched list. Setting
  // selectedId directly in create's onSuccess would race the ListWatchlists refetch — the reconcile
  // effect would see an id "not in the list yet" and clobber it back to the first list.
  const pendingSelectRef = useRef<string | null>(null);

  const watchlists = useMemo(() => data?.watchlists ?? [], [data]);

  // Keep the selection valid: honor a pending just-created id once it appears, default to the first
  // list, and reconcile to the first remaining / null when the selected list is deleted or the set
  // empties (a dangling id → blank detail).
  useEffect(() => {
    const pending = pendingSelectRef.current;
    if (pending && watchlists.some((wl) => wl.watchlistId === pending)) {
      pendingSelectRef.current = null;
      setSelectedId(pending);
      return;
    }
    if (watchlists.length === 0) {
      if (selectedId !== null) setSelectedId(null);
      return;
    }
    if (!selectedId || !watchlists.some((wl) => wl.watchlistId === selectedId)) {
      setSelectedId(watchlists[0].watchlistId);
    }
  }, [watchlists, selectedId]);

  function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    createWl.mutate(
      { name },
      {
        onSuccess: (res) => {
          setNewName('');
          // Auto-select the created list once the refetch includes it (see pendingSelectRef).
          if (res?.watchlist?.watchlistId) pendingSelectRef.current = res.watchlist.watchlistId;
        },
      },
    );
  }

  function handleDelete(watchlistId: string) {
    deleteWl.mutate(watchlistId);
  }

  const selected = watchlists.find((wl) => wl.watchlistId === selectedId) ?? null;

  return (
    <AppShell>
      <div className="p-4 sm:p-6">
        <div className="mb-6">
          <h1 className="text-xl font-bold tracking-tight">Watchlists</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Ranked by how close each name is to firing a signal — not by price change. Pick a
            strategy to see each list&apos;s readiness.
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

        {watchlists.length > 0 && (
          <div className="grid gap-4 md:grid-cols-[minmax(0,16rem)_1fr]">
            {/* Master column — select a list to see its detail. */}
            <Card>
              <CardContent className="p-2" data-testid="watchlist-master">
                <ul className="space-y-1">
                  {watchlists.map((wl) => (
                    <li key={wl.watchlistId}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(wl.watchlistId)}
                        aria-current={wl.watchlistId === selectedId}
                        disabled={anyWatchlistWriteInFlight}
                        className={cn(
                          'flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm',
                          wl.watchlistId === selectedId
                            ? 'bg-accent text-accent-foreground'
                            : 'hover:bg-accent/50',
                          'disabled:pointer-events-none disabled:opacity-50',
                        )}
                      >
                        <span className="truncate font-medium">{wl.name}</span>
                        <span className="ml-2 shrink-0 text-xs text-muted-foreground tabular-nums">
                          {wl.symbols.length}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            {/* Detail column — the selected list. */}
            <Card>
              <CardContent className="p-0">
                {selected ? (
                  <WatchlistDetail
                    watchlist={selected}
                    onDelete={handleDelete}
                    key={selected.watchlistId}
                  />
                ) : (
                  <p className="p-4 text-sm text-muted-foreground">Select a watchlist.</p>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </AppShell>
  );
}
