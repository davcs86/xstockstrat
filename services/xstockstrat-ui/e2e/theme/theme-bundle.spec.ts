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

  test('@AC-7 body background matches the built theme', async ({ page }) => {
    expect(ui.colorsEqual(await bodyBackground(page), ui.themeBackgroundHex(builtTheme))).toBe(
      true,
    );
  });
});
