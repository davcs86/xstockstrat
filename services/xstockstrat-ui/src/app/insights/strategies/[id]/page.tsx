'use client';
import { useState, use } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { AppShell } from '@/components/insights/AppShell';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { cn } from '@/components/ui/utils';
import { ConnectError } from '@connectrpc/connect';
import { formatSymbolYears, isNotFoundError } from '@/lib/scoreDisplay';
import { useStrategyReport, useBacktestHistory } from '@/hooks/useStrategies';
import { useRunBacktest, useTriggerBackfill } from '@/hooks/useBacktest';
import { useGetStrategy, useSetStrategyLiveInsights } from '@/hooks/useStrategyDefinitions';
import { useIsAdmin } from '@/hooks/useLiveStrategies';
import type { TradeRecord } from '@xstockstrat/proto/analysis/v1/analysis_pb';
import { BacktestStatus } from '@xstockstrat/proto/analysis/v1/analysis_pb';
import { BacktestDiagnostics } from '@/components/insights/BacktestDiagnostics';

// feature 064: cap the backtest range to 2 calendar years (matches the analysis service cap).
const MAX_RANGE_DAYS = 730;
function shiftDay(iso: string, days: number): string {
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return iso;
  return new Date(ms + days * 86_400_000).toISOString().slice(0, 10);
}

interface BacktestFormState {
  symbol: string;
  start: string;
  end: string;
  initial_capital: string;
}

export default function StrategyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const queryClient = useQueryClient();
  const { data: report, isLoading, error: reportError } = useStrategyReport(id);
  const { data: history } = useBacktestHistory(id);
  const { data: isAdmin } = useIsAdmin();
  const { data: definition } = useGetStrategy(id);
  const setLive = useSetStrategyLiveInsights();
  const {
    mutate: runBacktestMutate,
    data: backtestResult,
    isPending: running,
    error: runErrorObj,
  } = useRunBacktest();
  const {
    mutate: triggerBackfillMutate,
    data: backfillData,
    isPending: backfilling,
    error: backfillErrorObj,
  } = useTriggerBackfill();

  const [form, setForm] = useState<BacktestFormState>({
    symbol: 'AAPL',
    start: '2024-01-01',
    end: '2024-12-31',
    initial_capital: '100000',
  });

  const runError =
    runErrorObj instanceof ConnectError
      ? (runErrorObj as ConnectError).rawMessage
      : (runErrorObj?.message ?? null);

  function handleRunBacktest() {
    const isoToTimestamp = (iso: string) => {
      const ms = new Date(iso).getTime();
      return { seconds: BigInt(Math.floor(ms / 1000)), nanos: (ms % 1000) * 1_000_000 };
    };
    runBacktestMutate(
      {
        strategyId: id,
        // feature 065: run the strategy's registered definition so the run earns fingerprinted
        // evidence toward the derived headline grade (parity with the agent caller).
        strategyIdRef: id,
        symbols: form.symbol ? [form.symbol] : [],
        initialCapital: parseFloat(form.initial_capital),
        range: { start: isoToTimestamp(form.start), end: isoToTimestamp(form.end) },
      },
      {
        // The run now persists a score + a history row server-side; refetch the report and
        // the history so the Strategy Score card and Past Runs list reflect the new run.
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ['analysis-report', id] });
          queryClient.invalidateQueries({ queryKey: ['analysis-backtests', id] });
        },
      },
    );
  }

  const result = backtestResult ?? report?.latestBacktest;
  const pastRuns = history?.runs ?? [];
  // feature 065: the derived grade is cleared (NOT_FOUND) or absent for an unscored strategy — the
  // backtest form + Past Runs stay rendered so the user can earn evidence.
  const gradeCleared = isNotFoundError(reportError) || (!!report && !report.score);

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
            {/* Strategy Grade card (feature 065) — derived from cross-stock evidence, distinct
                from a single run's "Run score" in the Past Runs table below. */}
            {report?.score ? (
              <Card>
                <CardHeader>
                  <CardTitle>Strategy Grade</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-4xl font-bold text-buy">{report.score.rating}</span>
                    <span className="text-2xl text-muted-foreground tabular-nums">
                      {(report.score.overallScore * 100).toFixed(0)}%
                    </span>
                    {report.score.provisional && <Badge variant="secondary">Provisional</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground mb-4">
                    Derived from {report.score.evidenceSymbols} symbols ·{' '}
                    {formatSymbolYears(report.score.evidenceDays)} — individual runs are graded
                    separately
                  </p>
                  <div className="space-y-1.5">
                    {Object.entries(
                      (report.score.componentScores ?? {}) as Record<string, number>,
                    ).map(([key, val]) => (
                      <div key={key} className="flex justify-between text-xs">
                        <span className="text-muted-foreground capitalize">{key}</span>
                        <span className="text-foreground tabular-nums">
                          {(val * 100).toFixed(0)}
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ) : gradeCleared ? (
              <Card>
                <CardHeader>
                  <CardTitle>Strategy Grade</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    Not scored yet — run a backtest to earn evidence.
                  </p>
                </CardContent>
              </Card>
            ) : null}

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
                      max={form.end}
                      min={shiftDay(form.end, -MAX_RANGE_DAYS)}
                      onChange={(e) => setForm({ ...form, start: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">End Date</label>
                    <Input
                      type="date"
                      value={form.end}
                      min={form.start}
                      max={shiftDay(form.start, MAX_RANGE_DAYS)}
                      onChange={(e) => setForm({ ...form, end: e.target.value })}
                    />
                    <p className="mt-1 text-xs text-muted-foreground">Max range 2 years.</p>
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">
                      Initial Capital ($)
                    </label>
                    <Input
                      value={form.initial_capital}
                      onChange={(e) => setForm({ ...form, initial_capital: e.target.value })}
                    />
                  </div>
                  <Button onClick={handleRunBacktest} disabled={running} className="w-full">
                    {running ? 'Running…' : 'Run Backtest'}
                  </Button>
                  {runError && <p className="text-xs text-destructive">{runError}</p>}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right: results */}
          <div className="flex-1 min-w-0 space-y-4">
            {result &&
              result.status === BacktestStatus.INSUFFICIENT_DATA &&
              result.coverageGaps[0] && (
                <Card data-testid="insufficient-data">
                  <CardHeader>
                    <CardTitle>Insufficient data for this backtest</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      {result.coverageGaps[0].symbol} has {String(result.coverageGaps[0].barsHave)}{' '}
                      bars stored, but this backtest needs at least{' '}
                      {String(result.coverageGaps[0].barsNeed)}. Backfill the missing range to run
                      it.
                    </p>
                    <Button
                      data-testid="backfill-action"
                      disabled={backfilling}
                      onClick={() => {
                        const gap = result.coverageGaps[0];
                        triggerBackfillMutate({
                          symbols: [gap.symbol],
                          timeframeEnum: gap.timeframe,
                          range: gap.gap,
                          overwrite: false,
                        });
                      }}
                    >
                      {backfilling ? 'Starting backfill…' : 'Backfill this range'}
                    </Button>
                    {backfillData && (
                      <p
                        data-testid="backfill-confirmation"
                        className="text-sm text-[hsl(163_100%_44%)]"
                      >
                        Backfill started — job {backfillData.jobId}
                      </p>
                    )}
                    {backfillErrorObj && (
                      <p className="text-sm text-destructive">
                        Could not start backfill: {backfillErrorObj.message}
                      </p>
                    )}
                  </CardContent>
                </Card>
              )}

            {result && result.status !== BacktestStatus.INSUFFICIENT_DATA && (
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
                            label={{
                              value: 'Trade #',
                              position: 'insideBottom',
                              fill: 'hsl(215 16% 47%)',
                              fontSize: 11,
                            }}
                          />
                          <YAxis tick={{ fill: 'hsl(215 16% 47%)', fontSize: 11 }} />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: 'hsl(222 47% 7%)',
                              border: '1px solid hsl(222 20% 14%)',
                              borderRadius: 8,
                            }}
                            labelStyle={{ color: 'hsl(215 16% 47%)' }}
                            formatter={(v: unknown) => [
                              `$${typeof v === 'number' ? v.toLocaleString() : '0'}`,
                              'Equity',
                            ]}
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

                {/* Day-by-day debug diagnostics (feature 064) */}
                <BacktestDiagnostics diagnostics={result.diagnostics} />
              </>
            )}

            {/* Past runs — durable backtest history for this strategy */}
            {pastRuns.length > 0 && (
              <Card data-testid="past-runs">
                <CardHeader>
                  <CardTitle>Past Runs</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-muted-foreground">
                          <th className="py-1.5 pr-3 font-medium">When</th>
                          <th className="py-1.5 pr-3 font-medium">Symbols</th>
                          <th className="py-1.5 pr-3 font-medium">Range</th>
                          <th className="py-1.5 pr-3 font-medium text-right">Return</th>
                          <th className="py-1.5 pr-3 font-medium text-right">Sharpe</th>
                          <th className="py-1.5 pr-3 font-medium text-right">Trades</th>
                          <th className="py-1.5 font-medium text-right">Run score</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pastRuns.map((run) => (
                          <tr key={run.backtestId} className="border-t border-border">
                            <td className="py-1.5 pr-3 text-muted-foreground whitespace-nowrap">
                              {run.completedAt
                                ? new Date(Number(run.completedAt.seconds) * 1000).toLocaleString()
                                : '—'}
                            </td>
                            <td className="py-1.5 pr-3 font-mono text-xs">
                              {run.symbols.join(', ') || '—'}
                            </td>
                            {/* feature 065: the range each run covered; legacy rows have none. */}
                            <td className="py-1.5 pr-3 text-xs text-muted-foreground whitespace-nowrap">
                              {run.rangeStart && run.rangeEnd
                                ? `${new Date(Number(run.rangeStart.seconds) * 1000)
                                    .toISOString()
                                    .slice(0, 10)}–${new Date(Number(run.rangeEnd.seconds) * 1000)
                                    .toISOString()
                                    .slice(0, 10)}`
                                : '—'}
                            </td>
                            <td
                              className={cn(
                                'py-1.5 pr-3 text-right tabular-nums',
                                (run.totalReturn ?? 0) >= 0 ? 'text-buy' : 'text-destructive',
                              )}
                            >
                              {((run.totalReturn ?? 0) * 100).toFixed(2)}%
                            </td>
                            <td className="py-1.5 pr-3 text-right tabular-nums">
                              {(run.sharpeRatio ?? 0).toFixed(2)}
                            </td>
                            <td className="py-1.5 pr-3 text-right tabular-nums">
                              {String(run.totalTrades ?? 0)}
                            </td>
                            <td className="py-1.5 text-right tabular-nums">
                              {run.rating ? (
                                <span className="font-semibold text-buy">{run.rating}</span>
                              ) : (
                                '—'
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}

            {isLoading && !result && (
              <Card>
                <CardContent className="pt-5">
                  <p className="text-sm text-muted-foreground">Loading report…</p>
                </CardContent>
              </Card>
            )}
            {!isLoading && !result && pastRuns.length === 0 && (
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
