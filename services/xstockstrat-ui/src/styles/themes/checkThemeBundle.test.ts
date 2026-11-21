import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

type Sources = { globalsCss: string; stagingCss: string; productionCss: string };
const req = createRequire(import.meta.url);
const { checkBundle, loadSources } = req('./checkThemeBundle.cjs') as {
  checkBundle: (
    cssFiles: { file: string; css: string }[],
    theme: string,
    sources: Sources,
  ) => string[];
  loadSources: () => Sources;
};
const ui = req('./uiTheme.cjs') as {
  parseRootTokens: (css: string) => Map<string, string>;
  cssColorToSrgb: (text: string) => { r: number; g: number; b: number; a: number };
};

const SCRIPT = fileURLToPath(new URL('./checkThemeBundle.cjs', import.meta.url));
const sources = loadSources();
const THEMES = ['staging', 'production'] as const;
type Theme = (typeof THEMES)[number];
const tokens: Record<Theme, Map<string, string>> = {
  staging: ui.parseRootTokens(sources.stagingCss),
  production: ui.parseRootTokens(sources.productionCss),
};

// Palette names are assembled at runtime: a literal one in scanned source would emit palette CSS.
const pal = (family: string, n: number) => ['--color', family, String(n)].join('-');

const SHARED: Record<string, string> = {
  buy: 'hsl(159 52% 54%)',
  sell: 'hsl(359 63% 67%)',
  paper: 'hsl(43 41% 64%)',
  warning: 'hsl(43 41% 64%)',
};
const sharedCss = (over: Record<string, string | null> = {}) =>
  ':root,:host{' +
  Object.entries({ ...SHARED, ...over })
    .filter(([, v]) => v !== null)
    .map(([k, v]) => ['--color', k].join('-') + ':' + v)
    .join(';') +
  '}';
const rootCss = (theme: Theme, omit: string[] = []) =>
  ':root{' +
  [...tokens[theme]]
    .filter(([k]) => !omit.includes(k))
    .map(([k, v]) => `${k}:${v}`)
    .join(';') +
  '}';
/** A complete, valid bundle for `theme` with `extra` CSS appended. */
const bundle = (theme: Theme, extra = '', root = rootCss(theme)) => root + sharedCss() + extra;
const check = (theme: Theme, css: string) => checkBundle([{ file: 'a.css', css }], theme, sources);
const bLine = (css: string, literal: string, theme: Theme, token: string) =>
  `colour literal ${literal} at a.css:${css.lastIndexOf(literal)} equals ${theme} ${token}; use the theme token`;

const run = (cwd: string, args: string[] = []) =>
  spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, UI_THEME: 'staging' },
  });

describe('valid bundles', () => {
  it.each(THEMES)(
    'a %s bundle with its own tokens and the shared colours passes (AC-2/AC-3)',
    (theme) => {
      expect(check(theme, bundle(theme))).toEqual([]);
    },
  );
});

describe('check (c): shared order-side colours (AC-5)', () => {
  it('fails when a shared role is not emitted', () => {
    const css = rootCss('production') + sharedCss({ warning: null });
    expect(check('production', css).join('\n')).toMatch(/--color-warning/);
  });
  it('fails when a shared role is off by 2 per channel', () => {
    const css = rootCss('staging') + sharedCss({ buy: 'rgb(79 201 158)' });
    expect(check('staging', css).join('\n')).toMatch(/--color-buy/);
  });
  it('ignores a var() self-map as long as one literal declaration matches', () => {
    const name = ['--color', 'buy'].join('-');
    expect(check('staging', bundle('staging', `:root{${name}:var(${name})}`))).toEqual([]);
  });
});

describe('check (a): selected token values', () => {
  it.each(THEMES)(
    'skips arbitrary-property token overrides built from var()/calc() (%s)',
    (theme) => {
      expect(
        check(theme, bundle(theme, '.s{--radius:var(--radius-xl)}.t{--primary:calc(1px)}')),
      ).toEqual([]);
    },
  );
  it('accepts a length-normalised --radius', () => {
    expect(check('production', bundle('production', '.r{--radius:.45rem}'))).toEqual([]);
  });
  it.each(THEMES)('fails when a token has only var() declarations (%s)', (theme) => {
    const css = bundle(theme, '.s{--background:var(--x)}', rootCss(theme, ['--background']));
    expect(check(theme, css)).toContain('theme token --background has no literal declaration');
  });
  it('fails a production build that carries the staging token values', () => {
    const out = check('production', bundle('production', '', rootCss('staging')));
    expect(out.some((l) => l.startsWith('theme token --primary at a.css:'))).toBe(true);
  });
  it('fails a token value that is not exactly one colour', () => {
    const css = bundle('production', '.y{--primary:red}');
    expect(check('production', css)).toContain(
      `unparseable token value red at a.css:${css.indexOf('red}')}`,
    );
  });
});

describe('check (b): no hardcoded theme colour, in every build', () => {
  it.each(THEMES)(
    'fails a palette declaration equal to a staging-only token (%s build)',
    (theme) => {
      const value = tokens.staging.get('--background')!;
      const css = bundle(theme, `.x{${pal('stone', 950)}:${value}}`);
      expect(check(theme, css)).toContain(bLine(css, value, 'staging', '--background'));
    },
  );
  it.each(THEMES)(
    'fails a palette declaration equal to a production-only token (%s build)',
    (theme) => {
      const value = tokens.production.get('--chart-2')!;
      const css = bundle(theme, `.x{${pal('sky', 400)}:${value}}`);
      expect(check(theme, css)).toContain(bLine(css, value, 'production', '--chart-2'));
    },
  );
  it.each(THEMES)(
    'fails a pre-computed translucent fallback equal to staging --border (%s build)',
    (theme) => {
      const css = bundle(theme, '.x{border-color:#ffffff1a}');
      expect(check(theme, css)).toContain(bLine(css, '#ffffff1a', 'staging', '--border'));
    },
  );
  it('fails a color-mix literal operand equal to a production-only token', () => {
    const value = tokens.production.get('--chart-2')!;
    const css = bundle('staging', `.x{color:color-mix(in oklab, ${value} 50%, transparent)}`);
    expect(check('staging', css)).toContain(bLine(css, value, 'production', '--chart-2'));
  });
  it('fails a var() fallback that hardcodes a theme colour', () => {
    const css = bundle('staging', '.s{--primary:var(--x, oklch(0.432 0.095 166.913))}');
    expect(check('staging', css)).toContain(
      bLine(css, 'oklch(0.432 0.095 166.913)', 'staging', '--primary'),
    );
  });
  it.each(THEMES)(
    'passes colour functions built from var() and colours that only appear in selectors (%s)',
    (t) => {
      const extra =
        '.a{border-color:hsl(var(--sidebar-border))}' +
        '.b{background:color-mix(in oklch, var(--secondary), var(--foreground) 5%)}' +
        ".c\\[stroke\\=\\'\\#ccc\\'\\]{stroke:var(--border)}";
      expect(check(t, bundle(t, extra))).toEqual([]);
    },
  );

  describe('tolerance and alpha', () => {
    const bg = ui.cssColorToSrgb(tokens.staging.get('--background')!);
    const [r, g, b] = [bg.r, bg.g, bg.b].map(Math.round);
    it('treats a literal off by 1 per channel as the same colour', () => {
      expect(
        check('staging', bundle('staging', `.x{color:rgb(${r + 1} ${g} ${b})}`)).join('\n'),
      ).toMatch(/equals staging --background/);
    });
    it('treats a literal off by 2 as a different colour', () => {
      expect(check('staging', bundle('staging', `.x{color:rgb(${r + 2} ${g} ${b})}`))).toEqual([]);
    });
    it('treats alpha within 0.01 as equal and 0.02 apart as different', () => {
      expect(
        check('staging', bundle('staging', '.x{color:rgb(255 255 255 / 0.11)}')).join('\n'),
      ).toMatch(/equals staging --border/);
      expect(check('staging', bundle('staging', '.x{color:rgb(255 255 255 / 0.12)}'))).toEqual([]);
    });
    it('does not treat opaque white as the 10%-alpha staging border', () => {
      expect(check('staging', bundle('staging', '.x{border-color:#fff}'))).toEqual([]);
    });
  });

  it.each(THEMES)('exempts tokens shared by both themes (%s)', (theme) => {
    const destructive = tokens.staging.get('--destructive')!;
    expect(check(theme, bundle(theme, `.x{${pal('red', 400)}:${destructive}}`))).toEqual([]);
  });
});

describe('AC-1: no Nocturne primary in a production bundle', () => {
  const nocturne = 'oklch(0.432 0.095 166.913)';
  it('fails it as a plain declaration via (b)', () => {
    const css = bundle('production', `.x{color:${nocturne}}`);
    expect(check('production', css)).toContain(bLine(css, nocturne, 'staging', '--primary'));
  });
  it('fails it as a --primary declaration via (a)', () => {
    const out = check('production', bundle('production', `.y{--primary:${nocturne}}`));
    expect(out.some((l) => l.startsWith('theme token --primary at a.css:'))).toBe(true);
  });
});

describe('checkThemeBundle CLI', () => {
  const staged = () => bundle('staging');
  it('lists CSS recursively under --css-dir', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'theme-css-'));
    mkdirSync(path.join(dir, 'chunks'));
    writeFileSync(path.join(dir, 'chunks', 'x.css'), staged());
    const r = run(tmpdir(), ['--css-dir', dir]);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('checkThemeBundle: staging bundle OK (1 css files)');
  });
  it('fails on an empty directory', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'theme-empty-'));
    const r = run(tmpdir(), ['--css-dir', dir]);
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toContain('no CSS under');
  });
  it('defaults to .next/static/css relative to the cwd', () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'theme-cwd-'));
    mkdirSync(path.join(cwd, '.next', 'static', 'css'), { recursive: true });
    writeFileSync(path.join(cwd, '.next', 'static', 'css', 'a.css'), staged());
    const r = run(cwd);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('bundle OK (1 css files)');
  });
  it('exits 1 and prints the failure when a shared role is missing', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'theme-bad-'));
    writeFileSync(path.join(dir, 'a.css'), rootCss('staging') + sharedCss({ sell: null }));
    const r = run(tmpdir(), ['--css-dir', dir]);
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/--color-sell/);
  });
});

describe('globals.css Tailwind scan scope pin', () => {
  const lines = sources.globalsCss.split('\n');
  it('scans only src/ and keeps tw-animate-css on line 2', () => {
    expect(lines[0]).toBe("@import 'tailwindcss' source('..');");
    expect(lines[1]).toBe("@import 'tw-animate-css';");
  });
  it('excludes test files and the theme files from the scan, after both imports', () => {
    expect(lines.indexOf('@source not "../**/*.test.ts";')).toBeGreaterThan(1);
    expect(lines.indexOf('@source not "../styles/themes";')).toBeGreaterThan(1);
  });
});
