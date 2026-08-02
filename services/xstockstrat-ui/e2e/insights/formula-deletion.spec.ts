import { test, expect } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';
import { FORMULA_DELETED } from '../fixtures';

/**
 * E2E for feature 086 — soft-deleted formula surfaces.
 *
 * The insights mock backend does not implement IndicatorsService, and here we also override the
 * analysis GetStrategy / RunBacktest responses at the browser level with page.route() so the
 * "referenced formula was deleted" warnings render deterministically. (See formulas.spec.ts for
 * the same GetFormula-stubbing pattern.)
 */
test.describe('Soft-deleted formula surfaces (feature 086)', () => {
  test('deleted formula detail page is read-only with a Deleted badge', async ({ page }) => {
    await addAuthCookie(page);
    await page.route('**/xstockstrat.indicators.v1.IndicatorsService/GetFormula', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(FORMULA_DELETED),
      });
    });
    await page.goto(`/insights/formulas/${FORMULA_DELETED.formulaId}`);
    await expect(page.getByTestId('formula-deleted-badge')).toBeVisible({ timeout: 10000 });
    // A deleted formula cannot be edited: Save and Delete are hidden.
    await expect(page.getByRole('button', { name: 'Save' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Delete' })).toHaveCount(0);
  });

  test('strategy live-status flags a referenced deleted formula', async ({ page }) => {
    await addAuthCookie(page);
    await page.route(
      '**/xstockstrat.analysis.v1.AnalysisService/GetStrategy',
      async (route, request) => {
        const body = JSON.parse(request.postData() ?? '{}');
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            strategyId: body.strategyId ?? 'strat-high-001',
            displayName: 'Strategy with a deleted formula',
            components: [],
            entryRule: '{"op":"and","conditions":[]}',
            exitRule: '{"op":"or","conditions":[]}',
            active: true,
            liveEnabled: true,
            warnings: [
              "Formula 'Retired RSI' (f-deleted) referenced by this strategy has been deleted; " +
                'the run used its last-saved definition.',
            ],
          }),
        });
      },
    );
    await page.goto('/insights/strategies/strat-high-001');
    const banner = page.getByTestId('strategy-warnings');
    await expect(banner).toBeVisible({ timeout: 10000 });
    await expect(banner).toContainText('has been deleted');
  });

  test('backtest result flags a referenced deleted formula', async ({ page }) => {
    await addAuthCookie(page);
    await page.route('**/xstockstrat.analysis.v1.AnalysisService/RunBacktest', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          backtestId: 'bt-warn-1',
          strategyId: 'strat-high-001',
          status: 1, // BACKTEST_STATUS_OK
          totalTrades: 0,
          trades: [],
          coverageGaps: [],
          diagnostics: [],
          warnings: [
            "Formula 'Retired RSI' (f-deleted) referenced by this strategy has been deleted; " +
              'the run used its last-saved definition.',
          ],
        }),
      });
    });
    await page.goto('/insights/strategies/strat-high-001');
    await page.getByRole('button', { name: 'Run Backtest' }).click();
    const banner = page.getByTestId('backtest-warnings');
    await expect(banner).toBeVisible({ timeout: 10000 });
    await expect(banner).toContainText('has been deleted');
  });
});
