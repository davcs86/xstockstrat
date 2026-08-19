import { describe, expect, it } from 'vitest';
import { CHART_COLOR_TOKENS, CHART_GRID_TOKEN, resolveChartColor } from './chartColors';

// Node/vitest env only — `document`/`getComputedStyle` are absent, so the live oklch→rgb canvas
// conversion inside resolveChartColor cannot run here. These tests cover the PURE branches (token
// constants, the grid-token choice, the SSR/no-document fallback). The 1×1-canvas pixel read-back
// conversion is proven in a real browser (the feature's diagnosed chromium run / CI e2e) — a canvas
// fill is not DOM-inspectable, so a node test physically cannot reach it.
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
    expect(resolveChartColor('--chart-1', 'rgb(1, 2, 3)')).toBe('rgb(1, 2, 3)');
    expect(resolveChartColor('--color-buy', 'green')).toBe('green');
  });
});
