import { test, expect, type Page } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';
import {
  FORMULA_RSI,
  FORMULA_TEMPLATE_INSTANCE,
  FORMULA_TEMPLATE_ZSCORE,
  SOURCE_TEMPLATE_NEWSLETTER,
  STRATEGY_TEMPLATE_MEANREV,
  TEMPLATES,
} from '../fixtures';

/**
 * Feature 224 (AC-24) — the /insights template catalog. ListTemplates / InstantiateTemplate traverse
 * the REAL insights BFF router to the mock backend (indicators + analysis on 9092, ingest on 9093);
 * only the formulas-list "Update available" check stubs ListFormulas, which the mock leaves
 * unimplemented.
 */

const TAB_FOR: Record<number, string> = { 1: 'Strategy', 2: 'Formula', 3: 'Signal source' };

async function openTab(page: Page, kind: number) {
  await page.getByRole('tab', { name: TAB_FOR[kind], exact: true }).click();
}

test.describe('Template catalog (/insights/templates)', () => {
  test('the Engine nav carries a Templates entry that reaches the catalog', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/insights/strategies');
    const section = page.getByRole('navigation', { name: 'Section' });
    await section.getByRole('link', { name: 'Templates', exact: true }).click();
    await expect(page).toHaveURL(/\/insights\/templates(\/|$|\?)/);
    await expect(section.getByRole('link', { name: 'Templates', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(
      page
        .getByRole('navigation', { name: 'Primary' })
        .getByRole('link', { name: 'Engine', exact: true }),
    ).toHaveAttribute('aria-current', 'page');
  });

  test('every catalog tab lists its templates with a "Use template <name>" action', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await page.goto('/insights/templates');
    for (const tpl of TEMPLATES) {
      await openTab(page, tpl.meta.kind);
      await expect(page.getByText(tpl.meta.description)).toBeVisible({ timeout: 10000 });
      await expect(
        page.getByRole('button', { name: `Use template ${tpl.meta.name}`, exact: true }),
      ).toBeVisible();
    }
  });

  const INSTANCE_URL: [(typeof TEMPLATES)[number], RegExp][] = [
    [
      FORMULA_TEMPLATE_ZSCORE,
      new RegExp(`/insights/formulas/${FORMULA_TEMPLATE_INSTANCE.formulaId}$`),
    ],
    [
      STRATEGY_TEMPLATE_MEANREV,
      new RegExp(`/insights/strategies/${STRATEGY_TEMPLATE_MEANREV.payload.strategyId}$`),
    ],
    [SOURCE_TEMPLATE_NEWSLETTER, /\/insights\/signal-sources$/],
  ];

  for (const [tpl, url] of INSTANCE_URL) {
    test(`using the ${tpl.meta.name} template opens the created private copy`, async ({ page }) => {
      await addAuthCookie(page);
      await page.goto('/insights/templates');
      await openTab(page, tpl.meta.kind);
      const instantiated = page.waitForResponse((r) => r.url().endsWith('/InstantiateTemplate'));
      await page
        .getByRole('button', { name: `Use template ${tpl.meta.name}`, exact: true })
        .click({ timeout: 10000 });
      expect((await instantiated).status()).toBe(200);
      await expect(page).toHaveURL(url, { timeout: 10000 });
    });
  }

  test('a formula instance whose template moved on shows "Update available"', async ({ page }) => {
    await addAuthCookie(page);
    await page.route(
      '**/xstockstrat.indicators.v1.IndicatorsService/ListFormulas',
      async (route) => {
        const formulas = [FORMULA_TEMPLATE_INSTANCE, FORMULA_RSI];
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ formulas, totalCount: formulas.length }),
        });
      },
    );
    await page.goto('/insights/formulas');
    const instanceRow = page.locator('[role="button"]', {
      hasText: FORMULA_TEMPLATE_INSTANCE.name,
    });
    await expect(instanceRow.getByText('Update available')).toBeVisible({ timeout: 10000 });
    // Only the out-of-date instance carries the badge.
    await expect(page.getByText('Update available')).toHaveCount(1);
  });
});
