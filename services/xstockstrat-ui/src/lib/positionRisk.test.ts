import { describe, expect, it } from 'vitest';
import { PositionRiskFlag } from '@xstockstrat/proto/portfolio/v1/portfolio_pb';
import type { Position } from '@xstockstrat/proto/portfolio/v1/portfolio_pb';
import { openR, fmtR, sideLabel, isExitFlag } from './positionRisk';

// Minimal Position factory — only the fields the risk helpers read.
function pos(overrides: Partial<Position>): Position {
  return { ...(overrides as Position) };
}

describe('sideLabel', () => {
  it('is Long for a positive quantity and Short for a negative one', () => {
    expect(sideLabel(10)).toBe('Long');
    expect(sideLabel(-5)).toBe('Short');
    expect(sideLabel(0)).toBe('Long'); // flat/zero defaults to Long (never Short on 0)
    expect(sideLabel(undefined)).toBe('Long');
  });
});

describe('openR', () => {
  it('is unrealized P&L divided by the risk-at-stop', () => {
    expect(openR(pos({ unrealizedPnl: 100, riskAtStop: 118 }))).toBeCloseTo(100 / 118);
    expect(openR(pos({ unrealizedPnl: -60, riskAtStop: 120 }))).toBeCloseTo(-0.5);
  });

  it('is null when there is no stop-risk to normalize against', () => {
    expect(openR(pos({ unrealizedPnl: 100, riskAtStop: 0 }))).toBeNull();
    expect(openR(pos({ unrealizedPnl: 100 }))).toBeNull();
  });
});

describe('fmtR', () => {
  it('formats a signed R-multiple to one decimal, or em-dash for null', () => {
    expect(fmtR(0.8)).toBe('+0.8R');
    expect(fmtR(2)).toBe('+2.0R');
    expect(fmtR(-0.5)).toBe('-0.5R');
    expect(fmtR(null)).toBe('—');
  });
});

describe('isExitFlag', () => {
  it('is true for REDUCE_SIGNAL and STOP_NEAR, false otherwise', () => {
    expect(isExitFlag(pos({ flag: PositionRiskFlag.REDUCE_SIGNAL }))).toBe(true);
    expect(isExitFlag(pos({ flag: PositionRiskFlag.STOP_NEAR }))).toBe(true);
    expect(isExitFlag(pos({ flag: PositionRiskFlag.ADD_SIGNAL }))).toBe(false);
    expect(isExitFlag(pos({ flag: PositionRiskFlag.UNSPECIFIED }))).toBe(false);
  });
});
