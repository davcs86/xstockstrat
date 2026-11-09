import type { EnvironmentMode } from '@/context/AccountContext';
import { TradingMode as PbTradingMode } from '@xstockstrat/proto/common/v1/common_pb';

/** An unknown environment (`null`) maps to UNSPECIFIED so the server resolves the mode, never PAPER. */
export function toPbTradingMode(mode: EnvironmentMode | null): PbTradingMode {
  return mode === 'live'
    ? PbTradingMode.LIVE
    : mode === 'paper'
      ? PbTradingMode.PAPER
      : PbTradingMode.UNSPECIFIED;
}
