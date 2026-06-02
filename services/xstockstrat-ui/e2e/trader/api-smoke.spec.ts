import { test, expect, type Page } from '@playwright/test';
import { SignJWT } from 'jose';

/**
 * BFF smoke tests for the Connect-RPC gateway in the xstockstrat-ui trader segment.
 *
 * The mock backend (started in globalSetup on port 9091) handles ListOrders,
 * PlaceOrder, and GetPortfolio.  These tests call the BFF via browser-level
 * fetch (page.evaluate) to avoid the Next.js dev-server Transfer-Encoding
 * quirk that breaks Playwright's undici-based APIRequestContext.
 *
 * Auth cookies are injected via addAuthCookie() so each test exercises the
 * authenticated code path.  The auth.spec.ts file covers the unauthenticated
 * (redirect) and login/logout flows separately.
 */

const TEST_JWT_SECRET = 'test-jwt-secret-for-e2e-tests-min32c';
const BASE_URL = 'http://localhost:3000';
const LIST_ORDERS_BFF = '/trader/api/xstockstrat.trading.v1.TradingService/ListOrders';
const PLACE_ORDER_BFF = '/trader/api/xstockstrat.trading.v1.TradingService/PlaceOrder';
const GET_PORTFOLIO_BFF = '/trader/api/xstockstrat.portfolio.v1.PortfolioService/GetPortfolio';

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

async function callBff(
  page: Page,
  url: string,
  body: Record<string, unknown> = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  return page.evaluate(
    async ({ url, body }) => {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const responseBody = (await res.json()) as Record<string, unknown>;
      return { status: res.status, body: responseBody };
    },
    { url, body },
  );
}

test.describe('Connect BFF — TradingService/ListOrders data contract', () => {
  /**
   * OrderBook.tsx accesses (via Connect-RPC JSON, camelCase field names):
   *   data.orders[]
   *   order.orderId        → TableRow key
   *   order.symbol         → displayed in Symbol column
   *   order.side           → compared to 'ORDER_SIDE_BUY' for Badge variant
   *   order.qty            → displayed in Qty column
   *   order.filledQty      → displayed in Filled column (falls back to 0)
   *   order.filledAvgPrice → formatted as $N.NN or '—'
   *   order.status         → mapped to Badge variant via statusVariant lookup
   */
  test('returns orders array with all UI-required fields', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/trader/login');
    const { status, body } = await callBff(page, LIST_ORDERS_BFF, {});
    expect(status).toBe(200);

    expect(body).toHaveProperty('orders');
    expect(Array.isArray(body.orders)).toBe(true);
    expect((body.orders as unknown[]).length).toBeGreaterThan(0);

    const order = (body.orders as Array<Record<string, unknown>>)[0];
    // Fields accessed by OrderBook rows (camelCase — Connect-RPC JSON encoding)
    expect(order).toHaveProperty('orderId');       // key prop
    expect(order).toHaveProperty('symbol');         // Symbol column
    expect(order).toHaveProperty('side');           // Badge variant test
    expect(order).toHaveProperty('qty');            // Qty column
    expect(order).toHaveProperty('filledQty');      // Filled column
    expect(order).toHaveProperty('filledAvgPrice'); // Avg Price column
    expect(order).toHaveProperty('status');         // Status badge

    // side must be one of the values the statusVariant map handles
    expect(order.side).toMatch(/^ORDER_SIDE_(BUY|SELL)$/);

    // status must start with ORDER_STATUS_ (component strips prefix for display)
    expect(order.status).toMatch(/^ORDER_STATUS_/);

    // filledAvgPrice is passed to Number() so it must be numeric-safe
    expect(Number(order.filledAvgPrice)).not.toBeNaN();
  });
});

test.describe('Connect BFF — TradingService/PlaceOrder', () => {
  /**
   * OrderForm.tsx success handler:
   *   setMessage(`Order placed: ${data.orderId} (${data.status})`)
   *
   * Both orderId and status must be present in the BFF response (camelCase).
   */
  test('returns orderId and status used in the success message', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/trader/login');
    const { status, body } = await callBff(page, PLACE_ORDER_BFF, {
      symbol: 'AAPL',
      side: 'ORDER_SIDE_BUY',
      orderType: 'ORDER_TYPE_MARKET',
      qty: 1,
    });
    expect(status).toBe(200);

    const order = body as Record<string, unknown>;
    // UI success message: `Order placed: ${data.orderId} (${data.status})`
    expect(order).toHaveProperty('orderId');
    expect(typeof order.orderId).toBe('string');
    expect((order.orderId as string).length).toBeGreaterThan(0);

    expect(order).toHaveProperty('status');
    expect(typeof order.status).toBe('string');
    // status is a proto enum string — must start with ORDER_STATUS_
    expect(order.status).toMatch(/^ORDER_STATUS_/);
  });

  test('tradingMode field in response identifies the trading context', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/trader/login');
    const { status, body } = await callBff(page, PLACE_ORDER_BFF, {
      symbol: 'TSLA',
      side: 'ORDER_SIDE_SELL',
      orderType: 'ORDER_TYPE_LIMIT',
      qty: 2,
      limitPrice: 240.0,
    });
    expect(status).toBe(200);

    const order = body as Record<string, unknown>;
    expect(order).toHaveProperty('orderId');
    // tradingMode is included in the Order proto response and used by the UI
    // to distinguish paper vs live trades (must be a TRADING_MODE_ enum string)
    expect(order).toHaveProperty('tradingMode');
    expect(order.tradingMode).toMatch(/^TRADING_MODE_/);
  });
});

test.describe('Connect BFF — PortfolioService/GetPortfolio data contract', () => {
  /**
   * PortfolioSummary in OrderBook.tsx accesses (camelCase — Connect-RPC JSON):
   *   data.equity        → $N.NN (Number().toLocaleString)
   *   data.cash          → $N.NN
   *   data.buyingPower   → $N.NN
   *   data.dayPnl        → compared >= 0 for colour, formatted ±$N.NN
   *   data.dayPnlPct     → multiplied * 100, toFixed(2)%
   *   data.totalPnl      → $N.NN
   *   data.positions[]
   *     pos.symbol          → displayed
   *     pos.unrealizedPnl   → compared >= 0 for colour, formatted ±$N.NN
   */
  test('returns all numeric fields required by PortfolioSummary', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/trader/login');
    const { status, body } = await callBff(page, GET_PORTFOLIO_BFF, {});
    expect(status).toBe(200);

    const numericFields = [
      'equity',
      'cash',
      'buyingPower',
      'dayPnl',
      'dayPnlPct',
      'totalPnl',
    ] as const;

    for (const field of numericFields) {
      expect(body).toHaveProperty(field);
      // UI wraps each in Number() — must not produce NaN
      expect(Number(body[field])).not.toBeNaN();
    }

    // dayPnlPct is multiplied by 100 in the component; if it's already a
    // percentage (e.g. 66.0) the display would be 6600% — the value must be
    // in decimal form (0–1 range for typical P&L percentages)
    expect(Math.abs(Number(body.dayPnlPct))).toBeLessThan(100);
  });

  test('positions array contains symbol and unrealizedPnl', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/trader/login');
    const { body } = await callBff(page, GET_PORTFOLIO_BFF, {});

    expect(Array.isArray(body.positions)).toBe(true);
    if ((body.positions as unknown[]).length > 0) {
      const pos = (body.positions as Array<Record<string, unknown>>)[0];
      expect(pos).toHaveProperty('symbol');           // key prop and display
      expect(pos).toHaveProperty('unrealizedPnl');    // colour and display
      expect(Number(pos.unrealizedPnl)).not.toBeNaN(); // passed to Number()
    }
  });
});
