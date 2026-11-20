import { test, expect, type Page } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';
import {
  ALERT_DETAIL,
  ALERT_DETAIL_BROADCAST,
  ALERT_DETAIL_BROADCAST_ID,
  ALERT_DETAIL_ID,
  ALERT_DETAIL_UNKNOWN_ID,
} from '../fixtures/alerts';

const GET_ALERT = '/trader/api/xstockstrat.notify.v1.NotifyService/GetAlert';
const MARK_READ = '/trader/api/xstockstrat.notify.v1.NotifyService/MarkAlertRead';
const CONNECT_HEADERS = { 'Content-Type': 'application/json', 'Connect-Protocol-Version': '1' };
const ALERT_PAGE = '/accounts/notifications/';

test.describe('GetAlert BFF contract (feature 344)', () => {
  test('returns the alert with its correlation id and context', async ({ page }) => {
    await addAuthCookie(page);
    const res = await page.request.post(GET_ALERT, {
      headers: CONNECT_HEADERS,
      data: { alertId: ALERT_DETAIL_ID },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.alertId).toBe(ALERT_DETAIL_ID);
    expect(body.correlationId).toBe('c-77');
    expect(body.context.job_id).toBe('67276d1f');
  });

  test('@AC-2 an alert the caller cannot see answers 404 with code not_found', async ({ page }) => {
    await addAuthCookie(page);
    const res = await page.request.post(GET_ALERT, {
      headers: CONNECT_HEADERS,
      data: { alertId: ALERT_DETAIL_UNKNOWN_ID },
    });
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('not_found');
  });
});

// The fixture's bigint `createdAt` cannot go through JSON.stringify; the Connect JSON form is RFC 3339.
function alertJson(override: Partial<typeof ALERT_DETAIL> = {}): string {
  const { createdAt, ...rest } = { ...ALERT_DETAIL, ...override };
  return JSON.stringify({
    ...rest,
    createdAt: new Date(Number(createdAt.seconds) * 1000).toISOString(),
  });
}

async function fulfilGetAlert(page: Page, status: number, body: string) {
  await page.route('**' + GET_ALERT, (route) =>
    route.fulfill({ status, contentType: 'application/json', body }),
  );
}

test.describe('alert page (feature 344)', () => {
  test('@AC-1 every detail of the alert is shown and opening it marks it read', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await page.goto(ALERT_PAGE + ALERT_DETAIL_ID);
    const detail = page.getByTestId('alert-detail');
    await expect(detail.getByText(ALERT_DETAIL.title, { exact: true })).toBeVisible({
      timeout: 30000,
    });
    await expect(detail.getByText('ERROR', { exact: true })).toBeVisible();
    await expect(detail.getByText('backfill', { exact: true })).toBeVisible();
    await expect(detail.getByText('xstockstrat-ingest', { exact: true })).toBeVisible();
    await expect(detail.getByText(ALERT_DETAIL.body, { exact: true })).toBeVisible();
    await expect(
      detail.locator('dt', { hasText: 'Created' }).locator('xpath=following-sibling::dd[1]'),
    ).toHaveText(/\S/);
    await expect(detail.getByText('c-77', { exact: true })).toBeVisible();
    const rows = detail.getByTestId('alert-context-row');
    await expect(rows).toHaveCount(Object.keys(ALERT_DETAIL.context).length);
    await expect(rows.filter({ hasText: 'job_id' })).toContainText('67276d1f');
    await expect(page.getByTestId('alert-read-state')).toHaveText('Read');
  });

  test('@AC-9 an alert targeted at the caller opens', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto(ALERT_PAGE + ALERT_DETAIL_ID);
    const detail = page.getByTestId('alert-detail');
    await expect(detail.getByText(ALERT_DETAIL.title, { exact: true })).toBeVisible({
      timeout: 30000,
    });
    await expect(detail.getByText(ALERT_DETAIL.body, { exact: true })).toBeVisible();
  });

  test('@AC-3 a broadcast alert opens', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto(ALERT_PAGE + ALERT_DETAIL_BROADCAST_ID);
    const detail = page.getByTestId('alert-detail');
    await expect(detail.getByText(ALERT_DETAIL_BROADCAST.title, { exact: true })).toBeVisible({
      timeout: 30000,
    });
    await expect(detail.getByText(ALERT_DETAIL_BROADCAST.body, { exact: true })).toBeVisible();
    await expect(detail.getByText('No context fields')).toBeVisible();
  });

  test('@AC-2 an alert the caller cannot see shows "Alert not found"', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto(ALERT_PAGE + ALERT_DETAIL_UNKNOWN_ID);
    await expect(page.getByTestId('empty-state')).toContainText('Alert not found', {
      timeout: 30000,
    });
    await expect(page.getByTestId('alert-read-state')).toHaveCount(0);
  });

  test('@AC-2 the page keys on the not_found code, not the message', async ({ page }) => {
    await addAuthCookie(page);
    await fulfilGetAlert(
      page,
      404,
      JSON.stringify({ code: 'not_found', message: 'something else entirely' }),
    );
    await page.goto(ALERT_PAGE + ALERT_DETAIL_ID);
    await expect(page.getByTestId('empty-state')).toContainText('Alert not found', {
      timeout: 30000,
    });
  });

  test('a malformed id in the URL shows "Alert not found"', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto(ALERT_PAGE + 'a1f3');
    await expect(page.getByTestId('empty-state')).toContainText('Alert not found', {
      timeout: 30000,
    });
  });

  test('any other error shows "Could not load alert" and marks nothing read', async ({ page }) => {
    await addAuthCookie(page);
    let markReadSent = false;
    await page.route('**' + MARK_READ, async (route) => {
      markReadSent = true;
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await fulfilGetAlert(page, 500, JSON.stringify({ code: 'internal', message: 'db down' }));
    await page.goto(ALERT_PAGE + ALERT_DETAIL_ID);
    await expect(page.getByTestId('empty-state')).toContainText('Could not load alert', {
      timeout: 30000,
    });
    expect(markReadSent).toBe(false);
  });

  test('@AC-6 opening marks read the server-returned id, not the URL id', async ({ page }) => {
    await addAuthCookie(page);
    let markReadIds: string[] | undefined;
    await page.route('**' + MARK_READ, async (route) => {
      markReadIds = route.request().postDataJSON()?.alertIds;
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await fulfilGetAlert(page, 200, alertJson({ alertId: ALERT_DETAIL_BROADCAST_ID }));
    await page.goto(ALERT_PAGE + ALERT_DETAIL_ID);
    await expect.poll(() => markReadIds, { timeout: 30000 }).toEqual([ALERT_DETAIL_BROADCAST_ID]);
  });

  test('a failed mark-read leaves the alert rendered and unread', async ({ page }) => {
    await addAuthCookie(page);
    let markReadFailed = false;
    await page.route('**' + MARK_READ, async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'internal', message: 'db down' }),
      });
      markReadFailed = true;
    });
    await page.goto(ALERT_PAGE + ALERT_DETAIL_ID);
    await expect.poll(() => markReadFailed, { timeout: 30000 }).toBe(true);
    const detail = page.getByTestId('alert-detail');
    await expect(detail.getByText(ALERT_DETAIL.title, { exact: true })).toBeVisible();
    await expect(page.getByTestId('alert-read-state')).toHaveText('Unread');
  });
});
