import { describe, it, expect } from 'vitest';
import { dataKeyToProtoField, fundamentalsToInputData } from './fundamentalMetrics';

// The 11 canonical FundamentalMetric data-keys (snake_case) and their protobuf-es camelCase field
// names on the marketdata Fundamentals message.
const DATA_KEY_TO_FIELD: Record<string, string> = {
  market_cap: 'marketCap',
  pe_ratio: 'peRatio',
  pb_ratio: 'pbRatio',
  dividend_yield: 'dividendYield',
  eps: 'eps',
  beta: 'beta',
  roe: 'roe',
  debt_to_equity: 'debtToEquity',
  price: 'price',
  year_high: 'yearHigh',
  year_low: 'yearLow',
};

const ALL_KEYS = Object.keys(DATA_KEY_TO_FIELD).map((dataKey) => ({ dataKey }));

describe('dataKeyToProtoField', () => {
  it('maps every canonical data-key to its protobuf-es camelCase field', () => {
    for (const [dataKey, field] of Object.entries(DATA_KEY_TO_FIELD)) {
      expect(dataKeyToProtoField(dataKey)).toBe(field);
    }
  });

  it('leaves a single-word key unchanged', () => {
    expect(dataKeyToProtoField('price')).toBe('price');
  });
});

describe('fundamentalsToInputData', () => {
  it('maps a full row to 11 numeric entries keyed by data-key', () => {
    const row = {
      symbol: 'AAPL',
      marketCap: 3.1e12,
      peRatio: 31.4,
      pbRatio: 48.2,
      dividendYield: 0.005,
      eps: 6.13,
      beta: 1.29,
      roe: 1.47,
      debtToEquity: 1.95,
      price: 192.5,
      yearHigh: 199.6,
      yearLow: 164.1,
      missingMetrics: [],
    };
    const out = fundamentalsToInputData(row, ALL_KEYS);
    expect(Object.keys(out)).toHaveLength(11);
    expect(out.pe_ratio).toBe(31.4);
    expect(out.market_cap).toBe(3.1e12);
    expect(out.year_low).toBe(164.1);
    // A legitimate 0 survives (dividend yield of a non-payer), never coerced to null.
    const zeroed = fundamentalsToInputData({ ...row, dividendYield: 0 }, ALL_KEYS);
    expect(zeroed.dividend_yield).toBe(0);
    for (const v of Object.values(out)) expect(v).not.toBeNaN();
  });

  it('maps metrics in missingMetrics to null (authoritative, not truthiness)', () => {
    const row = {
      symbol: 'NEWCO',
      peRatio: 0, // provider sent 0 but it is actually missing — missingMetrics is authoritative
      roe: 0.22,
      missingMetrics: ['pe_ratio', 'dividend_yield'],
    };
    const out = fundamentalsToInputData(row, [
      { dataKey: 'pe_ratio' },
      { dataKey: 'roe' },
      { dataKey: 'dividend_yield' },
    ]);
    expect(out.pe_ratio).toBeNull();
    expect(out.dividend_yield).toBeNull();
    expect(out.roe).toBe(0.22);
  });

  it('maps absent or non-finite fields to null, never NaN', () => {
    const row = {
      symbol: 'X',
      peRatio: Number.NaN,
      // pb_ratio absent entirely
      missingMetrics: [],
    };
    const out = fundamentalsToInputData(row, [{ dataKey: 'pe_ratio' }, { dataKey: 'pb_ratio' }]);
    expect(out.pe_ratio).toBeNull();
    expect(out.pb_ratio).toBeNull();
    for (const v of Object.values(out)) expect(v).not.toBeNaN();
  });

  it('restricts output to the declared catalog subset', () => {
    const row = { symbol: 'X', peRatio: 12, roe: 0.3, missingMetrics: [] };
    const out = fundamentalsToInputData(row, [{ dataKey: 'pe_ratio' }]);
    expect(Object.keys(out)).toEqual(['pe_ratio']);
  });
});
