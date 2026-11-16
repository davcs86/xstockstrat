import { describe, expect, it } from 'vitest';
import {
  INDICATOR_COMPONENTS_DIP_BUYER_VOL_STOP,
  INDICATOR_COMPONENTS_PALETTE_13,
  INDICATOR_SERIES_AAPL,
} from '../../e2e/fixtures/indicatorSeries';
import {
  isChartable,
  normalizeAscendingUnique,
  seriesSlots,
  toLineData,
  type IndicatorLinePoint,
} from './indicatorChart';
import { SERIES_PALETTE } from './seriesPalette';

// A genuine 0 reading vs an UNSET (warm-up/gap) point — the whole P-03/AC-3 "never a fabricated 0"
// contract lives in this pure mapper now (moved off the old recharts `?? null` + connectNulls).
describe('toLineData', () => {
  const times = [{ seconds: 10 }, { seconds: 20 }, { seconds: 30 }];

  it('maps an UNSET value to a whitespace point with no `value` key (a gap)', () => {
    const pts = toLineData([{}, { value: 1 }, {}], times);
    expect(pts[0]).toEqual({ time: 10 });
    expect('value' in pts[0]).toBe(false);
    expect(pts[1]).toEqual({ time: 20, value: 1 });
    expect('value' in pts[2]).toBe(false);
  });

  it('keeps a genuine 0 reading as { time, value: 0 } — never dropped or whitespaced', () => {
    const pts = toLineData([{ value: 0 }], [{ seconds: 5 }]);
    expect(pts[0]).toEqual({ time: 5, value: 0 });
  });

  it('renders the macd warm-up head as two leading whitespace points (canonical fixture)', () => {
    const macd = INDICATOR_SERIES_AAPL.components[0]; // GAP, GAP, V(1.2), V(1.5), V(1.1)
    const pts = toLineData(macd.series[0].values, INDICATOR_SERIES_AAPL.times);
    expect(pts).toHaveLength(5);
    expect('value' in pts[0]).toBe(false);
    expect('value' in pts[1]).toBe(false);
    expect(pts[2]).toMatchObject({ value: 1.2 });
  });

  it('treats a values array shorter than times as trailing gaps — never invents data', () => {
    const pts = toLineData([{ value: 1 }], times);
    expect(pts).toHaveLength(3);
    expect(pts[0]).toEqual({ time: 10, value: 1 });
    expect('value' in pts[1]).toBe(false);
    expect('value' in pts[2]).toBe(false);
  });

  it('accepts bigint proto seconds (generated protobuf-es Timestamp shape)', () => {
    const pts = toLineData([{ value: 2 }], [{ seconds: BigInt(1704067200) }]);
    expect(pts[0]).toEqual({ time: 1704067200, value: 2 });
  });
});

describe('normalizeAscendingUnique (lightweight-charts v5 setData precondition)', () => {
  const pt = (time: number, value?: number): IndicatorLinePoint =>
    (value === undefined ? { time } : { time, value }) as IndicatorLinePoint;

  it('sorts out-of-order timestamps strictly ascending', () => {
    const out = normalizeAscendingUnique([pt(30, 3), pt(10, 1), pt(20, 2)]);
    expect(out.map((p) => p.time)).toEqual([10, 20, 30]);
  });

  it('collapses a duplicate timestamp keeping the last point (last wins, documented rule)', () => {
    const out = normalizeAscendingUnique([pt(10, 1), pt(10, 99)]);
    expect(out).toEqual([{ time: 10, value: 99 }]);
  });
});

describe('seriesSlots', () => {
  it('(AC-2) five series across four indicators get SERIES_PALETTE[0..4], all distinct', () => {
    const rows = seriesSlots(INDICATOR_COMPONENTS_DIP_BUYER_VOL_STOP);
    const flat = rows.flat();
    expect(flat).toEqual(SERIES_PALETTE.slice(0, 5));
    expect(new Set(flat.map((e) => e.token)).size).toBe(5);
    const vts = rows[3];
    expect(vts).toHaveLength(2);
    expect(vts[0].token).not.toBe(vts[1].token);
  });

  it('(AC-6) the thirteenth series reuses the first colour; slots 1-12 are distinct', () => {
    const flat = seriesSlots(INDICATOR_COMPONENTS_PALETTE_13).flat();
    expect(flat).toHaveLength(13);
    expect(flat[12]).toEqual(SERIES_PALETTE[0]);
    expect(flat[12]).toEqual(flat[0]);
    expect(new Set(flat.slice(0, 12).map((e) => e.token)).size).toBe(12);
  });

  it('gives a failed component [] and consumes no index', () => {
    expect(seriesSlots(INDICATOR_SERIES_AAPL.components)).toEqual([SERIES_PALETTE.slice(0, 3), []]);
    const failedFirst = [...INDICATOR_SERIES_AAPL.components].reverse();
    expect(seriesSlots(failedFirst)).toEqual([[], SERIES_PALETTE.slice(0, 3)]);
  });

  it('isChartable: true with series and no error; false with an error or no series', () => {
    const [macd, broken] = INDICATOR_SERIES_AAPL.components;
    expect(isChartable(macd)).toBe(true);
    expect(isChartable(broken)).toBe(false);
    expect(isChartable({ ...macd, error: 'boom' })).toBe(false);
    expect(isChartable({ ...macd, series: [] })).toBe(false);
  });
});
