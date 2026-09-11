import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Browser resolution for environments that pre-bake browsers and block downloads.
 *
 * Extracted from playwright.config.ts so the same resolution logic is shared by
 * global-setup.ts's preflight launch — a mismatch between the two caused the
 * preflight to fail in sandbox environments where PLAYWRIGHT_BROWSERS_PATH was
 * set but PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH was not (the preflight fell back
 * to Playwright's managed browser, which doesn't exist when downloads are blocked).
 */

// Per-browser relative path from a `<name>-<rev>` install dir to its launch binary.
const BROWSER_BINARY: Record<'chromium' | 'firefox', string> = {
  chromium: path.join('chrome-linux', 'chrome'),
  firefox: path.join('firefox', 'firefox'),
};

/** Resolve a pre-installed browser binary under PLAYWRIGHT_BROWSERS_PATH, or undefined. */
export function preinstalledBrowser(name: 'chromium' | 'firefox'): string | undefined {
  const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!browsersPath || !existsSync(browsersPath)) return undefined;
  // Stable unversioned symlink some sandboxes expose (e.g. `<path>/chromium` → …/chrome).
  const stable = path.join(browsersPath, name);
  if (existsSync(stable) && !statSync(stable).isDirectory()) return stable;
  // Otherwise pick the highest `<name>-<rev>` build that has its launch binary.
  const revs = readdirSync(browsersPath)
    .filter((d) => new RegExp(`^${name}-\\d+$`).test(d))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  for (const dir of revs) {
    const bin = path.join(browsersPath, dir, BROWSER_BINARY[name]);
    if (existsSync(bin)) return bin;
  }
  return undefined;
}

/**
 * Resolve the Chromium executable path for Playwright launch.
 *
 * Priority: PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH (explicit override) →
 *           preinstalledBrowser('chromium') (auto-detect from PLAYWRIGHT_BROWSERS_PATH) →
 *           undefined (Playwright's own managed browser).
 */
export function resolveChromiumExecutable(): string | undefined {
  const overridePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  return (
    (overridePath && existsSync(overridePath) ? overridePath : undefined) ??
    preinstalledBrowser('chromium')
  );
}
