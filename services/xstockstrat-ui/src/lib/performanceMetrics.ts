/**
 * Metric lib for the /insights strategy-performance dashboard. Pure, Node-safe functions over
 * `portfolio.position.closed` ledger events — realized-only by construction (Constitution C-5).
 */

import type { JsonObject } from '@bufbuild/protobuf';
import type { LedgerEvent } from '@xstockstrat/proto/ledger/v1/ledger_pb';
import type { ConfigValue } from '@xstockstrat/proto/config/v1/config_pb';
import { timestampToMillis } from './protoTime';

const MS_PER_DAY = 86_400_000;
const TRADING_DAYS_PER_YEAR = 252;

/** Fallback risk-free rate — mirrors the seeded `ui.performance.risk_free_rate_annual` default. The
 * live value comes from GetConfig; used only when the key is absent. */
export const DEFAULT_RISK_FREE_ANNUAL = 0.045;

/** A closed position, normalized from a `portfolio.position.closed` ledger event. `costBasis` /
 * `openedAtMs` are optional — a legacy event omits both. */
export interface ClosedTrade {
  occurredAtMs: number;
  realizedPnl: number;
  /** Total signed cost basis (positive for longs, negative for shorts); absent on legacy events. */
  costBasis?: number;
  openedAtMs?: number;
}

/** A cumulative-equity point (epoch millis → running realized P&L in dollars). */
export interface EquityPoint {
  t: number;
  value: number;
}

export interface Drawdown {
  /** Largest peak-to-trough decline in dollars (≤ 0). */
  dollars: number;
  /** Same decline as a fraction of the peak (≤ 0); 0 when no peak > 0 exists. */
  pct: number;
}

export interface SummaryStats {
  totalTrades: number;
  winCount: number;
  winRate: number;
  totalRealizedPnl: number;
  /** mean(realizedPnl / |costBasis|) over trades with a non-zero cost basis; null when none qualify. */
  avgReturnPct: number | null;
  /** mean hold time in days over trades with an open date; null when none qualify. */
  avgHoldTimeDays: number | null;
}

/**
 * Map `portfolio.position.closed` events → normalized ClosedTrade[], sorted ascending by close time.
 * Reads `realized_pnl` / optional `cost_basis` / optional `opened_at` from the payload.
 */
export function closedTradesFromEvents(events: LedgerEvent[]): ClosedTrade[] {
  const trades: ClosedTrade[] = [];
  for (const e of events) {
    const occurredAtMs = timestampToMillis(e.occurredAt);
    if (occurredAtMs === undefined) continue;
    const p = (e.payload ?? {}) as JsonObject;
    const trade: ClosedTrade = {
      occurredAtMs,
      realizedPnl: Number(p.realized_pnl ?? 0),
    };
    if (p.cost_basis !== undefined && p.cost_basis !== null) {
      trade.costBasis = Number(p.cost_basis);
    }
    if (typeof p.opened_at === 'string' && p.opened_at !== '') {
      const openedAtMs = Date.parse(p.opened_at);
      if (Number.isFinite(openedAtMs)) trade.openedAtMs = openedAtMs;
    }
    trades.push(trade);
  }
  trades.sort((a, b) => a.occurredAtMs - b.occurredAtMs);
  return trades;
}

/** Inclusive date-window filter; either bound may be omitted. */
export function filterByWindow(trades: ClosedTrade[], startMs?: number, endMs?: number): ClosedTrade[] {
  return trades.filter(
    (t) => (startMs === undefined || t.occurredAtMs >= startMs) && (endMs === undefined || t.occurredAtMs <= endMs),
  );
}

/** Cumulative running sum of realizedPnl in close-time order (realized-only, C-5). */
export function buildEquityCurve(trades: ClosedTrade[]): EquityPoint[] {
  const sorted = [...trades].sort((a, b) => a.occurredAtMs - b.occurredAtMs);
  let cum = 0;
  return sorted.map((t) => {
    cum += t.realizedPnl;
    return { t: t.occurredAtMs, value: cum };
  });
}

/** Largest peak-to-trough decline of the cumulative curve. Empty/monotonic-up → 0/0. */
export function maxDrawdown(curve: EquityPoint[]): Drawdown | null {
  if (curve.length === 0) return null;
  let peak = curve[0].value;
  let worstDollars = 0;
  let worstPct = 0;
  for (const point of curve) {
    if (point.value > peak) peak = point.value;
    const decline = point.value - peak;
    if (decline < worstDollars) {
      worstDollars = decline;
      worstPct = peak > 0 ? decline / peak : 0;
    }
  }
  return { dollars: worstDollars, pct: worstPct };
}

/**
 * Fractional day-over-day change of the cumulative equity, `(e_i − e_{i-1}) / |e_{i-1}|`, skipping
 * any step whose prior equity is 0 (zero-base div guard). The returns series `rollingSharpe` consumes.
 */
export function dailyReturns(curve: EquityPoint[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < curve.length; i++) {
    const prev = curve[i - 1].value;
    if (prev === 0) continue;
    returns.push((curve[i].value - prev) / Math.abs(prev));
  }
  return returns;
}

/** Population standard deviation `sqrt(mean((r−mean)^2))`. */
function populationStd(xs: number[]): number {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / xs.length);
}

/**
 * Annualized Sharpe over a returns series: `(mean − riskFreeAnnual/252) / popStd * sqrt(252)`.
 * Returns null when the series has < 2 points, zero variance, or a non-finite result.
 */
export function rollingSharpe(returns: number[], riskFreeAnnual: number): number | null {
  if (returns.length < 2) return null;
  const std = populationStd(returns);
  if (std === 0) return null;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const sharpe = ((mean - riskFreeAnnual / TRADING_DAYS_PER_YEAR) / std) * Math.sqrt(TRADING_DAYS_PER_YEAR);
  return Number.isFinite(sharpe) ? sharpe : null;
}

/**
 * Mean of `realizedPnl / |costBasis|` over trades with a present, non-zero cost basis. Trades with a
 * missing or zero cost basis are excluded; null when none qualify.
 */
export function avgReturnPct(trades: ClosedTrade[]): number | null {
  const pcts = trades
    .filter((t) => t.costBasis !== undefined && t.costBasis !== 0)
    .map((t) => t.realizedPnl / Math.abs(t.costBasis as number));
  if (pcts.length === 0) return null;
  return pcts.reduce((a, b) => a + b, 0) / pcts.length;
}

/**
 * Mean hold time in days, `(occurredAtMs − openedAtMs) / 86_400_000`, over trades with an open date.
 * Trades missing an open date are excluded; null when none qualify.
 */
export function avgHoldTimeDays(trades: ClosedTrade[]): number | null {
  const days = trades
    .filter((t) => t.openedAtMs !== undefined)
    .map((t) => (t.occurredAtMs - (t.openedAtMs as number)) / MS_PER_DAY);
  if (days.length === 0) return null;
  return days.reduce((a, b) => a + b, 0) / days.length;
}

/**
 * Aggregate summary. totalTrades/winCount/winRate/totalRealizedPnl count every trade (legacy
 * included); only the two averages exclude trades missing the extended fields.
 */
export function summaryStats(trades: ClosedTrade[]): SummaryStats {
  const totalTrades = trades.length;
  const winCount = trades.filter((t) => t.realizedPnl > 0).length;
  const totalRealizedPnl = trades.reduce((a, t) => a + t.realizedPnl, 0);
  return {
    totalTrades,
    winCount,
    winRate: totalTrades > 0 ? winCount / totalTrades : 0,
    totalRealizedPnl,
    avgReturnPct: avgReturnPct(trades),
    avgHoldTimeDays: avgHoldTimeDays(trades),
  };
}

/**
 * Read `performance.risk_free_rate_annual` with an oneof-presence check so a stored 0 survives (never
 * `value || default`). Falls back to DEFAULT_RISK_FREE_ANNUAL when the key is absent.
 */
export function readRiskFreeRate(values: Record<string, ConfigValue>): number {
  const v = values['performance.risk_free_rate_annual']?.value;
  return v?.case === 'floatVal' ? v.value : DEFAULT_RISK_FREE_ANNUAL;
}

/**
 * Read `performance.equity_curve_start_date` (ISO date) → epoch millis. Empty/absent/unparseable →
 * `earliestMs` (the earliest closed-position date, the auto default).
 */
export function readStartDateMs(values: Record<string, ConfigValue>, earliestMs: number): number {
  const v = values['performance.equity_curve_start_date']?.value;
  if (v?.case === 'stringVal' && v.value !== '') {
    const parsed = Date.parse(v.value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return earliestMs;
}
