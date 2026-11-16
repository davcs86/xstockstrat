import { test, expect } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';
import { ALERT_DETAIL_ID, ALERT_DETAIL_UNKNOWN_ID } from '../fixtures/alerts';

const GET_ALERT = '/trader/api/xstockstrat.notify.v1.NotifyService/GetAlert';
const CONNECT_HEADERS = { 'Content-Type': 'application/json', 'Connect-Protocol-Version': '1' };

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
