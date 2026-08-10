import { test, expect, type Page } from '@playwright/test';
import { addAuthCookie, addAdminCookie } from './helpers/auth';
import { FORMULA_RSI } from './fixtures/formulas';

/**
 * `PageBreadcrumb` collision coverage (feature 124, FR-10 / AC-9). Proves absent, for all 8
 * migrated/new sites, the two collision classes `fails.md` 2026-08-09 ("shadcn-migration-
 * high-confidence") documents:
 *  (1) a case-insensitive `aria-label` substring match between a page's `PageBreadcrumb` and
 *      another labeled region on the same page;
 *  (2) `BreadcrumbPage`'s built-in `role="link" aria-current="page"` colliding with a real,
 *      working nav `Link` of the same accessible name elsewhere on the page.
 * Every assertion below uses `{ exact: true }` deliberately — Playwright's default name
 * matching is case-insensitive substring, which is exactly what class (1)/(2) exploit.
 */

async function stubGetFormula(page: Page): Promise<void> {
  await page.route('**/xstockstrat.indicators.v1.IndicatorsService/GetFormula', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...FORMULA_RSI, source: 'result = {"value": 1.0}' }),
    }),
  );
}

async function stubListFormulas(page: Page): Promise<void> {
  await page.route('**/xstockstrat.indicators.v1.IndicatorsService/ListFormulas', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ formulas: [], totalCount: 0 }),
    }),
  );
}

test.describe('PageBreadcrumb collision coverage (FR-10 / AC-9)', () => {
  const sites: {
    name: string;
    ariaLabel: string;
    terminalLabel: string;
    goto: (page: Page) => Promise<void>;
  }[] = [
    {
      name: 'NamespaceEditor (migrated)',
      ariaLabel: 'Namespace path',
      terminalLabel: 'platform',
      goto: async (page) => {
        await addAuthCookie(page);
        await page.goto('/config-ui/platform');
      },
    },
    {
      name: 'Audit log (migrated)',
      ariaLabel: 'Audit log path',
      terminalLabel: 'Audit Log',
      goto: async (page) => {
        await addAuthCookie(page);
        await page.goto('/config-ui/audit');
      },
    },
    {
      name: 'Strategy detail (new)',
      ariaLabel: 'Strategy path',
      terminalLabel: 'strat-high-001',
      goto: async (page) => {
        await addAuthCookie(page);
        await page.goto('/insights/strategies/strat-high-001');
      },
    },
    {
      name: 'Strategy edit (new)',
      ariaLabel: 'Strategy path',
      terminalLabel: 'Edit',
      goto: async (page) => {
        await addAdminCookie(page);
        await stubListFormulas(page);
        await page.goto('/insights/strategies/strat-edit-001/edit');
      },
    },
    {
      name: 'Formula detail (new)',
      ariaLabel: 'Formula path',
      terminalLabel: FORMULA_RSI.name,
      goto: async (page) => {
        await addAuthCookie(page);
        await stubGetFormula(page);
        await page.goto(`/insights/formulas/${FORMULA_RSI.formulaId}`);
      },
    },
    {
      name: 'Position detail (new)',
      ariaLabel: 'Position path',
      terminalLabel: 'AAPL',
      goto: async (page) => {
        await addAuthCookie(page);
        await page.goto('/trader/positions/AAPL');
      },
    },
    {
      name: 'Signal detail (new)',
      ariaLabel: 'Signal path',
      terminalLabel: 'AAPL',
      goto: async (page) => {
        await addAuthCookie(page);
        await page.goto('/insights/market/AAPL');
      },
    },
    {
      name: 'Order detail (new)',
      ariaLabel: 'Order path',
      terminalLabel: 'mock-order-001',
      goto: async (page) => {
        await addAuthCookie(page);
        await page.goto('/trader/orders/mock-order-001');
      },
    },
  ];

  for (const site of sites) {
    test(`${site.name}: no aria-label / terminal-crumb collision`, async ({ page }) => {
      await site.goto(page);

      // (a) The PageBreadcrumb's own aria-label resolves to exactly one element — no
      // case-insensitive substring match against "Primary"/"Section" or another labeled region.
      await expect(page.getByLabel(site.ariaLabel, { exact: true })).toHaveCount(1);

      // (b) The terminal crumb (BreadcrumbPage always sets role="link" internally) resolves to
      // at most its own link under exact, case-sensitive matching — never colliding with an
      // unrelated real nav Link of the same accessible name.
      await expect(page.getByRole('link', { name: site.terminalLabel, exact: true })).toHaveCount(
        1,
      );
    });
  }

  test('Audit log: the "Audit Log" crumb and the Settings "Audit log" nav item do not collide', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await page.goto('/config-ui/audit');

    // Exact, case-sensitive matching separates the breadcrumb's terminal "Audit Log" crumb from
    // the Settings group's real "Audit log" Section nav link (lowercase "l") — each resolves to
    // exactly its own element.
    await expect(page.getByRole('link', { name: 'Audit Log', exact: true })).toHaveCount(1);
    await expect(page.getByRole('link', { name: 'Audit log', exact: true })).toHaveCount(1);
  });
});
