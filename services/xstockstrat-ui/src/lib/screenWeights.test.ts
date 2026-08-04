import { describe, it, expect } from 'vitest';
import { normalizeWeights } from './screenWeights';

describe('normalizeWeights', () => {
  it('normalizes a mixed vector to sum 1.0 and preserves ratios', () => {
    const shares = normalizeWeights([1, 3]);
    expect(shares[0] + shares[1]).toBeCloseTo(1.0, 10);
    expect(shares[1] / shares[0]).toBeCloseTo(3, 10);
    expect(shares).toEqual([0.25, 0.75]);
  });

  it('returns equal shares for an all-zero input (no NaN/Infinity)', () => {
    const shares = normalizeWeights([0, 0, 0]);
    expect(shares).toEqual([1 / 3, 1 / 3, 1 / 3]);
    expect(shares.every((s) => Number.isFinite(s))).toBe(true);
  });

  it('returns [1] for a single criterion', () => {
    expect(normalizeWeights([0.4])).toEqual([1]);
  });

  it('returns [] for an empty input', () => {
    expect(normalizeWeights([])).toEqual([]);
  });
});
