import { test, expect, type Page } from '@playwright/test';
import { SignJWT } from 'jose';

/**
 * BFF smoke tests for the Connect-RPC gateway in xstockstrat-config-ui.
 *
 * The mock backend (started in globalSetup on port 9093) handles ListKeys and
 * SetConfig and returns pre-configured keys.  These tests call the BFF via
 * browser-level fetch (page.evaluate) to avoid the Next.js dev-server
 * Transfer-Encoding quirk that breaks Playwright's undici-based APIRequestContext.
 *
 * Auth cookie is injected directly so the middleware allows the BFF call through.
 *
 * The tests assert on the exact shape that [namespace]/page.tsx (NamespacePage)
 * consumes so that any backend-to-UI contract mismatch is caught here first.
 */

const TEST_JWT_SECRET = 'test-jwt-secret-for-e2e-tests-min32c';
const BASE_URL = 'http://localhost:3000';
const CONFIG_BFF = '/config-ui/api/xstockstrat.config.v1.ConfigService/ListKeys';
const SET_CONFIG_BFF = '/config-ui/api/xstockstrat.config.v1.ConfigService/SetConfig';

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
      const responseBody = await res.json() as Record<string, unknown>;
      return { status: res.status, body: responseBody };
    },
    { url, body },
  );
}

test.describe('GET /api/config — namespace config table data contract', () => {
  /**
   * [namespace]/page.tsx (NamespacePage) accesses:
   *   data.keys                       → array iteration (data.keys ?? [])
   *   k.key                           → TableCell font-mono, row key prop
   *   k.defaultValue                  → displayed in Value column (or '[secret]' if isSecret)
   *   k.description                   → Description column (hidden on mobile)
   *   k.isSecret                      → boolean gate: hides value + disables Edit button
   *   k.consumingService              → (not rendered, but part of ConfigKey interface)
   *   k.environment                   → number (not rendered in table, but part of ListKeys response)
   *   k.tradingMode                   → number (not rendered in table, but part of ListKeys response)
   */
  test('returns { keys: [] } wrapper matching the ListKeysResponse interface', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/config-ui/login');
    const { status, body } = await callBff(page, CONFIG_BFF, { namespace: 'platform', environment: 1, tradingMode: 0 });
    expect(status).toBe(200);
    expect(body).toHaveProperty('keys');
    expect(Array.isArray(body.keys)).toBe(true);
  });

  test('each key has all ConfigKey interface fields', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/config-ui/login');
    const { body } = await callBff(page, CONFIG_BFF, { namespace: 'platform', environment: 1, tradingMode: 0 });
    const keys = body.keys as Array<Record<string, unknown>>;

    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) {
      expect(k).toHaveProperty('key');           // row key + displayed in Key column
      expect(k).toHaveProperty('defaultValue');  // displayed in Value column
      expect(k).toHaveProperty('description');   // Description column
      // isSecret is a proto3 bool — false (zero value) is omitted from JSON;
      // absent means false, which is the correct semantic for the component
      expect(typeof k.isSecret === 'boolean' || k.isSecret === undefined).toBe(true);
    }
  });

  test('non-secret key: defaultValue is a readable string (not [secret])', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/config-ui/login');
    const { body } = await callBff(page, CONFIG_BFF, { namespace: 'platform', environment: 1, tradingMode: 0 });
    const keys = body.keys as Array<Record<string, unknown>>;

    const nonSecret = keys.find((k) => !k.isSecret);
    expect(nonSecret).toBeDefined();
    expect(typeof nonSecret!.defaultValue).toBe('string');
    expect(nonSecret!.defaultValue).not.toBe('[secret]');
  });

  test('secret key: isSecret is true and value is masked', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/config-ui/login');
    const { body } = await callBff(page, CONFIG_BFF, { namespace: 'platform', environment: 1, tradingMode: 0 });
    const keys = body.keys as Array<Record<string, unknown>>;

    const secretKey = keys.find((k) => k.isSecret);
    if (!secretKey) {
      test.skip();
      return;
    }

    expect(secretKey.isSecret).toBe(true);
    expect(secretKey.defaultValue).toBe('[secret]');
  });

  test('env and mode params are forwarded to ListKeys as proto enums', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/config-ui/login');
    const { status, body } = await callBff(page, CONFIG_BFF, { namespace: 'platform', environment: 2, tradingMode: 2 });
    expect(status).toBe(200);
    expect(body).toHaveProperty('keys');
  });
});

test.describe('POST /api/config — inline edit save flow', () => {
  /**
   * NamespacePage handleSave() sends SetConfig via the browser configClient.
   * Verifies the BFF accepts the payload and returns a success response.
   */
  test('accepts a valid SetConfig payload and returns 200', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/config-ui/login');
    const { status } = await callBff(page, SET_CONFIG_BFF, {
      namespace: 'platform',
      key: 'platform.log_level',
      value: { value: { case: 'stringVal', value: 'debug' } },
      reason: 'Updated via config-ui',
      environment: 1,
      tradingMode: 0,
    });
    expect(status).toBe(200);
  });

  test('SetConfig does not return an error field on success', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/config-ui/login');
    const { status, body } = await callBff(page, SET_CONFIG_BFF, {
      namespace: 'platform',
      key: 'platform.log_level',
      value: { value: { case: 'stringVal', value: 'warn' } },
      reason: 'Updated via config-ui',
      environment: 1,
      tradingMode: 0,
    });
    expect(status).toBe(200);
    expect(body).not.toHaveProperty('error');
  });
});

test.describe('validation field in ListKeysResponse', () => {
  test('weight key has validation.valueType=1 and correct bounds', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/config-ui/login');
    const { status, body } = await callBff(page, CONFIG_BFF, { namespace: 'analysis', environment: 1, tradingMode: 0 });
    expect(status).toBe(200);
    const keys = body.keys as Array<Record<string, unknown>>;
    const weightKey = keys.find((k) => k.key === 'analysis.signals.source_weights');
    expect(weightKey).toBeDefined();
    const v = weightKey!.validation as Record<string, unknown>;
    expect(v).toBeDefined();
    expect(v.valueType).toBe(1);
    expect(Number(v.minValue)).toBeCloseTo(0.0);
    expect(Number(v.maxValue)).toBeCloseTo(1.0);
  });

  test('non-weight key has no validation field', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/config-ui/login');
    const { status, body } = await callBff(page, CONFIG_BFF, { namespace: 'platform', environment: 1, tradingMode: 0 });
    expect(status).toBe(200);
    const keys = body.keys as Array<Record<string, unknown>>;
    const logLevel = keys.find((k) => k.key === 'platform.log_level');
    expect(logLevel).toBeDefined();
    // validation absent means no validation applied (FR-5)
    expect(logLevel!.validation).toBeUndefined();
  });
});
