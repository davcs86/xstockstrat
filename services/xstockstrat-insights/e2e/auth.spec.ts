import { test, expect } from '@playwright/test';

test.describe('Auth — POST /api/auth/login', () => {
  test('returns 200 and sets access_token + refresh_token cookies with valid credentials', async ({ page }) => {
    const res = await page.request.post('/insights/api/auth/login', {
      data: { email: 'test@example.com', password: 'test-password' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('ok', true);

    const setCookieHeaders = res.headersArray().filter(h => h.name.toLowerCase() === 'set-cookie');
    const cookieNames = setCookieHeaders.map(h => h.value);
    expect(cookieNames.some(v => v.startsWith('access_token='))).toBe(true);
    expect(cookieNames.some(v => v.startsWith('refresh_token='))).toBe(true);
  });

  test('returns 400 when email or password is missing', async ({ page }) => {
    const res = await page.request.post('/insights/api/auth/login', {
      data: { email: '', password: '' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});

test.describe('Auth — protected routes require a session', () => {
  test('Connect BFF redirects to /login without a session cookie', async ({ page }) => {
    const res = await page.request.post(
      '/insights/api/xstockstrat.analysis.v1.AnalysisService/ListStrategies',
      {
        headers: { 'content-type': 'application/json' },
        data: '{}',
        maxRedirects: 0,
      },
    );
    expect([302, 307]).toContain(res.status());
  });
});

test.describe('Auth — POST /api/auth/logout', () => {
  test('clears session cookies after a valid login', async ({ page }) => {
    const loginRes = await page.request.post('/insights/api/auth/login', {
      data: { email: 'test@example.com', password: 'test-password' },
    });
    expect(loginRes.status()).toBe(200);

    const logoutRes = await page.request.post('/insights/api/auth/logout');
    expect(logoutRes.status()).toBe(200);

    const setCookieHeaders = logoutRes
      .headersArray()
      .filter(h => h.name.toLowerCase() === 'set-cookie');
    const cookieValues = setCookieHeaders.map(h => h.value);
    expect(cookieValues.some(v => v.includes('access_token=;') || v.includes('Max-Age=0'))).toBe(true);
  });
});
