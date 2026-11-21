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
// bt-hist-2's completedAt (e2e/mock-backend.ts): pins relative-time text so the goldens are stable.
const FIXED_NOW = 1717286400 * 1000;
const SHARED = {
  '--color-buy': 'hsl(159 52% 54%)',
  '--color-sell': 'hsl(359 63% 67%)',
  '--color-paper': 'hsl(43 41% 64%)',
};

async function openEquityCurve(page: Page) {
  await addAuthCookie(page);
  await page.goto('/insights/strategies/strat-history-001');
  const rows = page.getByTestId('past-run-row');
  await expect(rows).toHaveCount(2, { timeout: 10000 });
  await rows.first().click();
  const chart = page.getByTestId('equity-curve-chart');
  await expect(chart).toBeVisible({ timeout: 10000 });
  return chart;
}

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

  test('@AC-7 the shell banner keeps its accessible structure', async ({ page }) => {
    await page.clock.setFixedTime(FIXED_NOW);
    await addAuthCookie(page);
    await page.goto('/trader');
    const banner = page.getByRole('banner');
    await expect(banner).toContainText('xstockstrat');
    await expect(banner).toMatchAriaSnapshot({ name: 'shell.aria.yml' });
  });

  test('@AC-7 the trader main keeps its accessible structure', async ({ page }) => {
    await page.clock.setFixedTime(FIXED_NOW);
    await addAuthCookie(page);
    await page.goto('/trader');
    const main = page.getByRole('main');
    await expect(main).toBeVisible();
    await expect(main).toMatchAriaSnapshot({ name: 'trader-main.aria.yml' });
  });

  test('@AC-7 the strategy equity view keeps its accessible structure', async ({ page }) => {
    await page.clock.setFixedTime(FIXED_NOW);
    await openEquityCurve(page);
    const results = page.getByRole('main');
    await expect(results).toContainText('Backtest Results');
    await expect(results).toContainText('Equity Curve');
    await expect(results).toMatchAriaSnapshot({ name: 'strategy-equity.aria.yml' });
  });

  test('@AC-8 @AC-11 the trader chart parses every theme colour', async ({ page }) => {
    const messages: string[] = [];
    page.on('console', (m) => messages.push(m.text()));
    page.on('pageerror', (e) => messages.push(e.message));
    await addAuthCookie(page);
    await page.goto('/trader');
    await expect(
      page.locator('[data-testid="chart-container"] .tv-lightweight-charts'),
    ).toBeVisible({ timeout: 15000 });
    expect(messages.filter((m) => m.includes('Failed to parse color'))).toEqual([]);
  });

  test('@AC-12 the equity curve strokes with the --chart-1 token', async ({ page }) => {
    const chart = await openEquityCurve(page);
    const path = chart.locator('.recharts-line-curve').first();
    await expect(path).toBeVisible();
    const stroke = await path.evaluate((el) => getComputedStyle(el).stroke);
    const token = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--chart-1').trim(),
    );
    expect(ui.colorsEqual(ui.cssColorToSrgb(stroke), ui.cssColorToSrgb(token))).toBe(true);
  });

  test('@AC-5 order-side colours are identical in every theme', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/trader');
    const values = await page.evaluate((names) => {
      const css = getComputedStyle(document.documentElement);
      return names.map((n) => css.getPropertyValue(n).trim());
    }, Object.keys(SHARED));
    Object.values(SHARED).forEach((expected, i) => {
      expect(ui.colorsEqual(ui.cssColorToSrgb(values[i]), expected), Object.keys(SHARED)[i]).toBe(
        true,
      );
    });
  });
});
