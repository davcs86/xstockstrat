'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useIsMutating } from '@tanstack/react-query';
import { Plus, ChevronLeft } from 'lucide-react';
import { AppShell } from '@/components/insights/AppShell';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormDialog } from '@/components/shared/FormDialog';
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
  // Concurrency guard that survives WatchlistDetail remounts (page.tsx is never remounted): blocks
  // switching while a watchlist write is in flight; `|| isFetching` covers the settle→refetch window.
  const anyWatchlistWriteInFlight =
    useIsMutating({ mutationKey: WATCHLIST_WRITE_KEY }) > 0 || isFetching;

  const [newName, setNewName] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Mobile inbox nav: two panes on md+, one at a time on a phone (tap to open detail, back to list).
  const [mobileView, setMobileView] = useState<'list' | 'detail'>('list');
  // A just-created list id to select once it lands in the refetched list. Setting selectedId in
  // create's onSuccess would race the refetch and get clobbered to the first list.
  const pendingSelectRef = useRef<string | null>(null);

  const watchlists = useMemo(() => data?.watchlists ?? [], [data]);

  // Keep the selection valid: honor a pending just-created id, default to the first list, and
  // reconcile to the first remaining / null when the selected list is deleted or the set empties.
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
          setCreateOpen(false);
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
        <div className="mb-6 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Watchlists</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Ranked by how close each name is to firing a signal — not by price change. Pick a
              strategy to see each list&apos;s readiness.
            </p>
          </div>
          <FormDialog
            open={createOpen}
            onOpenChange={(o) => {
              setCreateOpen(o);
              if (!o) setNewName('');
            }}
            trigger={
              <Button className="shrink-0">
                <Plus className="mr-1.5 h-4 w-4" />
                New watchlist
              </Button>
            }
            title="New watchlist"
            description="Name it now — add symbols and bind strategies after it's created."
          >
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground" htmlFor="new-watchlist">
                  Watchlist name
                </label>
                <Input
                  id="new-watchlist"
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                  placeholder="e.g. Tech Large-Cap"
                />
              </div>
              {createWl.error && (
                <p className="text-sm text-destructive">{(createWl.error as Error).message}</p>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setCreateOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleCreate} disabled={createWl.isPending || !newName.trim()}>
                  {createWl.isPending ? 'Creating…' : 'Create'}
                </Button>
              </div>
            </div>
          </FormDialog>
        </div>

        {isLoading && <p className="text-sm text-muted-foreground">Loading watchlists…</p>}
        {error && <p className="text-sm text-destructive">Failed to load watchlists.</p>}
        {!isLoading && !error && watchlists.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No watchlists yet. Use “New watchlist” to create one.
          </p>
        )}

        {watchlists.length > 0 && (
          <div className="grid gap-4 md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
            {/* Master column (inbox) — hidden on mobile while a detail is open. */}
            <Card className={cn(mobileView === 'detail' && 'hidden md:block')}>
              <CardContent className="p-2" data-testid="watchlist-master">
                <ul className="space-y-1">
                  {watchlists.map((wl) => (
                    <li key={wl.watchlistId}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedId(wl.watchlistId);
                          setMobileView('detail');
                        }}
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

            {/* Detail column (reading pane) — hidden on mobile until a list is opened. */}
            <Card className={cn('min-w-0', mobileView === 'list' && 'hidden md:block')}>
              <CardContent className="p-0">
                <button
                  type="button"
                  onClick={() => setMobileView('list')}
                  className="flex items-center gap-1 px-4 pt-3 text-sm text-muted-foreground hover:text-foreground md:hidden"
                >
                  <ChevronLeft className="h-4 w-4" />
                  All watchlists
                </button>
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
