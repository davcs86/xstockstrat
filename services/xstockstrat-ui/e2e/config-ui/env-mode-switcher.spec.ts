import { test, expect } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';
import { TEST_USER_ID } from '../fixtures/users';

/**
 * E2E tests for the Config UI ENV switcher + per-user SCOPE control (embedded in
 * app/config-ui/page.tsx). Feature 147 replaced the paper/live MODE axis with a global/per-user
 * SCOPE axis and renamed the ENV vocabulary dev→staging (paper/live derives from environment).
 * PR #994 made per-user config owner-only self-service: the SCOPE control offers `global` and
 * `my overrides` (the caller's OWN id) only — no free-form user id — and the server clamps any
 * other requested `?user=` to the global scope.
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

  test('the SCOPE control offers global + "my overrides" toggles and NO free-form user input', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await page.goto('/config-ui?env=staging');

    await expect(page.getByText('ENV:')).toBeVisible();
    await expect(page.getByText('SCOPE:')).toBeVisible();
    await expect(page.getByRole('button', { name: 'global' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'my overrides' })).toBeVisible();
    // The arbitrary-user-id affordance was removed (owner-only self-service, PR #994).
    await expect(page.getByLabel('Per-user scope user id')).toHaveCount(0);
  });

  test('"my overrides" navigates with the caller\'s OWN ?user=', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/config-ui?env=staging');

    await page.getByRole('button', { name: 'my overrides' }).click();

    await expect(page).toHaveURL(new RegExp(`user=${TEST_USER_ID}`));
    await expect(page).toHaveURL(/env=staging/); // env preserved
  });

  test('a hand-edited ?user=<another-user> collapses to the global scope', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/config-ui?env=staging&user=someone-else');

    // The server clamps the scope to the caller's own id, so a foreign user id renders as global:
    // the global toggle is the active (pressed) one and "my overrides" is not.
    await expect(page.getByRole('button', { name: 'global' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByRole('button', { name: 'my overrides' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  test('clicking "global" clears the per-user scope', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto(`/config-ui?env=staging&user=${TEST_USER_ID}`);

    await page.getByRole('button', { name: 'global' }).click();

    await expect(page).not.toHaveURL(/user=/);
    await expect(page).toHaveURL(/env=staging/);
  });
});
