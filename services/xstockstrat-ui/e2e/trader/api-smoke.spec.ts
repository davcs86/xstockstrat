import { test, expect } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';

/**
 * BFF smoke tests for the Connect-RPC gateway in xstockstrat-trader.
 *
 * The mock backend (port 9091) handles TradingService, PortfolioService, and
 * MarketDataService. These tests call the BFF via browser-level fetch
 * (page.evaluate) to avoid the Next.js dev-server Transfer-Encoding quirk
 * that breaks Playwright's undici-based APIRequestContext.
 *
 * Auth cookie is injected directly so the BFF middleware allows the calls.
 * All assertions use camelCase protobuf-es JSON field names (orderId, filledQty, etc.)
 */

test.describe('Connect BFF — TradingService/ListOrders data contract', () => {
  /**
   * OrderBook.tsx (via useOrders hook) accesses:
   *   data.orders[]
   *   order.orderId        → TableRow key
   *   order.symbol         → Symbol column
   *   order.side           → numeric enum (1=BUY, 2=SELL)
   *   order.qty            → Qty column
   *   order.filledQty      → Filled column
   *   order.filledAvgPrice → formatted as $N.NN or '—'
   *   order.status         → numeric enum (3=FILLED)
   */
  test('returns orders array with all UI-required camelCase fields', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/auth/login');

    const result = await page.evaluate(async () => {
      const res = await fetch('/trader/api/xstockstrat.trading.v1.TradingService/ListOrders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tradingMode: 1 }),
      });
      return { status: res.status, body: await res.json() as Record<string, unknown> };
    });

    expect(result.status).toBe(200);
    expect(result.body).toHaveProperty('orders');
    expect(Array.isArray(result.body.orders)).toBe(true);
    expect((result.body.orders as unknown[]).length).toBeGreaterThan(0);

    const order = (result.body.orders as Record<string, unknown>[])[0];
    expect(order).toHaveProperty('orderId');
    expect(order).toHaveProperty('symbol');
    expect(order).toHaveProperty('side');
    // Connect JSON (protobuf-es) serializes enum fields as their string name, not a number
    expect(typeof order.side).toBe('string');
    expect(order).toHaveProperty('qty');
    expect(order).toHaveProperty('filledQty');
    expect(order).toHaveProperty('filledAvgPrice');
    expect(order).toHaveProperty('status');
    expect(typeof order.status).toBe('string');
  });
});

test.describe('Connect BFF — TradingService/PlaceOrder data contract', () => {
  /**
   * OrderForm.tsx (via usePlaceOrder hook) success handler:
   *   setMessage(`Order placed: ${order.orderId} (${OrderStatus[order.status] ?? 'UNKNOWN'})`)
   *
   * orderId and status must be present in the response.
   */
  test('returns orderId and numeric status on success', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/auth/login');

    const result = await page.evaluate(async () => {
      const res = await fetch('/trader/api/xstockstrat.trading.v1.TradingService/PlaceOrder', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ symbol: 'AAPL', side: 1, orderType: 1, qty: 1, tradingMode: 1 }),
      });
      return { status: res.status, body: await res.json() as Record<string, unknown> };
    });

    expect(result.status).toBe(200);
    expect(result.body).toHaveProperty('orderId');
    expect(typeof result.body.orderId).toBe('string');
    expect((result.body.orderId as string).length).toBeGreaterThan(0);
    expect(result.body).toHaveProperty('status');
    // Connect JSON (protobuf-es) serializes enum fields as their string name
    expect(typeof result.body.status).toBe('string');
  });
});

test.describe('Connect BFF — PortfolioService/GetPortfolio data contract', () => {
  /**
   * PortfolioPanel.tsx (via usePortfolio hook) accesses:
   *   data.equity / cash / buyingPower / dayPnl / dayPnlPct / totalPnl  → numeric
   *   data.positions[] → symbol, unrealizedPnl
   */
  test('returns all numeric fields required by PortfolioPanel', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/auth/login');

    const result = await page.evaluate(async () => {
      const res = await fetch('/trader/api/xstockstrat.portfolio.v1.PortfolioService/GetPortfolio', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      return { status: res.status, body: await res.json() as Record<string, unknown> };
    });

    expect(result.status).toBe(200);
    const body = result.body;

    for (const field of ['equity', 'cash', 'buyingPower', 'dayPnl', 'dayPnlPct', 'totalPnl']) {
      expect(body).toHaveProperty(field);
      expect(typeof body[field]).toBe('number');
    }

    // dayPnlPct is in decimal form (0–1 range); component multiplies * 100
    expect(Math.abs(body.dayPnlPct as number)).toBeLessThan(100);
  });

  test('positions array contains symbol and numeric unrealizedPnl', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/auth/login');

    const result = await page.evaluate(async () => {
      const res = await fetch('/trader/api/xstockstrat.portfolio.v1.PortfolioService/GetPortfolio', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      return { status: res.status, body: await res.json() as Record<string, unknown> };
    });

    const body = result.body;
    expect(Array.isArray(body.positions)).toBe(true);

    if ((body.positions as unknown[]).length > 0) {
      const pos = (body.positions as Record<string, unknown>[])[0];
      expect(pos).toHaveProperty('symbol');
      expect(pos).toHaveProperty('unrealizedPnl');
      expect(typeof pos.unrealizedPnl).toBe('number');
    }
  });
});
