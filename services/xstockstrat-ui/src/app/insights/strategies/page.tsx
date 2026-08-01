'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { AppShell } from '@/components/insights/AppShell';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StatTile } from '@/components/shared/StatTile';
import { useStrategies } from '@/hooks/useStrategies';
import { useStrategyDefinitions, useManageStrategy } from '@/hooks/useStrategyDefinitions';
import { useIsAdmin } from '@/hooks/useLiveStrategies';
import { StrategyOperation } from '@xstockstrat/proto/analysis/v1/analysis_pb';
import type { StrategyScore } from '@xstockstrat/proto/analysis/v1/analysis_pb';
import { ratingVariant, scoreColor, formatSymbolYears } from '@/lib/scoreDisplay';

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
  // collide with the account trading mode; design.md § Strategies).
  const activeCount = definitions.filter((d) => d.active).length;
  const pausedCount = definitions.filter((d) => d.active && !d.liveEnabled).length;
  const scoredDefs = definitions.filter((d) => scoreById.has(d.strategyId));
  const scoredCount = scoredDefs.length;
  const avgScore = scoredCount
    ? scoredDefs.reduce((s, d) => s + Number(scoreById.get(d.strategyId)?.overallScore ?? 0), 0) /
      scoredCount
    : null;

  function handleDeactivate(strategyId: string) {
    if (
      !window.confirm(
        `Deactivate strategy "${strategyId}"? It will no longer appear in the active list.`,
      )
    ) {
      return;
    }
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

        {defsData && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {definitions.map((d) => {
              const score: StrategyScore | undefined = scoreById.get(d.strategyId);
              const isActive = d.active;
              return (
                <div key={d.strategyId} className="space-y-2">
                  <Link href={`/insights/strategies/${d.strategyId}`}>
                    <Card className="h-full hover:border-primary/50 transition-colors cursor-pointer">
                      <CardContent className="pt-5">
                        <div className="flex items-start justify-between mb-3">
                          <p className="text-sm font-semibold font-mono text-foreground truncate mr-2">
                            {d.displayName || d.strategyId}
                          </p>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {/* State vocabulary (Active/Paused/Off) — never Live/Paper (083). */}
                            <Badge
                              variant={!isActive ? 'secondary' : d.liveEnabled ? 'buy' : 'warning'}
                            >
                              {!isActive ? 'Off' : d.liveEnabled ? 'Active' : 'Paused'}
                            </Badge>
                            {score?.provisional && <Badge variant="secondary">Provisional</Badge>}
                            {score?.rating && (
                              <Badge variant={ratingVariant(score.rating)}>{score.rating}</Badge>
                            )}
                          </div>
                        </div>
                        {score ? (
                          <div className="space-y-1.5">
                            <div className="flex justify-between text-xs">
                              <span className="text-muted-foreground">Overall Score</span>
                              <span
                                className={`font-bold tabular-nums ${scoreColor(score.overallScore)}`}
                              >
                                {(score.overallScore * 100).toFixed(0)}%
                              </span>
                            </div>
                            {/* feature 065: evidence breadth + duration behind the derived grade. */}
                            <p className="text-[11px] text-muted-foreground">
                              {score.evidenceSymbols} symbols ·{' '}
                              {formatSymbolYears(score.evidenceDays)}
                            </p>
                            {score.componentScores &&
                              Object.entries(score.componentScores as Record<string, number>)
                                .slice(0, 3)
                                .map(([key, val]) => (
                                  <div key={key} className="flex justify-between text-xs">
                                    <span className="text-muted-foreground capitalize">{key}</span>
                                    <span className="text-foreground/60 tabular-nums">
                                      {(val * 100).toFixed(0)}
                                    </span>
                                  </div>
                                ))}
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            Not scored yet — run a backtest to generate a score.
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground mt-3">View details →</p>
                      </CardContent>
                    </Card>
                  </Link>
                  {isAdmin && (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => router.push(`/insights/strategies/${d.strategyId}/edit`)}
                      >
                        Edit
                      </Button>
                      {isActive && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={manage.isPending}
                          onClick={() => handleDeactivate(d.strategyId)}
                        >
                          Deactivate
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {definitions.length === 0 && (
              <p className="text-sm text-muted-foreground col-span-3">
                No strategies registered yet. Create one with “New Strategy”, or run a backtest.
              </p>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
