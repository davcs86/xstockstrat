'use client';
import { useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import type { CellContext, ColumnDef } from '@tanstack/react-table';
import { AppShell } from '@/components/insights/AppShell';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StatTile } from '@/components/shared/StatTile';
import { DataTable } from '@/components/ui/data-table';
import { RowActionsMenu } from '@/components/shared/RowActionsMenu';
import { useStrategies } from '@/hooks/useStrategies';
import { useStrategyDefinitions, useManageStrategy } from '@/hooks/useStrategyDefinitions';
import { useIsAdmin } from '@/hooks/useLiveStrategies';
import { useStrategyAnalytics } from '@/hooks/useOpportunities';
import { StrategyOperation } from '@xstockstrat/proto/analysis/v1/analysis_pb';
import type { StrategyDefinition } from '@xstockstrat/proto/analysis/v1/analysis_pb';
import { scoreColor } from '@/lib/scoreDisplay';

export default function StrategiesPage() {
  const router = useRouter();
  const { data: isAdmin } = useIsAdmin();
  // Registered definitions drive the list — a strategy appears as soon as it is registered, scored
  // or not. Admins additionally see inactive (deactivated) definitions.
  const { data: defsData, isLoading, error } = useStrategyDefinitions(!!isAdmin);
  // Scores are merged in by id; a definition without a score renders a
  // "not scored yet" state instead of being hidden.
  const { data: scoresData } = useStrategies();

  const scoreById = new Map((scoresData?.strategies ?? []).map((s) => [s.strategyId, s]));
  const definitions = defsData?.definitions ?? [];
  // State vocabulary is Active/Paused/Off (never Live/Paper — that collides with the account trading
  // mode). Active = running live; Paused = registered-active but not live-enabled.
  const activeCount = definitions.filter((d) => d.active && d.liveEnabled).length;
  const pausedCount = definitions.filter((d) => d.active && !d.liveEnabled).length;
  const scoredDefs = definitions.filter((d) => scoreById.has(d.strategyId));
  const scoredCount = scoredDefs.length;
  const avgScore = scoredCount
    ? scoredDefs.reduce((s, d) => s + Number(scoreById.get(d.strategyId)?.overallScore ?? 0), 0) /
      scoredCount
    : null;

  const columns = useMemo<ColumnDef<StrategyDefinition>[]>(
    () => [
      {
        id: 'strategy',
        header: 'Strategy',
        accessorFn: (d) => d.displayName || d.strategyId,
        meta: { className: 'font-mono font-semibold' },
        cell: ({ row }) => {
          const d = row.original;
          return (
            <Link href={`/insights/strategies/${d.strategyId}`} className="hover:underline">
              {d.displayName || d.strategyId}
            </Link>
          );
        },
      },
      {
        id: 'state',
        header: 'State',
        accessorFn: (d) => (!d.active ? 'Off' : d.liveEnabled ? 'Active' : 'Paused'),
        cell: ({ row }) => {
          const d = row.original;
          const state = !d.active ? 'Off' : d.liveEnabled ? 'Active' : 'Paused';
          const stateVariant = !d.active ? 'secondary' : d.liveEnabled ? 'buy' : 'warning';
          return <Badge variant={stateVariant}>{state}</Badge>;
        },
      },
      {
        id: 'signals30d',
        header: 'Signals 30d',
        enableSorting: false,
        meta: { className: 'text-right hidden sm:table-cell' },
        cell: ({ row }) => (
          <AnalyticsCell
            strategyId={row.original.strategyId}
            render={(a) => (a ? a.signals30d : '—')}
          />
        ),
      },
      {
        id: 'taken',
        header: 'Taken',
        enableSorting: false,
        meta: { className: 'text-right hidden md:table-cell text-muted-foreground' },
        cell: ({ row }) => (
          <AnalyticsCell strategyId={row.original.strategyId} render={(a) => (a ? a.taken : '—')} />
        ),
      },
      {
        id: 'hitRate',
        header: 'Hit rate',
        enableSorting: false,
        meta: { className: 'text-right tabular-nums' },
        cell: ({ row }) => (
          <AnalyticsCell
            strategyId={row.original.strategyId}
            render={(a) => (a ? `${(a.blendedHitRate * 100).toFixed(0)}%` : '—')}
          />
        ),
      },
      {
        id: 'expectancy',
        header: 'Expectancy',
        enableSorting: false,
        meta: { className: 'text-right tabular-nums' },
        cell: ({ row }) => (
          <AnalyticsCell
            strategyId={row.original.strategyId}
            render={(a) => (
              <span className={a ? (a.expectancy >= 0 ? 'text-buy' : 'text-destructive') : ''}>
                {a ? `${a.expectancy >= 0 ? '+' : ''}${a.expectancy.toFixed(2)}` : '—'}
              </span>
            )}
          />
        ),
      },
      {
        id: 'maxDD',
        header: 'Max DD',
        enableSorting: false,
        meta: { className: 'text-right hidden lg:table-cell text-destructive' },
        cell: ({ row }) => (
          <AnalyticsCell
            strategyId={row.original.strategyId}
            render={(a) => (a ? `-${(a.maxDrawdown * 100).toFixed(0)}%` : '—')}
          />
        ),
      },
      {
        id: 'score',
        header: 'Score',
        accessorFn: (d) => scoreById.get(d.strategyId)?.overallScore ?? -1,
        meta: { className: 'text-right tabular-nums font-semibold' },
        cell: ({ row }) => {
          const score = scoreById.get(row.original.strategyId);
          return (
            <span className={score ? scoreColor(score.overallScore) : ''}>
              {score ? `${(score.overallScore * 100).toFixed(0)}%` : '—'}
            </span>
          );
        },
      },
      {
        id: 'actions',
        header: isAdmin ? 'Actions' : '',
        enableSorting: false,
        meta: { className: 'text-right whitespace-nowrap' },
        cell: StrategyActionsCell,
      },
    ],
    [scoreById, isAdmin],
  );

  return (
    <AppShell>
      <div className="p-4 sm:p-6">
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Strategies</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {activeCount} active · these are what put signals in your queue.
            </p>
          </div>
          {isAdmin && (
            <Button onClick={() => router.push('/insights/strategies/new')}>
              <Plus className="h-4 w-4 mr-1.5" />
              New Strategy
            </Button>
          )}
        </div>

        {definitions.length > 0 && (
          <div className="mb-6 grid grid-cols-2 overflow-hidden rounded-md border border-border sm:grid-cols-4">
            <StatTile
              label="Active strategies"
              value={activeCount}
              tone="gain"
              sub={pausedCount > 0 ? `${pausedCount} paused` : undefined}
            />
            <StatTile label="Registered" value={definitions.length} sub="incl. inactive" />
            <StatTile
              label="Scored"
              value={scoredCount}
              tone="accent"
              sub={`of ${definitions.length}`}
            />
            <StatTile
              label="Blended score"
              value={avgScore === null ? '—' : `${(avgScore * 100).toFixed(0)}%`}
              sub="mean overall"
            />
          </div>
        )}

        {isLoading && <p className="text-sm text-muted-foreground">Loading strategies…</p>}
        {error && <p className="text-sm text-destructive">Failed to load strategies</p>}

        {defsData && definitions.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No strategies registered yet. Create one with “New Strategy”, or run a backtest.
          </p>
        )}

        {defsData && definitions.length > 0 && (
          <Card>
            <CardContent className="p-0">
              <DataTable columns={columns} data={definitions} getRowId={(d) => d.strategyId} />
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}

/**
 * Per-cell strategy-analytics reader. Each of the 6 analytics columns renders its own instance
 * rather than hoisting the hook above the row loop: React Query dedupes identical concurrent queries
 * by key, so 6 calls with the same `strategyId` cost one round-trip, not six.
 */
function AnalyticsCell({
  strategyId,
  render,
}: {
  strategyId: string;
  render: (a: ReturnType<typeof useStrategyAnalytics>['data']) => React.ReactNode;
}) {
  const { data: a } = useStrategyAnalytics(strategyId);
  return <>{render(a)}</>;
}

/** Module-level on purpose: an inline `cell` would remount with every `columns` rebuild. */
function StrategyActionsCell({ row }: CellContext<StrategyDefinition, unknown>) {
  const router = useRouter();
  const { data: isAdmin } = useIsAdmin();
  const { mutate, isPending } = useManageStrategy();
  const { strategyId, active } = row.original;

  if (!isAdmin) {
    return (
      <Link
        href={`/insights/strategies/${strategyId}`}
        className="text-sm text-primary hover:underline"
      >
        Open →
      </Link>
    );
  }
  return (
    <RowActionsMenu
      testId={`actions-${strategyId}`}
      triggerLabel={`Actions for ${strategyId}`}
      actions={[
        { label: 'Edit', onSelect: () => router.push(`/insights/strategies/${strategyId}/edit`) },
        ...(active
          ? [
              {
                label: 'Deactivate',
                destructive: true,
                disabled: isPending,
                onSelect: () =>
                  mutate({ operation: StrategyOperation.DEACTIVATE, definition: { strategyId } }),
                confirm: {
                  title: 'Deactivate strategy',
                  description: (
                    <>
                      Deactivate strategy &quot;{strategyId}&quot;? It will no longer appear in the
                      active list.
                    </>
                  ),
                },
              },
            ]
          : []),
      ]}
    />
  );
}
