import { describe, expect, it } from 'vitest';
import { fmtSignedUsd, fmtUsdCompact } from './money';

describe('fmtSignedUsd', () => {
  it('puts the sign before the dollar sign', () => {
    expect(fmtSignedUsd(-50)).toBe('-$50.00');
    expect(fmtSignedUsd(100)).toBe('+$100.00');
    expect(fmtSignedUsd(1300)).toBe('+$1,300.00');
  });

  it('renders — for a missing value', () => {
    expect(fmtSignedUsd(undefined)).toBe('—');
    expect(fmtSignedUsd(null)).toBe('—');
  });
});

describe('fmtUsdCompact', () => {
  it('abbreviates large values with two fraction digits', () => {
    expect(fmtUsdCompact(6726553623.93)).toBe('$6.73B');
    expect(fmtUsdCompact(3.45e12)).toBe('$3.45T');
    expect(fmtUsdCompact(3.02e12)).toBe('$3.02T');
    expect(fmtUsdCompact(0)).toBe('$0.00');
  });

  it('renders — for a missing value', () => {
    expect(fmtUsdCompact(undefined)).toBe('—');
    expect(fmtUsdCompact(null)).toBe('—');
    expect(fmtUsdCompact(NaN)).toBe('—');
  });
});
