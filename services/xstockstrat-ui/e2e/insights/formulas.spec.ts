import { test, expect, type Page } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';
import { FORMULAS, FORMULA_FUNDAMENTALS, FUNDAMENTALS_AAPL } from '../fixtures';

/**
 * E2E smoke tests for the formula management UI (`/insights/formulas`).
 *
 * The mock backend (globalSetup, port 9092) does not mock IndicatorsService, so
 * the ListFormulas BFF call is stubbed at the browser level with page.route().
 * An auth cookie is injected so the middleware does not redirect to /auth/login.
 */

test.describe('Formula management UI', () => {
  test('formulas list page renders returned formulas', async ({ page }) => {
    await addAuthCookie(page);
    await page.route(
      '**/xstockstrat.indicators.v1.IndicatorsService/ListFormulas',
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ formulas: FORMULAS, totalCount: FORMULAS.length }),
        });
      },
    );
    await page.goto('/insights/formulas');
    await expect(page.getByText('RSI Divergence')).toBeVisible();
  });

  test('a row navigates to the formula detail page via Enter (FR-5 keyboard activation)', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await page.route(
      '**/xstockstrat.indicators.v1.IndicatorsService/ListFormulas',
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ formulas: FORMULAS, totalCount: FORMULAS.length }),
        });
      },
    );
    await page.goto('/insights/formulas');
    const row = page.locator('[role="button"]', { hasText: 'RSI Divergence' });
    await expect(row).toBeVisible({ timeout: 10000 });
    await row.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/insights\/formulas\/f-rsi/);
  });

  test('new formula page renders the create form', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/insights/formulas/new');
    await expect(page.locator('input[name="name"], input[placeholder]').first()).toBeVisible({
      timeout: 10000,
    });
  });

  test('system formula detail page is read-only (no Save/Delete)', async ({ page }) => {
    await addAuthCookie(page);
    // A built-in formula authored by the reserved "system" author must render read-only:
    // the editor shows the read-only badge and hides the Save and Delete actions.
    // GetFormula returns the FormulaDefinition message directly (not wrapped).
    await page.route('**/xstockstrat.indicators.v1.IndicatorsService/GetFormula', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          formulaId: 'sys-001',
          name: 'Fundamentals Value+Quality Composite (v1)',
          description: 'Built-in scoring formula',
          source: 'result = {"value": 1.0}',
          author: 'system',
          isPublic: true,
          parameters: [],
          outputs: [],
        }),
      });
    });
    await page.goto('/insights/formulas/sys-001');
    await expect(page.getByText('Read-only · system formula')).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: 'Save' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Delete' })).toHaveCount(0);
  });
});

/**
 * The 11-entry FundamentalMetric catalog the ListFundamentalMetrics RPC returns (feature 205). enum
 * NAME-strings match Connect-JSON's repeated-enum wire encoding; meanings mirror the indicators
 * handler's _FUNDAMENTAL_METRIC_MEANING. Single consumer (this spec) — inline per C-13.
 */
const FUNDAMENTAL_METRICS_CATALOG = {
  metrics: [
    { metric: 'FUNDAMENTAL_METRIC_MARKET_CAP', dataKey: 'market_cap', meaning: 'Market cap' },
    { metric: 'FUNDAMENTAL_METRIC_PE_RATIO', dataKey: 'pe_ratio', meaning: 'P/E ratio' },
    { metric: 'FUNDAMENTAL_METRIC_PB_RATIO', dataKey: 'pb_ratio', meaning: 'P/B ratio' },
    {
      metric: 'FUNDAMENTAL_METRIC_DIVIDEND_YIELD',
      dataKey: 'dividend_yield',
      meaning: 'Dividend yield',
    },
    { metric: 'FUNDAMENTAL_METRIC_EPS', dataKey: 'eps', meaning: 'EPS' },
    { metric: 'FUNDAMENTAL_METRIC_BETA', dataKey: 'beta', meaning: 'Beta' },
    { metric: 'FUNDAMENTAL_METRIC_ROE', dataKey: 'roe', meaning: 'ROE' },
    {
      metric: 'FUNDAMENTAL_METRIC_DEBT_TO_EQUITY',
      dataKey: 'debt_to_equity',
      meaning: 'Debt/equity',
    },
    { metric: 'FUNDAMENTAL_METRIC_PRICE', dataKey: 'price', meaning: 'Price' },
    { metric: 'FUNDAMENTAL_METRIC_YEAR_HIGH', dataKey: 'year_high', meaning: '52-week high' },
    { metric: 'FUNDAMENTAL_METRIC_YEAR_LOW', dataKey: 'year_low', meaning: '52-week low' },
  ],
};

async function stubCatalog(page: Page) {
  await page.route(
    '**/xstockstrat.indicators.v1.IndicatorsService/ListFundamentalMetrics',
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(FUNDAMENTAL_METRICS_CATALOG),
      });
    },
  );
}

async function stubGetFundamentalsFormula(page: Page) {
  await page.route('**/xstockstrat.indicators.v1.IndicatorsService/GetFormula', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(FORMULA_FUNDAMENTALS),
    });
  });
}

test.describe('Formula fundamental inputs (feature 205)', () => {
  test('AC-4: the fundamental-input picker lists all 11 metrics', async ({ page }) => {
    await addAuthCookie(page);
    await stubCatalog(page);
    await page.goto('/insights/formulas/new');
    await page.getByRole('button', { name: 'Add fundamental input' }).click();
    await page.getByLabel('fundamental input 0', { exact: true }).click();
    await expect(page.getByRole('option')).toHaveCount(11);
  });

  test('AC-2: saving a formula sends the selected metric as a NAME-string', async ({ page }) => {
    await addAuthCookie(page);
    await stubCatalog(page);
    let registerBody: { fundamentalInputs?: string[] } | null = null;
    await page.route(
      '**/xstockstrat.indicators.v1.IndicatorsService/RegisterFormula',
      async (route) => {
        registerBody = JSON.parse(route.request().postData() ?? '{}');
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ formulaId: 'f-new' }),
        });
      },
    );
    await page.goto('/insights/formulas/new');
    await page.locator('input[name="name"]').fill('Value screen');
    await page.getByRole('button', { name: 'Add fundamental input' }).click();
    await page.getByLabel('fundamental input 0', { exact: true }).click();
    await page.getByRole('option', { name: 'P/E ratio', exact: true }).click();
    await page.getByRole('button', { name: 'Create formula' }).click();
    await expect
      .poll(() => registerBody?.fundamentalInputs)
      .toEqual(['FUNDAMENTAL_METRIC_PE_RATIO']);
  });

  test('AC-3: opening a fundamentals formula shows its metrics selected', async ({ page }) => {
    await addAuthCookie(page);
    await stubCatalog(page);
    await stubGetFundamentalsFormula(page);
    await page.goto(`/insights/formulas/${FORMULA_FUNDAMENTALS.formulaId}`);
    // fundamentalInputs = [PE_RATIO, ROE] → the two picker rows show those meanings selected.
    await expect(page.getByLabel('fundamental input 0', { exact: true })).toContainText(
      'P/E ratio',
    );
    await expect(page.getByLabel('fundamental input 1', { exact: true })).toContainText('ROE');
  });

  test('AC-5: running a fundamentals formula sends snake_case data-keys in input_data', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await stubCatalog(page);
    await stubGetFundamentalsFormula(page);
    let executeBody: { inputData?: Record<string, number> } | null = null;
    await page.route(
      '**/xstockstrat.indicators.v1.IndicatorsService/ExecuteFormula',
      async (route) => {
        executeBody = JSON.parse(route.request().postData() ?? '{}');
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ parameterErrors: [] }),
        });
      },
    );
    await page.goto(`/insights/formulas/${FORMULA_FUNDAMENTALS.formulaId}`);
    await page.getByLabel('fundamental pe_ratio').fill('12.5');
    await page.getByLabel('fundamental roe').fill('0.3');
    await page.getByRole('button', { name: 'Run' }).click();
    await expect.poll(() => executeBody?.inputData).toEqual({ pe_ratio: 12.5, roe: 0.3 });
  });

  test('AC-6: symbol-prefill fills the grid from GetFundamentalsMulti, never NaN', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await stubCatalog(page);
    await stubGetFundamentalsFormula(page);
    await page.goto(`/insights/formulas/${FORMULA_FUNDAMENTALS.formulaId}`);
    await page.getByLabel('prefill symbol').fill('AAPL');
    await page.getByRole('button', { name: 'Load' }).click();
    await expect(page.getByLabel('fundamental pe_ratio')).toHaveValue(
      String(FUNDAMENTALS_AAPL.peRatio),
    );
    // Missing/absent metrics resolve to blank, never NaN (fails.md:86).
    for (const key of ['pe_ratio', 'roe']) {
      await expect(page.getByLabel(`fundamental ${key}`)).not.toHaveValue('NaN');
    }
  });
});
