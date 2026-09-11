import { describe, expect, it } from 'vitest';
import { timestampToDate, timestampToMillis, fmtShortDate, selectOhlcBar } from './protoTime';

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

describe('fmtShortDate', () => {
  it('formats UTC midnight as "Mon D"', () => {
    // 2026-09-10T00:00:00Z
    expect(fmtShortDate(new Date(Date.UTC(2026, 8, 10)))).toBe('Sep 10');
  });

  it('single-digit day, no leading zero', () => {
    expect(fmtShortDate(new Date(Date.UTC(2026, 0, 1)))).toBe('Jan 1');
  });

  it('uses UTC — a date that would render as previous day in negative-offset zones', () => {
    // 2026-06-15T00:00:00Z — in America/New_York (UTC-4 in summer) this is still June 14 local
    const d = new Date(Date.UTC(2026, 5, 15));
    expect(fmtShortDate(d)).toBe('Jun 15');
  });
});

describe('selectOhlcBar', () => {
  const mkBar = (dateStr: string, o: number, h: number, l: number, c: number) => ({
    time: { seconds: BigInt(new Date(dateStr).getTime() / 1000), nanos: 0 },
    open: o,
    high: h,
    low: l,
    close: c,
  });

  it('returns undefined for empty bars', () => {
    expect(selectOhlcBar([])).toBeUndefined();
  });

  it('returns the single completed bar when date != today', () => {
    const bar = mkBar('2026-09-09T00:00:00Z', 100, 105, 98, 102);
    const now = new Date('2026-09-10T15:00:00Z');
    const result = selectOhlcBar([bar], now);
    expect(result).toEqual({ date: expect.any(Date), open: 100, high: 105, low: 98, close: 102 });
    expect(result!.date.toISOString()).toBe('2026-09-09T00:00:00.000Z');
  });

  it('skips today bar and returns previous bar', () => {
    const yesterday = mkBar('2026-09-09T00:00:00Z', 100, 105, 98, 102);
    const today = mkBar('2026-09-10T00:00:00Z', 103, 106, 101, 104);
    const now = new Date('2026-09-10T18:30:00Z');
    const result = selectOhlcBar([yesterday, today], now);
    expect(result).toEqual({ date: expect.any(Date), open: 100, high: 105, low: 98, close: 102 });
  });

  it('returns most recent bar when neither is today', () => {
    const older = mkBar('2026-09-08T00:00:00Z', 90, 95, 88, 92);
    const newer = mkBar('2026-09-09T00:00:00Z', 100, 105, 98, 102);
    const now = new Date('2026-09-10T12:00:00Z');
    const result = selectOhlcBar([older, newer], now);
    expect(result!.open).toBe(100);
  });

  it('skips bar with missing time', () => {
    const noTime = { open: 1, high: 2, low: 0, close: 1 };
    const good = mkBar('2026-09-09T00:00:00Z', 100, 105, 98, 102);
    const now = new Date('2026-09-10T12:00:00Z');
    const result = selectOhlcBar([good, noTime], now);
    expect(result!.open).toBe(100);
  });

  it('returns undefined when all bars are today', () => {
    const today = mkBar('2026-09-10T00:00:00Z', 103, 106, 101, 104);
    const now = new Date('2026-09-10T09:00:00Z');
    expect(selectOhlcBar([today], now)).toBeUndefined();
  });
});
