import { describe, it, expect } from 'vitest';
import { isFiring, rollupReadiness, readinessState } from './readinessRollup';

describe('readinessState', () => {
  it('classifies each of firing / watching / quiet / nodata', () => {
    expect(
      readinessState({ passingConditions: 3, totalConditions: 3, formulaUnreadable: false }),
    ).toBe('firing');
    expect(
      readinessState({ passingConditions: 1, totalConditions: 3, formulaUnreadable: false }),
    ).toBe('watching');
    expect(
      readinessState({ passingConditions: 0, totalConditions: 3, formulaUnreadable: false }),
    ).toBe('quiet');
    expect(
      readinessState({ passingConditions: 0, totalConditions: 0, formulaUnreadable: false }),
    ).toBe('nodata');
  });

  it('maps any total===0 row to nodata regardless of passing', () => {
    expect(
      readinessState({ passingConditions: 3, totalConditions: 0, formulaUnreadable: false }),
    ).toBe('nodata');
  });
});

describe('readinessState — formula not readable (feature 289)', () => {
  it('maps a marked 0/0 row to unreadable, never nodata', () => {
    expect(
      readinessState({ passingConditions: 0, totalConditions: 0, formulaUnreadable: true }),
    ).toBe('unreadable');
  });

  it('maps a marked row to unreadable even with non-zero counts', () => {
    expect(
      readinessState({ passingConditions: 3, totalConditions: 3, formulaUnreadable: true }),
    ).toBe('unreadable');
    expect(
      readinessState({ passingConditions: 1, totalConditions: 3, formulaUnreadable: true }),
    ).toBe('unreadable');
  });
});

describe('isFiring', () => {
  it('is true only when there is at least one condition and all pass', () => {
    expect(isFiring({ passingConditions: 3, totalConditions: 3 })).toBe(true);
    expect(isFiring({ passingConditions: 2, totalConditions: 3 })).toBe(false);
    expect(isFiring({ passingConditions: 0, totalConditions: 0 })).toBe(false);
  });
});

describe('rollupReadiness', () => {
  const readiness = [
    { symbol: 'AAA', passingConditions: 3, totalConditions: 3, formulaUnreadable: false }, // ready
    { symbol: 'BBB', passingConditions: 1, totalConditions: 3, formulaUnreadable: false }, // watching
    { symbol: 'CCC', passingConditions: 0, totalConditions: 3, formulaUnreadable: false }, // quiet
    { symbol: 'DDD', passingConditions: 0, totalConditions: 0, formulaUnreadable: false }, // nodata (empty readiness)
  ];

  it('buckets each of ready / watching / quiet / nodata', () => {
    const counts = rollupReadiness(readiness, ['AAA', 'BBB', 'CCC', 'DDD']);
    expect(counts).toEqual({ ready: 1, watching: 1, quiet: 1, nodata: 1, unreadable: 0 });
  });

  it('maps a total===0 row to nodata, not quiet', () => {
    const counts = rollupReadiness(
      [{ symbol: 'X', passingConditions: 0, totalConditions: 0, formulaUnreadable: false }],
      ['X'],
    );
    expect(counts.nodata).toBe(1);
    expect(counts.quiet).toBe(0);
  });

  it('sum invariant holds when readiness covers every requested symbol', () => {
    const symbols = ['AAA', 'BBB', 'CCC', 'DDD'];
    const c = rollupReadiness(readiness, symbols);
    expect(c.ready + c.watching + c.quiet + c.nodata + c.unreadable).toBe(symbols.length);
  });

  it('counts a marked 0/0 row as unreadable, not nodata', () => {
    const counts = rollupReadiness(
      [{ symbol: 'MYSZ', passingConditions: 0, totalConditions: 0, formulaUnreadable: true }],
      ['MYSZ'],
    );
    expect(counts.unreadable).toBe(1);
    expect(counts.nodata).toBe(0);
  });

  it('five-bucket sum invariant holds for mixed input with an unreadable row', () => {
    const mixed = [
      ...readiness,
      { symbol: 'MYSZ', passingConditions: 0, totalConditions: 0, formulaUnreadable: true },
    ];
    const symbols = ['AAA', 'BBB', 'CCC', 'DDD', 'MYSZ', 'EEE']; // EEE absent from readiness
    const c = rollupReadiness(mixed, symbols);
    expect(c).toEqual({ ready: 1, watching: 1, quiet: 1, nodata: 2, unreadable: 1 });
    expect(c.ready + c.watching + c.quiet + c.nodata + c.unreadable).toBe(symbols.length);
  });

  it('counts a requested symbol missing from the readiness array as nodata (sum still holds)', () => {
    const symbols = ['AAA', 'BBB', 'CCC', 'DDD', 'EEE']; // EEE absent from readiness
    const c = rollupReadiness(readiness, symbols);
    expect(c.nodata).toBe(2); // DDD (empty) + EEE (missing)
    expect(c.ready + c.watching + c.quiet + c.nodata + c.unreadable).toBe(symbols.length);
  });
});
