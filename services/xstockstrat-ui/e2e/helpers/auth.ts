import { type Page } from '@playwright/test';
import { SignJWT } from 'jose';
import { TEST_USER_ID, TEST_USER_EMAIL } from '../fixtures/users';

/**
 * Shared E2E auth helpers for the consolidated xstockstrat-ui Playwright suite.
 *
 * Before the UI consolidation (feature 045) each of the three frontend suites
 * (trader, insights, config-ui) carried its own byte-identical copy of this
 * helper. The merge into a single `e2e/` tree left 13 duplicated copies behind;
 * they are centralised here so the JWT secret and cookie shape live in one place
 * (matching how `mock-backend.ts` / `global-setup.ts` are already shared).
 *
 * This is the canonical home for test JWT signing (test-data inventory,
 * e2e/fixtures/INVENTORY.md): specs must not re-implement SignJWT or
 * re-declare TEST_JWT_SECRET — import signTestJwt / addAuthCookie /
 * addAdminCookie / addCookieWithRoles instead.
 */

export const TEST_JWT_SECRET = 'test-jwt-secret-for-e2e-tests-min32c';
export const BASE_URL = 'http://localhost:3000';

/**
 * Signs a short-lived JWT for the canonical test user with the given roles.
 * Used by the cookie helpers below and by mock-backend.ts identity responses.
 */
export async function signTestJwt(roles: string[] = []): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    user_id: TEST_USER_ID,
    email: TEST_USER_EMAIL,
    roles,
    issued_at: now,
    expires_at: now + 3600,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(TEST_JWT_SECRET));
}

/**
 * Signs a test JWT carrying the given roles and injects it as the
 * `access_token` cookie so the Next.js middleware treats the page as
 * authenticated (no redirect to `/auth/login`).
 */
export async function addCookieWithRoles(page: Page, roles: string[]): Promise<void> {
  const token = await signTestJwt(roles);
  await page
    .context()
    .addCookies([
      { name: 'access_token', value: token, url: BASE_URL, httpOnly: true, sameSite: 'Lax' },
    ]);
}

/** Authenticated, no roles — the default for most specs. */
export async function addAuthCookie(page: Page): Promise<void> {
  await addCookieWithRoles(page, []);
}

/** Authenticated with the `admin` role (admin-scope gates). */
export async function addAdminCookie(page: Page): Promise<void> {
  await addCookieWithRoles(page, ['admin']);
}
