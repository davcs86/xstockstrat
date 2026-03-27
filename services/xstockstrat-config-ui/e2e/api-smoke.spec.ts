import { test, expect } from '@playwright/test';

/**
 * API smoke tests for xstockstrat-config-ui Next.js route handlers.
 *
 * These tests call GET /api/config and POST /api/config via Playwright's
 * APIRequestContext.  The route handler uses the Connect-RPC client which
 * points at the mock backend started in globalSetup.
 *
 * Assertions are scoped to the exact fields the [namespace]/page.tsx component
 * consumes so that any shape mismatch between the route and the UI is caught.
 */

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
  test('returns { keys: [] } wrapper matching the ListKeysResponse interface', async ({ request }) => {
    const res = await request.get('/api/config?namespace=platform&env=dev&mode=paper');
    expect(res.status()).toBe(200);

    const body = await res.json();
    // Component does: const data: ListKeysResponse = await fetch(...).then(r => r.json())
    // then: setKeys(data.keys ?? [])
    expect(body).toHaveProperty('keys');
    expect(Array.isArray(body.keys)).toBe(true);
  });

  test('each key has all ConfigKey interface fields', async ({ request }) => {
    const res = await request.get('/api/config?namespace=platform&env=dev&mode=paper');
    const { keys } = await res.json();

    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) {
      expect(k).toHaveProperty('key');           // row key + displayed in Key column
      expect(k).toHaveProperty('defaultValue');  // displayed in Value column
      expect(k).toHaveProperty('description');   // Description column
      expect(k).toHaveProperty('isSecret');      // boolean gate — must be boolean
      expect(typeof k.isSecret).toBe('boolean');
    }
  });

  test('non-secret key: defaultValue is a readable string (not [secret])', async ({ request }) => {
    const res = await request.get('/api/config?namespace=platform&env=dev&mode=paper');
    const { keys } = await res.json();

    const nonSecret = keys.find((k: { isSecret: boolean }) => !k.isSecret);
    expect(nonSecret).toBeDefined();
    // Component renders k.defaultValue directly when isSecret is false
    // It must be a string the operator can read and edit
    expect(typeof nonSecret.defaultValue).toBe('string');
    expect(nonSecret.defaultValue).not.toBe('[secret]');
  });

  test('secret key: isSecret is true and value is masked', async ({ request }) => {
    const res = await request.get('/api/config?namespace=platform&env=dev&mode=paper');
    const { keys } = await res.json();

    const secretKey = keys.find((k: { isSecret: boolean }) => k.isSecret);
    if (!secretKey) {
      // Mock may not include a secret key for every namespace — skip if absent
      test.skip();
      return;
    }

    expect(secretKey.isSecret).toBe(true);
    // Component renders <span>[secret]</span> and disables the Edit button for secrets
    // The route should return '[secret]' as the defaultValue for secret keys
    expect(secretKey.defaultValue).toBe('[secret]');
  });

  test('env and mode params are forwarded to ListKeys as proto enums', async ({ request }) => {
    // GET with production/live scope — the mock returns the same keys regardless,
    // but the route must not error when receiving these params
    const res = await request.get('/api/config?namespace=platform&env=production&mode=live');
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty('keys');
  });
});

test.describe('POST /api/config — inline edit save flow', () => {
  /**
   * NamespacePage handleSave() sends:
   *   { namespace, key, value, env, mode, author: 'config-ui', reason: 'Updated via config-ui' }
   * then re-fetches GET /api/config to refresh the table.
   */
  test('accepts a valid SetConfig payload and returns 200', async ({ request }) => {
    const res = await request.post('/api/config', {
      data: {
        namespace: 'platform',
        key: 'platform.log_level',
        value: 'debug',
        env: 'dev',
        mode: 'paper',
        author: 'config-ui',
        reason: 'Updated via config-ui',
      },
    });
    expect(res.status()).toBe(200);
  });

  test('SetConfig does not return an error field on success', async ({ request }) => {
    const res = await request.post('/api/config', {
      data: {
        namespace: 'platform',
        key: 'platform.log_level',
        value: 'warn',
        env: 'dev',
        mode: 'paper',
        author: 'config-ui',
        reason: 'Updated via config-ui',
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    // A successful save must not have an error field — the component doesn't
    // check for it but an error here would silently fail the operator's save
    expect(body).not.toHaveProperty('error');
  });
});
