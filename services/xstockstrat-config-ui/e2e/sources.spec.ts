import { test, expect, type Page } from '@playwright/test';
import { SignJWT } from 'jose';

/**
 * E2E tests for the signal sources API route and Sources page.
 *
 * GET  /config-ui/api/sources?include_inactive=true  → ListSignalSources
 * POST /config-ui/api/sources                        → ManageSignalSource
 * /config-ui/sources                                 → Sources page (Client Component)
 *
 * Note: the app uses basePath '/config-ui', so all routes include that prefix.
 * The mock backend (port 9093) is started in globalSetup.
 *
 * Auth cookies are injected via addAuthCookie() so each test exercises
 * the authenticated code path.
 */

const TEST_JWT_SECRET = 'test-jwt-secret-for-e2e-tests-min32c';
const BASE_URL = 'http://localhost:3002';
const SOURCES_API = `${BASE_URL}/config-ui/api/sources`;
const SOURCES_PAGE = `${BASE_URL}/config-ui/sources`;

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

test.describe('GET /api/sources — ListSignalSources data contract', () => {
  /**
   * SourcesPage fetches GET /api/sources?include_inactive=true on mount.
   * The route proxies to ListSignalSources and returns { sources: [...] }.
   * Each source has: slug, displayName, sourceType, active, hasCredentials, configJson.
   * The route must never include credentialsRef in the response.
   */

  test('returns 200 with a sources array wrapper', async ({ page }) => {
    await addAuthCookie(page);
    const res = await page.request.get(SOURCES_API);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('sources');
    expect(Array.isArray(body.sources)).toBe(true);
  });

  test('include_inactive=true param returns 200', async ({ page }) => {
    await addAuthCookie(page);
    const res = await page.request.get(`${SOURCES_API}?include_inactive=true`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('sources');
  });

  test('each source has required SignalSource fields', async ({ page }) => {
    await addAuthCookie(page);
    const res = await page.request.get(`${SOURCES_API}?include_inactive=true`);
    const { sources } = await res.json();
    expect(sources.length).toBeGreaterThan(0);
    for (const src of sources) {
      expect(src).toHaveProperty('slug');
      expect(src).toHaveProperty('displayName');
      expect(src).toHaveProperty('sourceType');
      expect(src).toHaveProperty('active');
      expect(src).toHaveProperty('hasCredentials');
      expect(typeof src.active).toBe('boolean');
      expect(typeof src.hasCredentials).toBe('boolean');
    }
  });

  test('response never includes credentialsRef field', async ({ page }) => {
    await addAuthCookie(page);
    const res = await page.request.get(`${SOURCES_API}?include_inactive=true`);
    const { sources } = await res.json();
    for (const src of sources) {
      // credentialsRef must never be returned — only hasCredentials (bool) is safe
      expect(src).not.toHaveProperty('credentialsRef');
    }
  });
});

test.describe('POST /api/sources — ManageSignalSource data contract', () => {
  /**
   * SourcesPage handleSave() sends:
   *   { source: { slug, displayName, sourceType, extractorModule, active, configJson },
   *     operation: 'register' | 'update' | 'deactivate',
   *     credentialsRef?: string }
   */

  test('accepts a valid update payload and returns 200', async ({ page }) => {
    await addAuthCookie(page);
    const res = await page.request.post(SOURCES_API, {
      data: {
        source: {
          slug: 'example_simple_email',
          displayName: 'Example Simple Email',
          sourceType: 'simple_email',
          extractorModule: 'app.extractors.example_simple_email',
          active: true,
          configJson: {
            sender_patterns: ['noreply@example.com'],
            subject_patterns: ['Signal:'],
          },
        },
        operation: 'update',
      },
    });
    expect(res.status()).toBe(200);
  });

  test('successful ManageSignalSource response does not have an error field', async ({ page }) => {
    await addAuthCookie(page);
    const res = await page.request.post(SOURCES_API, {
      data: {
        source: { slug: 'example_simple_email', displayName: 'Test', sourceType: 'simple_email',
                  extractorModule: 'app.extractors.noop', active: false, configJson: {} },
        operation: 'deactivate',
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).not.toHaveProperty('error');
  });
});

test.describe('/sources page — UI contract', () => {
  /**
   * SourcesPage renders a table of all sources fetched from GET /api/sources.
   * The credentials_ref field must never appear as a visible value anywhere on the page.
   */

  test('page loads and renders the Signal Sources heading', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto(SOURCES_PAGE);
    await expect(page.getByText('Signal Sources')).toBeVisible();
  });

  test('table shows the mock source slug', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto(SOURCES_PAGE);
    await expect(page.getByText('example_simple_email')).toBeVisible();
  });

  test('page does not render credentials_ref as a visible text value', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto(SOURCES_PAGE);
    // The form input for credentials_ref is always cleared on load — its value is ''.
    // The label text "Credentials Ref" only appears inside an edit form for auth website types,
    // which is not open by default. The literal key name "credentials_ref" must never appear
    // as a rendered text value in the table or page body.
    const content = await page.textContent('body');
    expect(content).not.toMatch(/credentials_ref/);
  });
});
