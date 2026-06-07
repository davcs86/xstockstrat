'use client';
import { useState, use } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { AppShell } from '@/components/insights/AppShell';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/components/ui/utils';
import { ConnectError } from '@connectrpc/connect';
import { useStrategyReport } from '@/hooks/useStrategies';
import { useRunBacktest } from '@/hooks/useBacktest';
import { useGetStrategy, useSetStrategyLiveInsights } from '@/hooks/useStrategyDefinitions';
import { useIsAdmin } from '@/hooks/useLiveStrategies';
import type { TradeRecord } from '@xstockstrat/proto/analysis/v1/analysis_pb';

interface BacktestFormState {
  symbol: string;
  start: string;
  end: string;
  initial_capital: string;
}

export default function StrategyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: report, isLoading } = useStrategyReport(id);
  const { data: isAdmin } = useIsAdmin();
  const { data: definition } = useGetStrategy(id);
  const setLive = useSetStrategyLiveInsights();
  const { mutate: runBacktestMutate, data: backtestResult, isPending: running, error: runErrorObj } = useRunBacktest();

  const [form, setForm] = useState<BacktestFormState>({
    symbol: 'AAPL',
    start: '2024-01-01',
    end: '2024-12-31',
    initial_capital: '100000',
  });

  const runError = runErrorObj instanceof ConnectError
    ? (runErrorObj as ConnectError).rawMessage
    : (runErrorObj?.message ?? null);

  function handleRunBacktest() {
    const isoToTimestamp = (iso: string) => {
      const ms = new Date(iso).getTime();
      return { seconds: BigInt(Math.floor(ms / 1000)), nanos: (ms % 1000) * 1_000_000 };
    };
    runBacktestMutate({
      strategyId: id,
      symbols: form.symbol ? [form.symbol] : [],
      initialCapital: parseFloat(form.initial_capital),
      range: { start: isoToTimestamp(form.start), end: isoToTimestamp(form.end) },
    });
  }

  const result = backtestResult ?? report?.latestBacktest;

  const equityCurve = (() => {
    if (!result?.trades?.length) return [];
    let equity = parseFloat(form.initial_capital) || 100000;
    return result.trades.map((t: TradeRecord, i: number) => {
      equity += t.pnl ?? 0;
      return { trade: i + 1, equity: Math.round(equity) };
    });
  })();

  return (
    <AppShell>
      <div className="p-4 sm:p-6 space-y-4">
        <div className="mb-2">
          <h1 className="text-xl font-bold tracking-tight font-mono">{id}</h1>
        </div>

        <div className="flex flex-col lg:flex-row gap-4">
          {/* Left sidebar: score + backtest runner */}
          <div className="w-full lg:w-80 shrink-0 space-y-4">
            {/* Score card */}
            {report?.score && (
              <Card>
                <CardHeader>
                  <CardTitle>Strategy Score</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-3 mb-4">
                    <span className="text-4xl font-bold text-buy">{report.score.rating}</span>
                    <span className="text-2xl text-muted-foreground tabular-nums">
                      {(report.score.overallScore * 100).toFixed(0)}%
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {Object.entries(
                      (report.score.componentScores ?? {}) as Record<string, number>,
                    ).map(([key, val]) => (
                      <div key={key} className="flex justify-between text-xs">
                        <span className="text-muted-foreground capitalize">{key}</span>
                        <span className="text-foreground tabular-nums">{(val * 100).toFixed(0)}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Live evaluation toggle */}
            {definition && (
              <Card>
                <CardHeader>
                  <CardTitle>Live Evaluation</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <span
                      className={cn(
                        'text-sm font-medium',
                        definition.liveEnabled ? 'text-buy' : 'text-muted-foreground',
                      )}
                    >
                      {definition.liveEnabled ? 'On' : 'Off'}
                    </span>
                    {isAdmin && (
                      <Button
                        size="sm"
                        variant={definition.liveEnabled ? 'outline' : 'default'}
                        disabled={setLive.isPending}
                        onClick={() =>
                          setLive.mutate({
                            strategyId: id,
                            liveEnabled: !definition.liveEnabled,
                          })
                        }
                      >
                        {definition.liveEnabled ? 'Disable' : 'Enable'}
                      </Button>
                    )}
                  </div>
                  {setLive.isError && (
                    <p className="text-sm text-destructive mt-2">
                      Could not update live status — admin scope required.
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Backtest runner form */}
            <Card>
              <CardHeader>
                <CardTitle>Run Backtest</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">Symbol</label>
                    <Input
                      value={form.symbol}
                      onChange={(e) => setForm({ ...form, symbol: e.target.value })}
                      placeholder="AAPL"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">Start Date</label>
                    <Input
                      type="date"
                      value={form.start}
                      onChange={(e) => setForm({ ...form, start: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">End Date</label>
                    <Input
                      type="date"
                      value={form.end}
                      onChange={(e) => setForm({ ...form, end: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">Initial Capital ($)</label>
                    <Input
                      value={form.initial_capital}
                      onChange={(e) => setForm({ ...form, initial_capital: e.target.value })}
                    />
                  </div>
                  <Button
                    onClick={handleRunBacktest}
                    disabled={running}
                    className="w-full"
                  >
                    {running ? 'Running…' : 'Run Backtest'}
                  </Button>
                  {runError && <p className="text-xs text-destructive">{runError}</p>}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right: results */}
          <div className="flex-1 min-w-0 space-y-4">
            {result && (
              <>
                {/* Metrics grid */}
                <Card>
                  <CardHeader>
                    <CardTitle>Backtest Results</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      <MetricCard
                        label="Total Return"
                        value={`${((result.totalReturn ?? 0) * 100).toFixed(2)}%`}
                        positive={(result.totalReturn ?? 0) >= 0}
                      />
                      <MetricCard
                        label="Sharpe Ratio"
                        value={(result.sharpeRatio ?? 0).toFixed(3)}
                        positive={(result.sharpeRatio ?? 0) >= 1}
                      />
                      <MetricCard
                        label="Max Drawdown"
                        value={`${((result.maxDrawdown ?? 0) * 100).toFixed(2)}%`}
                        neutral
                      />
                      <MetricCard
                        label="Win Rate"
                        value={`${((result.winRate ?? 0) * 100).toFixed(1)}%`}
                        positive={(result.winRate ?? 0) >= 0.5}
                      />
                      <MetricCard label="Total Trades" value={String(result.totalTrades ?? 0)} />
                      <MetricCard
                        label="Profit Factor"
                        value={(result.profitFactor ?? 0).toFixed(2)}
                        positive={(result.profitFactor ?? 0) >= 1}
                      />
                    </div>
                  </CardContent>
                </Card>

                {/* Equity curve */}
                {equityCurve.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Equity Curve</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ResponsiveContainer width="100%" height={220}>
                        <LineChart data={equityCurve}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(222 20% 14%)" />
                          <XAxis
                            dataKey="trade"
                            tick={{ fill: 'hsl(215 16% 47%)', fontSize: 11 }}
                            label={{ value: 'Trade #', position: 'insideBottom', fill: 'hsl(215 16% 47%)', fontSize: 11 }}
                          />
                          <YAxis tick={{ fill: 'hsl(215 16% 47%)', fontSize: 11 }} />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: 'hsl(222 47% 7%)',
                              border: '1px solid hsl(222 20% 14%)',
                              borderRadius: 8,
                            }}
                            labelStyle={{ color: 'hsl(215 16% 47%)' }}
                            formatter={(v: unknown) => [`$${typeof v === 'number' ? v.toLocaleString() : '0'}`, 'Equity']}
                          />
                          <Line
                            type="monotone"
                            dataKey="equity"
                            stroke="hsl(163 100% 44%)"
                            dot={false}
                            strokeWidth={2}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                )}
              </>
            )}

            {isLoading && !result && (
              <Card>
                <CardContent className="pt-5">
                  <p className="text-sm text-muted-foreground">Loading report…</p>
                </CardContent>
              </Card>
            )}
            {!isLoading && !result && (
              <Card>
                <CardContent className="pt-5">
                  <p className="text-sm text-muted-foreground">
                    No backtest results yet. Run a backtest using the form on the left.
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function MetricCard({
  label,
  value,
  positive,
  neutral,
}: {
  label: string;
  value: string;
  positive?: boolean;
  neutral?: boolean;
}) {
  const valueClass = neutral
    ? 'text-foreground'
    : positive === true
      ? 'text-buy'
      : positive === false
        ? 'text-destructive'
        : 'text-foreground';
  return (
    <div className="rounded-lg bg-secondary p-3">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className={cn('text-lg font-bold tabular-nums', valueClass)}>{value}</p>
    </div>
  );
}
