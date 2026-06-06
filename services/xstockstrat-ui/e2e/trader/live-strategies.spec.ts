import { test, expect, type Page } from '@playwright/test';
import { SignJWT } from 'jose';

/**
 * BFF tests for the Live Strategies feature (feature 048).
 *
 * Exercises the trader BFF routes added in Step 9 against the trader mock
 * (port 9091, Step 11): AnalysisService.ListStrategyDefinitions / SetStrategyLive
 * and NotifyService.ListAlerts. Auth cookie is injected directly; admin vs non-admin
 * JWTs verify the server-side admin-scope gate.
 */

const TEST_JWT_SECRET = 'test-jwt-secret-for-e2e-tests-min32c';
const BASE_URL = 'http://localhost:3000';

async function addCookieWithRoles(page: Page, roles: string[]): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({
    user_id: 'test-user-001',
    email: 'test@example.com',
    roles,
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

const addAuthCookie = (page: Page) => addCookieWithRoles(page, []);
const addAdminCookie = (page: Page) => addCookieWithRoles(page, ['admin']);

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

  test('setStrategyLive is denied for non-admin', async ({ page }) => {
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
      return { status: res.status, body: await res.text() };
    });

    expect(result.status).not.toBe(200);
    expect(result.body.toLowerCase()).toContain('permission');
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
