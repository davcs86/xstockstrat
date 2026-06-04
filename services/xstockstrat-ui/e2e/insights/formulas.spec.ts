import { test, expect, type Page } from '@playwright/test';
import { SignJWT } from 'jose';

/**
 * E2E smoke tests for the formula management UI (`/insights/formulas`).
 *
 * The mock backend (globalSetup, port 9092) does not mock IndicatorsService, so
 * the ListFormulas BFF call is stubbed at the browser level with page.route().
 * An auth cookie is injected so the middleware does not redirect to /auth/login.
 */

const TEST_JWT_SECRET = 'test-jwt-secret-for-e2e-tests-min32c';
const BASE_URL = 'http://localhost:3000';

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

const MOCK_FORMULAS = [
  { formulaId: 'f-001', name: 'RSI Divergence', author: 'test-user-001', isPublic: true },
  { formulaId: 'f-002', name: 'MACD Cross', author: 'test-user-001', isPublic: false },
];

test.describe('Formula management UI', () => {
  test('formulas list page renders returned formulas', async ({ page }) => {
    await addAuthCookie(page);
    await page.route('**/xstockstrat.indicators.v1.IndicatorsService/ListFormulas', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ formulas: MOCK_FORMULAS, totalCount: MOCK_FORMULAS.length }),
      });
    });
    await page.goto('/insights/formulas');
    await expect(page.getByText('RSI Divergence')).toBeVisible();
  });

  test('new formula page renders the create form', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/insights/formulas/new');
    await expect(page.locator('input[name="name"], input[placeholder]').first()).toBeVisible({
      timeout: 10000,
    });
  });
});
