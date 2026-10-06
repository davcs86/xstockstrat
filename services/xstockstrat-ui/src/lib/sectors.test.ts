import { describe, it, expect } from 'vitest';
import { Sector } from '@xstockstrat/proto/common/v1/common_pb';
import { OVERRIDABLE_SECTORS, SECTOR_LABEL, liveOverrides, normalizeOverride } from './sectors';

describe('sectors', () => {
  it('labels every Sector and excludes UNSPECIFIED from the overridable list', () => {
    expect(SECTOR_LABEL[Sector.FINANCIALS]).toBe('Financials');
    expect(OVERRIDABLE_SECTORS).toHaveLength(11);
    expect(OVERRIDABLE_SECTORS).not.toContain(Sector.UNSPECIFIED);
  });

  it('drops overrides whose component or param no longer exists', () => {
    const comps = [{ refName: 'fscore', params: { de_bad: 2 } }];
    const keep = { componentRef: 'fscore', paramName: 'de_bad', defaultValue: 2, bySector: [] };
    const stale = { ...keep, paramName: 'gone' };
    const orphan = { ...keep, componentRef: 'removed' };
    expect(liveOverrides([keep, stale, orphan], comps)).toEqual([keep]);
  });

  it('dedupes sectors (last wins) and drops non-finite / UNSPECIFIED entries', () => {
    const out = normalizeOverride({
      componentRef: 'c',
      paramName: 'p',
      defaultValue: 1,
      bySector: [
        { sector: Sector.FINANCIALS, value: 5 },
        { sector: Sector.FINANCIALS, value: 12 },
        { sector: Sector.UNSPECIFIED, value: 3 },
        { sector: Sector.ENERGY, value: Number.NaN },
      ],
    });
    expect(out.bySector).toEqual([{ sector: Sector.FINANCIALS, value: 12 }]);
  });
});
