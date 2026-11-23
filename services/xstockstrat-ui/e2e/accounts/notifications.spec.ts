import { test, expect, type Page } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';
import { TEST_USER_ID } from '../fixtures/users';
import { ALERT_LIST_WITH_READ_STATE, ALERT_UNREAD } from '../fixtures/alerts';

/**
 * E2E for the /accounts "Notifications" push feature (feature 165).
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
  test('renders the toggle with an accessible name', async ({ page }) => {
    // PushToggle only renders the Switch when Notification.permission !== 'denied'. CI runs the
    // `chrome-headless-shell` build, which has no notification platform and hard-reports
    // Notification.permission === 'denied' regardless of context.grantPermissions(['notifications'])
    // — so a real grant can't reach the 'ready' state there (it renders the blocked notice instead).
    // Force the permission getter to 'granted' before app scripts run so the enabled control renders
    // deterministically across browsers; we're asserting the control's accessible name (C-17), not the
    // browser's permission plumbing (the enable/register wiring is covered by the IDOR-guard specs above).
    await page.addInitScript(() => {
      Object.defineProperty(Notification, 'permission', {
        configurable: true,
        get: () => 'granted',
      });
    });
    await addAuthCookie(page);
    await page.goto('/accounts/notifications');
    await expect(page.getByRole('heading', { name: 'Push notifications' })).toBeVisible();
    // The control carries a unique accessible name (C-17).
    await expect(page.getByRole('switch', { name: 'Enable push notifications' })).toBeVisible();
  });

  async function thumbAndTrackCentres(page: Page) {
    const track = page.getByRole('switch', { name: 'Enable push notifications' });
    const trackBox = await track.boundingBox();
    const thumbBox = await track.locator('[data-slot="switch-thumb"]').boundingBox();
    if (!trackBox || !thumbBox) throw new Error('switch track or thumb not rendered');
    return {
      thumb: thumbBox.x + thumbBox.width / 2,
      track: trackBox.x + trackBox.width / 2,
    };
  }

  test('@AC-6 a checked switch is displayed with its thumb at the trailing end', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(Notification, 'permission', {
        configurable: true,
        get: () => 'granted',
      });
      // `ready` is a prototype accessor, so it is overridden on the prototype, not assigned.
      Object.defineProperty(ServiceWorkerContainer.prototype, 'ready', {
        configurable: true,
        get: () =>
          Promise.resolve({
            pushManager: {
              getSubscription: () => Promise.resolve({ endpoint: 'https://push.example/e2e' }),
            },
          }),
      });
    });
    await addAuthCookie(page);
    await page.goto('/accounts/notifications');
    const toggle = page.getByRole('switch', { name: 'Enable push notifications' });
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await expect
      .poll(async () => {
        const c = await thumbAndTrackCentres(page);
        return c.thumb > c.track;
      })
      .toBe(true);
  });

  test('@AC-7 an unchecked switch is displayed with its thumb at the leading end', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(Notification, 'permission', {
        configurable: true,
        get: () => 'granted',
      });
    });
    await addAuthCookie(page);
    await page.goto('/accounts/notifications');
    const toggle = page.getByRole('switch', { name: 'Enable push notifications' });
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    const c = await thumbAndTrackCentres(page);
    expect(c.thumb).toBeLessThan(c.track);
  });
});

test.describe('alert inbox (feature 203)', () => {
  const MARK_READ = '/trader/api/xstockstrat.notify.v1.NotifyService/MarkAlertRead';

  test('@AC-6 renders alerts with severity badge, module (category), body, and an unread indicator', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await page.goto('/accounts/notifications');
    await expect(page.getByTestId('alert-inbox-list')).toBeVisible({ timeout: 10000 });
    // Module (category) and body are surfaced for every alert (AC-6: level/module/body/unread).
    await expect(page.getByTestId('alert-module').first()).toBeVisible();
    await expect(page.getByTestId('alert-body').first()).toBeVisible();
    // A severity badge is rendered (level).
    await expect(page.locator('span[data-slot="badge"]').first()).toBeVisible();
    // An unread alert shows the unread dot indicator.
    await expect(page.getByLabel('Unread', { exact: true }).first()).toBeVisible();
  });

  test('@AC-6 displays the server-side unread count', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/accounts/notifications');
    // MOCK_UNREAD_COUNT = 2 (two of the three mock alerts are unread).
    await expect(page.getByLabel('Unread count')).toHaveText('2 unread');
  });

  test('@AC-1 Mark read calls MarkAlertRead with the alert id', async ({ page }) => {
    await addAuthCookie(page);
    let markReadIds: string[] | undefined;
    await page.route('**' + MARK_READ, async (route) => {
      markReadIds = route.request().postDataJSON()?.alertIds;
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await page.goto('/accounts/notifications');
    await expect(page.getByTestId('alert-inbox-list')).toBeVisible({ timeout: 10000 });
    // Per-alert "Mark read" renders only on unread rows; click the first.
    await page
      .getByRole('button', { name: /^Mark notification .* read$/ })
      .first()
      .click();
    await expect.poll(() => markReadIds?.length ?? 0).toBeGreaterThan(0);
  });

  test('@AC-4 the inbox row title opens the alert page', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/accounts/notifications');
    const list = page.getByTestId('alert-inbox-list');
    await expect(list).toBeVisible({ timeout: 10000 });
    await list.getByRole('link', { name: ALERT_UNREAD.title }).click();
    await expect(page).toHaveURL(new RegExp(`/accounts/notifications/${ALERT_UNREAD.alertId}$`));
    await expect(page.getByTestId('alert-detail')).toContainText(ALERT_UNREAD.title);
  });

  test('@AC-6 @feature-203 the title link leaves every row intact and nests no button', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await page.goto('/accounts/notifications');
    const list = page.getByTestId('alert-inbox-list');
    await expect(list).toBeVisible({ timeout: 10000 });
    await expect(list.getByTestId('alert-row')).toHaveCount(ALERT_LIST_WITH_READ_STATE.length);
    for (const a of ALERT_LIST_WITH_READ_STATE) {
      const row = list.getByTestId('alert-row').filter({ hasText: a.title });
      await expect(row.getByTestId('alert-module')).toHaveText(a.category);
      await expect(row.getByTestId('alert-body')).toHaveText(a.body);
      await expect(
        row.getByRole('button', { name: `Mark notification ${a.title} read` }),
      ).toHaveCount(a.read ? 0 : 1);
    }
    await expect(page.locator('a button')).toHaveCount(0);
  });
});
