'use client';
import useSWR from 'swr';
import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { analysisClient } from '@/lib/browserClients';

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
  const { data, isLoading, error } = useSWR(
    ['analysis-strategies'],
    () => analysisClient.listStrategies({ page: { pageSize: 50 } }),
    { refreshInterval: 30000 },
  );

  return (
    <AppShell>
      <div className="p-4 sm:p-6">
        <div className="mb-6">
          <h1 className="text-xl font-bold tracking-tight">Strategies</h1>
          <p className="text-sm text-muted-foreground mt-1">All registered trading strategies with scores</p>
        </div>

        {isLoading && <p className="text-sm text-muted-foreground">Loading strategies…</p>}
        {error && <p className="text-sm text-destructive">Failed to load strategies</p>}

        {data && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {(data.strategies ?? []).map((s: any) => (
              <Link key={s.strategyId} href={`/strategies/${s.strategyId}`}>
                <Card className="h-full hover:border-primary/50 transition-colors cursor-pointer">
                  <CardContent className="pt-5">
                    <div className="flex items-start justify-between mb-3">
                      <p className="text-sm font-semibold font-mono text-foreground truncate mr-2">{s.strategyId}</p>
                      {s.rating && (
                        <Badge variant={ratingVariant(s.rating)} className="shrink-0">
                          {s.rating}
                        </Badge>
                      )}
                    </div>
                    {s.overallScore !== undefined && (
                      <div className="space-y-1.5">
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">Overall Score</span>
                          <span className={`font-bold tabular-nums ${scoreColor(s.overallScore)}`}>
                            {(s.overallScore * 100).toFixed(0)}%
                          </span>
                        </div>
                        {s.componentScores &&
                          Object.entries(s.componentScores as Record<string, number>)
                            .slice(0, 3)
                            .map(([key, val]) => (
                              <div key={key} className="flex justify-between text-xs">
                                <span className="text-muted-foreground capitalize">{key}</span>
                                <span className="text-foreground/60 tabular-nums">{(val * 100).toFixed(0)}</span>
                              </div>
                            ))}
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground mt-3">View details →</p>
                  </CardContent>
                </Card>
              </Link>
            ))}
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
