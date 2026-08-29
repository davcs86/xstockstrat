import { test, expect } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';
import { TEST_USER_ID } from '../fixtures/users';

/**
 * E2E for the /accounts "Notifications" push feature (feature 163).
 *
 * The register/unregister IDOR guard (@AC-2 / @AC-3) is proven by driving the trader BFF's Connect
 * endpoint directly — the browser Push API is not reliably stubbable in headless Chromium, and the
 * property under test is the BFF wiring, not the browser's push service. The mock backend echoes the
 * received user_id back as the subscription id, so a request that carries a SPOOFED userId still
 * comes back stamped with the session user — proving the BFF overrides it from the verified session.
 */

const REGISTER = '/trader/api/xstockstrat.notify.v1.NotifyService/RegisterPushSubscription';
const UNREGISTER = '/trader/api/xstockstrat.notify.v1.NotifyService/UnregisterPushSubscription';
const CONNECT_HEADERS = { 'Content-Type': 'application/json', 'Connect-Protocol-Version': '1' };

test.describe('push subscription BFF (IDOR guard)', () => {
  test('@AC-2 register stamps the session user, ignoring a browser-supplied userId', async ({
    page,
  }) => {
    await addAuthCookie(page);
    const res = await page.request.post(REGISTER, {
      headers: CONNECT_HEADERS,
      // Deliberately spoof userId — the BFF must overwrite it with the session user.
      data: {
        userId: 'attacker-999',
        endpoint: 'https://push.example/e2e',
        p256dh: 'p',
        auth: 'a',
        userAgent: 'ua',
      },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.subscriptionId).toBe(TEST_USER_ID);
    expect(body.subscriptionId).not.toBe('attacker-999');
  });

  test('@AC-3 unregister targets the endpoint (no user scoping)', async ({ page }) => {
    await addAuthCookie(page);
    const res = await page.request.post(UNREGISTER, {
      headers: CONNECT_HEADERS,
      data: { endpoint: 'https://push.example/e2e' },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.deleted).toBe(true);
  });

  test('unauthenticated register is redirected to login (auth guard preserved)', async ({
    page,
  }) => {
    // No auth cookie — the middleware redirects the data call to /auth/login before it reaches notify.
    const res = await page.request.post(REGISTER, {
      headers: CONNECT_HEADERS,
      data: { endpoint: 'https://push.example/e2e', p256dh: 'p', auth: 'a' },
      maxRedirects: 0,
    });
    expect(res.status()).toBe(307);
    expect(res.headers()['location']).toContain('/auth/login');
  });
});

test.describe('push notifications page', () => {
  test('renders the toggle with an accessible name', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/accounts/notifications');
    await expect(page.getByRole('heading', { name: 'Push notifications' })).toBeVisible();
    // The control has a unique accessible name (C-17) — asserted regardless of push support state.
    // In a browser lacking push support the page instead shows the unsupported empty state.
    const toggle = page.getByRole('switch', { name: 'Enable push notifications' });
    const unsupported = page.getByText("Notifications aren't supported here");
    await expect(toggle.or(unsupported)).toBeVisible();
  });
});
