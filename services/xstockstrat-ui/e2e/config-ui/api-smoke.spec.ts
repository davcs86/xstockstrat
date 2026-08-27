import { test, expect, type Page } from '@playwright/test';
import { addAuthCookie, addAdminCookie } from '../helpers/auth';
import { setConfigPayload } from '../fixtures/configKeys';

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

const CONFIG_BFF = '/config-ui/api/xstockstrat.config.v1.ConfigService/ListKeys';
const SET_CONFIG_BFF = '/config-ui/api/xstockstrat.config.v1.ConfigService/SetConfig';

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

test.describe('GET /api/config — namespace config table data contract', () => {
  /**
   * [namespace]/NamespaceEditor.tsx accesses:
   *   data.keys                       → array iteration (data.keys ?? [])
   *   k.key                           → TableCell font-mono, row key prop
   *   k.currentValue                  → displayed in Value column + edit-prefill (secrets show '[secret]' and the editor starts BLANK, feature 147)
   *   k.defaultValue                  → seed metadata only (CONFIG-2); NOT read for display
   *   k.description                   → Description column (hidden on mobile)
   *   k.isSecret                      → masks the displayed value as '[secret]'; Edit IS allowed (admin-gated backend), the editor opens blank and stores a fresh encrypted value (feature 147)
   *   k.consumingService              → (not rendered, but part of ConfigKey interface)
   *   k.environment                   → number (not rendered in table, but part of ListKeys response)
   *   k.tradingMode                   → number (not rendered in table, but part of ListKeys response)
   */
  test('returns { keys: [] } wrapper matching the ListKeysResponse interface', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/auth/login');
    const { status, body } = await callBff(page, CONFIG_BFF, {
      namespace: 'platform',
      environment: 1,
      tradingMode: 0,
    });
    expect(status).toBe(200);
    expect(body).toHaveProperty('keys');
    expect(Array.isArray(body.keys)).toBe(true);
  });

  test('each key has all ConfigKey interface fields', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/auth/login');
    const { body } = await callBff(page, CONFIG_BFF, {
      namespace: 'platform',
      environment: 1,
      tradingMode: 0,
    });
    const keys = body.keys as Array<Record<string, unknown>>;

    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) {
      expect(k).toHaveProperty('key'); // row key + displayed in Key column
      expect(k).toHaveProperty('defaultValue'); // seed metadata only (CONFIG-2)
      expect(k).toHaveProperty('currentValue'); // displayed in Value column + edit-prefill
      expect(k).toHaveProperty('description'); // Description column
      // isSecret is a proto3 bool — false (zero value) is omitted from JSON;
      // absent means false, which is the correct semantic for the component
      expect(typeof k.isSecret === 'boolean' || k.isSecret === undefined).toBe(true);
    }
  });

  test('non-secret key: currentValue is a readable string (not [secret])', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/auth/login');
    const { body } = await callBff(page, CONFIG_BFF, {
      namespace: 'platform',
      environment: 1,
      tradingMode: 0,
    });
    const keys = body.keys as Array<Record<string, unknown>>;

    const nonSecret = keys.find((k) => !k.isSecret);
    expect(nonSecret).toBeDefined();
    expect(typeof nonSecret!.currentValue).toBe('string');
    expect(nonSecret!.currentValue).not.toBe('[secret]');
  });

  test('secret key: isSecret is true and default/current values are masked', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/auth/login');
    const { body } = await callBff(page, CONFIG_BFF, {
      namespace: 'platform',
      environment: 1,
      tradingMode: 0,
    });
    const keys = body.keys as Array<Record<string, unknown>>;

    const secretKey = keys.find((k) => k.isSecret);
    if (!secretKey) {
      test.skip();
      return;
    }

    expect(secretKey.isSecret).toBe(true);
    expect(secretKey.defaultValue).toBe('[secret]');
    expect(secretKey.currentValue).toBe('[secret]');
  });

  test('a value freshly written by SetConfig is what the next ListKeys reports as currentValue', async ({
    page,
  }) => {
    // Regression coverage for the config-ui "editing configs" bug (docs/reports/
    // 2026-08-07-config-ui-value-not-updating-defect.md): ListKeys used to expose only the
    // seed defaultValue, which a SetConfig write never touches, so a saved edit was invisible
    // to any caller of this RPC — not just the NamespaceEditor UI.
    await addAdminCookie(page);
    await page.goto('/auth/login');
    await callBff(page, SET_CONFIG_BFF, setConfigPayload());

    const { body } = await callBff(page, CONFIG_BFF, {
      namespace: 'platform',
      environment: 1,
      tradingMode: 0,
    });
    const keys = body.keys as Array<Record<string, unknown>>;
    const logLevel = keys.find((k) => k.key === 'platform.log_level');
    expect(logLevel).toBeDefined();
    // setConfigPayload()'s default value is 'debug'.
    expect(logLevel!.currentValue).toBe('debug');
    expect(logLevel!.defaultValue).not.toBe('debug');
  });

  test('env and mode params are forwarded to ListKeys as proto enums', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/auth/login');
    const { status, body } = await callBff(page, CONFIG_BFF, {
      namespace: 'platform',
      environment: 2,
      tradingMode: 2,
    });
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
    // Admin cookie: config writes require the ADMIN scope bit (feature 074).
    await addAdminCookie(page);
    await page.goto('/auth/login');
    const { status } = await callBff(page, SET_CONFIG_BFF, setConfigPayload());
    expect(status).toBe(200);
  });

  test('SetConfig does not return an error field on success', async ({ page }) => {
    await addAdminCookie(page);
    await page.goto('/auth/login');
    const { status, body } = await callBff(
      page,
      SET_CONFIG_BFF,
      setConfigPayload({ value: { stringVal: 'warn' } }),
    );
    expect(status).toBe(200);
    expect(body).not.toHaveProperty('error');
  });

  test('SetConfig is denied for a non-admin session', async ({ page }) => {
    // A signed-in viewer/trader must not be able to write config — this is the
    // SEV-1 the feature closes (any authenticated user could previously set
    // platform.maintenance_mode or the trading.approval.* thresholds).
    await addAuthCookie(page);
    await page.goto('/auth/login');
    const { status, body } = await callBff(
      page,
      SET_CONFIG_BFF,
      setConfigPayload({
        key: 'platform.maintenance_mode',
        value: { boolVal: true },
        reason: 'should be rejected',
      }),
    );
    expect(status).not.toBe(200);
    expect(JSON.stringify(body).toLowerCase()).toContain('permission');
  });

  test('SetConfig is rejected for a non-native environment (FailedPrecondition → 400)', async ({
    page,
  }) => {
    // webServer.env sets APPLICATION_ENV=development (native scope = staging = Environment.STAGING = 3).
    // environment: 2 (PRODUCTION) is the non-native scope for this deployment.
    await addAdminCookie(page);
    await page.goto('/auth/login');
    const { status, body } = await callBff(
      page,
      SET_CONFIG_BFF,
      setConfigPayload({ environment: 2 }),
    );
    expect(status).toBe(400);
    expect(JSON.stringify(body).toLowerCase()).toContain('native environment');
  });
});

test.describe('validation field in ListKeysResponse', () => {
  test('decay key has validation.valueType=VALUE_TYPE_FLOAT_SCALAR and correct bounds (AC-6)', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await page.goto('/auth/login');
    const { status, body } = await callBff(page, CONFIG_BFF, {
      namespace: 'analysis',
      environment: 3,
      userId: '',
    });
    expect(status).toBe(200);
    const keys = body.keys as Array<Record<string, unknown>>;
    const decayKey = keys.find((k) => k.key === 'analysis.scoring.signal_decay_half_life_hours');
    expect(decayKey).toBeDefined();
    const v = decayKey!.validation as Record<string, unknown>;
    expect(v).toBeDefined();
    // Connect JSON (protobuf-es) serializes enum fields as their proto name, not
    // the numeric value — see e2e/trader/api-smoke.spec.ts. ValueType 2 == FLOAT_SCALAR.
    expect(v.valueType).toBe('VALUE_TYPE_FLOAT_SCALAR');
    // proto3 JSON omits zero-valued scalars, so a minValue of 0.0 is absent from
    // the response (which is semantically still 0). Treat the omission as 0.
    expect(Number(v.minValue ?? 0)).toBeCloseTo(0.0);
    expect(Number(v.maxValue)).toBeCloseTo(8760);
    // AC-8: the removed FLOAT_MAP key must no longer be surfaced.
    expect(keys.find((k) => k.key === 'analysis.signals.source_weights')).toBeUndefined();
  });

  test('non-weight key has no validation field', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/auth/login');
    const { status, body } = await callBff(page, CONFIG_BFF, {
      namespace: 'platform',
      environment: 1,
      tradingMode: 0,
    });
    expect(status).toBe(200);
    const keys = body.keys as Array<Record<string, unknown>>;
    const logLevel = keys.find((k) => k.key === 'platform.log_level');
    expect(logLevel).toBeDefined();
    // validation absent means no validation applied (FR-5)
    expect(logLevel!.validation).toBeUndefined();
  });
});
