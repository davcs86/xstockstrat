import { test, expect } from '@playwright/test';
import { addAdminCookie, BASE_URL } from '../helpers/auth';

const PLATFORM_NAMESPACE_PAGE = `${BASE_URL}/config-ui/platform?env=dev&mode=paper`;

test.describe('Feature 100 — config-ui reason capture', () => {
  test('a typed reason for platform.log_level is forwarded instead of the hardcoded default', async ({
    page,
  }) => {
    await addAdminCookie(page);
    await page.goto(PLATFORM_NAMESPACE_PAGE);
    await page.getByText('platform.log_level').waitFor();

    const row = page.locator('tr', { hasText: 'platform.log_level' });
    await row.getByRole('button', { name: 'Actions' }).click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    await row.getByPlaceholder('Reason for this change').fill('routine debug toggle — TICKET-999');

    const reqPromise = page.waitForRequest(
      (r) => r.url().includes('/SetConfig') && r.method() === 'POST',
    );
    await row.getByRole('button', { name: 'Save' }).click();
    const body = (await reqPromise).postData() ?? '';
    expect(body).toContain('routine debug toggle');
    expect(body).not.toContain('Updated via config-ui');
  });

  test('an empty reason falls back to the default literal for a non-required key', async ({
    page,
  }) => {
    await addAdminCookie(page);
    await page.goto(PLATFORM_NAMESPACE_PAGE);
    await page.getByText('platform.log_level').waitFor();

    const row = page.locator('tr', { hasText: 'platform.log_level' });
    await row.getByRole('button', { name: 'Actions' }).click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    // Leave the reason field blank.

    const reqPromise = page.waitForRequest(
      (r) => r.url().includes('/SetConfig') && r.method() === 'POST',
    );
    await row.getByRole('button', { name: 'Save' }).click();
    const body = (await reqPromise).postData() ?? '';
    expect(body).toContain('Updated via config-ui');
  });

  test('platform.trading_state requires a non-empty reason before Save is allowed to call SetConfig', async ({
    page,
  }) => {
    await addAdminCookie(page);
    await page.goto(PLATFORM_NAMESPACE_PAGE);
    await page.getByText('platform.trading_state').waitFor();

    const row = page.locator('tr', { hasText: 'platform.trading_state' });
    await row.getByRole('button', { name: 'Actions' }).click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    // Leave the reason field blank.

    let sawSetConfig = false;
    page.on('request', (r) => {
      if (r.url().includes('/SetConfig')) sawSetConfig = true;
    });
    await row.getByRole('button', { name: 'Save' }).click();
    await expect(
      page.getByText('A reason is required when changing platform.trading_state'),
    ).toBeVisible();
    expect(sawSetConfig).toBe(false);
  });
});
