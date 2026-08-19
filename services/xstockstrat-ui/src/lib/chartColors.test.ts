import { describe, expect, it } from 'vitest';
import {
  CHART_COLOR_TOKENS,
  CHART_GRID_TOKEN,
  isCanvasSafeColor,
  resolveChartColor,
} from './chartColors';

// Node/vitest env only — `document`/`getComputedStyle` are absent, so the live oklch→rgb probe
// inside resolveChartColor cannot run here. These tests cover the PURE branches (canvas-safe
// detection, token constants, the grid-token choice, the SSR/no-document fallback). The probe's
// real oklch→rgb resolution is proven in Step 8's diagnosed chromium run (canvas fills aren't
// DOM-inspectable, so a node test physically cannot reach them).
describe('isCanvasSafeColor', () => {
  it('treats hsl / rgb / hex as canvas-safe (pass through unchanged)', () => {
    expect(isCanvasSafeColor('hsl(159 52% 54%)')).toBe(true);
    expect(isCanvasSafeColor('rgb(20, 30, 40)')).toBe(true);
    expect(isCanvasSafeColor('#1e293b')).toBe(true);
  });

  it('treats oklch / oklab / lab / lch as NOT canvas-safe (need probe resolution)', () => {
    expect(isCanvasSafeColor('oklch(0.869 0.005 56.366)')).toBe(false);
    expect(isCanvasSafeColor('oklab(0.4 0 0)')).toBe(false);
    expect(isCanvasSafeColor('lab(50% 40 59.5)')).toBe(false);
    expect(isCanvasSafeColor(' OKLCH(0.5 0 0) ')).toBe(false); // trims + case-insensitive
  });
});

describe('CHART_GRID_TOKEN', () => {
  it('is the dedicated visible grid token, not the 10%-alpha --border', () => {
    expect(CHART_GRID_TOKEN).toBe('--chart-grid');
    expect(CHART_GRID_TOKEN).not.toBe('--border');
  });
});

describe('CHART_COLOR_TOKENS', () => {
  it('lists the custom properties the unified chart surfaces consume', () => {
    expect([...CHART_COLOR_TOKENS]).toEqual(
      expect.arrayContaining([
        '--chart-1',
        '--chart-2',
        '--chart-3',
        '--chart-4',
        '--chart-5',
        '--muted-foreground',
        '--chart-grid',
        '--color-buy',
        '--color-sell',
      ]),
    );
  });
});

describe('resolveChartColor', () => {
  it('returns the documented fallback when there is no document (node/SSR) instead of throwing', () => {
    expect(resolveChartColor('--chart-1', '#abcdef')).toBe('#abcdef');
    expect(resolveChartColor('--color-buy', 'hsl(159 52% 54%)')).toBe('hsl(159 52% 54%)');
  });
});
