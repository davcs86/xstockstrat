import { describe, it, expect } from 'vitest';
import { TradingMode as PbTradingMode } from '@xstockstrat/proto/common/v1/common_pb';
import { toPbTradingMode } from './tradingMode';

describe('toPbTradingMode', () => {
  it('maps live to LIVE', () => {
    expect(toPbTradingMode('live')).toBe(PbTradingMode.LIVE);
  });

  it('maps paper to PAPER (@feature-095)', () => {
    expect(toPbTradingMode('paper')).toBe(PbTradingMode.PAPER);
  });

  it('maps an unknown environment (null) to UNSPECIFIED, never PAPER (AC-3)', () => {
    expect(toPbTradingMode(null)).toBe(PbTradingMode.UNSPECIFIED);
  });
});
