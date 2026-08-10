import { test, expect } from '@playwright/test';
import { addAdminCookie } from '../helpers/auth';

/**
 * E2E coverage for the namespace editor's non-native-environment gate (feature 115).
 * webServer.env sets APPLICATION_ENV=development, so this deployment's native Config UI
 * scope is 'dev'.
 */
test.describe('NamespaceEditor — non-native environment gate', () => {
  test("shows a warning banner and disables Save when env is not this deployment's native scope", async ({
    page,
  }) => {
    await addAdminCookie(page);
    await page.goto('/config-ui/platform?env=production&mode=paper');

    await expect(page.getByText(/native environment is/i)).toBeVisible();

    await page.getByRole('button', { name: 'Actions' }).first().click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  test('the native environment (dev) shows no banner and Save stays enabled', async ({ page }) => {
    await addAdminCookie(page);
    await page.goto('/config-ui/platform?env=dev&mode=paper');

    await expect(page.getByText(/native environment is/i)).toHaveCount(0);

    await page.getByRole('button', { name: 'Actions' }).first().click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled();
  });
});
