import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SERIES_PALETTE } from '../../lib/seriesPalette';

type Srgb = { r: number; g: number; b: number; a: number };
const req = createRequire(import.meta.url);
const ui = req('./uiTheme.cjs') as {
  parseRootTokens: (css: string) => Map<string, string>;
  cssDeclarations: (css: string) => { name: string; value: string }[];
  contrastRatio: (x: string, y: string) => number;
  colorsEqual: (x: string | Srgb, y: string | Srgb) => boolean;
};
const cv = req('./colorVision.cjs') as {
  pairDistances: (
    colors: string[],
    sim: 'deuteranopia' | 'protanopia' | 'normal',
  ) => { i: number; j: number; adjacent: boolean; dE: number }[];
};
const bundle = req('./checkThemeBundle.cjs') as {
  nonSharedTokens: (t: {
    staging: Map<string, string>;
    production: Map<string, string>;
  }) => { theme: string; name: string; color: Srgb }[];
};
const SERIES_TOKENS = SERIES_PALETTE.map((p) => p.token);

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const stagingCss = read('./staging.css');
const productionCss = read('./production.css');
const staging = ui.parseRootTokens(stagingCss);
const production = ui.parseRootTokens(productionCss);
const GOVERNANCE = '../../../../../docs/patterns/ui-ux-governance.md';

// Nocturne `:root` from globals.css:88-124 at 9eaf04f, before the split (FR-3: frozen).
const NOCTURNE: [string, string][] = [
  ['--background', 'oklch(0.147 0.004 49.25)'],
  ['--foreground', 'oklch(0.985 0.001 106.423)'],
  ['--card', 'oklch(0.216 0.006 56.043)'],
  ['--card-foreground', 'oklch(0.985 0.001 106.423)'],
  ['--popover', 'oklch(0.216 0.006 56.043)'],
  ['--popover-foreground', 'oklch(0.985 0.001 106.423)'],
  ['--primary', 'oklch(0.432 0.095 166.913)'],
  ['--primary-foreground', 'oklch(0.979 0.021 166.113)'],
  ['--secondary', 'oklch(0.274 0.006 286.033)'],
  ['--secondary-foreground', 'oklch(0.985 0 0)'],
  ['--muted', 'oklch(0.268 0.007 34.298)'],
  ['--muted-foreground', 'oklch(0.709 0.01 56.259)'],
  ['--accent', 'oklch(0.268 0.007 34.298)'],
  ['--accent-foreground', 'oklch(0.985 0.001 106.423)'],
  ['--destructive', 'oklch(0.704 0.191 22.216)'],
  ['--border', 'oklch(1 0 0 / 10%)'],
  ['--input', 'oklch(1 0 0 / 15%)'],
  ['--ring', 'oklch(0.553 0.013 58.071)'],
  ['--radius', '0.45rem'],
  ['--chart-1', 'oklch(0.869 0.005 56.366)'],
  ['--chart-2', 'oklch(0.553 0.013 58.071)'],
  ['--chart-3', 'oklch(0.444 0.011 73.639)'],
  ['--chart-4', 'oklch(0.374 0.01 67.558)'],
  ['--chart-5', 'oklch(0.268 0.007 34.298)'],
  ['--chart-grid', 'oklch(0.42 0.01 56.043 / 0.55)'],
  ['--sidebar', 'oklch(0.216 0.006 56.043)'],
  ['--sidebar-foreground', 'oklch(0.985 0.001 106.423)'],
  ['--sidebar-primary', 'oklch(0.696 0.17 162.48)'],
  ['--sidebar-primary-foreground', 'oklch(0.262 0.051 172.552)'],
  ['--sidebar-accent', 'oklch(0.268 0.007 34.298)'],
  ['--sidebar-accent-foreground', 'oklch(0.985 0.001 106.423)'],
  ['--sidebar-border', 'oklch(1 0 0 / 10%)'],
  ['--sidebar-ring', 'oklch(0.553 0.013 58.071)'],
];

type Pair = { fg: string; bg: string; min: number };
const text = (fg: string, bg: string): Pair => ({ fg, bg, min: 4.5 });
const nonText = (fg: string, bg: string): Pair => ({ fg, bg, min: 3 });
// ui-ux-governance.md §5 item 8: the documented contrast baseline.
const PAIRS: Pair[] = [
  text('foreground', 'background'),
  ...[
    'card',
    'popover',
    'primary',
    'secondary',
    'muted',
    'accent',
    'sidebar',
    'sidebar-primary',
    'sidebar-accent',
  ].map((x) => text(`${x}-foreground`, x)),
  ...['primary', 'muted-foreground', 'destructive'].flatMap((x) => [
    text(x, 'background'),
    text(x, 'card'),
  ]),
  nonText('ring', 'background'),
  ...[1, 2, 3, 4, 5].flatMap((n) => [
    nonText(`chart-${n}`, 'card'),
    nonText(`chart-${n}`, 'background'),
  ]),
  ...SERIES_TOKENS.flatMap((t) => [nonText(t.slice(2), 'card'), nonText(t.slice(2), 'background')]),
];
const ratio = (tokens: Map<string, string>, p: Pair) =>
  ui.contrastRatio(tokens.get(`--${p.fg}`)!, tokens.get(`--${p.bg}`)!);
const label = (p: Pair) => `${p.fg}/${p.bg}`;

describe('theme files', () => {
  it.each([
    ['staging', stagingCss],
    ['production', productionCss],
  ])('%s.css is exactly one :root block of custom properties', (_name, css) => {
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(stripped.match(/\{/g)).toHaveLength(1);
    expect(stripped.trim().startsWith(':root')).toBe(true);
    expect(ui.cssDeclarations(css).every((d) => d.name.startsWith('--'))).toBe(true);
  });
  it('declares the same token names in both themes', () => {
    expect([...production.keys()].sort()).toEqual([...staging.keys()].sort());
  });
  it('keeps the staging Nocturne tokens byte-identical (AC-2, FR-3; feature 342 AC-1)', () => {
    expect([...staging.entries()].filter(([k]) => !SERIES_TOKENS.includes(k))).toEqual(NOCTURNE);
  });
  it('declares exactly the Nocturne tokens plus the 12 series tokens in staging', () => {
    expect([...staging.keys()].sort()).toEqual(
      [...NOCTURNE.map(([k]) => k), ...SERIES_TOKENS].sort(),
    );
  });
  it('keeps the shared order-side colours out of both theme files (FR-5)', () => {
    for (const tokens of [staging, production]) {
      for (const role of ['buy', 'sell', 'paper', 'warning'])
        expect(tokens.has(`--color-${role}`)).toBe(false);
    }
  });
  it('gives production a different background from staging', () => {
    expect(ui.colorsEqual(production.get('--background')!, staging.get('--background')!)).toBe(
      false,
    );
  });
});

describe('production contrast', () => {
  it('pins the AC-8 ratios', () => {
    expect(ratio(production, text('foreground', 'background'))).toBeCloseTo(18.07, 1);
    expect(
      Math.abs(ratio(production, text('foreground', 'background')) - 18.07),
    ).toBeLessThanOrEqual(0.05);
    expect(
      Math.abs(ratio(production, text('primary-foreground', 'primary')) - 5.46),
    ).toBeLessThanOrEqual(0.05);
  });
  it.each(PAIRS.map((p) => [label(p), p] as const))('%s meets the baseline (AC-14)', (_l, p) => {
    expect(ratio(production, p)).toBeGreaterThanOrEqual(p.min);
  });
  it('contains no Nocturne primary anywhere (AC-1)', () => {
    for (const v of production.values()) {
      if (v.startsWith('oklch'))
        expect(ui.colorsEqual(v, 'oklch(0.432 0.095 166.913)')).toBe(false);
    }
  });
});

describe('staging contrast deviations (AC-17)', () => {
  const doc = read(GOVERNANCE);
  const begin = doc.indexOf('<!-- 307:staging-contrast-deviations:begin -->');
  const end = doc.indexOf('<!-- 307:staging-contrast-deviations:end -->');

  it('documents the frozen staging deviations in ui-ux-governance.md §5', () => {
    expect(begin, `${GOVERNANCE}: missing begin fence`).toBeGreaterThan(-1);
    expect(end, `${GOVERNANCE}: missing end fence`).toBeGreaterThan(begin);
    expect(doc).toContain('frozen per feature 307 FR-3');
  });

  it('lists exactly the staging pairs below the baseline, with their ratios', () => {
    const startLine = doc.slice(0, begin).split('\n').length;
    const listed = new Map<string, string>();
    doc
      .slice(begin, end)
      .split('\n')
      .slice(1)
      .forEach((line, i) => {
        if (line.trim() === '') return;
        const m = /^- ([a-z0-9-]+)\/([a-z0-9-]+): ([0-9]+\.[0-9])$/.exec(line);
        expect(
          m,
          `${GOVERNANCE}:${startLine + i + 1}: expected '- <fg>/<bg>: <ratio>'`,
        ).not.toBeNull();
        listed.set(`${m![1]}/${m![2]}`, m![3]);
      });
    const failing = new Map(
      PAIRS.filter((p) => ratio(staging, p) < p.min).map((p) => [
        label(p),
        ratio(staging, p).toFixed(1),
      ]),
    );
    expect(Object.fromEntries(listed)).toEqual(Object.fromEntries(failing));
  });
});

describe('series palette (feature 342)', () => {
  const THEMES = [
    ['staging', staging],
    ['production', production],
  ] as const;
  const values = SERIES_TOKENS.map((t) => staging.get(t)!);

  it.each(THEMES)('%s defines exactly 12 series tokens (AC-1)', (_name, tokens) => {
    const declared = [...tokens.keys()].filter((k) => k.startsWith('--series-'));
    expect(declared).toEqual(SERIES_TOKENS);
    expect(declared).toHaveLength(12);
  });

  it('keeps every series token equal across themes', () => {
    // Equal values keep the series tokens outside check (b) (checkThemeBundle.cjs nonSharedTokens)
    // and keep feature-307 @AC-2 true.
    for (const t of SERIES_TOKENS)
      expect(ui.colorsEqual(staging.get(t)!, production.get(t)!), t).toBe(true);
  });

  it.each(THEMES)('%s series colours meet 3:1 on card and background (AC-4)', (_name, tokens) => {
    for (const t of SERIES_TOKENS) {
      for (const bg of ['--card', '--background'])
        expect(
          ui.contrastRatio(tokens.get(t)!, tokens.get(bg)!),
          `${t}/${bg}`,
        ).toBeGreaterThanOrEqual(3);
    }
  });

  it.each([
    ['deuteranopia', true, 10],
    ['protanopia', true, 10],
    ['deuteranopia', false, 5],
    ['protanopia', false, 5],
    ['normal', null, 10],
  ] as const)('%s pairs (adjacent: %s) differ by at least %s (AC-5)', (sim, adjacent, floor) => {
    const rows = cv
      .pairDistances(values, sim)
      .filter((r) => adjacent === null || r.adjacent === adjacent);
    const worst = rows.reduce((a, b) => (b.dE < a.dE ? b : a));
    expect(
      worst.dE,
      `worst pair ${worst.i}-${worst.j}: dE ${worst.dE.toFixed(2)} under ${sim}`,
    ).toBeGreaterThanOrEqual(floor);
  });

  it('no series colour equals a theme-specific token', () => {
    const N = bundle.nonSharedTokens({ staging, production });
    for (const v of values) {
      for (const n of N)
        expect(ui.colorsEqual(v, n.color), `${v} vs ${n.theme} ${n.name}`).toBe(false);
    }
  });
});
