import { describe, expect, it } from 'vitest';
import { timestampToDate, timestampToMillis } from './protoTime';

describe('timestampToMillis', () => {
  it('converts seconds + nanos to epoch millis', () => {
    expect(timestampToMillis({ seconds: 1_700_000_000, nanos: 500_000_000 })).toBe(
      1_700_000_000_500,
    );
  });

  it('accepts bigint seconds (generated ts-proto shape)', () => {
    expect(timestampToMillis({ seconds: BigInt(1_700_000_000), nanos: 0 })).toBe(1_700_000_000_000);
  });

  it('defaults missing nanos to 0', () => {
    expect(timestampToMillis({ seconds: 10 })).toBe(10_000);
  });

  it('passes undefined through', () => {
    expect(timestampToMillis(undefined)).toBeUndefined();
  });
});

describe('timestampToDate', () => {
  it('converts to a Date', () => {
    const d = timestampToDate({ seconds: BigInt(1_700_000_000), nanos: 0 });
    expect(d).toBeInstanceOf(Date);
    expect(d?.getTime()).toBe(1_700_000_000_000);
  });

  it('passes undefined through', () => {
    expect(timestampToDate(undefined)).toBeUndefined();
  });
});
