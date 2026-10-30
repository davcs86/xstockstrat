import { test, expect, type APIResponse } from '@playwright/test';
import { REFRESH_STALL_TOKEN, signExpiredTestJwt } from './helpers/auth';
import { REFRESH_TIMEOUT_MS } from '../src/lib/deadlines';

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
    const marker = cookies.find((v) => v.startsWith('remember_me='));
    expect(access).toBeTruthy();
    expect(refresh).toBeTruthy();
    expect(access!.toLowerCase()).toContain('max-age=1209600');
    expect(refresh!.toLowerCase()).toContain('max-age=1209600');
    // The server-readable remember-me marker is set persistent so the refresh paths can re-apply
    // the extended Max-Age on rotation (the bug this fixed: refresh silently dropped persistence).
    expect(marker).toBeTruthy();
    expect(marker).toContain('remember_me=1');
    expect(marker!.toLowerCase()).toContain('max-age=1209600');
  });

  // Regression guard for the fix: a token refresh must NOT downgrade a persistent "Remember me"
  // session to session cookies. The browser never echoes a cookie's Max-Age, so /api/auth/refresh
  // recovers the intent from the remember_me marker and re-applies the rolling 14-day Max-Age.
  test('POST /api/auth/refresh preserves the extended Max-Age when the remember_me marker is present', async ({
    request,
  }) => {
    const res = await request.post('/api/auth/refresh', {
      headers: { cookie: 'refresh_token=test-refresh-token; remember_me=1' },
    });
    expect(res.status()).toBe(200);
    const cookies = res
      .headersArray()
      .filter((h) => h.name.toLowerCase() === 'set-cookie')
      .map((h) => h.value);
    const access = cookies.find((v) => v.startsWith('access_token='));
    const refresh = cookies.find((v) => v.startsWith('refresh_token='));
    const marker = cookies.find((v) => v.startsWith('remember_me='));
    for (const cookie of [access, refresh, marker]) {
      expect(cookie).toBeTruthy();
      expect(cookie!.toLowerCase()).toContain('max-age=1209600');
    }
  });

  // Complementary guard: a transient (no marker) session refresh stays session cookies.
  test('POST /api/auth/refresh keeps session cookies when no remember_me marker is present', async ({
    request,
  }) => {
    const res = await request.post('/api/auth/refresh', {
      headers: { cookie: 'refresh_token=test-refresh-token' },
    });
    expect(res.status()).toBe(200);
    const cookies = res
      .headersArray()
      .filter((h) => h.name.toLowerCase() === 'set-cookie')
      .map((h) => h.value.toLowerCase());
    const access = cookies.find((v) => v.startsWith('access_token='));
    const refresh = cookies.find((v) => v.startsWith('refresh_token='));
    expect(access).not.toContain('max-age');
    expect(refresh).not.toContain('max-age');
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
    // No persistent remember-me marker: if emitted at all it is a Max-Age=0 wipe of any prior one.
    const marker = cookies.find((v) => v.startsWith('remember_me='));
    if (marker) expect(marker).toContain('max-age=0');
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

test.describe('OAuth login — agent_cb is never followed unless it is the agent callback', () => {
  // playwright.config.ts sets AGENT_PUBLIC_URL=http://127.0.0.1:9099.
  for (const agentCb of ['javascript:alert(document.domain)//', 'https://attacker.example/cb']) {
    test(`rejects agent_cb=${agentCb}`, async ({ page }) => {
      await page.goto(`/auth/oauth-login?agent_cb=${encodeURIComponent(agentCb)}&txn=x&state=y`);
      await expect(page.getByText('Invalid OAuth authorization request.')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Authorize' })).toHaveCount(0);
    });
  }

  test('renders the form for the server-resolved agent callback', async ({ page }) => {
    const agentCb = encodeURIComponent('http://127.0.0.1:9099/oauth/callback');
    await page.goto(`/auth/oauth-login?agent_cb=${agentCb}&txn=x&state=y`);
    await expect(page.getByRole('button', { name: 'Authorize' })).toBeVisible();
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

test.describe('Segment health routes are reachable without a session (feature 271 @AC-3)', () => {
  for (const [path, status] of [
    ['/trader/health', 200],
    ['/trader/api/health', 200],
    ['/insights/health', 200],
    ['/insights/api/health', 200],
    ['/config-ui/health', 200],
    ['/config-ui/api/health', 200],
    ['/accounts/api/health', 200],
    ['/accounts/api/agent-health', 401],
  ] as const) {
    test(`GET ${path} without a session responds ${status}`, async ({ page }) => {
      const res = await page.request.get(path, { maxRedirects: 0 });
      expect(res.status()).toBe(status);
      expect(res.headers()['location']).toBeUndefined();
      const body = await res.json();
      if (status === 200) expect(body.status).toBe('ok');
      else expect(body.error).toBe('Unauthorized');
    });
  }
});

test.describe('Non-health routes still require a session (feature 271 @AC-4)', () => {
  for (const path of [
    '/trader/orders',
    '/trader/healthcheck-x',
    '/insights/api/health-extra',
    '/config-ui',
    '/accounts',
    '/healthcheck-x',
    '/health/anything',
  ]) {
    test(`GET ${path} without a session redirects to /auth/login`, async ({ page }) => {
      const res = await page.request.get(path, { maxRedirects: 0 });
      expect([302, 307]).toContain(res.status());
      expect(res.headers()['location'] ?? '').toContain('/auth/login');
    });
  }
});

test.describe('Session refresh against a stalled identity (feature 271 @AC-2)', () => {
  test.setTimeout(REFRESH_TIMEOUT_MS + 20_000);

  function expectSessionCookiesCleared(res: APIResponse): void {
    const cookies = res
      .headersArray()
      .filter((h) => h.name.toLowerCase() === 'set-cookie')
      .map((h) => h.value);
    for (const name of ['access_token=', 'refresh_token=']) {
      const cookie = cookies.find((v) => v.startsWith(name));
      expect(cookie).toBeTruthy();
      expect(cookie!.toLowerCase()).toContain('max-age=0');
    }
  }

  test('middleware refresh fails closed: redirects to login and clears cookies', async ({
    page,
  }) => {
    const started = Date.now();
    const res = await page.request.get('/trader', {
      maxRedirects: 0,
      timeout: REFRESH_TIMEOUT_MS + 15_000,
      headers: {
        cookie: `access_token=${await signExpiredTestJwt()}; refresh_token=${REFRESH_STALL_TOKEN}`,
      },
    });
    const elapsed = Date.now() - started;
    expect([302, 307]).toContain(res.status());
    expect(res.headers()['location'] ?? '').toContain('/auth/login?redirect=%2Ftrader');
    expectSessionCookiesCleared(res);
    expect(elapsed).toBeLessThanOrEqual(REFRESH_TIMEOUT_MS + 5_000);
  });

  test('POST /api/auth/refresh fails closed: 401 and clears cookies', async ({ request }) => {
    const started = Date.now();
    const res = await request.post('/api/auth/refresh', {
      timeout: REFRESH_TIMEOUT_MS + 15_000,
      headers: { cookie: `refresh_token=${REFRESH_STALL_TOKEN}` },
    });
    const elapsed = Date.now() - started;
    expect(res.status()).toBe(401);
    expectSessionCookiesCleared(res);
    expect(elapsed).toBeLessThanOrEqual(REFRESH_TIMEOUT_MS + 5_000);
  });
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
