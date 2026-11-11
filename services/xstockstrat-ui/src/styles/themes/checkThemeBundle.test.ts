import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const req = createRequire(import.meta.url);
const { checkBundle } = req('./checkThemeBundle.cjs') as {
  checkBundle: (
    cssFiles: { file: string; css: string }[],
    theme: string,
    sources: { globalsCss: string },
  ) => string[];
};

const SCRIPT = fileURLToPath(new URL('./checkThemeBundle.cjs', import.meta.url));
const GLOBALS = fileURLToPath(new URL('../../app/globals.css', import.meta.url));
const globalsCss = readFileSync(GLOBALS, 'utf8');

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

const run = (cwd: string, args: string[] = []) =>
  spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, UI_THEME: 'staging' },
  });

describe('checkBundle check (c): shared order-side colours', () => {
  it('passes when all four shared roles are emitted with the globals.css values', () => {
    expect(checkBundle([{ file: 'a.css', css: sharedCss() }], 'staging', { globalsCss })).toEqual(
      [],
    );
  });
  it('fails when a shared role is not emitted', () => {
    const out = checkBundle([{ file: 'a.css', css: sharedCss({ warning: null }) }], 'production', {
      globalsCss,
    });
    expect(out.join('\n')).toMatch(/--color-warning/);
  });
  it('fails when a shared role is off by 2 per channel', () => {
    const out = checkBundle(
      [{ file: 'a.css', css: sharedCss({ buy: 'rgb(79 201 158)' }) }],
      'staging',
      {
        globalsCss,
      },
    );
    expect(out.join('\n')).toMatch(/--color-buy/);
  });
  it('ignores a var() self-map as long as one literal declaration matches', () => {
    const selfMap = [
      ':root{',
      ['--color', 'buy'].join('-'),
      ':var(',
      ['--color', 'buy'].join('-'),
      ')}',
    ].join('');
    expect(
      checkBundle([{ file: 'a.css', css: sharedCss() + selfMap }], 'staging', { globalsCss }),
    ).toEqual([]);
  });
});

describe('checkThemeBundle CLI', () => {
  it('lists CSS recursively under --css-dir', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'theme-css-'));
    mkdirSync(path.join(dir, 'chunks'));
    writeFileSync(path.join(dir, 'chunks', 'x.css'), sharedCss());
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
    writeFileSync(path.join(cwd, '.next', 'static', 'css', 'a.css'), sharedCss());
    const r = run(cwd);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('bundle OK (1 css files)');
  });
  it('exits 1 and prints the failure when a shared role is missing', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'theme-bad-'));
    writeFileSync(path.join(dir, 'a.css'), sharedCss({ sell: null }));
    const r = run(tmpdir(), ['--css-dir', dir]);
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/--color-sell/);
  });
});

describe('globals.css Tailwind scan scope pin', () => {
  const lines = globalsCss.split('\n');
  it('scans only src/ and keeps tw-animate-css on line 2', () => {
    expect(lines[0]).toBe("@import 'tailwindcss' source('..');");
    expect(lines[1]).toBe("@import 'tw-animate-css';");
  });
  it('excludes test files and the theme files from the scan, after both imports', () => {
    const tests = lines.indexOf('@source not "../**/*.test.ts";');
    const themes = lines.indexOf('@source not "../styles/themes";');
    expect(tests).toBeGreaterThan(1);
    expect(themes).toBeGreaterThan(1);
  });
});
