/**
 * Equity-curve derivation for backtest results. Pure (no JSX — vitest coverage is scoped to
 * src/lib/**). The curve is one line per symbol from `diagnostics[].bars[]`; the run-level
 * `daily_equity` chain is never plotted. Multi-symbol runs render normalized % return per line
 * (absolute offsets between sequentially-compounded symbols encode iteration order, not info);
 * a single-symbol run keeps absolute dollars.
 */

import type { SymbolDiagnostics, TradeRecord } from '@xstockstrat/proto/analysis/v1/analysis_pb';
import { timestampToMillis } from './protoTime';

export type EquityCurveMode = 'absolute' | 'normalized';

export interface EquityPoint {
  /** Epoch millis (bar timestamp). */
  t: number;
  /** Equity in dollars (absolute mode) or % return from the line's first bar (normalized). */
  value: number;
}

export interface EquitySeries {
  symbol: string;
  points: EquityPoint[];
}

export interface EquityCurve {
  mode: EquityCurveMode;
  series: EquitySeries[];
}

export interface TradeMarker {
  kind: 'entry' | 'exit';
  t: number;
  /** y-value in the curve's mode units, resolved from the nearest bar of the trade's symbol. */
  value: number;
  symbol: string;
  side: string;
  qty: number;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
}

/** True when any diagnostic bar carries a usable equity value — drives the explicit no-curve-data state. */
export function hasEquityData(diagnostics: SymbolDiagnostics[] | undefined): boolean {
  return !!diagnostics?.some((d) => d.bars?.some((b) => (b.equity ?? 0) > 0));
}

export function buildEquitySeries(diagnostics: SymbolDiagnostics[] | undefined): EquityCurve {
  const raw: EquitySeries[] = [];
  for (const d of diagnostics ?? []) {
    const points: EquityPoint[] = [];
    for (const b of d.bars ?? []) {
      const t = timestampToMillis(b.timestamp);
      // proto3 default 0 means "no equity captured" — a real portfolio value is > 0.
      if (t === undefined || !((b.equity ?? 0) > 0)) continue;
      points.push({ t, value: b.equity });
    }
    if (points.length > 0) {
      points.sort((a, b2) => a.t - b2.t);
      raw.push({ symbol: d.symbol, points });
    }
  }
  if (raw.length <= 1) {
    return { mode: 'absolute', series: raw };
  }
  // Multi-symbol: index each line to its own first bar and plot % return.
  const series = raw.map((s) => {
    const base = s.points[0].value;
    return {
      symbol: s.symbol,
      points: s.points.map((p) => ({ t: p.t, value: (p.value / base - 1) * 100 })),
    };
  });
  return { mode: 'normalized', series };
}

/** Median gap between consecutive bars — the tolerance unit for marker snapping. */
function barInterval(points: EquityPoint[]): number {
  if (points.length < 2) return Number.POSITIVE_INFINITY;
  const gaps = points.slice(1).map((p, i) => p.t - points[i].t);
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

function nearestPoint(points: EquityPoint[], t: number): EquityPoint | undefined {
  let best: EquityPoint | undefined;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const p of points) {
    const dist = Math.abs(p.t - t);
    if (dist < bestDist) {
      best = p;
      bestDist = dist;
    }
  }
  return best;
}

/**
 * Entry/exit markers for each trade, y resolved by nearest-bar lookup within one bar interval of the
 * trade's symbol series. Exact-match would drop the forced-close trade (exit_time patched onto the
 * last bar); a marker farther than one interval from any bar is dropped, not drawn at a wrong height.
 */
export function buildTradeMarkers(
  trades: TradeRecord[] | undefined,
  series: EquitySeries[],
): TradeMarker[] {
  const bySymbol = new Map(series.map((s) => [s.symbol, s]));
  const markers: TradeMarker[] = [];
  for (const trade of trades ?? []) {
    const line = bySymbol.get(trade.symbol);
    if (!line || line.points.length === 0) continue;
    const tolerance = barInterval(line.points);
    for (const kind of ['entry', 'exit'] as const) {
      const t = timestampToMillis(kind === 'entry' ? trade.entryTime : trade.exitTime);
      if (t === undefined) continue;
      const point = nearestPoint(line.points, t);
      if (!point || Math.abs(point.t - t) > tolerance) continue;
      markers.push({
        kind,
        t: point.t,
        value: point.value,
        symbol: trade.symbol,
        side: trade.side,
        qty: trade.qty,
        entryPrice: trade.entryPrice,
        exitPrice: trade.exitPrice,
        pnl: trade.pnl,
      });
    }
  }
  return markers;
}
