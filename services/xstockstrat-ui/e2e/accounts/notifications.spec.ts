import { test, expect } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';
import { TEST_USER_ID } from '../fixtures/users';

/**
 * E2E for the /accounts "Notifications" push feature (feature 163).
 *
 * The register/unregister IDOR guard (@AC-2 / @AC-3) is proven by driving the trader BFF's Connect
 * endpoint directly — the browser Push API is not reliably stubbable in headless Chromium, and the
 * property under test is the BFF wiring, not the browser's push service. Identity is carried by the
 * propagated x-user-id header (set by the BFF from the verified session, never settable by the
 * browser); the mock echoes that header value back as the subscription id. So even a request whose
 * body tries to assert another user comes back stamped with the session user.
 */

const REGISTER = '/trader/api/xstockstrat.notify.v1.NotifyService/RegisterPushSubscription';
const UNREGISTER = '/trader/api/xstockstrat.notify.v1.NotifyService/UnregisterPushSubscription';
const CONNECT_HEADERS = { 'Content-Type': 'application/json', 'Connect-Protocol-Version': '1' };

test.describe('push subscription BFF (IDOR guard)', () => {
  test('@AC-2 register owner comes from the session x-user-id header, not the request body', async ({
    page,
  }) => {
    await addAuthCookie(page);
    const res = await page.request.post(REGISTER, {
      headers: CONNECT_HEADERS,
      // A body-supplied userId would be ignored — the proto has no user_id field and the notify
      // service resolves the owner from the x-user-id header the BFF forwards from the session.
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
    // The mock echoes the header-derived caller — proving identity came from the session, not the body.
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
  test('renders the toggle with an accessible name', async ({ page, context }) => {
    // Grant Notification permission so the toggle reaches the 'ready' state and renders the Switch.
    // Headless Chromium defaults Notification.permission to 'denied', which would (correctly) render
    // the blocked notice instead — we want to exercise the enabled control here (C-17 accessible name).
    await context.grantPermissions(['notifications'], { origin: 'http://localhost:3000' });
    await addAuthCookie(page);
    await page.goto('/accounts/notifications');
    await expect(page.getByRole('heading', { name: 'Push notifications' })).toBeVisible();
    // The control carries a unique accessible name (C-17).
    await expect(page.getByRole('switch', { name: 'Enable push notifications' })).toBeVisible();
  });
});
