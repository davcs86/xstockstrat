import { test, expect, type Page } from '@playwright/test';
import { addAdminCookie, addAuthCookie } from '../helpers/auth';
import { BACKTEST_SEED_SPAN_RESULT, FORMULAS, SECTOR_PARAM_OVERRIDE_FSCORE } from '../fixtures';

/**
 * Feature 217 — per-sector component-param overrides: authoring in the strategy wizard and the
 * seed-span backtest warning. ListFormulas / ManageStrategy / RunBacktest are stubbed at the
 * browser level with page.route() (as in strategy-authoring.spec.ts and formula-deletion.spec.ts).
 */

async function stubListFormulas(page: Page): Promise<void> {
  await page.route('**/xstockstrat.indicators.v1.IndicatorsService/ListFormulas', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ formulas: FORMULAS, totalCount: FORMULAS.length }),
    });
  });
}

test('wizard authors a per-sector override and submits it with the definition', async ({
  page,
}) => {
  await addAdminCookie(page);
  await stubListFormulas(page);
  let captured: Record<string, unknown> | null = null;
  await page.route('**/xstockstrat.analysis.v1.AnalysisService/ManageStrategy', async (route) => {
    captured = JSON.parse(route.request().postData() ?? '{}');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ strategyId: 'sector_demo' }),
    });
  });
  await page.goto('/insights/strategies/new');
  await expect(page.getByText('Step 1 — Identity')).toBeVisible({ timeout: 30000 });
  const next = page.getByRole('button', { name: 'Next', exact: true });
  await page.getByPlaceholder('e.g. sma_crossover').fill('sector_demo');
  await next.click();
  await page.getByPlaceholder('SMA Crossover').fill('Sector Demo');
  await next.click();
  await next.click();
  await next.click(); // → Step 2 — Components

  await page.getByRole('button', { name: 'Add component' }).click();
  await page.getByLabel('ref name').fill('rsi');
  await page.getByLabel('indicator name').click();
  await page.getByRole('option', { name: /^RSI/ }).click();

  await page.getByRole('button', { name: 'Add sector override' }).click();
  await page.getByLabel('override 1 component').click();
  await page.getByRole('option', { name: 'rsi' }).click();
  await page.getByLabel('override 1 default value').fill('14');
  await page.getByRole('button', { name: 'Add sector', exact: true }).click();
  await page.getByLabel('override 1 sector 1').click();
  await page.getByRole('option', { name: 'Financials' }).click();
  await page.getByLabel('override 1 Financials value').fill('21');

  await next.click(); // → Step 3 — Rules
  const jsonTabs = page.getByRole('tab', { name: 'JSON' });
  await jsonTabs.nth(0).click();
  await page.getByLabel('Entry rule JSON').fill('{"fn":"<","lhs":"rsi","rhs":30}');
  await jsonTabs.nth(1).click();
  await page.getByLabel('Exit rule JSON').fill('{"fn":">","lhs":"rsi","rhs":70}');
  await next.click();
  await expect(page.getByTestId('review-sector-overrides')).toContainText('rsi.period');

  await page.getByRole('button', { name: 'Create Strategy' }).click();
  await expect.poll(() => captured).not.toBeNull();
  const definition = (captured as unknown as { definition: Record<string, unknown> }).definition;
  expect(definition.sectorParamOverrides).toEqual([SECTOR_PARAM_OVERRIDE_FSCORE]);
});

test('backtest result surfaces the sector seed-span warning', async ({ page }) => {
  await addAuthCookie(page);
  await page.route('**/xstockstrat.analysis.v1.AnalysisService/RunBacktest', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(BACKTEST_SEED_SPAN_RESULT),
    });
  });
  await page.goto('/insights/strategies/strat-high-001');
  await page.getByRole('button', { name: 'Run Backtest' }).click();
  const banner = page.getByTestId('backtest-warnings');
  await expect(banner).toBeVisible({ timeout: 10000 });
  await expect(banner).toContainText('seed span');
});
