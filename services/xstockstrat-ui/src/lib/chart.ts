// Shared candlestick-chart primitives used by the trader ChartPanel and the insights
// market-symbol page: the supported timeframe set, the bar shape, and the proto→chart bar
// mapping. Single source of truth (DRY guard rail — see docs/patterns/dry-guard-rail.md).

import { Timeframe as PbTimeframe } from '@xstockstrat/proto/common/v1/common_pb';

// Only 15m/1h/1d are supported platform-wide: the marketdata service stores and resolves
// exactly these canonical intervals (common.v1.Timeframe = 15MIN/1HOUR/1DAY; 15m is the
// smallest interval the free Alpaca data plan serves). 10m/30m/1w/1mo have no backend
// support and render empty, so they are not offered.
export type Timeframe = '15Min' | '1Hour' | '1Day';

export const TIMEFRAMES: { value: Timeframe; label: string }[] = [
  { value: '15Min', label: '15m' },
  { value: '1Hour', label: '1h' },
  { value: '1Day', label: '1d' },
];

// The deprecated GetBarsRequest.timeframe string is scheduled for removal; senders must
// populate timeframe_enum too, or timeframe.Resolve(UNSPECIFIED, "") errors and the chart
// goes blank. Mapped type, not a lookup object: a fourth Timeframe member fails tsc here
// rather than silently skipping the enum (feature 080 FR-8/AC-8).
export const TIMEFRAME_ENUM: Record<Timeframe, PbTimeframe> = {
  '15Min': PbTimeframe.TIMEFRAME_15MIN,
  '1Hour': PbTimeframe.TIMEFRAME_1HOUR,
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
