import { test, expect } from '@playwright/test';
import { addAuthCookie, addAdminCookie } from '../helpers/auth';

/**
 * BFF tests for the Live Strategies feature (feature 048).
 *
 * Exercises the trader BFF routes added in Step 9 against the trader mock
 * (port 9091, Step 11): AnalysisService.ListStrategyDefinitions / SetStrategyLive
 * and NotifyService.ListAlerts. Auth cookie is injected directly; admin vs non-admin
 * JWTs verify the server-side admin-scope gate.
 */

test.describe('Live Strategies BFF', () => {
  test('listStrategyDefinitions returns definitions with liveEnabled', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/trader/login');

    const result = await page.evaluate(async () => {
      const res = await fetch(
        '/trader/api/xstockstrat.analysis.v1.AnalysisService/ListStrategyDefinitions',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ includeInactive: false }),
        },
      );
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    });

    expect(result.status).toBe(200);
    expect(Array.isArray(result.body.definitions)).toBe(true);
    const defs = result.body.definitions as Record<string, unknown>[];
    expect(defs.length).toBeGreaterThan(0);
    expect(defs[0].liveEnabled).toBe(true);
  });

  test('setStrategyLive succeeds for admin', async ({ page }) => {
    await addAdminCookie(page);
    await page.goto('/trader/login');

    const result = await page.evaluate(async () => {
      const res = await fetch(
        '/trader/api/xstockstrat.analysis.v1.AnalysisService/SetStrategyLive',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          // Use liveEnabled:true — proto3 Connect-JSON omits false/default bool fields.
          body: JSON.stringify({ strategyId: 'strat-live-001', liveEnabled: true }),
        },
      );
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    });

    expect(result.status).toBe(200);
    const definition = result.body.definition as Record<string, unknown>;
    expect(definition.strategyId).toBe('strat-live-001');
    expect(definition.liveEnabled).toBe(true);
  });

  // feature 133: the trader BFF no longer admin-gates setStrategyLive. A non-admin OWNER may
  // toggle their own strategy (strat-live-001 is owned by the default user); a non-owner is denied
  // by the backend (covered in insights/strategy-ownership.spec.ts).
  test('setStrategyLive succeeds for a non-admin owner (admin gate removed)', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/trader/login');

    const result = await page.evaluate(async () => {
      const res = await fetch(
        '/trader/api/xstockstrat.analysis.v1.AnalysisService/SetStrategyLive',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ strategyId: 'strat-live-001', liveEnabled: true }),
        },
      );
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    });

    expect(result.status).toBe(200);
    const definition = result.body.definition as Record<string, unknown>;
    expect(definition.strategyId).toBe('strat-live-001');
  });

  test('listAlerts returns strategy-category alerts with strategy_id tag', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/trader/login');

    const result = await page.evaluate(async () => {
      const res = await fetch('/trader/api/xstockstrat.notify.v1.NotifyService/ListAlerts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ categories: ['strategy'], limit: 50 }),
      });
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    });

    expect(result.status).toBe(200);
    const alerts = (result.body.alerts as Record<string, unknown>[]) ?? [];
    const strategyAlert = alerts.find((a) => a.category === 'strategy');
    expect(strategyAlert).toBeTruthy();
    expect((strategyAlert!.tags as string[]) ?? []).toContain('strategy_id:strat-live-001');
  });
});

// Step 28: OrderBook.tsx renders on the same bare /trader route as LiveStrategiesPanel — added
// here (rather than a new spec file) to avoid a third spec navigating to the same route. Closes
// a coverage gap: api-smoke.spec.ts only asserts the ListOrders data contract, never the
// rendered table's column headers or row content. This is new coverage, not a regression
// fixture — the underlying markup already rendered this content pre-Step-27 migration too.
test.describe('OrderBook — rendered table content at bare /trader (Step 28 coverage)', () => {
  test('renders its column headers and the mock AAPL order row', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/trader');

    const orderBookTable = page.getByTestId('order-book-table');
    await expect(orderBookTable).toBeVisible({ timeout: 10000 });

    for (const header of ['Symbol', 'Side', 'Qty', 'Filled', 'Status']) {
      await expect(
        orderBookTable.getByRole('columnheader', { name: header, exact: true }),
      ).toBeVisible();
    }

    const aaplRow = orderBookTable.getByRole('row').filter({ hasText: 'AAPL' });
    await expect(aaplRow).toBeVisible();
    await expect(aaplRow.getByText('BUY')).toBeVisible();
    await expect(aaplRow.getByText('FILLED')).toBeVisible();
  });
});

test.describe('LiveStrategiesPanel — clickable row keyboard activation (FR-5)', () => {
  test('a row opens the alert feed via Enter, matching the existing click behavior', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await page.goto('/trader');

    const row = page.locator('[role="button"]', { hasText: 'Live Test Strategy' });
    await expect(row).toBeVisible({ timeout: 10000 });
    await row.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Recent strategy alerts — strat-live-001')).toBeVisible();
  });

  // Regression guard for the keyboard mis-fire bug. Actual pre-migration mechanism (verified via
  // git-stash RED capture, not the "double-fires both" guess in design.md): the row's onKeyDown
  // called e.preventDefault() on the bubbling keydown event BEFORE setSelectedId(...). Per the DOM
  // spec, preventDefault() on a cancelable event cancels its default action regardless of which
  // phase/listener called it — so that preventDefault() canceled the browser's own native
  // "Enter activates the focused button" default action entirely. Pre-migration, keyboard Enter on
  // the Enable/Disable button therefore never fired the button's own click/mutation at all — it
  // only (wrongly) fired the row's handler, opening the alert feed. Not a double-fire; a
  // single mis-fire. The DataTable composite's shared isInteractiveTarget guard checks the
  // keydown target BEFORE calling preventDefault()/onRowClick, so a keydown that originates inside
  // a nested <button> returns early without ever calling preventDefault() — leaving the browser's
  // native button-Enter-activation intact and letting the button's own handler fire normally.
  test('keyboard Enter on the Enable/Disable button fires only its own action, not the row click (regression guard)', async ({
    page,
  }) => {
    await addAdminCookie(page);
    await page.goto('/trader');

    const button = page.getByRole('button', { name: /^(Enable|Disable)$/ }).first();
    await expect(button).toBeVisible({ timeout: 10000 });
    const label = await button.textContent();

    // Pre-migration this response never arrives (see comment above) — bound the wait so a RED
    // run fails fast/deterministically instead of riding out the full default test timeout.
    const setLivePromise = page.waitForResponse(
      (r) =>
        r.url().includes('/xstockstrat.analysis.v1.AnalysisService/SetStrategyLive') &&
        r.status() === 200,
      { timeout: 5000 },
    );
    await button.focus();
    await page.keyboard.press('Enter');
    await setLivePromise;

    // The button's own action fired (label flips Enable <-> Disable) ...
    await expect(button).not.toHaveText(label ?? '');
    // ... but the row's onRowClick did NOT also fire — no alert feed opened.
    await expect(page.getByText(/^Recent strategy alerts/)).toHaveCount(0);
  });
});
