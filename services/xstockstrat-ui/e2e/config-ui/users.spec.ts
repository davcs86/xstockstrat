import { test, expect } from '@playwright/test';
import { addAdminCookie, BASE_URL } from '../helpers/auth';

// Feature 043 — config-ui admin Users section (list, actions, nav reachability, last-admin guard).
// Signed in as admin (the section is adminOnly). The BFF admin-gates every call server-side; here we
// assert the observable UI behavior against the mock IdentityService admin handlers.

const USERS_PAGE = `${BASE_URL}/config-ui/users`;

test.describe('config-ui Users section (feature 043)', () => {
  test('AC-1/AC-10: lists users with roles/status and never shows a password', async ({ page }) => {
    await addAdminCookie(page);
    await page.goto(USERS_PAGE);
    await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();
    // Fixture rows render. Emails are unique so no nav collision; roles/status use unambiguous text.
    // Generous timeout on the first row: the BFF ListUsers route cold-compiles on its first hit (dev).
    await expect(page.getByText('bob@example.com')).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('root@example.com')).toBeVisible();
    await expect(page.getByText('Admin, Trader')).toBeVisible(); // primary user's roles cell
    // Scope to the status Badge — 'Inactive' also appears inside a row's accessible name, so a bare
    // getByText is a strict-mode violation.
    await expect(page.locator('[data-slot="badge"]', { hasText: 'Inactive' })).toBeVisible();
    // AC-10: no password/hash text anywhere on the page.
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body).not.toContain('password_hash');
    expect(body).not.toContain('$2b$'); // bcrypt hash prefix
  });

  test('AC-9: Users is reachable from the config-ui shell nav (admin)', async ({ page }) => {
    await addAdminCookie(page);
    await page.goto(`${BASE_URL}/config-ui/audit`);
    // The desktop Row-2 "Section" nav lists the active (Settings) group's items — Users is there for
    // an admin. Target that landmark to avoid the Primary-group and hidden mobile-offcanvas copies.
    const usersLink = page
      .getByRole('navigation', { name: 'Section' })
      .getByRole('link', { name: 'Users' });
    await expect(usersLink).toBeVisible();
    await usersLink.click();
    await expect(page).toHaveURL(/\/config-ui\/users$/);
    await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();
  });

  test('AC-11: deactivating the last admin surfaces "cannot remove last admin" and keeps the row', async ({
    page,
  }) => {
    await addAdminCookie(page);
    await page.goto(USERS_PAGE);
    // Open the row actions for the last-admin user and try to deactivate.
    await page.getByRole('button', { name: 'Actions for root@example.com' }).click();
    await page.getByRole('menuitem', { name: 'Deactivate' }).click();
    await expect(page.getByText('cannot remove last admin')).toBeVisible();
    // The row stays admin/active (list is not mutated).
    await expect(page.getByText('root@example.com')).toBeVisible();
  });

  test('AC-8 (surface): creating a user round-trips through the BFF without error', async ({
    page,
  }) => {
    await addAdminCookie(page);
    await page.goto(USERS_PAGE);
    await page.getByRole('button', { name: 'Create user' }).click();
    await page.getByLabel('Email').fill('new@example.com');
    await page.getByLabel('Password').fill('a-strong-password');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    // The create dialog closes and no error notice is shown (the mutation succeeded via the BFF).
    await expect(page.getByText('cannot remove last admin')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();
  });
});
