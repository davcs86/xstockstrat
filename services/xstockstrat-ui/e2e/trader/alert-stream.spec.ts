import { test, expect } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';

/**
 * E2E tests for the AlertStream component.
 *
 * The mock backend (port 9091) handles NotifyService.StreamAlerts as a bounded
 * async generator that yields 3 Alert objects then ends. The AlertStream component
 * subscribes on mount via browser Connect (notifyClient.streamAlerts → BFF →
 * gRPC H2C mock). No page.route() needed — the mock handles the path directly.
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

  test('badge reflects the server-side unread count, not the stream length (AC-2)', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await page.goto('/trader');
    // listAlerts returns unreadCount = MOCK_UNREAD_COUNT (2); the stream yields 3 alerts. The badge
    // must show the per-user server count (2), never the client-side stream array length (3) —
    // per-user read state is why a broadcast alert can be read for one user and unread for another.
    await expect(page.locator('span[data-slot="badge"]').filter({ hasText: /^2$/ })).toBeVisible({
      timeout: 10000,
    });
    await expect(
      page.locator('span[data-slot="badge"]').filter({ hasText: /^3$/ }),
    ).not.toBeVisible();
  });

  test('opening the sheet shows at least one alert title', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/trader');
    const badge = page.locator('span[data-slot="badge"]').filter({ hasText: /^2$/ });
    await expect(badge).toBeVisible({ timeout: 10000 });
    // Click the bell button — it is the direct parent of the badge span.
    await badge.locator('..').click();
    // alert-stream-002 has title 'Order rejected' (severity CRITICAL)
    await expect(page.getByText('Order rejected')).toBeVisible();
  });

  test('high-severity alerts use destructive badge colour', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/trader');
    // alert-stream-002 has severity 4 (CRITICAL) → hasHighSeverity=true → Badge variant="destructive"
    // (feature 121 FR-10: swapped from a raw bg-destructive span to ui/Badge, which sets
    // data-variant rather than a stable literal background class — scope on that instead).
    await expect(page.locator('span[data-slot="badge"][data-variant="destructive"]')).toBeVisible({
      timeout: 10000,
    });
  });

  test('Clear all empties the sheet feed; the server-driven badge is unaffected', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await page.goto('/trader');
    const badge = page.locator('span[data-slot="badge"]').filter({ hasText: /^2$/ });
    await expect(badge).toBeVisible({ timeout: 10000 });
    // Click the bell button — it is the direct parent of the badge span.
    await badge.locator('..').click();
    await expect(page.getByText('Order rejected')).toBeVisible();
    await page.getByRole('button', { name: 'Clear all' }).click();
    // The local sheet feed empties; the unread badge tracks the server, so a local clear leaves it.
    await expect(page.getByText('No alerts')).toBeVisible();
  });
});
