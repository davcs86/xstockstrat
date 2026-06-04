import { test, expect } from '@playwright/test';

/**
 * E2E tests for the unified login flow (feature 019).
 *
 * Auth routes are consolidated at /api/auth/{login,logout,refresh}; the login page
 * lives at /auth/login (outside every basePath). The mock backend's IdentityService
 * handles authenticateUser/refreshToken/revokeToken.
 */

test.describe('Unified auth — POST /api/auth/login', () => {
  test('returns 200 and sets access_token + refresh_token cookies with valid credentials', async ({ page }) => {
    const res = await page.request.post('/api/auth/login', {
      data: { email: 'test@example.com', password: 'test-password' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('ok', true);

    const setCookieHeaders = res.headersArray().filter((h) => h.name.toLowerCase() === 'set-cookie');
    const cookieNames = setCookieHeaders.map((h) => h.value);
    expect(cookieNames.some((v) => v.startsWith('access_token='))).toBe(true);
    expect(cookieNames.some((v) => v.startsWith('refresh_token='))).toBe(true);
  });

  test('returns 400 when email or password is missing', async ({ page }) => {
    const res = await page.request.post('/api/auth/login', {
      data: { email: '', password: '' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});

test.describe('Unified auth — protected routes redirect to /auth/login', () => {
  for (const path of ['/trader/api/orders?trading_mode=paper', '/insights/strategies', '/config-ui/']) {
    test(`GET ${path} without a session redirects to /auth/login`, async ({ page }) => {
      const res = await page.request.get(path, { maxRedirects: 0 });
      expect([302, 307]).toContain(res.status());
      expect(res.headers()['location'] ?? '').toContain('/auth/login');
    });
  }
});

test.describe('Unified auth — per-basePath login pages are gone', () => {
  for (const path of ['/trader/login', '/insights/login', '/config-ui/login']) {
    test(`GET ${path} no longer renders a login page`, async ({ page }) => {
      const res = await page.request.get(path, { maxRedirects: 0 });
      // Either a 404 (page removed) or a redirect to the unified login page.
      if (res.status() === 404) {
        expect(res.status()).toBe(404);
      } else {
        expect([302, 307]).toContain(res.status());
        expect(res.headers()['location'] ?? '').toContain('/auth/login');
      }
    });
  }
});

test.describe('Unified auth — POST /api/auth/logout', () => {
  test('clears session cookies after a valid login', async ({ page }) => {
    const loginRes = await page.request.post('/api/auth/login', {
      data: { email: 'test@example.com', password: 'test-password' },
    });
    expect(loginRes.status()).toBe(200);

    const logoutRes = await page.request.post('/api/auth/logout');
    expect(logoutRes.status()).toBe(200);

    const setCookieHeaders = logoutRes
      .headersArray()
      .filter((h) => h.name.toLowerCase() === 'set-cookie');
    const cookieValues = setCookieHeaders.map((h) => h.value);
    expect(cookieValues.some((v) => v.includes('access_token=;') || v.includes('Max-Age=0'))).toBe(true);
  });
});
