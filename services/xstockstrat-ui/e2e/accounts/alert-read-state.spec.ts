import { test, expect } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';
import { badgeOf, bellOf, stubNotify } from '../helpers/alertReadState';
import { DRAWER_ALERT_CLEAR_A, DRAWER_ALERT_STORED_UNREAD } from '../fixtures/alerts';

/**
 * Feature 344 @AC-6: opening an alert, or marking it read in the inbox, clears the bell badge on
 * the same page. Badge values only, never request counts (D-26).
 */

const ALERT = DRAWER_ALERT_STORED_UNREAD;
const ALERT_PAGE = '/accounts/notifications/' + ALERT.alertId;

test.describe('alert read state (feature 344)', () => {
  test('@AC-6 opening the alert page directly clears the bell and persists', async ({ page }) => {
    const notify = await stubNotify(page, [ALERT], 'held');
    await addAuthCookie(page);
    await page.goto(ALERT_PAGE);
    await expect(page.getByTestId('alert-detail')).toContainText(ALERT.title, { timeout: 10000 });
    await expect(badgeOf(page)).toHaveCount(0, { timeout: 10000 });
    // @AC-1 / @AC-3 @feature-203 PRESERVE: the page-open path marks exactly this alert.
    expect(notify.markedIds).toEqual([ALERT.alertId]);

    await page.reload();
    await page.goto('/accounts/notifications');
    await expect(page.getByTestId('alert-row').filter({ hasText: ALERT.title })).toHaveAttribute(
      'data-read',
      'true',
      { timeout: 10000 },
    );
  });

  test('@AC-6 client navigation from the inbox clears the bell without a reload', async ({
    page,
  }) => {
    await stubNotify(page, [ALERT], 'held');
    await addAuthCookie(page);
    await page.goto('/accounts/notifications');
    await expect(badgeOf(page)).toHaveText('1', { timeout: 10000 });
    await page.getByTestId('alert-inbox-list').getByRole('link', { name: ALERT.title }).click();
    await expect(page).toHaveURL(new RegExp(`${ALERT_PAGE}$`));
    await expect(page.getByTestId('alert-detail')).toContainText(ALERT.title);
    await expect(badgeOf(page)).toHaveCount(0, { timeout: 10000 });
  });

  test('a delayed first ListAlerts does not leave a stale badge', async ({ page }) => {
    // A second unread alert makes the settled badge a value ('1'), not an absence that also holds
    // before any ListAlerts has answered; the stale first answer would show '2'.
    const notify = await stubNotify(page, [ALERT, DRAWER_ALERT_CLEAR_A], 'held', {
      holdFirstList: true,
    });
    await addAuthCookie(page);
    await page.goto(ALERT_PAGE);
    await expect(page.getByTestId('alert-detail')).toContainText(ALERT.title, { timeout: 10000 });
    await expect.poll(() => notify.markedIds, { timeout: 10000 }).toEqual([ALERT.alertId]);
    notify.releaseList();
    await expect(badgeOf(page)).toHaveText('1', { timeout: 10000 });
  });

  test('one inbox "Mark read" clears the inbox badge and the bell together', async ({ page }) => {
    await stubNotify(page, [ALERT], 'held');
    await addAuthCookie(page);
    await page.goto('/accounts/notifications');
    await expect(badgeOf(page)).toHaveText('1', { timeout: 10000 });
    await expect(page.getByLabel('Unread count')).toHaveText('1 unread');
    await page.getByRole('button', { name: `Mark notification ${ALERT.title} read` }).click();
    await expect(page.getByLabel('Unread count')).toHaveText('0 unread', { timeout: 10000 });
    await expect(badgeOf(page)).toHaveCount(0, { timeout: 10000 });
  });

  test('a failed page-open mark-read keeps the page and raises no error banner', async ({
    page,
  }) => {
    await stubNotify(page, [ALERT], 'held', { failMarkRead: true });
    await addAuthCookie(page);
    const markFailed = page.waitForResponse(
      (r) => r.url().includes('MarkAlertRead') && r.status() === 500,
    );
    await page.goto(ALERT_PAGE);
    await markFailed;
    await expect(page.getByTestId('alert-detail')).toContainText(ALERT.title, { timeout: 10000 });
    await expect(page.getByTestId('alert-read-state')).toHaveText('Unread');
    // Next's route announcer is an empty role="alert"; the global error banner has text.
    await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toHaveCount(0);
  });
});

test.describe('alert drawer link (feature 344)', () => {
  test('@AC-5 the drawer row title opens the alert page, which then leaves the drawer empty', async ({
    page,
  }) => {
    const notify = await stubNotify(page, [ALERT], 'held');
    await addAuthCookie(page);
    await page.goto('/trader');
    await expect(badgeOf(page)).toHaveText('1', { timeout: 10000 });
    await bellOf(page).click();
    await page.getByRole('dialog').getByRole('link', { name: ALERT.title }).click();
    await expect(page).toHaveURL(new RegExp(`${ALERT_PAGE}$`));
    await expect(page.getByTestId('alert-detail')).toContainText(ALERT.title, { timeout: 10000 });

    await expect.poll(() => notify.markedIds, { timeout: 10000 }).toEqual([ALERT.alertId]);
    await expect(badgeOf(page)).toHaveCount(0, { timeout: 10000 });
    await bellOf(page).click();
    await expect(page.getByRole('dialog').getByText('No alerts')).toBeVisible({ timeout: 10000 });
  });

  test('the drawer closes on /accounts, where the header does not remount', async ({ page }) => {
    await stubNotify(page, [ALERT], 'held');
    await addAuthCookie(page);
    await page.goto('/accounts/notifications');
    await expect(badgeOf(page)).toHaveText('1', { timeout: 10000 });
    await bellOf(page).click();
    await page.getByRole('dialog').getByRole('link', { name: ALERT.title }).click();
    await expect(page).toHaveURL(new RegExp(`${ALERT_PAGE}$`));
    await expect(page.getByTestId('alert-detail')).toContainText(ALERT.title, { timeout: 10000 });
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('the drawer row link nests no button and keeps the row "Mark read"', async ({ page }) => {
    await stubNotify(page, [ALERT], 'held');
    await addAuthCookie(page);
    await page.goto('/trader');
    await expect(badgeOf(page)).toHaveText('1', { timeout: 10000 });
    await bellOf(page).click();
    const drawer = page.getByRole('dialog');
    await expect(drawer.getByRole('link', { name: ALERT.title })).toBeVisible();
    await expect(drawer.locator('a button')).toHaveCount(0);
    await expect(drawer.getByRole('button', { name: `Mark read: ${ALERT.title}` })).toBeVisible();
  });
});
