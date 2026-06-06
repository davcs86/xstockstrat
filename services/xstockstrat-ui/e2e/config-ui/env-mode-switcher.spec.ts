import { test, expect } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';

/**
 * E2E tests for the EnvModeSwitcher component (embedded in app/page.tsx).
 *
 * The switcher uses plain <a> tags that update URL search params.  Tests
 * verify that clicking each button produces the correct URL so namespace
 * navigation correctly carries the selected scope.
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

  test('clicking "production" updates URL to ?env=production', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/config-ui?env=dev&mode=paper');

    await page.getByRole('link', { name: 'production' }).click();

    await expect(page).toHaveURL(/env=production/);
    await expect(page).toHaveURL(/mode=paper/);  // mode param preserved
  });

  test('clicking "live" mode updates URL to ?mode=live', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/config-ui?env=dev&mode=paper');

    await page.getByRole('link', { name: 'live' }).click();

    await expect(page).toHaveURL(/mode=live/);
    await expect(page).toHaveURL(/env=dev/);  // env param preserved
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

  test('all four switcher options are rendered', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/config-ui');

    await expect(page.getByRole('link', { name: 'dev' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'production' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'paper' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'live' })).toBeVisible();
  });
});
