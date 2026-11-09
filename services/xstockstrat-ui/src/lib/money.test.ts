import { describe, expect, it } from 'vitest';
import { fmtSignedUsd } from './money';

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
