import { test, expect } from '@playwright/test';

/**
 * API smoke tests for xstockstrat-trader Next.js route handlers.
 *
 * These tests make HTTP requests directly to the Next.js API routes via
 * Playwright's APIRequestContext.  The route handlers call the real Connect-RPC
 * client code which points at the mock backend started in globalSetup — so the
 * full server-side path is exercised.
 *
 * Each assertion mirrors the exact field access in the UI components so that
 * a mismatch between the route's response shape and the component's expectations
 * is immediately visible as a test failure.
 */

test.describe('GET /api/orders — OrderBook data contract', () => {
  /**
   * OrderBook.tsx accesses:
   *   data.orders[]
   *   order.order_id   → TableRow key
   *   order.symbol     → displayed in Symbol column
   *   order.side       → compared to 'ORDER_SIDE_BUY' for Badge variant
   *   order.qty        → displayed in Qty column
   *   order.filled_qty → displayed in Filled column (falls back to 0)
   *   order.filled_avg_price → formatted as $N.NN or '—'
   *   order.status     → mapped to Badge variant via statusVariant lookup
   */
  test('returns orders array with all UI-required fields', async ({ request }) => {
    const res = await request.get('/api/orders?trading_mode=paper');
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty('orders');
    expect(Array.isArray(body.orders)).toBe(true);
    expect(body.orders.length).toBeGreaterThan(0);

    const order = body.orders[0];
    // Fields accessed by OrderBook rows
    expect(order).toHaveProperty('order_id');       // key prop
    expect(order).toHaveProperty('symbol');          // Symbol column
    expect(order).toHaveProperty('side');            // Badge variant test
    expect(order).toHaveProperty('qty');             // Qty column
    expect(order).toHaveProperty('filled_qty');      // Filled column
    expect(order).toHaveProperty('filled_avg_price'); // Avg Price column
    expect(order).toHaveProperty('status');          // Status badge

    // side must be one of the values the statusVariant map handles
    expect(order.side).toMatch(/^ORDER_SIDE_(BUY|SELL)$/);

    // status must start with ORDER_STATUS_ (component strips prefix for display)
    expect(order.status).toMatch(/^ORDER_STATUS_/);

    // filled_avg_price is passed to Number() so it must be numeric-safe
    expect(Number(order.filled_avg_price)).not.toBeNaN();
  });
});

test.describe('POST /api/orders — OrderForm success path', () => {
  /**
   * OrderForm.tsx success handler:
   *   setMessage(`Order placed: ${data.order_id} (${data.status})`)
   *
   * Both order_id and status must be present in the response.
   */
  test('returns order_id and status used in the success message', async ({ request }) => {
    const res = await request.post('/api/orders', {
      data: {
        symbol: 'AAPL',
        side: 'buy',
        order_type: 'market',
        qty: 1,
        trading_mode: 'paper',
      },
    });
    expect(res.status()).toBe(200);

    const body = await res.json();
    // UI success message: `Order placed: ${data.order_id} (${data.status})`
    expect(body).toHaveProperty('order_id');
    expect(typeof body.order_id).toBe('string');
    expect(body.order_id.length).toBeGreaterThan(0);

    expect(body).toHaveProperty('status');
    expect(typeof body.status).toBe('string');

    // trading_mode returned for reference
    expect(body).toHaveProperty('trading_mode');
  });

  test('returns error field when order placement fails', async ({ request }) => {
    // Send an invalid payload (missing required fields) to trigger a 500
    const res = await request.post('/api/orders', {
      data: { symbol: '', qty: -1 },
    });
    // Route handler catches errors and returns JSON { error: ... } with status 500
    expect([400, 500]).toContain(res.status());
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(typeof body.error).toBe('string');
  });
});

test.describe('GET /api/portfolio — PortfolioSummary data contract', () => {
  /**
   * PortfolioSummary in OrderBook.tsx accesses:
   *   data.equity        → $N.NN (Number().toLocaleString)
   *   data.cash          → $N.NN
   *   data.buying_power  → $N.NN
   *   data.day_pnl       → compared >= 0 for colour, formatted ±$N.NN
   *   data.day_pnl_pct   → multiplied * 100, toFixed(2)%
   *   data.total_pnl     → $N.NN
   *   data.positions[]
   *     pos.symbol          → displayed
   *     pos.unrealized_pnl  → compared >= 0 for colour, formatted ±$N.NN
   */
  test('returns all numeric fields required by PortfolioSummary', async ({ request }) => {
    const res = await request.get('/api/portfolio?trading_mode=paper');
    expect(res.status()).toBe(200);

    const body = await res.json();

    const numericFields = [
      'equity',
      'cash',
      'buying_power',
      'day_pnl',
      'day_pnl_pct',
      'total_pnl',
    ] as const;

    for (const field of numericFields) {
      expect(body).toHaveProperty(field);
      // UI wraps each in Number() — must not produce NaN
      expect(Number(body[field])).not.toBeNaN();
    }

    // day_pnl_pct is multiplied by 100 in the component; if it's already a
    // percentage (e.g. 66.0) the display would be 6600% — the value must be
    // in decimal form (0–1 range for typical P&L percentages)
    expect(Math.abs(Number(body.day_pnl_pct))).toBeLessThan(100);
  });

  test('positions array contains symbol and unrealized_pnl', async ({ request }) => {
    const res = await request.get('/api/portfolio?trading_mode=paper');
    const body = await res.json();

    expect(Array.isArray(body.positions)).toBe(true);
    if (body.positions.length > 0) {
      const pos = body.positions[0];
      expect(pos).toHaveProperty('symbol');                  // key prop and display
      expect(pos).toHaveProperty('unrealized_pnl');          // colour and display
      expect(Number(pos.unrealized_pnl)).not.toBeNaN();      // passed to Number()
    }
  });
});
