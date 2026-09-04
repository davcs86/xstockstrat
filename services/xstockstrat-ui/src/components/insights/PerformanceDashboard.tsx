'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Brush, CartesianGrid, ComposedChart, Line, Tooltip, XAxis, YAxis } from 'recharts';
import { insightsLedgerClient } from '@/lib/browserClients/insightsLedgerClient';
import { insightsConfigClient } from '@/lib/browserClients/insightsConfigClient';
import { AccountProvider, useAccountContext } from '@/context/AccountContext';
import { TradingModeBadge } from '@/components/shared/TradingModeBadge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/EmptyState';
import { CardNotice } from '@/components/shared/CardNotice';
import { StatTile } from '@/components/shared/StatTile';
import { ChartContainer, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import {
  buildEquityCurve,
  closedTradesFromEvents,
  dailyReturns,
  filterByWindow,
  maxDrawdown,
  readRiskFreeRate,
  readStartDateMs,
  rollingSharpe,
  summaryStats,
} from '@/lib/performanceMetrics';

/** Default poll cadence — the dashboard re-derives every metric from a fresh fetch each tick, with
 * no full reload (no config key). */
export const POLL_INTERVAL_MS = 60_000;

const MS_PER_DAY = 86_400_000;
/** Rolling-Sharpe lookback window (rolling 30-day). */
const SHARPE_LOOKBACK_DAYS = 30;

// Series color is driven through ChartConfig → the --chart-* design tokens (C-17), never a
// hardcoded hsl(...) literal.
const CHART_CONFIG: ChartConfig = { equity: { label: 'Cumulative P&L', color: 'var(--chart-1)' } };
const AXIS_TICK = { fontSize: 11 } as const;

function fmtDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
function fmtUsd(v: number): string {
  return `$${Math.round(v).toLocaleString()}`;
}
function parseDate(v: string): number | undefined {
  if (!v) return undefined;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : undefined;
}

function PerformanceDashboardInner() {
  const { environmentMode } = useAccountContext();
  const [startStr, setStartStr] = useState('');
  const [endStr, setEndStr] = useState('');

  const eventsQuery = useQuery({
    queryKey: ['insights-performance-events'],
    queryFn: async () => {
      const resp = await insightsLedgerClient.queryEvents({
        eventType: 'portfolio.position.closed',
        page: { pageSize: 500, pageToken: '' },
      });
      return resp.events;
    },
    refetchInterval: POLL_INTERVAL_MS,
  });

  const configQuery = useQuery({
    queryKey: ['insights-performance-config'],
    queryFn: async () => {
      const resp = await insightsConfigClient.getConfig({ namespace: 'ui' });
      return resp.values;
    },
    refetchInterval: POLL_INTERVAL_MS,
  });

  const allTrades = useMemo(
    () => closedTradesFromEvents(eventsQuery.data ?? []),
    [eventsQuery.data],
  );

  const metrics = useMemo(() => {
    const values = configQuery.data ?? {};
    const riskFreeAnnual = readRiskFreeRate(values);
    const earliestMs = allTrades[0]?.occurredAtMs ?? Date.now();
    const configStartMs = readStartDateMs(values, earliestMs);

    // The date-range picker overrides the configured base date; either bound may be unset.
    const startMs = parseDate(startStr) ?? configStartMs;
    const endMs = parseDate(endStr);
    const windowed = filterByWindow(allTrades, startMs, endMs);
    const curve = buildEquityCurve(windowed);

    // Rolling 30-day Sharpe: returns over the last-30-calendar-day slice of the selected window.
    const anchorMs = endMs ?? windowed[windowed.length - 1]?.occurredAtMs ?? Date.now();
    const sharpeTrades = filterByWindow(windowed, anchorMs - SHARPE_LOOKBACK_DAYS * MS_PER_DAY, endMs);
    const sharpe = rollingSharpe(dailyReturns(buildEquityCurve(sharpeTrades)), riskFreeAnnual);

    return { curve, drawdown: maxDrawdown(curve), sharpe, stats: summaryStats(windowed) };
  }, [allTrades, configQuery.data, startStr, endStr]);

  const isLoading = eventsQuery.isLoading || configQuery.isLoading;
  const error = eventsQuery.error ?? configQuery.error;
  const { curve, drawdown, sharpe, stats } = metrics;

  return (
    <div className="space-y-4" data-testid="performance-page">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold">Performance</h1>
            <TradingModeBadge mode={environmentMode} />
            {environmentMode === 'paper' && (
              <span
                data-testid="paper-trading-label"
                className="text-xs font-medium text-yellow-400"
              >
                Paper Trading
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            Realized P&amp;L across closed positions — cumulative equity, drawdown, rolling Sharpe,
            and per-trade averages.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="perf-start">From</Label>
            <Input
              id="perf-start"
              type="date"
              value={startStr}
              onChange={(e) => setStartStr(e.target.value)}
              className="w-40"
              data-testid="perf-start"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="perf-end">To</Label>
            <Input
              id="perf-end"
              type="date"
              value={endStr}
              onChange={(e) => setEndStr(e.target.value)}
              className="w-40"
              data-testid="perf-end"
            />
          </div>
        </div>
      </div>

      {isLoading && <Skeleton className="h-[320px] w-full" data-testid="performance-loading" />}
      {!isLoading && error && (
        <CardNotice variant="error">Performance data is unavailable right now.</CardNotice>
      )}
      {!isLoading && !error && curve.length === 0 && (
        <EmptyState
          title="No closed positions yet"
          description="Closed positions will appear here once trades are realized."
        />
      )}

      {!isLoading && !error && curve.length > 0 && (
        <>
          <div
            data-testid="performance-summary"
            className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3 lg:grid-cols-6"
          >
            <StatTile label="Total trades" value={stats.totalTrades} />
            <StatTile label="Win rate" value={`${(stats.winRate * 100).toFixed(1)}%`} />
            <StatTile
              label="Total P&L"
              value={fmtUsd(stats.totalRealizedPnl)}
              tone={stats.totalRealizedPnl >= 0 ? 'gain' : 'loss'}
            />
            <StatTile
              label="Avg return / trade"
              value={stats.avgReturnPct === null ? '—' : `${(stats.avgReturnPct * 100).toFixed(2)}%`}
              tone={
                stats.avgReturnPct === null
                  ? undefined
                  : stats.avgReturnPct >= 0
                    ? 'gain'
                    : 'loss'
              }
            />
            <StatTile
              label="Avg hold (days)"
              value={stats.avgHoldTimeDays === null ? '—' : stats.avgHoldTimeDays.toFixed(1)}
            />
            <StatTile
              label="Max drawdown"
              value={drawdown ? fmtUsd(drawdown.dollars) : '—'}
              sub={drawdown ? `${(drawdown.pct * 100).toFixed(1)}%` : undefined}
              tone={drawdown && drawdown.dollars < 0 ? 'loss' : undefined}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-sm">Cumulative realized P&amp;L</CardTitle>
              </CardHeader>
              <CardContent>
                <div data-testid="equity-curve-chart">
                  <ChartContainer config={CHART_CONFIG} className="aspect-auto h-[300px] w-full">
                    <ComposedChart data={curve}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                      <XAxis
                        dataKey="t"
                        type="number"
                        scale="time"
                        domain={['dataMin', 'dataMax']}
                        tick={AXIS_TICK}
                        tickFormatter={fmtDay}
                      />
                      <YAxis
                        tick={AXIS_TICK}
                        domain={['auto', 'auto']}
                        tickFormatter={(v: number) => fmtUsd(v)}
                      />
                      <Tooltip
                        content={
                          <ChartTooltipContent
                            labelFormatter={(_l, p) =>
                              fmtDay((p?.[0]?.payload as { t: number } | undefined)?.t ?? 0)
                            }
                          />
                        }
                      />
                      <Line
                        dataKey="value"
                        name="equity"
                        type="monotone"
                        stroke="var(--color-equity)"
                        dot={false}
                        strokeWidth={2}
                        isAnimationActive={false}
                      />
                      <Brush
                        dataKey="t"
                        height={22}
                        travellerWidth={8}
                        stroke="var(--color-equity)"
                        tickFormatter={fmtDay}
                        data-testid="equity-curve-brush"
                      />
                    </ComposedChart>
                  </ChartContainer>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Rolling 30-day Sharpe</CardTitle>
              </CardHeader>
              <CardContent>
                {sharpe === null ? (
                  <p data-testid="sharpe-na" className="text-sm text-muted-foreground">
                    Not available — not enough return variance in this window.
                  </p>
                ) : (
                  <p data-testid="sharpe-value" className="font-mono text-3xl font-semibold tabular-nums">
                    {sharpe.toFixed(2)}
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The /insights strategy-performance dashboard. Reads `portfolio.position.closed` ledger events +
 * one-shot `ui.performance.*` config via the insights BFF, derives metrics with the pure
 * performanceMetrics lib, and re-polls every {@link POLL_INTERVAL_MS}. Wrapped in AccountProvider for
 * the paper/live label; its browser tradingClient posts same-origin to /trader/api (sanctioned exception).
 */
export function PerformanceDashboard() {
  return (
    <AccountProvider>
      <PerformanceDashboardInner />
    </AccountProvider>
  );
}
