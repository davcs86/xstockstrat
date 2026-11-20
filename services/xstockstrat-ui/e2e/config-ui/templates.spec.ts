import { test, expect } from '@playwright/test';
import { addAdminCookie } from '../helpers/auth';
import {
  expectFocusOnMarkedTrigger,
  expectRowMenuSettled,
  openMarkedRowMenu,
} from '../helpers/rowMenu';
import {
  SOURCE_TEMPLATE_MEDIATED_WEBSITE,
  STRATEGY_TEMPLATE_MEANREV,
  STRATEGY_TEMPLATE_SYSTEM,
} from '../fixtures';

/**
 * Feature 335 (AC-29) — the admin template catalog renders a platform-seeded template as read-only.
 * The shared mock serves one template per kind, so this spec overrides the strategy list itself.
 */

const ADMIN_TEMPLATE = {
  ...STRATEGY_TEMPLATE_MEANREV,
  meta: { ...STRATEGY_TEMPLATE_MEANREV.meta, templateId: 'tpl-admin-custom' },
};

test.describe('Template authoring (/config-ui/templates)', () => {
  test('a system template shows a System badge and no Edit / Retire', async ({ page }) => {
    await addAdminCookie(page);
    await page.route(
      '**/config-ui/api/xstockstrat.analysis.v1.AnalysisService/ListTemplates',
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ templates: [STRATEGY_TEMPLATE_SYSTEM, ADMIN_TEMPLATE] }),
        });
      },
    );
    await page.goto('/config-ui/templates');
    await page.getByRole('tab', { name: 'Strategy', exact: true }).click();

    // @AC-12: the selected tab carries a background the unselected one does not.
    const unselectedFill = await page
      .getByRole('tab', { name: 'Formula', exact: true })
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    const strategyTab = page.getByRole('tab', { name: 'Strategy', exact: true });
    await expect(strategyTab).toHaveAttribute('aria-selected', 'true');
    await expect(strategyTab).not.toHaveCSS('background-color', unselectedFill);

    const systemRow = page.getByRole('row', { name: /tpl-quality_dip_buyer/ });
    await expect(systemRow.getByText('System', { exact: true })).toBeVisible({ timeout: 10000 });
    await expect(systemRow.getByRole('button', { name: /Actions for template/ })).toHaveCount(0);

    const adminRow = page.getByRole('row', { name: /tpl-admin-custom/ });
    await adminRow.getByRole('button', { name: /Actions for template/ }).click();
    await expect(page.getByRole('menuitem', { name: 'Edit', exact: true })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Retire', exact: true })).toBeVisible();
  });
});

test.describe('Row menu confirm flow (feature 350)', () => {
  test('@AC-6 dismissing Retire closes the menu and the page answers the first click', async ({
    page,
  }) => {
    await addAdminCookie(page);
    await page.goto('/config-ui/templates');
    await page.getByRole('tab', { name: 'Strategy', exact: true }).click();
    await page
      .getByRole('button', { name: `Actions for template ${STRATEGY_TEMPLATE_MEANREV.meta.name}` })
      .click();
    await page.getByRole('menuitem', { name: 'Retire', exact: true }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Cancel', exact: true })
      .click();

    await expectRowMenuSettled(page);
    await page.getByRole('button', { name: 'New strategy template' }).click();
    await expect(page.getByRole('alertdialog', { name: 'New strategy template' })).toBeVisible();
  });

  test('@AC-9 a refused Retire keeps focus on the same row trigger', async ({ page }) => {
    await addAdminCookie(page);
    await page.route(
      '**/config-ui/api/xstockstrat.analysis.v1.AnalysisService/ManageTemplate',
      (route) =>
        route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'failed_precondition', message: 'template is in use' }),
        }),
    );
    await page.goto('/config-ui/templates');
    await page.getByRole('tab', { name: 'Strategy', exact: true }).click();
    const trigger = page.getByRole('button', {
      name: `Actions for template ${STRATEGY_TEMPLATE_MEANREV.meta.name}`,
    });
    await openMarkedRowMenu(trigger);
    await page.getByRole('menuitem', { name: 'Retire', exact: true }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Retire', exact: true })
      .click();

    await expect(page.getByRole('main').getByText('template is in use')).toBeVisible();
    await expectRowMenuSettled(page);
    await expectFocusOnMarkedTrigger(page);
  });
});

test.describe('Signal-source template instructions (feature 355)', () => {
  const INGEST_BFF = '**/config-ui/api/xstockstrat.ingest.v1.IngestService';
  const PROSE = 'Each 8-K item 2.02 entry is an earnings signal.';
  type SourceTemplate = {
    meta: Record<string, unknown>;
    payload: Record<string, unknown>;
  };

  test('@AC-14 the template form saves and reloads extraction instructions', async ({ page }) => {
    await addAdminCookie(page);
    // The shared mock lists one static source template and does not store a ManageTemplate write,
    // so this pair of stubs holds the template for the test.
    let stored: SourceTemplate = SOURCE_TEMPLATE_MEDIATED_WEBSITE;
    await page.route(`${INGEST_BFF}/ListTemplates`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ templates: [stored] }),
      }),
    );
    await page.route(`${INGEST_BFF}/ManageTemplate`, async (route) => {
      const posted = (route.request().postDataJSON() as { template: SourceTemplate }).template;
      stored = { meta: { ...stored.meta, ...posted.meta }, payload: posted.payload };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(stored),
      });
    });
    const name = SOURCE_TEMPLATE_MEDIATED_WEBSITE.meta.name;
    const openEdit = async () => {
      await page.getByRole('button', { name: `Actions for template ${name}` }).click();
      await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
    };

    await page.goto('/config-ui/templates');
    await page.getByRole('tab', { name: 'Signal source', exact: true }).click();
    await openEdit();
    const field = page.getByLabel('Extraction instructions');
    await expect(field).toHaveValue('');
    await field.fill(PROSE);
    const req = page.waitForRequest((r) => r.url().includes('/ManageTemplate'));
    await page.getByRole('button', { name: 'Save template' }).click();
    const body = (await req).postDataJSON() as { template: SourceTemplate };
    expect(body.template.payload.extractionInstructions).toBe(PROSE);
    await expect(field).toHaveCount(0);

    await openEdit();
    await expect(page.getByLabel('Extraction instructions')).toHaveValue(PROSE);
  });
});
