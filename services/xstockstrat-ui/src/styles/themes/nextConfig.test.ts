import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const req = createRequire(import.meta.url);
const PKG = fileURLToPath(new URL('../../..', import.meta.url));
const NEXT_CONFIG = req.resolve('../../../next.config.js');
const UI_THEME_CJS = req.resolve('./uiTheme.cjs');
const { themeBackgroundHex } = req('./uiTheme.cjs') as {
  themeBackgroundHex: (t: string) => string;
};

type NextConfig = {
  env: Record<string, string>;
  webpack: (config: {
    resolve: { alias: Record<string, string> };
    cache?: { type: string; version?: string };
  }) => {
    resolve: { alias: Record<string, string> };
    cache?: { type: string; version?: string };
  };
};

const original = process.env.UI_THEME;
function loadConfig(theme: string | undefined): NextConfig {
  delete req.cache[NEXT_CONFIG];
  delete req.cache[UI_THEME_CJS];
  if (theme === undefined) delete process.env.UI_THEME;
  else process.env.UI_THEME = theme;
  return req(NEXT_CONFIG) as NextConfig;
}
afterEach(() => {
  if (original === undefined) delete process.env.UI_THEME;
  else process.env.UI_THEME = original;
  delete req.cache[NEXT_CONFIG];
});

const aliasOf = (config: NextConfig) =>
  config.webpack({ resolve: { alias: {} } }).resolve.alias['@theme-tokens$'];

describe('next.config.js theme selection', () => {
  it('selects the staging theme when UI_THEME is unset (AC-3)', () => {
    expect(aliasOf(loadConfig(undefined))).toMatch(/[/\\]staging\.css$/);
  });
  it.each(['staging', 'production'])(
    'aliases @theme-tokens to %s.css and inlines its background',
    (theme) => {
      const config = loadConfig(theme);
      expect(aliasOf(config)).toMatch(new RegExp(`[/\\\\]${theme}\\.css$`));
      expect(config.env.UI_THEME_BACKGROUND_HEX).toBe(themeBackgroundHex(theme));
    },
  );
  it('keys the persistent webpack cache by theme so a theme switch never reuses stale CSS', () => {
    const versionOf = (theme: string) =>
      loadConfig(theme).webpack({
        resolve: { alias: {} },
        cache: { type: 'filesystem', version: 'v1' },
      }).cache!.version;
    expect(versionOf('staging')).toBe('v1|ui-theme:staging');
    expect(versionOf('production')).toBe('v1|ui-theme:production');
  });
  it('keeps any alias webpack already configured', () => {
    const out = loadConfig('staging').webpack({ resolve: { alias: { keep: 'me' } } });
    expect(out.resolve.alias.keep).toBe('me');
  });
  it('fails to load on an unknown UI_THEME, naming both allowed values (AC-4)', () => {
    const r = spawnSync(process.execPath, ['-e', "require('./next.config.js')"], {
      cwd: PKG,
      encoding: 'utf8',
      env: { ...process.env, UI_THEME: 'prod' },
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/"staging"/);
    expect(r.stderr).toMatch(/"production"/);
  });
});

describe('theme is build-time only (FR-10)', () => {
  const needle = ['APPLICATION', 'ENV'].join('_');
  const themesDir = path.join(PKG, 'src', 'styles', 'themes');
  const scanned = [
    path.join(PKG, 'next.config.js'),
    path.join(PKG, 'src', 'app', 'layout.tsx'),
    ...readdirSync(themesDir)
      .filter((f) => /\.(cjs|css)$/.test(f))
      .map((f) => path.join(themesDir, f)),
  ];
  it.each(scanned.map((f) => [path.relative(PKG, f), f]))(
    '%s never reads the runtime environment',
    (_rel, f) => {
      expect(readFileSync(f, 'utf8')).not.toContain(needle);
    },
  );
});
