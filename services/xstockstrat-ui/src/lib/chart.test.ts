import { describe, expect, it } from 'vitest';
import { Timeframe as PbTimeframe } from '@xstockstrat/proto/common/v1/common_pb';
import { TIMEFRAME_ENUM, TIMEFRAMES, mapBars } from './chart';

describe('TIMEFRAME_ENUM', () => {
  it('maps each supported timeframe to its hardcoded proto enum', () => {
    expect(TIMEFRAME_ENUM['15Min']).toBe(PbTimeframe.TIMEFRAME_15MIN);
    expect(TIMEFRAME_ENUM['1Hour']).toBe(PbTimeframe.TIMEFRAME_1HOUR);
    expect(TIMEFRAME_ENUM['1Day']).toBe(PbTimeframe.TIMEFRAME_1DAY);
  });

  it('covers exactly the TIMEFRAMES set (totality backstop)', () => {
    expect(Object.keys(TIMEFRAME_ENUM).sort()).toEqual(TIMEFRAMES.map((t) => t.value).sort());
  });
});

describe('mapBars', () => {
  it('maps a raw proto bar to the chart Bar shape', () => {
    const result = mapBars([
      {
        time: { seconds: 1_700_000_000 },
        open: 100,
        high: 105,
        low: 99,
        close: 102,
        volume: BigInt(1000),
      },
    ]);
    expect(result).toEqual([
      { time: 1_700_000_000, open: 100, high: 105, low: 99, close: 102, volume: 1000 },
    ]);
  });

  it('sorts bars ascending by time', () => {
    const result = mapBars([
      { time: { seconds: 200 }, open: 2, high: 2, low: 2, close: 2, volume: 2 },
      { time: { seconds: 100 }, open: 1, high: 1, low: 1, close: 1, volume: 1 },
    ]);
    expect(result.map((b) => b.time)).toEqual([100, 200]);
  });
});
