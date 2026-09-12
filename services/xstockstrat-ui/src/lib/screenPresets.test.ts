import { describe, it, expect } from 'vitest';
import { ScreenKind, Comparator } from '@xstockstrat/proto/analysis/v1/analysis_pb';
import { SCREEN_PRESETS } from './screenPresets';
import { FUNDAMENTAL_METRICS, BUILTIN_INDICATORS } from './strategyCatalog';

const fundamentalNames = new Set(FUNDAMENTAL_METRICS.map((m) => m.name));
const indicatorNames = new Set(BUILTIN_INDICATORS.map((i) => i.name));
const validComparators = new Set([Comparator.LT, Comparator.LTE, Comparator.GT, Comparator.GTE]);

describe('SCREEN_PRESETS', () => {
  it('has at least one preset', () => {
    expect(SCREEN_PRESETS.length).toBeGreaterThanOrEqual(1);
  });

  it.each(SCREEN_PRESETS.map((p) => [p.id, p]))('%s has non-empty criteria', (_id, preset) => {
    expect(preset.criteria.length).toBeGreaterThan(0);
  });

  it.each(SCREEN_PRESETS.map((p) => [p.id, p]))(
    '%s has required fields (name, description, id)',
    (_id, preset) => {
      expect(preset.id).toBeTruthy();
      expect(preset.name).toBeTruthy();
      expect(preset.description).toBeTruthy();
    },
  );

  it.each(SCREEN_PRESETS.map((p) => [p.id, p]))(
    '%s criteria reference valid catalog entries',
    (_id, preset) => {
      for (const c of preset.criteria) {
        if (c.kind === ScreenKind.FUNDAMENTAL) {
          expect(fundamentalNames).toContain(c.metricName);
        } else if (c.kind === ScreenKind.TECHNICAL_INDICATOR) {
          expect(indicatorNames).toContain(c.metricName);
        }
      }
    },
  );

  it.each(SCREEN_PRESETS.map((p) => [p.id, p]))(
    '%s criteria have valid field types',
    (_id, preset) => {
      for (const c of preset.criteria) {
        expect(typeof c.refName).toBe('string');
        expect([ScreenKind.FUNDAMENTAL, ScreenKind.TECHNICAL_INDICATOR]).toContain(c.kind);
        expect(typeof c.metricName).toBe('string');
        expect(validComparators).toContain(c.op);
        expect(typeof c.threshold).toBe('number');
        expect(typeof c.weight).toBe('number');
        expect(typeof c.hardFilter).toBe('boolean');
      }
    },
  );

  it('Fundamentals Signal has exactly 5 rows with the expected metrics', () => {
    const fs = SCREEN_PRESETS.find((p) => p.id === 'fundamentals-signal');
    expect(fs).toBeDefined();
    expect(fs!.criteria).toHaveLength(5);
    const metrics = fs!.criteria.map((c) => c.metricName);
    expect(metrics).toEqual(['pe_ratio', 'pb_ratio', 'roe', 'debt_to_equity', 'eps']);
  });

  it('Fundamentals Signal eps row is a hard filter', () => {
    const fs = SCREEN_PRESETS.find((p) => p.id === 'fundamentals-signal')!;
    const eps = fs.criteria.find((c) => c.metricName === 'eps')!;
    expect(eps.hardFilter).toBe(true);
    expect(eps.op).toBe(Comparator.GT);
    expect(eps.threshold).toBe(0);
  });
});
