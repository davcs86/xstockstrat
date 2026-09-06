// Shared candlestick-chart primitives used by the trader ChartPanel and the insights
// market-symbol page: the supported timeframe set, the bar shape, and the proto→chart bar
// mapping. Single source of truth (DRY guard rail — see docs/patterns/dry-guard-rail.md).

import { Timeframe as PbTimeframe } from '@xstockstrat/proto/common/v1/common_pb';

// Only 1d is supported platform-wide — GetBars/BackfillBars reject any other timeframe, and the
// always-on ingester only fetches 1d.
export type Timeframe = '1Day';

export const TIMEFRAMES: { value: Timeframe; label: string }[] = [{ value: '1Day', label: '1d' }];

// Senders must populate timeframe_enum, or timeframe.Resolve(UNSPECIFIED, "") errors and the chart
// goes blank. Mapped type (not a lookup): a Timeframe member without an enum here fails tsc.
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
