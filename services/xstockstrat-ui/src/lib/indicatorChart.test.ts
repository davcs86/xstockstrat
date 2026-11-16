import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { create } from '@bufbuild/protobuf';
import { ConfigValueSchema, type ConfigValue } from '@xstockstrat/proto/config/v1/config_pb';
import { describe, expect, it } from 'vitest';
import { UI_CHART_HISTORY_VALUES } from '../../e2e/fixtures/configKeys';
import { indicatorSeriesResponse, smaComponent } from '../../e2e/fixtures/indicatorHistory';
import { INDICATOR_SERIES_AAPL } from '../../e2e/fixtures/indicatorSeries';
import {
  DEFAULT_HISTORY_BARS,
  normalizeAscendingUnique,
  readHistoryBars,
  toLineData,
  windowIndicatorSeries,
  type IndicatorLinePoint,
} from './indicatorChart';

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

const CONFIG_MIGRATIONS = fileURLToPath(
  new URL('../../../xstockstrat-config/migrations/', import.meta.url),
);
const HISTORY_KEY = 'chart.indicator_history_bars';

const asConfig = (init: Record<string, { value: ConfigValue['value'] }>) =>
  Object.fromEntries(
    Object.entries(init).map(([k, v]) => [k, create(ConfigValueSchema, v)]),
  ) as Record<string, ConfigValue>;

describe('readHistoryBars', () => {
  it('falls back to the default when the key is absent', () => {
    expect(readHistoryBars({})).toBe(200);
  });

  it('falls back to the default on a wrong value type', () => {
    const asString = { [HISTORY_KEY]: { value: { case: 'stringVal' as const, value: '600' } } };
    const asFloat = { [HISTORY_KEY]: { value: { case: 'floatVal' as const, value: 600 } } };
    expect(readHistoryBars(asConfig(asString))).toBe(200);
    expect(readHistoryBars(asConfig(asFloat))).toBe(200);
  });

  it('clamps below the drawn window up to W and above the ceiling down to 1000', () => {
    expect(readHistoryBars(asConfig(UI_CHART_HISTORY_VALUES.init(50)))).toBe(200);
    expect(readHistoryBars(asConfig(UI_CHART_HISTORY_VALUES.init(5000)))).toBe(1000);
  });

  it('returns a valid configured depth unchanged', () => {
    expect(readHistoryBars(asConfig(UI_CHART_HISTORY_VALUES.init(1000)))).toBe(1000);
    expect(readHistoryBars(asConfig(UI_CHART_HISTORY_VALUES.init(600)))).toBe(600);
  });

  it('reads the seeded value through the real reader (seed-to-reader, C-05 / F-07)', () => {
    const files = readdirSync(CONFIG_MIGRATIONS).filter((f) =>
      f.endsWith('_ui_chart_history_bars.up.sql'),
    );
    expect(files).toHaveLength(1);
    const sql = readFileSync(CONFIG_MIGRATIONS + files[0], 'utf8');
    const row = /'chart\.indicator_history_bars',\s*'([^']*)',\s*'([^']*)'/.exec(sql);
    expect(row).not.toBeNull();
    const [, valueType, valueData] = row!;
    expect(valueType).toBe('int');
    const seeded = Number(valueData);
    const read = readHistoryBars(asConfig(UI_CHART_HISTORY_VALUES.init(seeded)));
    expect(read).toBe(seeded);
    expect(read).toBe(DEFAULT_HISTORY_BARS);
  });
});

const hasValue = (v: { value?: number }) => v.value !== undefined;

describe('windowIndicatorSeries', () => {
  it('AC-1: a 200-period average over a 190-bar window has a value on every drawn bar', () => {
    const out = windowIndicatorSeries(indicatorSeriesResponse(400, [200]), 1000, 190);
    expect(out.times).toHaveLength(190);
    const sma = out.components.find((c) => c.refName === 'sma200')!;
    expect(sma.series[0].values).toHaveLength(190);
    expect(sma.series[0].values.every(hasValue)).toBe(true);
    expect(out.insufficient.size).toBe(0);
  });

  it('AC-2: history shorter than the period reports the indicator as lacking history', () => {
    const out = windowIndicatorSeries(indicatorSeriesResponse(150, [200]), 1000, 190);
    expect(out.insufficient.has('sma200')).toBe(true);
  });

  it('AC-3: exactly the period of history gives a value on the last bar only', () => {
    const out = windowIndicatorSeries(indicatorSeriesResponse(200, [200]), 1000, 190);
    const drawn = out.components[0].series[0].values;
    expect(drawn).toHaveLength(190);
    expect(hasValue(drawn[189])).toBe(true);
    expect(drawn.slice(0, 189).some(hasValue)).toBe(false);
    expect(out.insufficient.size).toBe(0);
  });

  it('AC-4: only the indicator lacking history is reported; the other draws in full', () => {
    const out = windowIndicatorSeries(indicatorSeriesResponse(150, [200, 20]), 1000, 100);
    expect([...out.insufficient]).toEqual(['sma200']);
    const sma20 = out.components.find((c) => c.refName === 'sma20')!;
    expect(sma20.series[0].values).toHaveLength(100);
    expect(sma20.series[0].values.every(hasValue)).toBe(true);
  });

  it('a full page at the default depth never reports insufficient history (leading gaps only)', () => {
    const out = windowIndicatorSeries(indicatorSeriesResponse(200, [250]), 200, 200);
    expect(out.times).toHaveLength(200);
    expect(out.components[0].series[0].values.some(hasValue)).toBe(false);
    expect(out.insufficient.size).toBe(0);
  });

  it('a short page never reports a component with firstValueBars 0 or an error', () => {
    const page = {
      times: indicatorSeriesResponse(50, []).times,
      components: [
        { ...smaComponent('unknownP', 200, 50), firstValueBars: 0 },
        { ...smaComponent('broken', 200, 50), error: 'formula failed', series: [] },
        smaComponent('short', 200, 50),
      ],
    };
    const out = windowIndicatorSeries(page, 1000, 200);
    expect([...out.insufficient]).toEqual(['short']);
  });

  it('returns the tail of the response times, so each value keeps its own time', () => {
    const resp = indicatorSeriesResponse(300, [20]);
    const out = windowIndicatorSeries(resp, 1000, 200);
    expect(out.times).toEqual(resp.times.slice(100));
    expect(out.components[0].series[0].values).toEqual(
      resp.components[0].series[0].values.slice(100),
    );
  });

  it('does not mutate the input', () => {
    const resp = indicatorSeriesResponse(300, [200]);
    const before = structuredClone(resp);
    windowIndicatorSeries(resp, 1000, 190);
    expect(resp).toEqual(before);
  });

  it('a windowed series keeps the gap contract through toLineData', () => {
    const out = windowIndicatorSeries(indicatorSeriesResponse(200, [200]), 1000, 190);
    const pts = toLineData(out.components[0].series[0].values, out.times);
    expect(pts).toHaveLength(190);
    expect('value' in pts[0]).toBe(false);
    expect('value' in pts[189]).toBe(true);
  });
});
