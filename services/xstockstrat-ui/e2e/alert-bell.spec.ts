import { test, expect, type Page } from '@playwright/test';
import { addAuthCookie } from './helpers/auth';
import { fulfillStream, gate } from './helpers/connectStream';
import { bellOf, badgeOf } from './helpers/alertReadState';
import { ALERT_STREAM_001 } from './fixtures/alerts';

/**
 * Feature 344 (@AC-10, D-14): the bell sits in the shared header, so every segment shows it with
 * the same unread badge under the shared mock, and each page has exactly one stream consumer.
 */

const STREAM_ALERTS = '**/xstockstrat.notify.v1.NotifyService/StreamAlerts';
const DROPPED = { code: 'unavailable', message: 'stream dropped in test' };
const PAGES = ['/trader', '/insights/opportunities', '/config-ui', '/accounts/notifications'];

/** The badge text once two reads in a row agree (the drawer list merges stored and streamed rows). */
async function stableBadgeText(page: Page): Promise<string> {
  await expect(badgeOf(page)).toBeVisible({ timeout: 10000 });
  let previous: string | null = null;
  await expect
    .poll(
      async () => {
        const text = await badgeOf(page).innerText();
        const settled = text === previous;
        previous = text;
        return settled;
      },
      { timeout: 10000, intervals: [500] },
    )
    .toBe(true);
  return previous ?? '';
}

test.describe('the bell on every segment (feature 344)', () => {
  for (const path of PAGES) {
    test(`@AC-10 ${path} shows one bell with the /trader badge`, async ({ page }) => {
      await addAuthCookie(page);
      await page.goto('/trader');
      const traderBadge = await stableBadgeText(page);

      await page.goto(path);
      await expect(bellOf(page)).toBeVisible({ timeout: 10000 });
      await expect(bellOf(page)).toHaveCount(1);
      await expect(badgeOf(page)).toBeVisible({ timeout: 10000 });
      await expect(badgeOf(page)).toHaveText(traderBadge, { timeout: 10000 });
    });
  }

  test('@AC-10 /accounts/notifications has one alert stream consumer', async ({ page }) => {
    await addAuthCookie(page);
    let streamRequests = 0;
    page.on('request', (req) => {
      if (req.url().endsWith('/xstockstrat.notify.v1.NotifyService/StreamAlerts')) {
        streamRequests += 1;
      }
    });
    await page.goto('/accounts/notifications');
    await expect(bellOf(page)).toBeVisible({ timeout: 10000 });
    await expect.poll(() => streamRequests, { timeout: 10000 }).toBeGreaterThanOrEqual(1);
    await expect(bellOf(page)).toHaveCount(1);
  });

  test('@AC-9 @feature-270 the alert stream reconnects on /accounts/notifications', async ({
    page,
  }) => {
    await addAuthCookie(page);
    const reconnect = gate();
    let attempts = 0;
    await page.route(STREAM_ALERTS, async (route) => {
      attempts += 1;
      if (attempts === 1) {
        await fulfillStream(route, [ALERT_STREAM_001], DROPPED);
        return;
      }
      await reconnect.wait;
      await route.continue();
    });

    await page.goto('/accounts/notifications');
    await expect(page.getByTestId('alert-stream-disconnected')).toBeAttached({ timeout: 10000 });
    await expect(bellOf(page)).toHaveAccessibleName(/disconnected/);

    reconnect.release();
    await expect(bellOf(page)).toHaveAccessibleName('Alerts', { timeout: 10000 });
    await expect(page.getByTestId('alert-stream-disconnected')).toHaveCount(0);
  });

  test('@AC-12 @feature-270 /trader keeps the trading-mode badge and the account selector', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await page.goto('/trader');
    const banner = page.getByRole('banner');
    await expect(banner.getByText(/^(paper|live)$/i).first()).toBeVisible({ timeout: 10000 });
    await expect(banner.getByRole('combobox').first()).toBeVisible({ timeout: 5000 });
  });
});
