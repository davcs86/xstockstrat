/**
 * Unit tests for the /insights performance-dashboard metric lib (feature 031).
 *
 * One focused case per acceptance scenario (AC-1..AC-5, AC-8, AC-11..AC-13). All inputs are plain
 * numeric literals / directly-constructed ClosedTrade objects — no proto domain fixtures — so no
 * e2e/fixtures import is required (C-13, single consumer). Written RED (before performanceMetrics.ts
 * exists → module-not-found), then GREEN once Step 7 lands.
 */

import { describe, expect, it } from 'vitest';
import type { LedgerEvent } from '@xstockstrat/proto/ledger/v1/ledger_pb';
import type { ConfigValue } from '@xstockstrat/proto/config/v1/config_pb';
import {
  type ClosedTrade,
  avgHoldTimeDays,
  avgReturnPct,
  buildEquityCurve,
  closedTradesFromEvents,
  dailyReturns,
  filterByWindow,
  maxDrawdown,
  readRiskFreeRate,
  readStartDateMs,
  rollingSharpe,
  summaryStats,
} from './performanceMetrics';

const day = (iso: string) => Date.parse(iso);

// A trade closed on `iso`, realizing `pnl`, optionally with cost basis / open date.
function trade(iso: string, pnl: number, costBasis?: number, openedIso?: string): ClosedTrade {
  return {
    occurredAtMs: day(iso),
    realizedPnl: pnl,
    ...(costBasis !== undefined ? { costBasis } : {}),
    ...(openedIso !== undefined ? { openedAtMs: day(openedIso) } : {}),
  };
}

// Population standard deviation — mirrors the lib's rollingSharpe convention so AC-3's reference is
// hand-computed identically.
function popStd(xs: number[]): number {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) * (b - m), 0) / xs.length);
}

describe('closedTradesFromEvents', () => {
  it('maps payload realized_pnl / cost_basis / opened_at + occurred_at, sorted ascending', () => {
    const mk = (occMs: number, payload: Record<string, unknown>): LedgerEvent =>
      ({
        eventType: 'portfolio.position.closed',
        occurredAt: { seconds: BigInt(Math.floor(occMs / 1000)), nanos: 0 },
        payload,
      }) as unknown as LedgerEvent;
    const events = [
      mk(day('2026-02-11'), {
        realized_pnl: 500,
        cost_basis: 10000,
        opened_at: '2026-02-01T00:00:00Z',
      }),
      mk(day('2026-02-05'), { realized_pnl: -120 }), // legacy: no cost_basis / opened_at
    ];
    const trades = closedTradesFromEvents(events);
    expect(trades.map((t) => t.occurredAtMs)).toEqual([day('2026-02-05'), day('2026-02-11')]);
    expect(trades[1].realizedPnl).toBe(500);
    expect(trades[1].costBasis).toBe(10000);
    expect(trades[1].openedAtMs).toBe(day('2026-02-01T00:00:00Z'));
    expect(trades[0].costBasis).toBeUndefined();
    expect(trades[0].openedAtMs).toBeUndefined();
  });
});

describe('AC-1 equity curve — cumulative realized P&L from base date', () => {
  it('first point is on/after the configured base date and final value is the P&L sum', () => {
    // 10 trades spanning Dec 2025 → Aug 2026; base date filters out the pre-2026 one.
    const all: ClosedTrade[] = [
      trade('2025-12-20', 999), // excluded by base date
      trade('2026-01-05', 100),
      trade('2026-02-05', 200),
      trade('2026-03-05', -50),
      trade('2026-04-05', 300),
      trade('2026-05-05', -80),
      trade('2026-06-05', 150),
      trade('2026-07-05', 220),
      trade('2026-08-05', -40),
      trade('2026-08-20', 60),
    ];
    const startMs = day('2026-01-01');
    const windowed = filterByWindow(all, startMs);
    const curve = buildEquityCurve(windowed);
    expect(curve[0].t).toBeGreaterThanOrEqual(startMs);
    const expected = windowed.reduce((a, t) => a + t.realizedPnl, 0);
    expect(curve[curve.length - 1].value).toBeCloseTo(expected, 6);
    // monotonic in time
    for (let i = 1; i < curve.length; i++) expect(curve[i].t).toBeGreaterThanOrEqual(curve[i - 1].t);
  });
});

describe('AC-2 max drawdown', () => {
  it('peak 5000 → trough 4380 is -620 / -12.4%', () => {
    // A curve that climbs to 5000 then falls to 4380.
    const trades: ClosedTrade[] = [
      trade('2026-01-01', 2000),
      trade('2026-01-02', 3000), // cum 5000 (peak)
      trade('2026-01-03', -620), // cum 4380 (trough)
      trade('2026-01-04', 100),
    ];
    const dd = maxDrawdown(buildEquityCurve(trades));
    expect(dd).not.toBeNull();
    expect(dd!.dollars).toBeCloseTo(-620, 6);
    expect(dd!.pct).toBeCloseTo(-0.124, 3);
  });

  it('monotonic-up curve → zero drawdown', () => {
    const dd = maxDrawdown(buildEquityCurve([trade('2026-01-01', 100), trade('2026-01-02', 50)]));
    expect(dd).not.toBeNull();
    expect(dd!.dollars).toBe(0);
    expect(dd!.pct).toBe(0);
  });
});

describe('AC-3 rolling Sharpe with configured risk-free rate', () => {
  it('equals the hand-computed (mean - rf/252)/popStd * sqrt(252)', () => {
    const returns = [0.01, -0.005, 0.02, 0.0, 0.008, -0.012, 0.015, 0.003, -0.002, 0.011];
    const rf = 0.045;
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const expected = ((mean - rf / 252) / popStd(returns)) * Math.sqrt(252);
    expect(rollingSharpe(returns, rf)).toBeCloseTo(expected, 2);
  });
});

describe('AC-4 zero-variance Sharpe guard', () => {
  it('identical returns (std 0) → null, never Infinity/NaN', () => {
    const r = rollingSharpe([0.01, 0.01, 0.01, 0.01], 0.045);
    expect(r).toBeNull();
  });
  it('fewer than 2 points → null', () => {
    expect(rollingSharpe([0.01], 0.045)).toBeNull();
    expect(rollingSharpe([], 0.045)).toBeNull();
  });
});

describe('AC-5 summary stats', () => {
  it('10 trades, 6 winners / 4 losers → totals + win rate + defined averages', () => {
    const trades: ClosedTrade[] = [
      trade('2026-01-01', 100, 1000, '2025-12-31'),
      trade('2026-01-02', 200, 2000, '2026-01-01'),
      trade('2026-01-03', 50, 500, '2026-01-02'),
      trade('2026-01-04', 300, 3000, '2026-01-03'),
      trade('2026-01-05', 25, 250, '2026-01-04'),
      trade('2026-01-06', 10, 100, '2026-01-05'),
      trade('2026-01-07', -40, 400, '2026-01-06'),
      trade('2026-01-08', -80, 800, '2026-01-07'),
      trade('2026-01-09', -15, 150, '2026-01-08'),
      trade('2026-01-10', -60, 600, '2026-01-09'),
    ];
    const s = summaryStats(trades);
    expect(s.totalTrades).toBe(10);
    expect(s.winCount).toBe(6);
    expect(s.winRate).toBeCloseTo(0.6, 6);
    expect(s.totalRealizedPnl).toBeCloseTo(490, 6);
    expect(s.avgReturnPct).not.toBeNull();
    expect(s.avgHoldTimeDays).not.toBeNull();
  });
});

describe('AC-8 date-range window recomputes every metric', () => {
  it('June-only window differs from full range', () => {
    const all: ClosedTrade[] = [
      trade('2026-01-15', 100, 1000, '2026-01-10'),
      trade('2026-03-15', 200, 2000, '2026-03-10'),
      trade('2026-06-05', -300, 3000, '2026-06-01'),
      trade('2026-06-20', 500, 5000, '2026-06-10'),
      trade('2026-08-15', 80, 800, '2026-08-10'),
    ];
    const june = filterByWindow(all, day('2026-06-01'), day('2026-06-30T23:59:59Z'));
    expect(june).toHaveLength(2);
    const fullCurve = buildEquityCurve(all);
    const juneCurve = buildEquityCurve(june);
    expect(juneCurve[0].t).not.toBe(fullCurve[0].t);
    expect(summaryStats(june).totalTrades).toBe(2);
    expect(summaryStats(all).totalTrades).toBe(5);
    // Sharpe recomputed over only the June returns
    const juneSharpe = rollingSharpe(dailyReturns(juneCurve), 0.045);
    const fullSharpe = rollingSharpe(dailyReturns(fullCurve), 0.045);
    expect(juneSharpe).not.toBe(fullSharpe);
  });
});

describe('AC-11 average return per trade', () => {
  it('500 / 10000 → +5.0%', () => {
    expect(avgReturnPct([trade('2026-02-11', 500, 10000)])).toBeCloseTo(0.05, 6);
  });
  it('excludes costBasis === 0 (no Infinity)', () => {
    const r = avgReturnPct([trade('2026-02-11', 500, 10000), trade('2026-02-12', 100, 0)]);
    expect(r).toBeCloseTo(0.05, 6); // the zero-basis trade is dropped, not averaged
    expect(Number.isFinite(r!)).toBe(true);
  });
  it('short position (negative cost basis) uses |cost basis|', () => {
    // realized 200 on a short opened for -4000 → 200/4000 = +5.0%
    expect(avgReturnPct([trade('2026-02-11', 200, -4000)])).toBeCloseTo(0.05, 6);
  });
});

describe('AC-12 average hold time', () => {
  it('2026-02-01 → 2026-02-11 = 10 days', () => {
    expect(avgHoldTimeDays([trade('2026-02-11', 500, 10000, '2026-02-01')])).toBeCloseTo(10, 6);
  });
});

describe('AC-13 legacy event excluded from averages, still counted elsewhere', () => {
  it('a trade without cost_basis/opened_at drops from the two averages but stays in totals/curve', () => {
    const trades: ClosedTrade[] = [
      trade('2026-01-01', 500, 10000, '2025-12-22'), // full
      trade('2026-01-02', 100), // legacy: no costBasis / openedAtMs
    ];
    // averages computed over the one full trade only
    expect(avgReturnPct(trades)).toBeCloseTo(0.05, 6);
    expect(avgHoldTimeDays(trades)).toBeCloseTo(10, 6);
    // but the legacy trade still counts everywhere else
    const s = summaryStats(trades);
    expect(s.totalTrades).toBe(2);
    expect(s.winCount).toBe(2);
    expect(s.totalRealizedPnl).toBeCloseTo(600, 6);
    const curve = buildEquityCurve(trades);
    expect(curve[curve.length - 1].value).toBeCloseTo(600, 6);
  });

  it('all-legacy → averages are null, not NaN', () => {
    const trades: ClosedTrade[] = [trade('2026-01-01', 100), trade('2026-01-02', -50)];
    expect(avgReturnPct(trades)).toBeNull();
    expect(avgHoldTimeDays(trades)).toBeNull();
  });
});

describe('dailyReturns zero-base guard', () => {
  it('skips a step where the prior cumulative equity is 0', () => {
    // curve values: 0, 100, 150 → the 0→100 step is skipped (div-by-zero), 100→150 kept.
    const trades: ClosedTrade[] = [trade('2026-01-01', 0), trade('2026-01-02', 100), trade('2026-01-03', 50)];
    const rets = dailyReturns(buildEquityCurve(trades));
    expect(rets).toHaveLength(1);
    expect(rets[0]).toBeCloseTo(0.5, 6);
  });
});

describe('readRiskFreeRate / readStartDateMs oneof-presence reads', () => {
  const floatVal = (v: number): ConfigValue =>
    ({ value: { case: 'floatVal', value: v } }) as unknown as ConfigValue;
  const stringVal = (v: string): ConfigValue =>
    ({ value: { case: 'stringVal', value: v } }) as unknown as ConfigValue;

  it('reads a stored float, including a legitimate 0 (never value || default)', () => {
    expect(readRiskFreeRate({ 'performance.risk_free_rate_annual': floatVal(0.03) })).toBeCloseTo(0.03);
    expect(readRiskFreeRate({ 'performance.risk_free_rate_annual': floatVal(0) })).toBe(0);
  });
  it('falls back to 0.045 when the key is absent', () => {
    expect(readRiskFreeRate({})).toBeCloseTo(0.045);
  });
  it('reads a stored start date; empty / absent → earliest', () => {
    const earliest = day('2026-01-01');
    expect(readStartDateMs({ 'performance.equity_curve_start_date': stringVal('2026-06-01') }, earliest)).toBe(
      day('2026-06-01'),
    );
    expect(readStartDateMs({ 'performance.equity_curve_start_date': stringVal('') }, earliest)).toBe(earliest);
    expect(readStartDateMs({}, earliest)).toBe(earliest);
  });
});
