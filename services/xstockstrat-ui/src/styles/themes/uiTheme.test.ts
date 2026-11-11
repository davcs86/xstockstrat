import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const req = createRequire(import.meta.url);
const ui = req('./uiTheme.cjs') as {
  resolveUiTheme: (v: string | undefined) => string;
  parseRootTokens: (css: string) => Map<string, string>;
  cssDeclarations: (css: string) => { name: string; value: string; valueOffset: number }[];
  colorLiterals: (value: string, valueOffset?: number) => { text: string; offset: number }[];
  cssColorToSrgb: (text: string, where?: string) => { r: number; g: number; b: number; a: number };
  relativeLuminance: (c: { r: number; g: number; b: number }) => number;
  contrastRatio: (x: string, y: string) => number;
  colorsEqual: (x: string, y: string) => boolean;
};

const texts = (value: string) => ui.colorLiterals(value).map((l) => l.text);

describe('resolveUiTheme', () => {
  it('defaults an unset theme to staging', () => {
    expect(ui.resolveUiTheme(undefined)).toBe('staging');
  });
  it('passes the two allowed themes through', () => {
    expect(ui.resolveUiTheme('staging')).toBe('staging');
    expect(ui.resolveUiTheme('production')).toBe('production');
  });
  it.each(['', 'prod', 'Production'])('rejects %j naming both allowed values', (v) => {
    expect(() => ui.resolveUiTheme(v)).toThrow(/"staging".*"production"/);
  });
});

describe('cssColorToSrgb', () => {
  it('parses oklch with numeric, percentage and leading-dot lightness identically', () => {
    const a = ui.cssColorToSrgb('oklch(0.63 0.16 262)');
    expect(ui.colorsEqual('oklch(63% 0.16 262)', 'oklch(0.63 0.16 262)')).toBe(true);
    expect(ui.colorsEqual('oklch(.63 .16 262)', 'oklch(0.63 0.16 262)')).toBe(true);
    expect(a.a).toBe(1);
  });
  it('reads alpha given as a number and as a percentage', () => {
    expect(ui.cssColorToSrgb('oklch(1 0 0 / 10%)').a).toBeCloseTo(0.1, 5);
    expect(ui.cssColorToSrgb('oklch(1 0 0 / .1)').a).toBeCloseTo(0.1, 5);
    expect(ui.cssColorToSrgb('rgb(0 0 0/.1)').a).toBeCloseTo(0.1, 5);
    expect(ui.cssColorToSrgb('#ffffff1a').a).toBeCloseTo(0x1a / 255, 5);
  });
  it('parses hex, rgb and hsl forms to the same channels', () => {
    expect(ui.colorsEqual('#fff', 'rgb(255, 255, 255)')).toBe(true);
    expect(ui.colorsEqual('#0000', 'rgba(0,0,0,0)')).toBe(true);
    expect(ui.colorsEqual('hsl(0 0% 100%)', '#ffffff')).toBe(true);
    expect(ui.colorsEqual('hsla(120deg, 100%, 25%, 1)', '#008000')).toBe(true);
  });
  it('matches known Nocturne oklch values to their sRGB hex', () => {
    expect(ui.colorsEqual('oklch(0.147 0.004 49.25)', '#0c0a09')).toBe(true);
  });
  it.each(['lab(50% 0 0)', 'lch(50% 0 0)', 'oklab(0.5 0 0)', 'hwb(0 0% 0%)', 'color(srgb 1 0 0)'])(
    'fails closed on unsupported syntax %s',
    (v) => {
      expect(() => ui.cssColorToSrgb(v, 'a.css:7')).toThrow('unsupported colour syntax at a.css:7');
    },
  );
  it('clamps an out-of-gamut colour per channel instead of overflowing', () => {
    const c = ui.cssColorToSrgb('oklch(0.795 0.184 86.047)');
    for (const ch of [c.r, c.g, c.b]) {
      expect(ch).toBeGreaterThanOrEqual(0);
      expect(ch).toBeLessThanOrEqual(255);
    }
    expect(Math.round(c.b)).toBe(0);
  });
});

describe('colorsEqual and contrast', () => {
  it('treats opaque white and 10%-alpha white as different colours', () => {
    expect(ui.colorsEqual('#fff', 'oklch(1 0 0 / 10%)')).toBe(false);
  });
  it('tolerates ±1 per channel but not ±2', () => {
    expect(ui.colorsEqual('rgb(10 20 30)', 'rgb(11 19 31)')).toBe(true);
    expect(ui.colorsEqual('rgb(10 20 30)', 'rgb(12 20 30)')).toBe(false);
  });
  it('computes WCAG contrast (black on white is 21:1)', () => {
    expect(ui.contrastRatio('#000', '#fff')).toBeCloseTo(21, 5);
    expect(ui.relativeLuminance(ui.cssColorToSrgb('#fff'))).toBeCloseTo(1, 5);
  });
});

describe('colorLiterals tokenizer', () => {
  it.each([
    ['hsl(var(--x))', []],
    ['rgb(var(--x) / .5)', []],
    ['oklch(from var(--x) l c h)', []],
    ['color-mix(in oklch, var(--a), var(--b) 5%)', []],
    ['color-mix(in oklab, #fff 10%, transparent)', ['#fff']],
    [
      'color-mix(in srgb, color-mix(in oklab, oklch(0.5 0.1 200) 50%, var(--x)), #000)',
      ['oklch(0.5 0.1 200)', '#000'],
    ],
    ['var(--tw-shadow-color, rgb(0 0 0/.1))', ['rgb(0 0 0/.1)']],
    ['0 0 #0000', ['#0000']],
    ["'#fff'", []],
    ['url(#fff)', []],
    ['a\\#ccc', []],
    ['#ffffff1a', ['#ffffff1a']],
    ['transparent', []],
    ['currentcolor', []],
    ['red', []],
  ])('%s → %j', (value, expected) => {
    expect(texts(value)).toEqual(expected);
  });
  it('reports byte offsets relative to the value offset', () => {
    expect(ui.colorLiterals('0 0 #0000', 100)).toEqual([{ text: '#0000', offset: 104 }]);
  });
});

describe('cssDeclarations', () => {
  it('blanks comments, including colour text inside them', () => {
    const decls = ui.cssDeclarations('/* oklch(1 0 0 / 10%) */ :root{--a:#fff}');
    expect(decls.map((d) => [d.name, d.value])).toEqual([['--a', '#fff']]);
  });
  it('never scans selectors', () => {
    const css = ".x\\[stroke\\=\\'\\#ccc\\'\\]{color:red}[stroke='#fff']{fill:none}";
    const values = ui.cssDeclarations(css).map((d) => d.value);
    expect(values).toEqual(['red', 'none']);
    expect(values.flatMap(texts)).toEqual([]);
  });
  it('skips @supports preludes but scans the declarations inside them', () => {
    const css = '@supports (color: color-mix(in lab, red, red)){.a{color:#123456}}';
    const decls = ui.cssDeclarations(css);
    expect(decls.map((d) => d.value)).toEqual(['#123456']);
  });
  it('scans @property initial-value like any other declaration', () => {
    const decls = ui.cssDeclarations('@property --x{syntax:"*";inherits:false;initial-value:#fff}');
    expect(decls.find((d) => d.name === 'initial-value')?.value).toBe('#fff');
  });
  it('strips !important', () => {
    expect(ui.cssDeclarations('.a{color:#fff!important}')[0].value).toBe('#fff');
    expect(ui.cssDeclarations('.a{color:#fff !important}')[0].value).toBe('#fff');
  });
  it('reports the byte offset of each value', () => {
    const css = '.a{color:#fff}';
    const [d] = ui.cssDeclarations(css);
    expect(css.slice(d.valueOffset, d.valueOffset + d.value.length)).toBe('#fff');
  });
});

describe('parseRootTokens', () => {
  it('maps every custom property of a single :root block', () => {
    const map = ui.parseRootTokens(
      ':root {\n  --a: #fff;\n  /* c */\n  --b: oklch(1 0 0 / 10%);\n}\n',
    );
    expect([...map.entries()]).toEqual([
      ['--a', '#fff'],
      ['--b', 'oklch(1 0 0 / 10%)'],
    ]);
  });
});
