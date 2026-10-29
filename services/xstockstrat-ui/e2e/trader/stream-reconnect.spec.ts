import { test, expect, type Route } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';
import { ORDER_WORKING, ORDER_WORKING_FILLED_AT, ORDER_WORKING_STREAMED_AT } from '../fixtures';
import { ALERT_STREAM_001, ALERT_STREAM_002 } from '../fixtures/alerts';

/**
 * Feature 270 (D-11): a dropped live stream shows its disconnected indicator, reconnects with
 * backoff and recovers without a page reload. Attempt 1 is a stream that fails `unavailable`;
 * attempt 2 waits on a test-controlled gate. A fulfilled route cannot stay open, so the orders
 * attempt 2 ends cleanly and later attempts continue to the held-open mock.
 */

// Connect streaming framing: 1-byte flag (0x00 message, 0x02 end-stream), 4-byte BE length, JSON.
function connectStreamBody(messages: object[], error?: { code: string; message: string }): Buffer {
  const frame = (flag: number, payload: object) => {
    const json = Buffer.from(JSON.stringify(payload));
    const head = Buffer.alloc(5);
    head.writeUInt8(flag, 0);
    head.writeUInt32BE(json.length, 1);
    return Buffer.concat([head, json]);
  };
  return Buffer.concat([
    ...messages.map((m) => frame(0x00, m)),
    frame(0x02, error ? { error } : {}),
  ]);
}

function fulfillStream(
  route: Route,
  messages: object[],
  error?: { code: string; message: string },
) {
  return route.fulfill({
    status: 200,
    contentType: 'application/connect+json',
    body: connectStreamBody(messages, error),
  });
}

function gate(): { wait: Promise<void>; release: () => void } {
  let release!: () => void;
  const wait = new Promise<void>((r) => (release = r));
  return { wait, release };
}

const DROPPED = { code: 'unavailable', message: 'stream dropped in test' };

test('@AC-2 @AC-1 the orders stream reconnects and the newer streamed status wins without a reload', async ({
  page,
}) => {
  await addAuthCookie(page);
  await page.route('**/xstockstrat.trading.v1.TradingService/ListOrders', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        orders: [{ ...ORDER_WORKING, updatedAt: ORDER_WORKING_STREAMED_AT }],
        page: { totalCount: 1, nextPageToken: '' },
      }),
    }),
  );

  const reconnect = gate();
  let attempts = 0;
  await page.route('**/xstockstrat.trading.v1.TradingService/StreamOrderUpdates', async (route) => {
    attempts += 1;
    if (attempts === 1) {
      await fulfillStream(
        route,
        [
          {
            ...ORDER_WORKING,
            status: 'ORDER_STATUS_PARTIALLY_FILLED',
            updatedAt: ORDER_WORKING_STREAMED_AT,
          },
        ],
        DROPPED,
      );
      return;
    }
    if (attempts === 2) {
      await reconnect.wait;
      await fulfillStream(route, [
        { ...ORDER_WORKING, status: 'ORDER_STATUS_FILLED', updatedAt: ORDER_WORKING_FILLED_AT },
      ]);
      return;
    }
    await route.continue();
  });

  await page.goto('/trader/orders');
  const row = page.getByTestId(`order-row-${ORDER_WORKING.orderId}`);
  await expect(row).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId('order-stream-disconnected')).toBeVisible();

  reconnect.release();
  await expect(row).toContainText('FILLED');
  await expect(row).not.toContainText('PARTIALLY_FILLED');
  await expect(page.getByTestId('order-stream-disconnected')).toBeHidden({ timeout: 10000 });
  // The older polled NEW record must not mask the newer streamed FILLED one.
  await expect(row).not.toContainText('NEW');
  expect(attempts).toBeGreaterThanOrEqual(2);
});

test('@AC-9 the alert stream reconnects, clears the indicator and dedupes re-delivered alerts', async ({
  page,
}) => {
  await addAuthCookie(page);
  const reconnect = gate();
  let attempts = 0;
  await page.route('**/xstockstrat.notify.v1.NotifyService/StreamAlerts', async (route) => {
    attempts += 1;
    if (attempts === 1) {
      await fulfillStream(route, [ALERT_STREAM_001], DROPPED);
      return;
    }
    await reconnect.wait;
    await route.continue();
  });

  await page.goto('/trader');
  await expect(page.getByTestId('alert-stream-disconnected')).toBeAttached({ timeout: 10000 });
  const bell = page.getByRole('button', { name: /^Alerts/ });
  await expect(bell).toHaveAccessibleName(/disconnected/);

  reconnect.release();
  await expect(bell).toHaveAccessibleName('Alerts', { timeout: 10000 });
  await expect(page.getByTestId('alert-stream-disconnected')).toHaveCount(0);

  await bell.click();
  await expect(page.getByText(ALERT_STREAM_002.title)).toBeVisible();
  await expect(page.getByText(ALERT_STREAM_001.title, { exact: true })).toHaveCount(1);
});
