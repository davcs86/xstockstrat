'use client';
import { useMemo } from 'react';
import { CartesianGrid, ComposedChart, Line, Scatter, Tooltip, XAxis, YAxis } from 'recharts';
import type {
  EquityPoint,
  SymbolDiagnostics,
  TradeRecord,
} from '@xstockstrat/proto/analysis/v1/analysis_pb';
import { timestampToDate } from '@/lib/protoTime';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { ChartContainer, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import {
  buildEquitySeries,
  buildTradeMarkers,
  hasEquityData,
  type TradeMarker,
} from '@/lib/equityCurve';

// One palette slot per symbol line; markers reuse the buy/sell semantics.
const LINE_COLORS = [
  'hsl(163 100% 44%)',
  'hsl(210 100% 60%)',
  'hsl(38 92% 55%)',
  'hsl(280 70% 60%)',
];

const AXIS_TICK = { fill: 'hsl(215 16% 47%)', fontSize: 11 };

function fmtDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

interface TooltipEntry {
  payload?: (TradeMarker & { t: number; value: number }) | { t: number; value: number };
  name?: string;
  value?: number | string;
  color?: string;
}

/** Shared tooltip: a trade-marker point renders the full trade payload (FR-4, unchanged, since
 * `ChartTooltipContent`'s default rendering can't express this branch without a custom override);
 * a plain curve point delegates to `ui/chart.tsx`'s `ChartTooltipContent`. */
function CurveTooltip({
  active,
  payload,
  mode,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  mode: 'absolute' | 'normalized';
}) {
  if (!active || !payload?.length) return null;
  const marker = payload
    .map((p) => p.payload)
    .find((p): p is TradeMarker & { t: number } => !!p && 'kind' in p);

  if (marker) {
    return (
      <div
        data-testid="curve-tooltip"
        className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-md"
      >
        <div className="space-y-0.5" data-testid="marker-tooltip">
          <p className="font-semibold">
            {marker.kind === 'entry' ? 'Entry' : 'Exit'} — {marker.symbol} ({marker.side})
          </p>
          <p className="text-muted-foreground">{fmtDay(marker.t)}</p>
          <p>Qty {marker.qty.toFixed(2)}</p>
          <p>
            Entry ${marker.entryPrice.toFixed(2)} → Exit ${marker.exitPrice.toFixed(2)}
          </p>
          <p className={marker.pnl >= 0 ? 'text-buy' : 'text-destructive'}>
            P&L ${marker.pnl.toFixed(2)}
          </p>
        </div>
      </div>
    );
  }

  const fmtY = (v: number) =>
    mode === 'absolute' ? `$${Math.round(v).toLocaleString()}` : `${v.toFixed(2)}%`;

  return (
    <div data-testid="curve-tooltip">
      <ChartTooltipContent
        active={active}
        payload={payload as unknown as Parameters<typeof ChartTooltipContent>[0]['payload']}
        labelFormatter={() => fmtDay((payload[0].payload as { t: number }).t)}
        formatter={(value, name, item) => (
          <span className="flex-1" style={{ color: (item as { color?: string }).color }}>
            {name}: {typeof value === 'number' ? fmtY(value) : value}
          </span>
        )}
      />
    </div>
  );
}

/**
 * Time-based equity curve shared by the fresh-run and historical-run views (feature 068,
 * AC-5 — one component, no divergent render paths). One time-aligned line per symbol
 * (normalized % for multi-symbol runs — absolute dollars would encode symbol iteration
 * order, not information); trade entry/exit markers resolve to the nearest bar.
 */
export function EquityCurveChart({
  diagnostics,
  trades,
}: {
  diagnostics: SymbolDiagnostics[] | undefined;
  trades: TradeRecord[] | undefined;
}) {
  const { mode, series, markers } = useMemo(() => {
    const curve = buildEquitySeries(diagnostics);
    return { ...curve, markers: buildTradeMarkers(trades, curve.series) };
  }, [diagnostics, trades]);

  // One ChartConfig entry per symbol line, colors matching LINE_COLORS unchanged (FR-3).
  const chartConfig: ChartConfig = useMemo(
    () =>
      Object.fromEntries(
        series.map((s, i) => [
          s.symbol,
          { label: s.symbol, color: LINE_COLORS[i % LINE_COLORS.length] },
        ]),
      ),
    [series],
  );

  if (!hasEquityData(diagnostics)) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Equity Curve</CardTitle>
        </CardHeader>
        <CardContent>
          <p data-testid="equity-curve-empty" className="text-sm text-muted-foreground">
            No equity curve data for this run.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Equity Curve{mode === 'normalized' ? ' — % return per symbol' : ''}</CardTitle>
      </CardHeader>
      <CardContent>
        <div data-testid="equity-curve-chart">
          <ChartContainer config={chartConfig} className="aspect-auto h-[260px] w-full">
            <ComposedChart>
              <CartesianGrid
                xAxisId={0}
                yAxisId={0}
                strokeDasharray="3 3"
                stroke="hsl(222 20% 14%)"
              />
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
                tickFormatter={(v: number) =>
                  mode === 'absolute' ? `$${Math.round(v).toLocaleString()}` : `${v.toFixed(0)}%`
                }
              />
              <Tooltip content={<CurveTooltip mode={mode} />} />
              {series.map((s, i) => (
                <Line
                  key={s.symbol}
                  data={s.points}
                  dataKey="value"
                  name={s.symbol}
                  type="monotone"
                  stroke={LINE_COLORS[i % LINE_COLORS.length]}
                  dot={false}
                  strokeWidth={2}
                  isAnimationActive={false}
                />
              ))}
              <Scatter
                data={markers}
                dataKey="value"
                name="Trades"
                isAnimationActive={false}
                shape={(props: { cx?: number; cy?: number; payload?: TradeMarker }) => {
                  const { cx, cy, payload: m } = props;
                  if (cx === undefined || cy === undefined || !m) return <g />;
                  return (
                    <circle
                      data-testid="trade-marker"
                      data-kind={m.kind}
                      cx={cx}
                      cy={cy}
                      r={5}
                      fill={m.kind === 'entry' ? 'hsl(163 100% 44%)' : 'hsl(0 84% 60%)'}
                      stroke="hsl(222 47% 7%)"
                      strokeWidth={1}
                    />
                  );
                }}
              />
            </ComposedChart>
          </ChartContainer>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Feature 150: the portfolio-mode equity curve — ONE shared-pool line (cash + Σ marked-to-market),
 * distinct from the per-symbol {@link EquityCurveChart}. In portfolio mode this is the authoritative
 * aggregate curve (the per-symbol `BarDiagnostic.equity` stays per-symbol); the two coexist so a
 * reader can see both the pool and each symbol's own path. Absolute dollars — a single pool curve
 * has no symbol-iteration-order ambiguity to normalize away.
 */
export function PortfolioEquityCurveChart({ curve }: { curve: EquityPoint[] | undefined }) {
  const points = useMemo(
    () =>
      (curve ?? [])
        .map((p) => ({ t: timestampToDate(p.timestamp)?.getTime() ?? 0, value: p.equity }))
        .filter((p) => p.t > 0)
        .sort((a, b) => a.t - b.t),
    [curve],
  );

  if (points.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Portfolio Equity Curve</CardTitle>
        </CardHeader>
        <CardContent>
          <p data-testid="portfolio-equity-empty" className="text-sm text-muted-foreground">
            No portfolio equity curve data for this run.
          </p>
        </CardContent>
      </Card>
    );
  }

  const chartConfig: ChartConfig = { equity: { label: 'Portfolio', color: LINE_COLORS[0] } };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Portfolio Equity Curve</CardTitle>
      </CardHeader>
      <CardContent>
        <div data-testid="portfolio-equity-curve-chart">
          <ChartContainer config={chartConfig} className="aspect-auto h-[260px] w-full">
            <ComposedChart>
              <CartesianGrid
                xAxisId={0}
                yAxisId={0}
                strokeDasharray="3 3"
                stroke="hsl(222 20% 14%)"
              />
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
                tickFormatter={(v: number) => `$${Math.round(v).toLocaleString()}`}
              />
              <Tooltip content={<CurveTooltip mode="absolute" />} />
              <Line
                data={points}
                dataKey="value"
                name="Portfolio"
                type="monotone"
                stroke={LINE_COLORS[0]}
                dot={false}
                strokeWidth={2}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ChartContainer>
        </div>
      </CardContent>
    </Card>
  );
}
