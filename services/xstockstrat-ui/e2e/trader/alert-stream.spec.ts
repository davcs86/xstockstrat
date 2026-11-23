import { test, expect } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';
import { bellOf, badgeOf, stubNotify } from '../helpers/alertReadState';
import {
  ALERT_STREAM_HELD,
  ALERT_STREAM_HOLD_MS,
  ALERT_STREAM_HOLD_TRACE_ID,
  DRAWER_ALERT_CLEAR_A,
  DRAWER_ALERT_CLEAR_B,
  DRAWER_ALERT_STORED_READ,
  DRAWER_ALERT_STORED_UNREAD,
  DRAWER_ALERT_STREAMED,
} from '../fixtures/alerts';
import { DEFAULT_UNARY_TIMEOUT_MS } from '../../src/lib/deadlines';

/**
 * E2E tests for the AlertStream bell and drawer. The default-mock tests use the shared mock
 * (ListAlerts with unreadOnly returns its 2 stored unread rows plus the 3 streamed ones). The
 * feature-339 scenarios stub ListAlerts, MarkAlertRead and StreamAlerts per test.
 */

test.describe('AlertStream', () => {
  test('bell icon is visible on the page', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/trader');
    await expect(
      page
        .locator('button')
        .filter({ has: page.locator('svg') })
        .first(),
    ).toBeVisible();
  });

  test('the badge counts the merged unread list before and after the drawer opens', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await page.goto('/trader');
    // 2 stored unread plus 3 streamed (feature 339 design.md § e2e plan).
    await expect(badgeOf(page)).toHaveText('5', { timeout: 10000 });
    await bellOf(page).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(badgeOf(page)).toHaveText('5');
  });

  test('opening the sheet shows at least one alert title', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/trader');
    await expect(badgeOf(page)).toBeVisible({ timeout: 10000 });
    await bellOf(page).click();
    // alert-stream-002 has title 'Order rejected' (severity CRITICAL)
    await expect(page.getByText('Order rejected')).toBeVisible();
  });

  test('high-severity alerts use destructive badge colour', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/trader');
    // alert-stream-002 has severity 4 (CRITICAL) → hasHighSeverity=true → Badge variant="destructive"
    // (feature 121 FR-10: swapped from a raw bg-destructive span to ui/Badge, which sets
    // data-variant rather than a stable literal background class — scope on that instead).
    await expect(
      bellOf(page).locator('[data-slot="badge"][data-variant="destructive"]'),
    ).toBeVisible({ timeout: 10000 });
  });

  test('the alert stream survives past the unary default deadline (feature 271 @AC-5)', async ({
    page,
  }) => {
    test.setTimeout(ALERT_STREAM_HOLD_MS + 45_000);
    await page.setExtraHTTPHeaders({ 'x-trace-id': ALERT_STREAM_HOLD_TRACE_ID });
    await addAuthCookie(page);
    await page.goto('/trader');
    const t0 = Date.now();
    await expect(badgeOf(page)).toBeVisible({ timeout: 10000 });
    await bellOf(page).click();
    await expect(page.getByText(ALERT_STREAM_HELD.title)).toBeVisible({
      timeout: ALERT_STREAM_HOLD_MS + 15_000,
    });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(DEFAULT_UNARY_TIMEOUT_MS);
  });
});

test.describe('Alerts drawer lists unread alerts (feature 339)', () => {
  test('@AC-3 the drawer lists stored unread alerts and not read ones', async ({ page }) => {
    await stubNotify(page, [DRAWER_ALERT_STORED_UNREAD, DRAWER_ALERT_STORED_READ], 'held');
    await addAuthCookie(page);
    await page.goto('/trader');
    await expect(badgeOf(page)).toHaveText('1', { timeout: 10000 });
    await bellOf(page).click();
    const drawer = page.getByRole('dialog');
    await expect(drawer.getByText(DRAWER_ALERT_STORED_UNREAD.title)).toBeVisible();
    await expect(drawer.getByText(DRAWER_ALERT_STORED_READ.title)).toHaveCount(0);

    await page.goto('/accounts/notifications');
    await expect(page.getByLabel('Unread count')).toHaveText('1 unread', { timeout: 10000 });
  });

  test('@AC-4 marking a drawer alert read removes it and persists', async ({ page }) => {
    await stubNotify(page, [DRAWER_ALERT_STORED_UNREAD], 'held');
    await addAuthCookie(page);
    await page.goto('/trader');
    await expect(badgeOf(page)).toHaveText('1', { timeout: 10000 });
    await bellOf(page).click();
    const drawer = page.getByRole('dialog');
    await drawer
      .getByRole('button', { name: `Mark read: ${DRAWER_ALERT_STORED_UNREAD.title}` })
      .click();
    await expect(drawer.getByText('No alerts')).toBeVisible();
    await expect(badgeOf(page)).toHaveCount(0);

    await page.goto('/accounts/notifications');
    await expect(
      page.getByTestId('alert-row').filter({ hasText: DRAWER_ALERT_STORED_UNREAD.title }),
    ).toHaveAttribute('data-read', 'true', { timeout: 10000 });
  });

  test('@AC-5 a streamed alert raises the badge and lists first', async ({ page }) => {
    const notify = await stubNotify(page, [DRAWER_ALERT_STORED_UNREAD], 'gated');
    await addAuthCookie(page);
    await page.goto('/trader');
    await expect(badgeOf(page)).toHaveText('1', { timeout: 10000 });
    await expect.poll(() => notify.streamAttempts).toBeGreaterThan(0);

    notify.streamed.push(DRAWER_ALERT_STREAMED);
    notify.release();
    await expect.poll(() => badgeOf(page).textContent(), { timeout: 10000 }).toBe('2');

    await bellOf(page).click();
    const rows = page.getByRole('dialog').getByRole('listitem');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText(DRAWER_ALERT_STREAMED.title);
    await expect(rows.nth(1)).toContainText(DRAWER_ALERT_STORED_UNREAD.title);
  });

  test('@AC-9 an alert both streamed and stored is listed once', async ({ page }) => {
    const notify = await stubNotify(page, [], 'gated');
    await addAuthCookie(page);
    await page.goto('/trader');
    await expect.poll(() => notify.listCalls, { timeout: 10000 }).toBeGreaterThan(0);
    await expect.poll(() => notify.streamAttempts, { timeout: 10000 }).toBeGreaterThan(0);

    notify.streamed.push(DRAWER_ALERT_STREAMED);
    notify.release();
    notify.stored.push({ ...DRAWER_ALERT_STREAMED, read: false });
    await expect.poll(() => badgeOf(page).textContent(), { timeout: 10000 }).toBe('1');

    await bellOf(page).click();
    const drawer = page.getByRole('dialog');
    await expect(drawer.getByText(DRAWER_ALERT_STREAMED.title, { exact: true })).toHaveCount(1);
    await expect(badgeOf(page)).toHaveText('1');
  });

  test('@AC-10 Clear all marks every unread alert read and persists', async ({ page }) => {
    const notify = await stubNotify(page, [DRAWER_ALERT_CLEAR_A, DRAWER_ALERT_CLEAR_B], 'held');
    await addAuthCookie(page);
    await page.goto('/trader');
    await expect(badgeOf(page)).toHaveText('2', { timeout: 10000 });
    await bellOf(page).click();
    const drawer = page.getByRole('dialog');
    await drawer.getByRole('button', { name: 'Clear all', exact: true }).click();
    await expect(drawer.getByText('No alerts')).toBeVisible();
    await expect(badgeOf(page)).toHaveCount(0);
    expect([...notify.markedIds].sort()).toEqual(
      [DRAWER_ALERT_CLEAR_A.alertId, DRAWER_ALERT_CLEAR_B.alertId].sort(),
    );

    await page.goto('/accounts/notifications');
    const rows = page.getByTestId('alert-row');
    await expect(rows.filter({ hasText: DRAWER_ALERT_CLEAR_A.title })).toHaveAttribute(
      'data-read',
      'true',
      { timeout: 10000 },
    );
    await expect(rows.filter({ hasText: DRAWER_ALERT_CLEAR_B.title })).toHaveAttribute(
      'data-read',
      'true',
    );
  });
});
