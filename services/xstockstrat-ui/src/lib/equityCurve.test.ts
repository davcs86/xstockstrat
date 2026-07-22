import { describe, expect, it } from 'vitest';
import type { SymbolDiagnostics, TradeRecord } from '@xstockstrat/proto/analysis/v1/analysis_pb';
import { buildEquitySeries, buildTradeMarkers, hasEquityData } from './equityCurve';

const DAY = 86_400;

function bar(daySec: number, equity: number) {
  return {
    timestamp: { seconds: BigInt(daySec), nanos: 0 },
    equity,
  };
}

function diag(symbol: string, bars: ReturnType<typeof bar>[]): SymbolDiagnostics {
  return { symbol, bars } as unknown as SymbolDiagnostics;
}

function trade(
  symbol: string,
  entrySec: number,
  exitSec: number,
  overrides: Partial<TradeRecord> = {},
): TradeRecord {
  return {
    symbol,
    side: 'long',
    qty: 10,
    entryPrice: 100,
    exitPrice: 110,
    pnl: 100,
    entryTime: { seconds: BigInt(entrySec), nanos: 0 },
    exitTime: { seconds: BigInt(exitSec), nanos: 0 },
    ...overrides,
  } as unknown as TradeRecord;
}

describe('buildEquitySeries', () => {
  it('single symbol stays absolute, points ordered by time', () => {
    const d = diag('AAPL', [bar(DAY, 100_000), bar(2 * DAY, 101_000), bar(3 * DAY, 99_500)]);
    const { mode, series } = buildEquitySeries([d]);
    expect(mode).toBe('absolute');
    expect(series).toHaveLength(1);
    expect(series[0].symbol).toBe('AAPL');
    expect(series[0].points.map((p) => p.t)).toEqual([DAY * 1000, 2 * DAY * 1000, 3 * DAY * 1000]);
    expect(series[0].points.map((p) => p.value)).toEqual([100_000, 101_000, 99_500]);
  });

  it('two symbols normalize each line to % return from its own first bar', () => {
    const a = diag('AAPL', [bar(DAY, 100_000), bar(2 * DAY, 110_000)]);
    const b = diag('MSFT', [bar(DAY, 200_000), bar(2 * DAY, 190_000)]);
    const { mode, series } = buildEquitySeries([a, b]);
    expect(mode).toBe('normalized');
    expect(series[0].points[0].value).toBe(0);
    expect(series[0].points[1].value).toBeCloseTo(10); // +10%
    expect(series[1].points.map((p) => p.value)[1]).toBeCloseTo(-5); // -5%
  });

  it('skips bars without equity and empty diagnostics', () => {
    const d = diag('AAPL', [bar(DAY, 0), bar(2 * DAY, 100_000)]);
    const empty = diag('MSFT', []);
    const { mode, series } = buildEquitySeries([d, empty]);
    expect(series).toHaveLength(1); // MSFT contributes nothing
    expect(mode).toBe('absolute'); // only one line with data
    expect(series[0].points).toHaveLength(1); // zero-equity bar skipped
  });
});

describe('hasEquityData', () => {
  it('is false for undefined, empty, and all-zero-equity diagnostics', () => {
    expect(hasEquityData(undefined)).toBe(false);
    expect(hasEquityData([])).toBe(false);
    expect(hasEquityData([diag('AAPL', [bar(DAY, 0)])])).toBe(false);
  });

  it('is true when any bar carries equity', () => {
    expect(hasEquityData([diag('AAPL', [bar(DAY, 1)])])).toBe(true);
  });
});

describe('buildTradeMarkers', () => {
  const d = diag('AAPL', [
    bar(DAY, 100_000),
    bar(2 * DAY, 101_000),
    bar(3 * DAY, 99_500),
    bar(4 * DAY, 102_000),
  ]);

  it('resolves entry/exit marker y from the nearest bar of that symbol', () => {
    const { series } = buildEquitySeries([d]);
    const markers = buildTradeMarkers([trade('AAPL', 2 * DAY, 4 * DAY)], series);
    expect(markers).toHaveLength(2);
    const [entry, exit] = markers;
    expect(entry.kind).toBe('entry');
    expect(entry.t).toBe(2 * DAY * 1000);
    expect(entry.value).toBe(101_000);
    expect(exit.kind).toBe('exit');
    expect(exit.value).toBe(102_000); // forced-close case: exit at last bar resolves there
  });

  it('carries the tooltip payload (symbol/side/qty/prices/pnl)', () => {
    const { series } = buildEquitySeries([d]);
    const [entry] = buildTradeMarkers(
      [trade('AAPL', 2 * DAY, 4 * DAY, { qty: 5, pnl: -42 } as Partial<TradeRecord>)],
      series,
    );
    expect(entry.symbol).toBe('AAPL');
    expect(entry.side).toBe('long');
    expect(entry.qty).toBe(5);
    expect(entry.entryPrice).toBe(100);
    expect(entry.exitPrice).toBe(110);
    expect(entry.pnl).toBe(-42);
  });

  it('drops a marker more than one bar interval away from any bar', () => {
    const { series } = buildEquitySeries([d]);
    const markers = buildTradeMarkers([trade('AAPL', 20 * DAY, 40 * DAY)], series);
    expect(markers).toHaveLength(0);
  });

  it('drops markers for symbols with no series', () => {
    const { series } = buildEquitySeries([d]);
    const markers = buildTradeMarkers([trade('TSLA', 2 * DAY, 3 * DAY)], series);
    expect(markers).toHaveLength(0);
  });
});
