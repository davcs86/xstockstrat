'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { AppShell } from '@/components/insights/AppShell';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StatTile } from '@/components/shared/StatTile';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { useStrategies } from '@/hooks/useStrategies';
import { useStrategyDefinitions, useManageStrategy } from '@/hooks/useStrategyDefinitions';
import { useIsAdmin } from '@/hooks/useLiveStrategies';
import { useStrategyAnalytics } from '@/hooks/useOpportunities';
import { StrategyOperation } from '@xstockstrat/proto/analysis/v1/analysis_pb';
import type { StrategyDefinition, StrategyScore } from '@xstockstrat/proto/analysis/v1/analysis_pb';
import { scoreColor } from '@/lib/scoreDisplay';

export default function StrategiesPage() {
  const router = useRouter();
  const { data: isAdmin } = useIsAdmin();
  // Registered strategy definitions drive the list — a strategy appears here as
  // soon as it is registered, whether or not it has been backtested/scored yet.
  // Admins additionally see inactive (deactivated) definitions.
  const { data: defsData, isLoading, error } = useStrategyDefinitions(!!isAdmin);
  // Scores are merged in by id; a definition without a score renders a
  // "not scored yet" state instead of being hidden.
  const { data: scoresData } = useStrategies();
  const manage = useManageStrategy();

  const scoreById = new Map((scoresData?.strategies ?? []).map((s) => [s.strategyId, s]));
  const definitions = defsData?.definitions ?? [];
  // Aggregate stats + the Active/Paused/Off state vocabulary (never Live/Paper — that would
  // collide with the account trading mode; design.md § Strategies). "Active" = running live;
  // "Paused" = registered-active but not live-enabled — counted separately, not folded in.
  const activeCount = definitions.filter((d) => d.active && d.liveEnabled).length;
  const pausedCount = definitions.filter((d) => d.active && !d.liveEnabled).length;
  const scoredDefs = definitions.filter((d) => scoreById.has(d.strategyId));
  const scoredCount = scoredDefs.length;
  const avgScore = scoredCount
    ? scoredDefs.reduce((s, d) => s + Number(scoreById.get(d.strategyId)?.overallScore ?? 0), 0) /
      scoredCount
    : null;

  function handleDeactivate(strategyId: string) {
    manage.mutate({ operation: StrategyOperation.DEACTIVATE, definition: { strategyId } });
  }

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

        {/* Aggregate stat row (feature 083) — from the definitions + merged scores. */}
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
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Strategy</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead className="text-right hidden sm:table-cell">Signals 30d</TableHead>
                    <TableHead className="text-right hidden md:table-cell">Taken</TableHead>
                    <TableHead className="text-right">Hit rate</TableHead>
                    <TableHead className="text-right">Expectancy</TableHead>
                    <TableHead className="text-right hidden lg:table-cell">Max DD</TableHead>
                    <TableHead className="text-right">Score</TableHead>
                    <TableHead className="text-right">{isAdmin ? 'Actions' : ''}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {definitions.map((d) => (
                    <StrategyRow
                      key={d.strategyId}
                      def={d}
                      score={scoreById.get(d.strategyId)}
                      isAdmin={!!isAdmin}
                      deactivating={manage.isPending}
                      onEdit={() => router.push(`/insights/strategies/${d.strategyId}/edit`)}
                      onDeactivate={() => handleDeactivate(d.strategyId)}
                    />
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}

/** One strategy row backed by per-strategy analytics (Signals/Taken/Hit-rate/Expectancy/Max-DD). */
function StrategyRow({
  def: d,
  score,
  isAdmin,
  deactivating,
  onEdit,
  onDeactivate,
}: {
  def: StrategyDefinition;
  score: StrategyScore | undefined;
  isAdmin: boolean;
  deactivating: boolean;
  onEdit: () => void;
  onDeactivate: () => void;
}) {
  const { data: a } = useStrategyAnalytics(d.strategyId);
  const state = !d.active ? 'Off' : d.liveEnabled ? 'Active' : 'Paused';
  const stateVariant = !d.active ? 'secondary' : d.liveEnabled ? 'buy' : 'warning';
  return (
    <TableRow>
      <TableCell className="font-mono font-semibold">
        <Link href={`/insights/strategies/${d.strategyId}`} className="hover:underline">
          {d.displayName || d.strategyId}
        </Link>
      </TableCell>
      <TableCell>
        <Badge variant={stateVariant}>{state}</Badge>
      </TableCell>
      <TableCell className="text-right tabular-nums hidden sm:table-cell">
        {a ? a.signals30d : '—'}
      </TableCell>
      <TableCell className="text-right tabular-nums hidden md:table-cell text-muted-foreground">
        {a ? a.taken : '—'}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {a ? `${(a.blendedHitRate * 100).toFixed(0)}%` : '—'}
      </TableCell>
      <TableCell
        className={`text-right tabular-nums ${
          a ? (a.expectancy >= 0 ? 'text-buy' : 'text-destructive') : ''
        }`}
      >
        {a ? `${a.expectancy >= 0 ? '+' : ''}${a.expectancy.toFixed(2)}` : '—'}
      </TableCell>
      <TableCell className="text-right tabular-nums hidden lg:table-cell text-destructive">
        {a ? `-${(a.maxDrawdown * 100).toFixed(0)}%` : '—'}
      </TableCell>
      <TableCell
        className={`text-right tabular-nums font-semibold ${score ? scoreColor(score.overallScore) : ''}`}
      >
        {score ? `${(score.overallScore * 100).toFixed(0)}%` : '—'}
      </TableCell>
      <TableCell className="text-right whitespace-nowrap">
        {isAdmin ? (
          <>
            <Button size="sm" variant="outline" className="mr-1" onClick={onEdit}>
              Edit
            </Button>
            {d.active && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="ghost" disabled={deactivating}>
                    Deactivate
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogDescription>
                    Deactivate strategy &quot;{d.strategyId}&quot;? It will no longer appear in the
                    active list.
                  </AlertDialogDescription>
                  <AlertDialogCancel disabled={deactivating}>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    disabled={deactivating}
                    onClick={(e) => {
                      e.preventDefault();
                      onDeactivate();
                    }}
                  >
                    Confirm
                  </AlertDialogAction>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </>
        ) : (
          <Link
            href={`/insights/strategies/${d.strategyId}`}
            className="text-sm text-primary hover:underline"
          >
            Open →
          </Link>
        )}
      </TableCell>
    </TableRow>
  );
}
