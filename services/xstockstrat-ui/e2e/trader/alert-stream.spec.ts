import { test, expect, type Page } from '@playwright/test';
import { SignJWT } from 'jose';

/**
 * E2E tests for the AlertStream component.
 *
 * The mock backend (port 9091) handles NotifyService.StreamAlerts as a bounded
 * async generator that yields 3 Alert objects then ends. The AlertStream component
 * subscribes on mount via browser Connect (notifyClient.streamAlerts → BFF →
 * gRPC H2C mock). No page.route() needed — the mock handles the path directly.
 */

const TEST_JWT_SECRET = 'test-jwt-secret-for-e2e-tests-min32c';
const BASE_URL = 'http://localhost:3000';

async function addAuthCookie(page: Page): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({
    user_id: 'test-user-001',
    email: 'test@example.com',
    roles: [],
    issued_at: now,
    expires_at: now + 3600,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(TEST_JWT_SECRET));

  await page.context().addCookies([
    { name: 'access_token', value: token, url: BASE_URL, httpOnly: true, sameSite: 'Lax' },
  ]);
}

test.describe('AlertStream', () => {
  test('bell icon is visible on the page', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/trader');
    await expect(page.locator('button').filter({ has: page.locator('svg') }).first()).toBeVisible();
  });

  test('badge shows 3 after stream completes', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/trader');
    // Mock streams 3 bounded alerts then ends — badge shows count 3.
    // Use exact-match regex to avoid matching numeric substrings in portfolio/order spans.
    await expect(page.locator('span').filter({ hasText: /^3$/ })).toBeVisible({ timeout: 10000 });
  });

  test('opening the sheet shows at least one alert title', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/trader');
    const badge = page.locator('span').filter({ hasText: /^3$/ });
    await expect(badge).toBeVisible({ timeout: 10000 });
    // Click the bell button — it is the direct parent of the badge span.
    await badge.locator('..').click();
    // alert-stream-002 has title 'Order rejected' (severity CRITICAL)
    await expect(page.getByText('Order rejected')).toBeVisible();
  });

  test('high-severity alerts use destructive badge colour', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/trader');
    // alert-stream-002 has severity 4 (CRITICAL) → hasHighSeverity=true → bg-destructive class
    await expect(page.locator('span.bg-destructive')).toBeVisible({ timeout: 10000 });
  });

  test('Clear all button resets the badge', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/trader');
    const badge = page.locator('span').filter({ hasText: /^3$/ });
    await expect(badge).toBeVisible({ timeout: 10000 });
    // Click the bell button — it is the direct parent of the badge span.
    await badge.locator('..').click();
    await page.getByRole('button', { name: 'Clear all' }).click();
    // Badge disappears after clearing alerts
    await expect(page.locator('span').filter({ hasText: /^3$/ })).not.toBeVisible();
  });
});
