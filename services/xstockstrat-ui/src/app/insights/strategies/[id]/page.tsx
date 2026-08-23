'use client';
import { useMemo, useState, use } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { AppShell } from '@/components/insights/AppShell';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { DataTable } from '@/components/ui/data-table';
import { cn } from '@/components/ui/utils';
import { ConnectError } from '@connectrpc/connect';
import { formatSymbolYears, isNotFoundError } from '@/lib/scoreDisplay';
import { timestampToDate } from '@/lib/protoTime';
import { useStrategyReport, useBacktestHistory, useBacktestDetail } from '@/hooks/useStrategies';
import { useRunBacktest, useTriggerBackfill } from '@/hooks/useBacktest';
import { useGetStrategy, useSetStrategyLiveInsights } from '@/hooks/useStrategyDefinitions';
import { useStrategyAnalytics } from '@/hooks/useOpportunities';
import { useIsAdmin } from '@/hooks/useLiveStrategies';
import { BacktestStatus, SizingMode } from '@xstockstrat/proto/analysis/v1/analysis_pb';
import { BacktestDiagnostics, SIZING_MODE_LABEL } from '@/components/insights/BacktestDiagnostics';
import {
  EquityCurveChart,
  PortfolioEquityCurveChart,
} from '@/components/insights/EquityCurveChart';
import { PageBreadcrumb } from '@/components/shared/PageBreadcrumb';

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
  const { data: analytics } = useStrategyAnalytics(id);
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

  // feature 068: an opened Past Runs row; its persisted detail feeds the same results
  // surface the fresh run uses (single render path, AC-5).
  const [selectedRunId, setSelectedRunId] = useState<string | undefined>(undefined);
  const {
    data: selectedDetail,
    isLoading: detailLoading,
    isNotFound: detailNotFound,
  } = useBacktestDetail(selectedRunId);

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
        // feature 068: also clear any opened historical run so the fresh result is never
        // shadowed by a stale selection (design.md seam-clear; e2e-asserted).
        onSuccess: () => {
          setSelectedRunId(undefined);
          queryClient.invalidateQueries({ queryKey: ['analysis-report', id] });
          queryClient.invalidateQueries({ queryKey: ['analysis-backtests', id] });
        },
      },
    );
  }

  // feature 068: with a historical run open, the results surface renders ONLY that run's
  // persisted detail (or its explicit empty/loading state) — the fresh-run/latest fallback
  // applies only when no row is selected, so a NOT_FOUND legacy row never leaks another
  // run's metrics.
  const result = selectedRunId ? selectedDetail : (backtestResult ?? report?.latestBacktest);
  const pastRuns = history?.runs ?? [];
  // feature 065: the derived grade is cleared (NOT_FOUND) or absent for an unscored strategy — the
  // backtest form + Past Runs stay rendered so the user can earn evidence.
  const gradeCleared = isNotFoundError(reportError) || (!!report && !report.score);

  type BacktestRun = (typeof pastRuns)[number];

  const pastRunsColumns = useMemo<ColumnDef<BacktestRun>[]>(
    () => [
      {
        id: 'when',
        header: 'When',
        accessorFn: (run) => timestampToDate(run.completedAt)?.getTime() ?? 0,
        meta: { className: 'py-1.5 pr-3 text-muted-foreground whitespace-nowrap' },
        cell: ({ row }) => timestampToDate(row.original.completedAt)?.toLocaleString() ?? '—',
      },
      {
        id: 'symbols',
        header: 'Symbols',
        accessorFn: (run) => run.symbols.join(', '),
        meta: { className: 'py-1.5 pr-3 font-mono text-xs' },
        cell: ({ row }) => row.original.symbols.join(', ') || '—',
      },
      {
        // feature 150: distinguish cross-mode rows so a portfolio return is never silently read
        // against a legacy one (the product spec's minimum comparability guard — label, not block).
        id: 'mode',
        header: 'Mode',
        accessorFn: (run) => SIZING_MODE_LABEL[run.sizingMode],
        meta: { className: 'py-1.5 pr-3 text-xs text-muted-foreground whitespace-nowrap' },
        cell: ({ row }) => SIZING_MODE_LABEL[row.original.sizingMode],
      },
      {
        id: 'range',
        header: 'Range',
        enableSorting: false,
        meta: { className: 'py-1.5 pr-3 text-xs text-muted-foreground whitespace-nowrap' },
        cell: ({ row }) => {
          const run = row.original;
          return run.rangeStart && run.rangeEnd
            ? `${timestampToDate(run.rangeStart)!.toISOString().slice(0, 10)}–${timestampToDate(run.rangeEnd)!.toISOString().slice(0, 10)}`
            : '—';
        },
      },
      {
        id: 'return',
        header: 'Return',
        accessorFn: (run) => run.totalReturn ?? 0,
        meta: { className: 'py-1.5 pr-3 text-right tabular-nums' },
        cell: ({ row }) => {
          const run = row.original;
          return (
            <span className={(run.totalReturn ?? 0) >= 0 ? 'text-buy' : 'text-destructive'}>
              {((run.totalReturn ?? 0) * 100).toFixed(2)}%
            </span>
          );
        },
      },
      {
        id: 'sharpe',
        header: 'Sharpe',
        accessorFn: (run) => run.sharpeRatio ?? 0,
        meta: { className: 'py-1.5 pr-3 text-right tabular-nums' },
        cell: ({ row }) => (row.original.sharpeRatio ?? 0).toFixed(2),
      },
      {
        id: 'trades',
        header: 'Trades',
        accessorFn: (run) => run.totalTrades ?? 0,
        meta: { className: 'py-1.5 pr-3 text-right tabular-nums' },
        cell: ({ row }) => String(row.original.totalTrades ?? 0),
      },
      {
        id: 'runScore',
        header: 'Run score',
        accessorFn: (run) => run.rating ?? '',
        meta: { className: 'py-1.5 text-right tabular-nums' },
        cell: ({ row }) =>
          row.original.rating ? (
            <span className="font-semibold text-buy">{row.original.rating}</span>
          ) : (
            '—'
          ),
      },
    ],
    [],
  );

  return (
    <AppShell>
      <div className="p-4 sm:p-6 space-y-4">
        <div className="mb-2 space-y-1">
          <PageBreadcrumb
            ariaLabel="Strategy path"
            items={[{ label: 'Strategies', href: '/insights/strategies' }, { label: id }]}
          />
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

            {/* Feature 086: live-status warning when a referenced formula was soft-deleted. */}
            {definition && definition.warnings.length > 0 && (
              <Card data-testid="strategy-warnings">
                <CardHeader>
                  <CardTitle>Warnings</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="list-disc space-y-1 pl-5 text-sm text-[hsl(38_92%_50%)]">
                    {definition.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
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
                  <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">Signal-eligible</p>
                      <p className="text-xs text-muted-foreground">
                        Joins platform-wide signals in the live universe.
                      </p>
                    </div>
                    <Badge
                      variant={definition.signalEligible ? 'buy' : 'secondary'}
                      data-testid="signal-eligible-badge"
                    >
                      {definition.signalEligible ? 'On' : 'Off'}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* feature 083 — per-strategy analytics + Active/Paused/Off state (AC-5). */}
            {definition && (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>Analytics</CardTitle>
                    <Badge
                      variant={
                        !definition.active ? 'secondary' : definition.liveEnabled ? 'buy' : 'paper'
                      }
                    >
                      {!definition.active ? 'Off' : definition.liveEnabled ? 'Active' : 'Paused'}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div
                    className="grid grid-cols-2 gap-3 sm:grid-cols-3"
                    data-testid="strategy-analytics"
                  >
                    {[
                      ['Expectancy', analytics ? analytics.expectancy.toFixed(2) : '—'],
                      [
                        'Hit rate',
                        analytics ? `${(analytics.blendedHitRate * 100).toFixed(0)}%` : '—',
                      ],
                      [
                        'Max drawdown',
                        analytics ? `${(analytics.maxDrawdown * 100).toFixed(0)}%` : '—',
                      ],
                      ['Signals 30d', analytics ? String(analytics.signals30d) : '—'],
                      ['Taken', analytics ? String(analytics.taken) : '—'],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-md border border-border p-3">
                        <div className="text-xs text-muted-foreground">{label}</div>
                        <div className="mt-1 font-mono tabular-nums text-lg font-semibold">
                          {value}
                        </div>
                      </div>
                    ))}
                  </div>
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
            {/* feature 068: a legacy/evicted run has no persisted detail — explicit empty
                state; the row's summary metrics remain visible in the Past Runs table. */}
            {selectedRunId && detailNotFound && (
              <Card>
                <CardContent className="pt-5">
                  <p data-testid="run-detail-empty" className="text-sm text-muted-foreground">
                    No detailed data for this run — it predates detail persistence or its detail was
                    evicted. Summary metrics remain in the Past Runs table below.
                  </p>
                </CardContent>
              </Card>
            )}
            {selectedRunId && detailLoading && (
              <Card>
                <CardContent className="pt-5">
                  <p className="text-sm text-muted-foreground">Loading run detail…</p>
                </CardContent>
              </Card>
            )}
            {result && result.warnings.length > 0 && (
              <Card data-testid="backtest-warnings">
                <CardHeader>
                  <CardTitle>Warnings</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="list-disc space-y-1 pl-5 text-sm text-[hsl(38_92%_50%)]">
                    {result.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
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
                    <CardTitle className="flex items-center gap-2">
                      Backtest Results
                      {/* feature 150: label the sizing mode so a portfolio-mode return is never
                          silently compared against a legacy one. */}
                      <Badge
                        variant={
                          result.sizingMode === SizingMode.PORTFOLIO ? 'default' : 'secondary'
                        }
                        data-testid="sizing-mode-badge"
                      >
                        {SIZING_MODE_LABEL[result.sizingMode]}
                      </Badge>
                    </CardTitle>
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

                {/* Equity curve — time-based, per-symbol, with trade markers (feature 068).
                    Shared by the fresh-run and historical views (AC-5). */}
                <EquityCurveChart diagnostics={result.diagnostics} trades={result.trades} />

                {/* feature 150: in portfolio mode, also plot the shared-pool equity curve — the
                    authoritative aggregate in that mode (per-symbol BarDiagnostic.equity is not). */}
                {result.sizingMode === SizingMode.PORTFOLIO &&
                  result.portfolioEquityCurve.length > 0 && (
                    <PortfolioEquityCurveChart curve={result.portfolioEquityCurve} />
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
                  <DataTable
                    columns={pastRunsColumns}
                    data={pastRuns}
                    getRowId={(run) => run.backtestId}
                    tableClassName="w-full text-sm"
                    onRowClick={(run) => setSelectedRunId(run.backtestId)}
                    rowClassName={(run) =>
                      cn(
                        'border-t border-border',
                        selectedRunId === run.backtestId && 'bg-secondary',
                      )
                    }
                    getRowProps={(run) => ({
                      'data-testid': 'past-run-row',
                      'aria-selected': selectedRunId === run.backtestId,
                    })}
                  />
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
