import { test, expect } from '@playwright/test';

/**
 * E2E tests for the AlertStream component.
 *
 * The SSE endpoint (/api/alerts/stream) is mocked with page.route() to
 * deliver synthetic alert events, letting us verify the badge counter,
 * severity styling, and clear-all behaviour without a live notify service.
 */

/** Build a minimal SSE response body from an array of alert payloads. */
function sseBody(alerts: object[]): string {
  return alerts.map((a) => `data: ${JSON.stringify(a)}\n\n`).join('');
}

test.describe('AlertStream', () => {
  test('bell icon is visible on the page', async ({ page }) => {
    await page.route('/trader/api/alerts/stream', async (route) => {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
        body: '',
      });
    });

    await page.goto('/trader');
    // The bell icon button is rendered by AlertStream
    await expect(page.locator('button').filter({ has: page.locator('svg') }).first()).toBeVisible();
  });

  test('badge shows unread count after SSE events arrive', async ({ page }) => {
    const alerts = [
      { alert_id: 'a1', severity: 1, category: 'SYSTEM', title: 'Info alert', body: '', source_service: 'trading' },
      { alert_id: 'a2', severity: 2, category: 'RISK', title: 'Warn alert', body: 'Details', source_service: 'trading' },
    ];

    await page.route('/trader/api/alerts/stream', async (route) => {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
        body: sseBody(alerts),
      });
    });

    await page.goto('/trader');
    // Badge should show count of 2
    await expect(page.locator('span').filter({ hasText: '2' })).toBeVisible({ timeout: 5000 });
  });

  test('badge shows 9+ when more than 9 alerts arrive', async ({ page }) => {
    const alerts = Array.from({ length: 10 }, (_, i) => ({
      alert_id: `a${i}`,
      severity: 1,
      category: 'SYSTEM',
      title: `Alert ${i}`,
      body: '',
      source_service: 'trading',
    }));

    await page.route('/trader/api/alerts/stream', async (route) => {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
        body: sseBody(alerts),
      });
    });

    await page.goto('/trader');
    await expect(page.locator('span').filter({ hasText: '9+' })).toBeVisible({ timeout: 5000 });
  });

  test('opening the sheet shows alert title and body', async ({ page }) => {
    const alerts = [
      { alert_id: 'a1', severity: 3, category: 'RISK', title: 'Order rejected', body: 'Insufficient funds', source_service: 'trading' },
    ];

    await page.route('/trader/api/alerts/stream', async (route) => {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
        body: sseBody(alerts),
      });
    });

    await page.goto('/trader');
    // Wait for badge to appear, then click the bell to open the sheet
    await expect(page.locator('span').filter({ hasText: '1' })).toBeVisible({ timeout: 5000 });
    await page.locator('button').filter({ has: page.locator('svg') }).first().click();

    await expect(page.getByText('Order rejected')).toBeVisible();
    await expect(page.getByText('Insufficient funds')).toBeVisible();
  });

  test('high-severity alerts (>=3) use destructive badge colour', async ({ page }) => {
    const alerts = [
      { alert_id: 'a1', severity: 4, category: 'SYSTEM', title: 'Critical failure', body: '', source_service: 'trading' },
    ];

    await page.route('/trader/api/alerts/stream', async (route) => {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
        body: sseBody(alerts),
      });
    });

    await page.goto('/trader');
    // The badge counter span uses bg-destructive for high severity
    await expect(page.locator('span.bg-destructive')).toBeVisible({ timeout: 5000 });
  });

  test('Clear all button resets the badge', async ({ page }) => {
    const alerts = [
      { alert_id: 'a1', severity: 1, category: 'SYSTEM', title: 'Test', body: '', source_service: 'trading' },
    ];

    await page.route('/trader/api/alerts/stream', async (route) => {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
        body: sseBody(alerts),
      });
    });

    await page.goto('/trader');
    await expect(page.locator('span').filter({ hasText: '1' })).toBeVisible({ timeout: 5000 });

    // Open the sheet and clear
    await page.locator('button').filter({ has: page.locator('svg') }).first().click();
    await page.getByRole('button', { name: 'Clear all' }).click();

    // Badge should disappear
    await expect(page.locator('span').filter({ hasText: '1' })).not.toBeVisible();
  });
});
