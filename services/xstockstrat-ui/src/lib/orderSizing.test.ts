import { describe, it, expect } from 'vitest';
import { riskReward, suggestedShares } from './orderSizing';

// feature 095 (AC-9) — the order-ticket R:R + suggested-size math is pure and client-side.
describe('orderSizing', () => {
  it('computes reward/risk per share and a 2.0:1 ratio label', () => {
    const rr = riskReward(12.34, 11.5, 14.0);
    expect(rr).not.toBeNull();
    expect(rr!.rewardPerShare).toBeCloseTo(1.66, 2);
    expect(rr!.riskPerShare).toBeCloseTo(0.84, 2);
    expect(rr!.ratioLabel).toBe('2.0:1');
  });

  it('returns null for invalid geometry (stop above entry, or missing inputs)', () => {
    expect(riskReward(12.34, 13.0, 14.0)).toBeNull(); // stop ≥ entry → no risk
    expect(riskReward(12.34, 11.5, 12.0)).toBeNull(); // target ≤ entry → no reward
    expect(riskReward(undefined, 11.5, 14.0)).toBeNull();
  });

  it('suggests a positive share count bounded by risk and affordability', () => {
    const n = suggestedShares(5000, 12.34, 11.5);
    expect(n).toBeGreaterThan(0);
    expect(Number.isInteger(n)).toBe(true);
    expect(n).toBeLessThanOrEqual(Math.floor(5000 / 12.34)); // never more than affordable
  });

  it('returns 0 when inputs are missing or the stop distance is zero', () => {
    expect(suggestedShares(0, 12.34, 11.5)).toBe(0);
    expect(suggestedShares(5000, 12.34, 12.34)).toBe(0); // zero stop distance
    expect(suggestedShares(5000, undefined, 11.5)).toBe(0);
  });
});
