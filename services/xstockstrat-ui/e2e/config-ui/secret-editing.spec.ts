import { test, expect } from '@playwright/test';
import { addAdminCookie } from '../helpers/auth';

const PLATFORM_NAMESPACE_PAGE = '/config-ui/platform?env=staging';
const SECRET_KEY = 'marketdata.alpaca.api_key';

/**
 * Feature 147 (PR #994 review): secret config rows are now EDITABLE by an admin through config-ui
 * — the value is encrypted at rest by xstockstrat-config and only ciphertext is stored, so the UI
 * lets an admin write a fresh secret while never displaying or prefilling the redacted value.
 *
 * Before this change the Edit action was hidden for `isSecret` rows entirely, so a seeded secret
 * (NULL ciphertext) could never be populated through any UI. These tests pin the new behavior:
 *   - the value column still masks the secret as '[secret]' (never the plaintext),
 *   - the Edit action IS offered for a secret row,
 *   - opening the editor yields a BLANK, masked (type=password) input — never the '[secret]'
 *     sentinel prefilled as if it were the value.
 */
test.describe('config-ui — admin can edit an encrypted secret row (value never disclosed)', () => {
  test('secret row masks its value but still offers Edit, and the editor opens blank + masked', async ({
    page,
  }) => {
    await addAdminCookie(page);
    await page.goto(PLATFORM_NAMESPACE_PAGE);

    const row = page.locator('tr', { hasText: SECRET_KEY });
    await expect(row).toBeVisible();

    // The value is masked, never the stored plaintext/ciphertext.
    await expect(row.getByText('[secret]', { exact: true })).toBeVisible();

    // Edit is now available for a secret row (admin-gated by the backend on Save).
    await row.getByRole('button', { name: 'Actions' }).click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();

    // The editor opens BLANK (not seeded with '[secret]') and masked as a password field, so the
    // operator types a fresh secret and nothing on screen ever reveals the current value.
    const input = row.locator('input').first();
    await expect(input).toHaveValue('');
    await expect(input).toHaveAttribute('type', 'password');
  });
});
