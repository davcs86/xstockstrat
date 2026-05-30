'use client';
import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { AppShell } from '@/components/AppShell';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AccountPortfolioSelector } from '@/components/AccountPortfolioSelector';
import { BASE_PATH } from '@/lib/basepath';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function DashboardSkeleton() {
  return (
    <AppShell>
      <div className="p-4 sm:p-6 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
          <div className="md:col-span-4">
            <Card className="h-full">
              <CardHeader>
                <CardTitle>Strategy Scores</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">Loading…</p>
              </CardContent>
            </Card>
          </div>
          <div className="md:col-span-8">
            <Card className="h-full">
              <CardHeader>
                <CardTitle>Equity Curve</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-60 rounded-md bg-secondary/40 animate-pulse" />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <InsightsDashboard />
    </Suspense>
  );
}

function InsightsDashboard() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const accountId = searchParams.get('account_id') ?? '';

  const handleAccountChange = (id: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (id) {
      params.set('account_id', id);
    } else {
      params.delete('account_id');
    }
    router.replace(`/?${params.toString()}`);
  };

  const { data: strategies } = useSWR(`${BASE_PATH}/api/analysis/strategies`, fetcher, {
    refreshInterval: 30000,
  });

  const topStrategy = strategies?.strategies?.[0];

  return (
    <AppShell>
      <div className="p-4 sm:p-6 space-y-4">
        <AccountPortfolioSelector accountId={accountId} onAccountChange={handleAccountChange} />
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
          {/* Strategy scores */}
          <div className="md:col-span-4">
            <Card className="h-full">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Strategy Scores</CardTitle>
                  <Button variant="ghost" size="sm" asChild>
                    <Link href="/strategies" className="text-xs text-primary">View all →</Link>
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {!strategies ? (
                  <p className="text-sm text-muted-foreground">Loading…</p>
                ) : (
                  <ul className="space-y-3">
                    {(strategies?.strategies ?? []).map((s: any) => (
                      <li key={s.strategyId}>
                        <Link
                          href={`/strategies/${s.strategyId}`}
                          className="flex items-center justify-between text-sm group"
                        >
                          <span className="font-mono text-xs text-muted-foreground group-hover:text-foreground transition-colors truncate mr-2">
                            {s.strategyId}
                          </span>
                          <div className="flex items-center gap-2 shrink-0">
                            {s.rating && (
                              <Badge variant={ratingVariant(s.rating) as any}>
                                {s.rating}
                              </Badge>
                            )}
                            {s.overallScore !== undefined && (
                              <span className={`font-bold text-xs tabular-nums ${scoreColor(s.overallScore)}`}>
                                {(s.overallScore * 100).toFixed(0)}%
                              </span>
                            )}
                          </div>
                        </Link>
                      </li>
                    ))}
                    {(strategies?.strategies ?? []).length === 0 && (
                      <p className="text-sm text-muted-foreground">
                        No strategies yet.{' '}
                        <Link href="/strategies" className="text-primary hover:underline">
                          Run a backtest
                        </Link>
                      </p>
                    )}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Equity curve chart */}
          <div className="md:col-span-8">
            <Card className="h-full">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>
                    {topStrategy ? `${topStrategy.strategyId} — Score Trend` : 'Equity Curve'}
                  </CardTitle>
                  {topStrategy && (
                    <Button variant="ghost" size="sm" asChild>
                      <Link href={`/strategies/${topStrategy.strategyId}`} className="text-xs text-primary">
                        Run backtest →
                      </Link>
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={chartData(strategies?.strategies ?? [])}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(222 20% 14%)" />
                    <XAxis dataKey="label" tick={{ fill: 'hsl(215 16% 47%)', fontSize: 11 }} />
                    <YAxis tick={{ fill: 'hsl(215 16% 47%)', fontSize: 11 }} domain={[0, 100]} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(222 47% 7%)',
                        border: '1px solid hsl(222 20% 14%)',
                        borderRadius: 8,
                      }}
                      labelStyle={{ color: 'hsl(215 16% 47%)' }}
                      formatter={(v: any) => [`${Number(v).toFixed(0)}`, 'Score']}
                    />
                    <Line
                      type="monotone"
                      dataKey="score"
                      stroke="hsl(163 100% 44%)"
                      dot={{ fill: 'hsl(163 100% 44%)' }}
                      strokeWidth={2}
                    />
                  </LineChart>
                </ResponsiveContainer>
                {(strategies?.strategies ?? []).length === 0 && (
                  <p className="text-xs text-muted-foreground text-center mt-2">
                    Strategy scores will appear here once backtests are run
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function scoreColor(score: number): string {
  if (score >= 0.8) return 'text-buy';
  if (score >= 0.6) return 'text-paper';
  return 'text-destructive';
}

function ratingVariant(rating: string): string {
  if (rating === 'A') return 'buy';
  if (rating === 'B') return 'info';
  if (rating === 'C') return 'warning';
  return 'destructive';
}

function chartData(strategies: any[]): { label: string; score: number }[] {
  if (strategies.length === 0) {
    return Array.from({ length: 5 }, (_, i) => ({ label: `S${i + 1}`, score: 0 }));
  }
  return strategies.map((s) => ({
    label: s.strategyId?.slice(0, 8) ?? '—',
    score: Math.round((s.overallScore ?? 0) * 100),
  }));
}
