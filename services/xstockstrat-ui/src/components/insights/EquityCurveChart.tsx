'use client';
import { useMemo } from 'react';
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { SymbolDiagnostics, TradeRecord } from '@xstockstrat/proto/analysis/v1/analysis_pb';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
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

/** Shared tooltip: a trade-marker point renders the full trade payload (FR-4); a plain
 * curve point renders date + equity/return. */
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
  const fmtY = (v: number) =>
    mode === 'absolute' ? `$${Math.round(v).toLocaleString()}` : `${v.toFixed(2)}%`;
  const marker = payload
    .map((p) => p.payload)
    .find((p): p is TradeMarker & { t: number } => !!p && 'kind' in p);
  return (
    <div
      data-testid="curve-tooltip"
      className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-md"
    >
      {marker ? (
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
      ) : (
        <div className="space-y-0.5">
          <p className="text-muted-foreground">{fmtDay((payload[0].payload as { t: number }).t)}</p>
          {payload.map((p, i) => (
            <p key={i} style={{ color: p.color }}>
              {p.name}: {typeof p.value === 'number' ? fmtY(p.value) : p.value}
            </p>
          ))}
        </div>
      )}
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
          <ResponsiveContainer width="100%" height={260}>
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
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
