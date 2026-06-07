'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { AppShell } from '@/components/insights/AppShell';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useStrategies } from '@/hooks/useStrategies';
import { useStrategyDefinitions, useManageStrategy } from '@/hooks/useStrategyDefinitions';
import { useIsAdmin } from '@/hooks/useLiveStrategies';
import { StrategyOperation } from '@xstockstrat/proto/analysis/v1/analysis_pb';
import type { StrategyScore } from '@xstockstrat/proto/analysis/v1/analysis_pb';

function ratingVariant(rating: string): 'buy' | 'info' | 'warning' | 'destructive' {
  if (rating === 'A') return 'buy';
  if (rating === 'B') return 'info';
  if (rating === 'C') return 'warning';
  return 'destructive';
}

function scoreColor(score: number): string {
  if (score >= 0.8) return 'text-buy';
  if (score >= 0.6) return 'text-paper';
  return 'text-destructive';
}

export default function StrategiesPage() {
  const router = useRouter();
  const { data, isLoading, error } = useStrategies();
  const { data: isAdmin } = useIsAdmin();
  // Definitions (active/live state) — merged in by id so deactivated strategies
  // can be visually distinguished and the Deactivate action can be hidden.
  const { data: defsData } = useStrategyDefinitions(true);
  const manage = useManageStrategy();

  const activeById = new Map(
    (defsData?.definitions ?? []).map((d) => [d.strategyId, d.active]),
  );

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
              All registered trading strategies with scores
            </p>
          </div>
          {isAdmin && (
            <Button onClick={() => router.push('/insights/strategies/new')}>
              <Plus className="h-4 w-4 mr-1.5" />
              New Strategy
            </Button>
          )}
        </div>

        {isLoading && <p className="text-sm text-muted-foreground">Loading strategies…</p>}
        {error && <p className="text-sm text-destructive">Failed to load strategies</p>}

        {data && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {(data.strategies ?? []).map((s: StrategyScore) => {
              const isActive = activeById.get(s.strategyId);
              return (
                <div key={s.strategyId} className="space-y-2">
                  <Link href={`/insights/strategies/${s.strategyId}`}>
                    <Card className="h-full hover:border-primary/50 transition-colors cursor-pointer">
                      <CardContent className="pt-5">
                        <div className="flex items-start justify-between mb-3">
                          <p className="text-sm font-semibold font-mono text-foreground truncate mr-2">
                            {s.strategyId}
                          </p>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {isActive === false && <Badge variant="secondary">inactive</Badge>}
                            {s.rating && (
                              <Badge variant={ratingVariant(s.rating)}>{s.rating}</Badge>
                            )}
                          </div>
                        </div>
                        {s.overallScore !== undefined && (
                          <div className="space-y-1.5">
                            <div className="flex justify-between text-xs">
                              <span className="text-muted-foreground">Overall Score</span>
                              <span
                                className={`font-bold tabular-nums ${scoreColor(s.overallScore)}`}
                              >
                                {(s.overallScore * 100).toFixed(0)}%
                              </span>
                            </div>
                            {s.componentScores &&
                              Object.entries(s.componentScores as Record<string, number>)
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
                        onClick={() => router.push(`/insights/strategies/${s.strategyId}/edit`)}
                      >
                        Edit
                      </Button>
                      {isActive !== false && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={manage.isPending}
                          onClick={() => handleDeactivate(s.strategyId)}
                        >
                          Deactivate
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {(data.strategies ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground col-span-3">
                No strategies found. Run a backtest to register a strategy.
              </p>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
