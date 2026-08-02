import { describe, it, expect } from 'vitest';
import { formatLastRun } from './formatLastRun';

describe('formatLastRun', () => {
  const then = new Date('2026-08-02T00:00:00.000Z');
  const base = then.getTime();

  it('renders "just now" under a minute', () => {
    expect(formatLastRun(then, base + 30_000)).toBe('last run just now');
  });

  it('renders minutes', () => {
    expect(formatLastRun(then, base + 120_000)).toBe('last run 2m ago');
  });

  it('renders hours', () => {
    expect(formatLastRun(then, base + 3 * 3_600_000)).toBe('last run 3h ago');
  });

  it('renders days', () => {
    expect(formatLastRun(then, base + 2 * 86_400_000)).toBe('last run 2d ago');
  });

  it('clamps a future "now" to just now (never negative)', () => {
    expect(formatLastRun(then, base - 5_000)).toBe('last run just now');
  });
});
