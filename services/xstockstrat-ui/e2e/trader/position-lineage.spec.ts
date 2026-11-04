import { test, expect, type Page } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';
import { ORDER_FILLED, LINEAGE_LIST_PAGE_SIZE } from '../fixtures/orders';
import { TEST_USER_B_ID } from '../fixtures/users';

/**
 * Feature 251 — the Exposure position sheet's fill lineage is read per user-owned order
 * (ListOrders -> QueryEvents by stream), not from a platform-wide order.filled page.
 */

const LIST_ORDERS = '**/xstockstrat.trading.v1.TradingService/ListOrders';

interface QueryBody {
  streamKey?: string;
  eventType?: string;
}

async function openAaplSheet(page: Page) {
  await addAuthCookie(page);
  await page.goto('/trader/positions');
  const aapl = page.getByRole('button', { name: /AAPL/ });
  await expect(aapl).toBeVisible({ timeout: 10000 });
  await aapl.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

function recordQueryBodies(page: Page) {
  const bodies: QueryBody[] = [];
  page.on('request', (req) => {
    if (req.url().includes('LedgerService/QueryEvents')) {
      bodies.push(req.postDataJSON() as QueryBody);
    }
  });
  return bodies;
}

test.describe('Position fill lineage (feature 251)', () => {
  test('AC-3: lists the caller fill and never requests another user order', async ({ page }) => {
    const bodies = recordQueryBodies(page);
    const dialog = await openAaplSheet(page);
    await expect(dialog.getByText('o-buy')).toBeVisible();
    await expect(dialog.getByText('o-other')).toHaveCount(0);
    expect(bodies.some((b) => b.streamKey === 'o-other')).toBe(false);
  });

  test('AC-18: the paper sheet omits the LIVE fill', async ({ page }) => {
    const dialog = await openAaplSheet(page);
    await expect(dialog.getByText('o-buy')).toBeVisible();
    await expect(dialog.getByText('o-live')).toHaveCount(0);
  });

  test('AC-19: the position fill is listed although the platform page holds 100 other-user fills', async ({
    page,
  }) => {
    const dialog = await openAaplSheet(page);
    await expect(dialog.getByText('o-buy')).toBeVisible();
    await expect(dialog.getByText(/o-foreign-/)).toHaveCount(0);
  });

  test('AC-20: the BFF returns no foreign event for another user order stream', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await page.goto('/auth/login');
    const result = await page.evaluate(async () => {
      const res = await fetch('/trader/api/xstockstrat.ledger.v1.LedgerService/QueryEvents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ streamKey: 'o-other', eventType: 'order.filled' }),
      });
      return {
        status: res.status,
        body: (await res.json()) as { events?: { userId?: string }[] },
      };
    });
    expect(result.status).toBe(200);
    expect((result.body.events ?? []).some((e) => e.userId === TEST_USER_B_ID)).toBe(false);
  });

  test('AC-21: more than 50 orders shows the truncation notice and queries at most 50', async ({
    page,
  }) => {
    const bodies = recordQueryBodies(page);
    const orders = Array.from({ length: LINEAGE_LIST_PAGE_SIZE }, (_, i) => ({
      ...ORDER_FILLED,
      orderId: `bulk-${i}`,
    }));
    await page.route(LIST_ORDERS, async (route) => {
      const body = route.request().postDataJSON() as { page?: { pageSize?: number } };
      if (body.page?.pageSize === LINEAGE_LIST_PAGE_SIZE) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ orders }),
        });
        return;
      }
      await route.continue();
    });
    const dialog = await openAaplSheet(page);
    await expect(dialog.getByText('Showing fills for the latest 50 orders only.')).toBeVisible();
    const lineageQueries = bodies.filter((b) => b.eventType === 'order.filled' && b.streamKey);
    expect(lineageQueries.length).toBeLessThanOrEqual(50);
  });

  test('AC-22: a fill on an order still in NEW status is listed', async ({ page }) => {
    const dialog = await openAaplSheet(page);
    await expect(dialog.getByText('o-stale')).toBeVisible();
  });
});
