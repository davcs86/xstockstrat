import { describe, it, expect } from 'vitest';
import { BUILTIN_INDICATORS } from './strategyCatalog';

const MISLEADING_NAMES = ['Average True Range', 'Volume Weighted Average Price'];

describe('BUILTIN_INDICATORS descriptions', () => {
  it.each(MISLEADING_NAMES)('no entry describes itself as %s', (name) => {
    const offenders = BUILTIN_INDICATORS.filter((i) => i.description.includes(name));
    expect(offenders.map((i) => i.name)).toEqual([]);
  });

  it.each(['ATR', 'VWAP'])('keeps the %s entry key', (key) => {
    expect(BUILTIN_INDICATORS.some((i) => i.name === key)).toBe(true);
  });
});
