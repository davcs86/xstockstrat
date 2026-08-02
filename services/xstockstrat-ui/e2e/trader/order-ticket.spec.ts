import { test, expect } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';

/**
 * Single-Order ticket page (feature 096) — the upgraded `/trader/orders/[id]` view: ticket-grammar
 * field grid + order-preview sidebar, with Edit (ReplaceOrder) / Cancel (CancelOrder) offered only
 * for a working order. Data from the shared mock backend (e2e/fixtures/orders.ts): ORDER_WORKING
 * (mock-order-002, TSLA, NEW) and ORDER_FILLED (mock-order-001, AAPL, FILLED).
 */
test.describe('Single Order ticket page', () => {
  test('a working order shows the ticket, preview and Edit + Cancel actions', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/trader/orders/mock-order-002');

    // Generous first-hit timeout: the first getOrder RPC compiles the trader BFF route on a cold server.
    await expect(page.getByText('TSLA').first()).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('Order ticket')).toBeVisible();
    await expect(page.getByText('Order preview')).toBeVisible();
    // Origin strategy is surfaced from the order's own strategyId.
    await expect(page.getByText('trailing-exit-atr').first()).toBeVisible();

    // Working order → both actions present; Cancel requires a confirm step.
    await expect(page.getByRole('button', { name: 'Edit order' })).toBeVisible();
    const cancel = page.getByRole('button', { name: 'Cancel order' });
    await expect(cancel).toBeVisible();
    await cancel.click();
    await expect(page.getByRole('button', { name: 'Confirm cancel' })).toBeVisible();
  });

  test('a filled (terminal) order shows no Edit or Cancel actions', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/trader/orders/mock-order-001');

    await expect(page.getByText('AAPL').first()).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('Order ticket')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit order' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Cancel order' })).toHaveCount(0);
  });
});
