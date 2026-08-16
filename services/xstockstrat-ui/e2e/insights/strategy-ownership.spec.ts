import { test, expect, type Page } from '@playwright/test';
import { addAuthCookie, addCookieWithRoles } from '../helpers/auth';
import { TEST_USER_B_ID, TEST_USER_B_EMAIL } from '../fixtures/users';

/**
 * Cross-user strategy ownership isolation (feature 133).
 *
 * Strategies are per-user now: the composite `(user_id, strategy_id)` PK lets two users hold the
 * same id, and every read/mutation resolves ownership from the propagated `x-user-id` header
 * (never the request body). The insights/trader BFFs no longer admin-gate strategy mutations
 * (Step 13) — they forward the caller's identity and trust the backend's uniform PERMISSION_DENIED.
 *
 * The mock backend (started in globalSetup on port 9092) owns every seeded strategy as user A
 * (`TEST_USER_ID`, the default `addAuthCookie` identity). User B (`TEST_USER_B_ID`) owns nothing
 * seeded, so B can neither see nor mutate A's strategies. These tests prove the BFF forwards
 * identity and the backend gates on it — the exact seam Step 13 changed.
 *
 * BFF calls go through browser-level `fetch` (`page.evaluate`) to dodge the Next.js dev-server
 * Transfer-Encoding quirk that breaks Playwright's undici-based APIRequestContext (see api-smoke).
 */

const A_STRATEGY_ID = 'strat-owned-by-a';
const BFF = (method: string) => `/insights/api/xstockstrat.analysis.v1.AnalysisService/${method}`;

async function callBff(
  page: Page,
  method: string,
  reqBody: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return page.evaluate(
    async ({ url, reqBody }) => {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(reqBody),
      });
      const body = (await res.json()) as Record<string, unknown>;
      return { status: res.status, body };
    },
    { url: BFF(method), reqBody },
  );
}

async function loginAsUserB(page: Page): Promise<void> {
  await addCookieWithRoles(page, [], { id: TEST_USER_B_ID, email: TEST_USER_B_EMAIL });
}

test.describe('feature 133 — cross-user strategy ownership isolation', () => {
  test('AC-3: user A sees their strategies on the /insights list; user B sees none', async ({
    page,
  }) => {
    // User A (default identity) — the seeded definitions are theirs. The first BFF round-trip
    // through the mock can be slow on a cold dev server, so allow the loading state to resolve.
    await addAuthCookie(page);
    await page.goto('/insights/strategies');
    await expect(page.getByText('Live Test Strategy')).toBeVisible({ timeout: 15000 });

    // User B — a distinct identity owns nothing seeded, so the list is empty.
    await loginAsUserB(page);
    await page.goto('/insights/strategies');
    await expect(page.getByText('No strategies registered yet.', { exact: false })).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText('Live Test Strategy')).toHaveCount(0);
  });

  test('AC-3: ListStrategyDefinitions is owner-scoped at the BFF', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/auth/login');
    const asA = await callBff(page, 'ListStrategyDefinitions', {});
    expect(asA.status).toBe(200);
    expect((asA.body.definitions as unknown[]).length).toBeGreaterThan(0);

    await loginAsUserB(page);
    await page.goto('/auth/login');
    const asB = await callBff(page, 'ListStrategyDefinitions', {});
    expect(asB.status).toBe(200);
    expect(asB.body.definitions ?? []).toEqual([]);
  });

  test('AC-2/AC-6: the owner can read their strategy; a non-owner is denied PERMISSION_DENIED', async ({
    page,
  }) => {
    // Owner (A) reads their own strategy — allowed.
    await addAuthCookie(page);
    await page.goto('/auth/login');
    const ownerRead = await callBff(page, 'GetStrategy', { strategyId: A_STRATEGY_ID });
    expect(ownerRead.status).toBe(200);
    expect(ownerRead.body.strategyId).toBe(A_STRATEGY_ID);

    // Non-owner (B) reading A's strategy — uniform PERMISSION_DENIED (no NOT_FOUND leak).
    await loginAsUserB(page);
    await page.goto('/auth/login');
    const nonOwnerRead = await callBff(page, 'GetStrategy', { strategyId: A_STRATEGY_ID });
    expect(nonOwnerRead.status).toBe(403);
    expect(nonOwnerRead.body.code).toBe('permission_denied');
  });

  test('AC-2: a non-owner cannot set another user’s strategy live', async ({ page }) => {
    await loginAsUserB(page);
    await page.goto('/auth/login');
    const res = await callBff(page, 'SetStrategyLive', {
      strategyId: A_STRATEGY_ID,
      liveEnabled: true,
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('permission_denied');
  });

  test('AC-2: a non-owner cannot update another user’s strategy', async ({ page }) => {
    await loginAsUserB(page);
    await page.goto('/auth/login');
    const res = await callBff(page, 'ManageStrategy', {
      operation: 'STRATEGY_OPERATION_UPDATE',
      definition: { strategyId: A_STRATEGY_ID, displayName: 'hijacked' },
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('permission_denied');
  });
});
