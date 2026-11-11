import { test, expect, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import { addAuthCookie } from '../helpers/auth';

/**
 * E2E for feature 307 (ui-env-themed-bundles): the bundle carries exactly the theme it was built with.
 * The image sets UI_THEME at build time (Dockerfile.e2e); CI runs this spec against both images.
 */
const req = createRequire(__filename);
const ui = req('../../src/styles/themes/uiTheme.cjs') as {
  cssColorToSrgb: (text: string) => { r: number; g: number; b: number; a: number };
  colorsEqual: (x: unknown, y: unknown) => boolean;
  themeBackgroundHex: (theme: string) => string;
};

const builtTheme = process.env.UI_THEME ?? 'staging';

async function bodyBackground(page: Page) {
  await addAuthCookie(page);
  await page.goto('/trader');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  // Chromium keeps the oklch() colour space, so compare as sRGB, never as strings.
  return ui.cssColorToSrgb(bg);
}

test.describe('UI theme bundle (feature 307)', () => {
  test('@AC-10 staging bundle background is independent of APPLICATION_ENV', async ({ page }) => {
    expect(ui.themeBackgroundHex('staging')).toBe('#0c0a09');
    expect(ui.colorsEqual(await bodyBackground(page), '#0c0a09')).toBe(true);
  });

  test('@AC-13 PWA chrome colour follows the theme', async ({ page, request }) => {
    const hex = ui.themeBackgroundHex(builtTheme);
    const res = await request.get('/manifest.webmanifest');
    expect(res.ok()).toBe(true);
    expect(res.headers()['cache-control']).toContain('no-cache');
    const manifest = await res.json();
    expect(manifest.theme_color).toBe(hex);
    expect(manifest.background_color).toBe(hex);
    expect(manifest.display).toBe('standalone');
    const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes);
    expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));

    await addAuthCookie(page);
    await page.goto('/trader');
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', hex);
  });

  test('@AC-7 body background matches the built theme', async ({ page }) => {
    expect(ui.colorsEqual(await bodyBackground(page), ui.themeBackgroundHex(builtTheme))).toBe(
      true,
    );
  });
});
