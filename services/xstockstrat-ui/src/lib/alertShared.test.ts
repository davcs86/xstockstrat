import { describe, expect, it } from 'vitest';
import { contextEntries, formatWhen } from './alertShared';

describe('contextEntries', () => {
  it('shows a string value as is (@AC-1)', () => {
    expect(contextEntries({ job_id: '67276d1f' })).toEqual([{ key: 'job_id', value: '67276d1f' }]);
  });

  it('shows a list as JSON', () => {
    expect(contextEntries({ failed_symbols: ['AAPL', 'TSLA'] })).toEqual([
      { key: 'failed_symbols', value: '["AAPL","TSLA"]' },
    ]);
  });

  it('shows a number as JSON', () => {
    expect(contextEntries({ attempts: 3 })).toEqual([{ key: 'attempts', value: '3' }]);
  });

  it('gives no rows for an empty or missing context', () => {
    expect(contextEntries({})).toEqual([]);
    expect(contextEntries(undefined)).toEqual([]);
  });

  it('keeps insertion order', () => {
    expect(contextEntries({ c: '1', a: '2', b: '3' }).map((e) => e.key)).toEqual(['c', 'a', 'b']);
  });
});

describe('formatWhen', () => {
  it('gives an empty string for a missing timestamp', () => {
    expect(formatWhen(undefined)).toBe('');
  });

  it('formats a bigint-seconds timestamp as a local date-time', () => {
    expect(formatWhen({ seconds: BigInt(1_763_200_000), nanos: 0 })).toBe(
      new Date(1_763_200_000_000).toLocaleString(),
    );
  });
});
