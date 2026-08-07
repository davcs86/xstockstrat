import { test, expect } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';

/**
 * E2E tests for the EnvModeSwitcher component (embedded in app/page.tsx).
 *
 * The switcher uses plain <a> tags that update URL search params.  Tests
 * verify that clicking each button produces the correct URL so namespace
 * navigation correctly carries the selected scope.
 *
 * Feature 115: the non-native ENV option (relative to this deployment's
 * APPLICATION_ENV — 'dev' in the e2e webServer) renders as a fixed Badge
 * instead of a link, since a write scoped to it is rejected by the BFF guard.
 *
 * Auth cookie is injected directly so the middleware does not redirect to /login.
 */

test.describe('EnvModeSwitcher', () => {
  test('ENV "dev" button is active by default', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/config-ui');
    // Active env button has bg-primary/10 and text-primary classes
    const devBtn = page.getByRole('link', { name: 'dev' }).first();
    await expect(devBtn).toBeVisible();
    // Active state is indicated by Tailwind classes — just verify default URL has env=dev
    await expect(page).toHaveURL(/env=dev/);
  });

  test('ENV "production" renders as a fixed badge, not a link, on this dev-native deployment', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await page.goto('/config-ui?env=dev&mode=paper');

    await expect(page.getByRole('link', { name: 'production' })).toHaveCount(0);
    const badge = page.getByText('production', { exact: true });
    await expect(badge).toBeVisible();
    await expect(badge).toHaveAttribute('title', /native environment is dev/);
  });

  test('clicking "live" mode updates URL to ?mode=live', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/config-ui?env=dev&mode=paper');

    await page.getByRole('link', { name: 'live' }).click();

    await expect(page).toHaveURL(/mode=live/);
    await expect(page).toHaveURL(/env=dev/); // env param preserved
  });

  test('clicking "paper" mode from live restores ?mode=paper', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/config-ui?env=dev&mode=live');

    await page.getByRole('link', { name: 'paper' }).click();

    await expect(page).toHaveURL(/mode=paper/);
  });

  test('both ENV and MODE rows are visible', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/config-ui');

    await expect(page.getByText('ENV:')).toBeVisible();
    await expect(page.getByText('MODE:')).toBeVisible();
  });

  test('dev/paper/live render as links; production renders as a fixed badge', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/config-ui');

    await expect(page.getByRole('link', { name: 'dev' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'production' })).toHaveCount(0);
    await expect(page.getByText('production', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'paper' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'live' })).toBeVisible();
  });
});
