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
});
