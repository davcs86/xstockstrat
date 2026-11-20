import { describe, expect, it } from 'vitest';
import { SERIES_PALETTE } from './seriesPalette';

describe('SERIES_PALETTE', () => {
  it('lists --series-1 … --series-12 in order with 12 distinct fallbacks', () => {
    expect(SERIES_PALETTE).toHaveLength(12);
    expect(SERIES_PALETTE.map((p) => p.token)).toEqual(
      Array.from({ length: 12 }, (_, i) => `--series-${i + 1}`),
    );
    expect(new Set(SERIES_PALETTE.map((p) => p.fallback)).size).toBe(12);
  });
});
