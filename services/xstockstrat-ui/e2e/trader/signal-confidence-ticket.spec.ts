import { test, expect, type Page } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';
import { BROKER_ACCOUNT_ALPACA } from '../fixtures';

/**
 * feature 110 — the scoped signal-detail confidence ticket. On `/trader/positions/[symbol]` the
 * OrderForm receives `Opportunity.signal_confidence`: a blank quantity coerces to 0 (never NaN) and
 * `PlaceOrder` carries `confidence`, routing into feature 023's qty≤0 auto-sizing. The plain
 * `/trader` + `/trader/orders` forms mount the same component WITHOUT the prop and keep a required
 * quantity (FR-3). Confidence is the raw ExternalSignal value — NOT the ordinal conviction (AC-4).
 */

// A minimal enriched Opportunity (Connect-JSON camelCase; validUntil is an RFC3339 string on the
// wire, NOT {seconds,nanos}). signalConfidence drives the ticket affordance.
function opp(symbol: string, signalConfidence: number, conviction = 0.7) {
  return {
    symbol,
    action: 1, // ENTER
    conviction,
    passingConditions: 2,
    totalConditions: 3,
    thesis: 'signal',
    strategyId: 'quality-dip-buy',
    source: 'watchlist',
    validUntil: new Date('2030-01-01T14:30:00Z').toISOString(),
    opportunityKey: `u1|${symbol}|quality-dip-buy`,
    provenance: ['watchlist'],
    signalConfidence,
  };
}

async function mockAccount(page: Page) {
  await page.route('**/xstockstrat.trading.v1.TradingService/ListBrokerAccounts', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ accounts: [BROKER_ACCOUNT_ALPACA] }),
    }),
  );
}

async function mockOpps(page: Page, opportunities: unknown[]) {
  await page.route('**/xstockstrat.analysis.v1.AnalysisService/ListOpportunities', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ opportunities }),
    }),
  );
}

// Capture every PlaceOrder request body; return a plausible auto-sized success response.
async function capturePlaceOrder(page: Page, sink: Array<Record<string, unknown>>) {
  await page.route('**/xstockstrat.trading.v1.TradingService/PlaceOrder', (route) => {
    sink.push(route.request().postDataJSON() as Record<string, unknown>);
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ orderId: 'mock-order-001', status: 3, qty: 5, stopPrice: 0 }),
    });
  });
}

const submit = (page: Page, symbol: string) =>
  page.getByRole('button', { name: `BUY ${symbol}`, exact: true });

test.describe('signal-confidence ticket (feature 110)', () => {
  test('AC-3/AC-8: a blank quantity on the symbol page auto-sizes with confidence', async ({
    page,
  }) => {
    const orders: Array<Record<string, unknown>> = [];
    await addAuthCookie(page);
    await mockAccount(page);
    await mockOpps(page, [opp('CAPR', 0.82)]);
    await capturePlaceOrder(page, orders);
    await page.goto('/trader/positions/CAPR');

    // The qty field is optional here (the confidence hint proves the affordance is active).
    await expect(page.getByTestId('signal-confidence-hint')).toBeVisible({ timeout: 30000 });
    await submit(page, 'CAPR').click();

    await expect.poll(() => orders.length).toBe(1);
    const req = orders[0];
    // Connect-JSON omits a proto3 default 0, so a coerced-0 qty is absent (never NaN) — never > 0.
    expect(Number(req.qty ?? 0)).toBeLessThanOrEqual(0);
    expect(req.confidence).toBe(0.82); // routed into 023's qty≤0 auto-sizing (AC-8)
  });

  test('AC-4: the confidence sent is the raw signal value, not the ordinal conviction', async ({
    page,
  }) => {
    const orders: Array<Record<string, unknown>> = [];
    await addAuthCookie(page);
    await mockAccount(page);
    // Ordinal conviction 0.95, but the raw signal confidence is 0.30 — the ticket must send 0.30.
    await mockOpps(page, [opp('CAPR', 0.3, 0.95)]);
    await capturePlaceOrder(page, orders);
    await page.goto('/trader/positions/CAPR');
    await expect(page.getByTestId('signal-confidence-hint')).toBeVisible({ timeout: 30000 });
    await submit(page, 'CAPR').click();

    await expect.poll(() => orders.length).toBe(1);
    expect(orders[0].confidence).toBe(0.3); // the ExternalSignal value, NOT the 0.95 ordinal
  });

  test('AC-7: an explicit quantity overrides auto-sizing', async ({ page }) => {
    const orders: Array<Record<string, unknown>> = [];
    await addAuthCookie(page);
    await mockAccount(page);
    await mockOpps(page, [opp('CAPR', 0.82)]);
    await capturePlaceOrder(page, orders);
    await page.goto('/trader/positions/CAPR');
    await expect(page.getByTestId('signal-confidence-hint')).toBeVisible({ timeout: 30000 });
    await page.getByPlaceholder('Quantity').fill('50');
    await submit(page, 'CAPR').click();

    await expect.poll(() => orders.length).toBe(1);
    expect(Number(orders[0].qty)).toBe(50); // explicit qty wins — no auto-size
  });

  test('AC-2: distinct confidences reach the auto-size path per symbol', async ({ page }) => {
    const orders: Array<Record<string, unknown>> = [];
    await addAuthCookie(page);
    await mockAccount(page);
    await capturePlaceOrder(page, orders);

    await mockOpps(page, [opp('CAPR', 0.9)]);
    await page.goto('/trader/positions/CAPR');
    await expect(page.getByTestId('signal-confidence-hint')).toBeVisible({ timeout: 30000 });
    await submit(page, 'CAPR').click();
    await expect.poll(() => orders.length).toBe(1);

    await mockOpps(page, [opp('NVDA', 0.3)]);
    await page.goto('/trader/positions/NVDA');
    await expect(page.getByTestId('signal-confidence-hint')).toBeVisible({ timeout: 30000 });
    await submit(page, 'NVDA').click();
    await expect.poll(() => orders.length).toBe(2);

    expect(orders[0].confidence).toBe(0.9);
    expect(orders[1].confidence).toBe(0.3);
  });

  test('AC-5: the plain /trader form still requires a quantity (no auto-size)', async ({
    page,
  }) => {
    const orders: Array<Record<string, unknown>> = [];
    await addAuthCookie(page);
    await mockAccount(page);
    await capturePlaceOrder(page, orders);
    await page.goto('/trader');

    // No signalConfidence prop → the qty field is required; a blank submit is blocked by HTML5
    // validation and NO PlaceOrder is sent (never a silent max-risk auto-size).
    const qty = page.getByPlaceholder('Quantity');
    await expect(qty).toBeVisible({ timeout: 30000 });
    await expect(qty).toHaveAttribute('required', '');
    await page.getByRole('button', { name: /^BUY/ }).click();
    await page.waitForTimeout(500);
    expect(orders).toHaveLength(0);
  });

  test('AC-6: the /trader/orders form keeps the required-quantity behavior', async ({ page }) => {
    const orders: Array<Record<string, unknown>> = [];
    await addAuthCookie(page);
    await mockAccount(page);
    await capturePlaceOrder(page, orders);
    await page.goto('/trader/orders');

    const qty = page.getByPlaceholder('Quantity');
    await expect(qty).toBeVisible({ timeout: 30000 });
    await expect(qty).toHaveAttribute('required', '');
    await page.getByRole('button', { name: /^BUY/ }).click();
    await page.waitForTimeout(500);
    expect(orders).toHaveLength(0);
  });
});
