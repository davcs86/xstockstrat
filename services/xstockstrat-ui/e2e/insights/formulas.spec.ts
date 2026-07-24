import { test, expect } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';
import { FORMULAS } from '../fixtures';

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
