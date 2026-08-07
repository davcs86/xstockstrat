import { test, expect } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';

/**
 * Order-intent uncertainty badge (feature 101 — exactly-once order intent). The order-ticket page
 * (`/trader/orders/[id]`) renders `IntentStateBadge` beside `OrderStatusBadge`; it shows text only
 * for `IntentState.UNKNOWN` (a broker call whose outcome the platform never confirmed) and renders
 * nothing for the normal PENDING/COMPLETED/REJECTED/UNSPECIFIED states. Data from the shared mock
 * backend (e2e/fixtures/orders.ts): ORDER_UNKNOWN_INTENT (mock-order-003, MSFT, intentState=UNKNOWN)
 * vs. ORDER_FILLED (mock-order-001) / ORDER_WORKING (mock-order-002), neither of which sets intentState.
 */
test.describe('Order intent-state badge', () => {
  test('an order with an unknown broker-call outcome shows the uncertainty badge', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await page.goto('/trader/orders/mock-order-003');

    await expect(page.getByText('MSFT').first()).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('Uncertain — verify with broker')).toBeVisible();
  });

  test('a normally-resolved order shows no uncertainty badge', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/trader/orders/mock-order-001');

    await expect(page.getByText('AAPL').first()).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('Uncertain — verify with broker')).toHaveCount(0);
  });
});
