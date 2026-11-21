import { test, expect } from '@playwright/test';
import { addAdminCookie } from '../helpers/auth';
import { CONFIG_KEY_FIXTURES } from '../fixtures';

// Fixture rows carry relative keys (feature 296); the page composes the FQN from the open namespace.
const NOTIFY_NAMESPACE_PAGE = '/config-ui/notify?env=staging';
const PROVIDER_KEY = 'fanout.email_provider';
const APP_KEY = 'commsgun.app_key';

function seeded(key: string) {
  const row = CONFIG_KEY_FIXTURES.find((r) => r.key === key);
  if (!row) throw new Error(`CONFIG_KEY_FIXTURES has no ${key} row`);
  return row;
}

/**
 * Feature 338 (AC-16): the commsgun email provider is operated from config-ui's generic key editor.
 * The editor lists stored rows only, so these rows stand for what the seed migration writes.
 */
test.describe('config-ui — notify commsgun email provider keys', () => {
  test('lists the provider mode with its seeded value and masks the app key', async ({ page }) => {
    await addAdminCookie(page);
    await page.goto(NOTIFY_NAMESPACE_PAGE);

    const provider = page.locator('tr', { hasText: `notify.${PROVIDER_KEY}` });
    // First load of the namespace route on a cold dev server (same allowance as users.spec.ts).
    await expect(provider).toBeVisible({ timeout: 30000 });
    await expect(
      provider.getByRole('cell', { name: seeded(PROVIDER_KEY).defaultValue, exact: true }),
    ).toBeVisible();

    const secret = page.locator('tr', { hasText: `notify.${APP_KEY}` });
    await expect(secret).toBeVisible();
    await expect(secret.getByText('[secret]', { exact: true })).toBeVisible();

    // The editor opens blank and masked: nothing on screen ever shows the stored key.
    await secret.getByRole('button', { name: 'Actions' }).click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    const input = secret.locator('input').first();
    await expect(input).toHaveValue('');
    await expect(input).toHaveAttribute('type', 'password');
  });

  // This spec owns notify.fanout.email_provider on the shared mock backend: no other spec writes it.
  test('saving the provider mode as sendgrid shows it, and it survives a reload', async ({
    page,
  }) => {
    await addAdminCookie(page);
    await page.goto(NOTIFY_NAMESPACE_PAGE);

    const row = page.locator('tr', { hasText: `notify.${PROVIDER_KEY}` });
    await expect(row).toBeVisible({ timeout: 30000 });
    await row.getByRole('button', { name: 'Actions' }).click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    await row.locator('input').first().fill('sendgrid');
    const saved = page.waitForResponse((r) => r.url().includes('/SetConfig') && r.status() === 200);
    await row.getByRole('button', { name: 'Save' }).click();
    await saved;

    await expect(row.getByRole('cell', { name: 'sendgrid', exact: true })).toBeVisible();

    await page.reload();
    const reloaded = page.locator('tr', { hasText: `notify.${PROVIDER_KEY}` });
    await expect(reloaded.getByRole('cell', { name: 'sendgrid', exact: true })).toBeVisible();
  });
});
