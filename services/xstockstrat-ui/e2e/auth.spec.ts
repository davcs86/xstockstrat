import { test, expect } from '@playwright/test';

/**
 * E2E tests for the unified login flow (feature 019).
 *
 * Auth routes are consolidated at /api/auth/{login,logout,refresh}; the login page
 * lives at /auth/login (outside every basePath). The mock backend's IdentityService
 * handles authenticateUser/refreshToken/revokeToken.
 */

test.describe('Unified auth — POST /api/auth/login', () => {
  test('returns 200 and sets access_token + refresh_token cookies with valid credentials', async ({
    page,
  }) => {
    const res = await page.request.post('/api/auth/login', {
      data: { email: 'test@example.com', password: 'test-password' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('ok', true);

    const setCookieHeaders = res
      .headersArray()
      .filter((h) => h.name.toLowerCase() === 'set-cookie');
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

test.describe('Extended session — "Remember me" (feature 153)', () => {
  // AC-2/AC-4: opting in writes persistent cookies (Max-Age = 14 days), within the 30-day server TTL.
  test('rememberMe=true sets access_token + refresh_token with Max-Age=1209600', async ({
    page,
  }) => {
    const res = await page.request.post('/api/auth/login', {
      data: { email: 'test@example.com', password: 'test-password', rememberMe: true },
    });
    expect(res.status()).toBe(200);
    const cookies = res
      .headersArray()
      .filter((h) => h.name.toLowerCase() === 'set-cookie')
      .map((h) => h.value);
    const access = cookies.find((v) => v.startsWith('access_token='));
    const refresh = cookies.find((v) => v.startsWith('refresh_token='));
    expect(access).toBeTruthy();
    expect(refresh).toBeTruthy();
    expect(access!.toLowerCase()).toContain('max-age=1209600');
    expect(refresh!.toLowerCase()).toContain('max-age=1209600');
  });

  // AC-3: default (no opt-in) keeps session cookies — no Max-Age / Expires.
  test('without rememberMe the cookies carry no Max-Age (session cookies)', async ({ page }) => {
    const res = await page.request.post('/api/auth/login', {
      data: { email: 'test@example.com', password: 'test-password' },
    });
    expect(res.status()).toBe(200);
    const cookies = res
      .headersArray()
      .filter((h) => h.name.toLowerCase() === 'set-cookie')
      .map((h) => h.value.toLowerCase());
    const access = cookies.find((v) => v.startsWith('access_token='));
    const refresh = cookies.find((v) => v.startsWith('refresh_token='));
    expect(access).toBeTruthy();
    expect(refresh).toBeTruthy();
    expect(access).not.toContain('max-age');
    expect(access).not.toContain('expires=');
    expect(refresh).not.toContain('max-age');
    expect(refresh).not.toContain('expires=');
  });

  // AC-1: the operator login page shows an unchecked Remember me control by default.
  test('operator login page shows an unchecked Remember me checkbox', async ({ page }) => {
    await page.goto('/auth/login');
    const checkbox = page.getByRole('checkbox', { name: /remember me/i });
    await expect(checkbox).toBeVisible();
    await expect(checkbox).not.toBeChecked();
  });

  // The shared OAuth authorize page must NOT show the checkbox (opt-in prop only on operator login).
  test('OAuth login page does not show the Remember me checkbox', async ({ page }) => {
    await page.goto('/auth/oauth-login');
    await expect(page.getByRole('checkbox', { name: /remember me/i })).toHaveCount(0);
  });
});

test.describe('Unified auth — login pages are not edge-cacheable', () => {
  // Regression guard: the login pages must render dynamically (Cache-Control: no-store),
  // NOT be statically prerendered with `s-maxage=31536000`. When they were static, the
  // production edge (Cloudflare — honors only `Vary: Accept-Encoding`, ignores `Vary: RSC`)
  // cached the router's `text/x-component` RSC/Flight prefetch payload under the plain URL
  // key and served it to real document navigations, so the browser rendered raw Flight text
  // (including Next's built-in "404: This page could not be found." string) instead of the
  // login form. `src/app/auth/layout.tsx`'s `export const dynamic = 'force-dynamic'` keeps
  // both `/auth/*` pages uncacheable so the edge can never cross-serve the two variants.
  for (const path of ['/auth/login', '/auth/oauth-login']) {
    test(`GET ${path} is served no-store, not with a long s-maxage`, async ({ page }) => {
      const res = await page.request.get(path);
      expect(res.status()).toBe(200);
      const cacheControl = (res.headers()['cache-control'] ?? '').toLowerCase();
      expect(cacheControl).toContain('no-store');
      expect(cacheControl).not.toContain('s-maxage=31536000');
    });
  }
});

test.describe('Unified auth — protected routes redirect to /auth/login', () => {
  for (const path of [
    '/trader/api/orders?trading_mode=paper',
    '/insights/strategies',
    '/config-ui',
  ]) {
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
    expect(cookieValues.some((v) => v.includes('access_token=;') || v.includes('Max-Age=0'))).toBe(
      true,
    );
  });
});
