import { type Page } from '@playwright/test';
import { SignJWT } from 'jose';

/**
 * Shared E2E auth helpers for the consolidated xstockstrat-ui Playwright suite.
 *
 * Before the UI consolidation (feature 045) each of the three frontend suites
 * (trader, insights, config-ui) carried its own byte-identical copy of this
 * helper. The merge into a single `e2e/` tree left 13 duplicated copies behind;
 * they are centralised here so the JWT secret and cookie shape live in one place
 * (matching how `mock-backend.ts` / `global-setup.ts` are already shared).
 */

export const TEST_JWT_SECRET = 'test-jwt-secret-for-e2e-tests-min32c';
export const BASE_URL = 'http://localhost:3000';

/**
 * Signs a short-lived test JWT and injects it as the `access_token` cookie so
 * the Next.js middleware treats the page as authenticated (no redirect to
 * `/auth/login`).
 */
export async function addAuthCookie(page: Page): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({
    user_id: 'test-user-001',
    email: 'test@example.com',
    roles: [],
    issued_at: now,
    expires_at: now + 3600,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(TEST_JWT_SECRET));

  await page.context().addCookies([
    { name: 'access_token', value: token, url: BASE_URL, httpOnly: true, sameSite: 'Lax' },
  ]);
}
