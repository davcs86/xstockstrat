import { test, expect, type Page } from '@playwright/test';
import { addAdminCookie, addAuthCookie } from '../helpers/auth';
import { CONFIG_KEY_STUB_ROWS, listKeysStubBody, TEST_USER_ID } from '../fixtures';
import { KNOWN_NAMESPACES } from '../../src/lib/configNamespaces';

/**
 * Feature 219 — namespace selection is a combobox above the keys table (the landing card grid is
 * gone). Locate the Select by role + exact name only: "platform" also appears as the breadcrumb's
 * terminal crumb, and "Namespace" is a substring of the "Namespace path" breadcrumb label.
 */
function namespaceSelect(page: Page) {
  return page.getByRole('combobox', { name: 'Namespace', exact: true });
}

test.describe('Config-ui namespace selection (feature 219)', () => {
  test('AC-1: landing shows the platform keys table under a Namespace combobox, no grid', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await page.goto('/config-ui?env=staging');

    await expect(namespaceSelect(page)).toHaveText('platform');
    await expect(page.locator('tr', { hasText: 'platform.log_level' })).toBeVisible();
    await expect(page.getByText('Configuration Namespaces')).toHaveCount(0);
  });

  test('AC-1: the combobox offers every known namespace', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/config-ui?env=staging');

    await namespaceSelect(page).click();
    for (const ns of KNOWN_NAMESPACES) {
      await expect(page.getByRole('option', { name: ns, exact: true })).toBeVisible();
    }
  });

  test('AC-2: selecting a namespace navigates and preserves env and the caller user scope', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await page.goto(`/config-ui/platform?env=staging&user=${TEST_USER_ID}`);

    await namespaceSelect(page).click();
    await page.getByRole('option', { name: 'marketdata', exact: true }).click();

    await expect(page).toHaveURL(
      new RegExp(`/config-ui/marketdata\\?env=staging&user=${TEST_USER_ID}$`),
    );
    await expect(namespaceSelect(page)).toHaveText('marketdata');
  });

  test('AC-3: a deep link pre-selects its namespace and lists that namespace keys', async ({
    page,
  }) => {
    await page.route('**/xstockstrat.config.v1.ConfigService/ListKeys', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: listKeysStubBody([CONFIG_KEY_STUB_ROWS.tradingMaxPositionPct]),
      }),
    );
    await addAuthCookie(page);
    await page.goto('/config-ui/trading?env=staging');

    await expect(namespaceSelect(page)).toHaveText('trading');
    await expect(
      page.locator('tr', { hasText: CONFIG_KEY_STUB_ROWS.tradingMaxPositionPct.key }),
    ).toBeVisible();
  });

  test('selecting from the landing page keeps the env query', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/config-ui?env=production');

    await namespaceSelect(page).click();
    await page.getByRole('option', { name: 'trading', exact: true }).click();

    await expect(page).toHaveURL(/\/config-ui\/trading\?env=production/);
  });

  test('switching scope discards an open edit draft (editor remounts)', async ({ page }) => {
    await addAdminCookie(page);
    await page.goto('/config-ui/platform?env=staging');

    const row = page.locator('tr', { hasText: 'platform.log_level' });
    await row.getByRole('button', { name: 'Actions' }).click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    await expect(page.getByPlaceholder('Reason for this change')).toBeVisible();

    await page.getByRole('button', { name: 'my overrides' }).click();

    await expect(page).toHaveURL(new RegExp(`user=${TEST_USER_ID}`));
    await expect(page.getByPlaceholder('Reason for this change')).toHaveCount(0);
  });

  test('AC-14: a namespace page keeps the env/scope header and a non-link Config crumb', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await page.goto('/config-ui/marketdata?env=staging');

    await expect(page.getByText('ENV:')).toBeVisible();
    await expect(page.getByText('SCOPE:')).toBeVisible();
    await expect(namespaceSelect(page)).toBeVisible();
    await expect(page.locator('table')).toBeVisible();

    const crumbs = page.getByLabel('Namespace path', { exact: true });
    await expect(crumbs.locator('li').last()).toHaveText('marketdata');
    await expect(crumbs.getByRole('link', { name: '← namespaces' })).toHaveCount(0);
    await expect(crumbs.getByText('Config', { exact: true })).toBeVisible();
    await expect(crumbs.getByRole('link', { name: 'Config', exact: true })).toHaveCount(0);
  });

  test('Settings › Config is the active nav item on a namespace page', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/config-ui/trading?env=staging');

    // Resolving to the Settings group is what puts Config in the Section nav at all.
    await expect(
      page
        .getByRole('navigation', { name: 'Section' })
        .getByRole('link', { name: 'Config', exact: true }),
    ).toHaveAttribute('aria-current', 'page');
  });

  test('the audit page crumb reads Config and links to /config-ui', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/config-ui/audit');

    await expect(
      page
        .getByLabel('Audit log path', { exact: true })
        .getByRole('link', { name: 'Config', exact: true }),
    ).toHaveAttribute('href', '/config-ui');
  });
});
