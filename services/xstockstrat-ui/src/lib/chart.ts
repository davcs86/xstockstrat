// Shared candlestick-chart primitives used by the trader ChartPanel and the insights
// market-symbol page: the supported timeframe set, the bar shape, and the proto→chart bar
// mapping. Single source of truth (DRY guard rail — see docs/patterns/dry-guard-rail.md).

import { Timeframe as PbTimeframe } from '@xstockstrat/proto/common/v1/common_pb';

// Only 1d is supported platform-wide (feature 143) — GetBars/BackfillBars reject any other
// requested timeframe, and the always-on ingester only ever fetches 1d. The 15m/1h options were
// removed: no trading-path consumer (live loop, screener technical criteria, default SMA strategy)
// evaluates anything but daily bars. Historical 15m/1h rows stay stored but are no longer fetchable.
export type Timeframe = '1Day';

export const TIMEFRAMES: { value: Timeframe; label: string }[] = [{ value: '1Day', label: '1d' }];

// The deprecated GetBarsRequest.timeframe string is scheduled for removal; senders must
// populate timeframe_enum too, or timeframe.Resolve(UNSPECIFIED, "") errors and the chart
// goes blank. Mapped type, not a lookup object: a Timeframe member without an enum here fails
// tsc rather than silently skipping the enum (feature 080 FR-8/AC-8).
export const TIMEFRAME_ENUM: Record<Timeframe, PbTimeframe> = {
  '1Day': PbTimeframe.TIMEFRAME_1DAY,
};

export interface Bar {
  time: number; // Unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface RawBar {
  time?: { seconds: bigint | number } | null;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: bigint | number;
}

/** Map proto OHLCV bars to the chart's Bar shape, sorted ascending by time. */
export function mapBars(rawBars: RawBar[]): Bar[] {
  return rawBars
    .map((b) => ({
      time: b.time ? Number(b.time.seconds) : 0,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: Number(b.volume),
    }))
    .sort((a, b) => a.time - b.time);
}
