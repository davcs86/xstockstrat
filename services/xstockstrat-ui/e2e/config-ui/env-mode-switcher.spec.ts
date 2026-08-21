import { test, expect } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';

/**
 * E2E tests for the Config UI ENV switcher + per-user SCOPE control (embedded in
 * app/config-ui/page.tsx). Feature 147 replaced the paper/live MODE axis with a global/per-user
 * SCOPE axis and renamed the ENV vocabulary dev→staging (paper/live derives from environment).
 *
 * The ENV switcher uses plain <a> tags that update the `env` search param; the non-native ENV
 * option (relative to this deployment's APPLICATION_ENV — 'staging' in the e2e webServer, which
 * sets APPLICATION_ENV=development) renders as a fixed Badge instead of a link, since a write
 * scoped to it is rejected by the BFF guard.
 *
 * Auth cookie is injected directly so the middleware does not redirect to /login.
 */

test.describe('Config UI ENV + SCOPE switcher', () => {
  test('ENV defaults to "staging" (this deployment\'s native scope)', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/config-ui');
    const stagingBtn = page.getByRole('link', { name: 'staging' }).first();
    await expect(stagingBtn).toBeVisible();
    await expect(page).toHaveURL(/env=staging/);
  });

  test('ENV "production" renders as a fixed badge, not a link, on this staging-native deployment', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await page.goto('/config-ui?env=staging');

    await expect(page.getByRole('link', { name: 'production' })).toHaveCount(0);
    const badge = page.getByText('production', { exact: true });
    await expect(badge).toBeVisible();
    await expect(badge).toHaveAttribute('title', /native environment is staging/);
  });

  test('the SCOPE control offers a global toggle and a per-user input', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/config-ui?env=staging');

    await expect(page.getByText('ENV:')).toBeVisible();
    await expect(page.getByText('SCOPE:')).toBeVisible();
    await expect(page.getByRole('button', { name: 'global' })).toBeVisible();
    await expect(page.getByLabel('Per-user scope user id')).toBeVisible();
  });

  test('applying a per-user id navigates with ?user=', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/config-ui?env=staging');

    await page.getByLabel('Per-user scope user id').fill('u-123');
    await page.getByRole('button', { name: 'apply' }).click();

    await expect(page).toHaveURL(/user=u-123/);
    await expect(page).toHaveURL(/env=staging/); // env preserved
  });

  test('clicking "global" clears the per-user scope', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/config-ui?env=staging&user=u-123');

    await page.getByRole('button', { name: 'global' }).click();

    await expect(page).not.toHaveURL(/user=/);
    await expect(page).toHaveURL(/env=staging/);
  });
});
