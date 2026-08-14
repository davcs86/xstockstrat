import { test, expect } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';
import { TEST_USER_ID, TEST_USER_EMAIL } from '../fixtures/users';

const PROFILE_BFF = '/accounts/api/profile';

test.describe('Accounts — Profile', () => {
  test('unauthenticated visit redirects to /auth/login', async ({ page }) => {
    const res = await page.request.get('/accounts/profile', { maxRedirects: 0 });
    expect([302, 307]).toContain(res.status());
    expect(res.headers()['location'] ?? '').toContain('/auth/login');
  });

  test('authenticated session renders profile with user_id and email read-only', async ({
    page,
  }) => {
    // Stub the BFF to return a deterministic profile.
    await page.route(PROFILE_BFF, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          userId: TEST_USER_ID,
          email: TEST_USER_EMAIL,
          phone: '+1234567890',
          displayName: 'Test Admin',
          metadata: {},
          metadataUpdatedAt: null,
        }),
      }),
    );
    await addAuthCookie(page);
    await page.goto('/accounts/profile');
    // user_id and email should be visible as read-only (disabled inputs)
    await expect(page.getByRole('textbox', { name: 'User ID' })).toHaveValue(TEST_USER_ID);
    await expect(page.getByRole('textbox', { name: 'Email' })).toHaveValue(TEST_USER_EMAIL);
    // Confirm they are disabled (read-only)
    await expect(page.getByRole('textbox', { name: 'User ID' })).toBeDisabled();
    await expect(page.getByRole('textbox', { name: 'Email' })).toBeDisabled();
  });
});
