import { test, expect, type Page } from '@playwright/test';
import { SignJWT } from 'jose';

/**
 * E2E tests for the signal sources BFF and Sources page.
 *
 * Connect-RPC BFF paths (called via page.evaluate to avoid undici quirks):
 *   POST /config-ui/api/xstockstrat.ingest.v1.IngestService/ListSignalSources
 *   POST /config-ui/api/xstockstrat.ingest.v1.IngestService/ManageSignalSource
 *
 * UI tests navigate to /config-ui/sources to verify the page renders the
 * data fetched from the BFF via the browser-side ingestClient.
 *
 * Auth cookie is injected so middleware allows requests through.
 */

const TEST_JWT_SECRET = 'test-jwt-secret-for-e2e-tests-min32c';
const BASE_URL = 'http://localhost:3000';
const LIST_SOURCES_BFF = '/config-ui/api/xstockstrat.ingest.v1.IngestService/ListSignalSources';
const MANAGE_SOURCE_BFF = '/config-ui/api/xstockstrat.ingest.v1.IngestService/ManageSignalSource';
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

test.describe('GET /api/sources — ListSignalSources data contract', () => {
  /**
   * SourcesPage fetches ListSignalSources on mount via the BFF.
   * Each source has: slug, displayName, sourceType, active, hasCredentials, configJson.
   * The route must never include credentialsRef in the response.
   */

  test('returns 200 with a sources array wrapper', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/config-ui/login');
    const { status, body } = await callBff(page, LIST_SOURCES_BFF, { includeInactive: true });
    expect(status).toBe(200);
    expect(body).toHaveProperty('sources');
    expect(Array.isArray(body.sources)).toBe(true);
  });

  test('include_inactive=true param returns 200', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/config-ui/login');
    const { status, body } = await callBff(page, LIST_SOURCES_BFF, { includeInactive: true });
    expect(status).toBe(200);
    expect(body).toHaveProperty('sources');
  });

  test('each source has required SignalSource fields', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/config-ui/login');
    const { body } = await callBff(page, LIST_SOURCES_BFF, { includeInactive: true });
    const sources = body.sources as Array<Record<string, unknown>>;
    expect(sources.length).toBeGreaterThan(0);
    for (const src of sources) {
      expect(src).toHaveProperty('slug');
      expect(src).toHaveProperty('displayName');
      expect(src).toHaveProperty('sourceType');
      expect(src).toHaveProperty('active');
      expect(src).toHaveProperty('hasCredentials');  // mock uses true so proto3 includes it
      expect(typeof src.active).toBe('boolean');
      expect(typeof src.hasCredentials).toBe('boolean');
    }
  });

  test('response never includes credentialsRef field', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/config-ui/login');
    const { body } = await callBff(page, LIST_SOURCES_BFF, { includeInactive: true });
    const sources = body.sources as Array<Record<string, unknown>>;
    for (const src of sources) {
      expect(src).not.toHaveProperty('credentialsRef');
    }
  });
});

test.describe('POST /api/sources — ManageSignalSource data contract', () => {
  test('accepts a valid update payload and returns 200', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/config-ui/login');
    const { status } = await callBff(page, MANAGE_SOURCE_BFF, {
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
    });
    expect(status).toBe(200);
  });

  test('successful ManageSignalSource response does not have an error field', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/config-ui/login');
    const { status, body } = await callBff(page, MANAGE_SOURCE_BFF, {
      source: { slug: 'example_simple_email', displayName: 'Test', sourceType: 'simple_email',
                extractorModule: 'app.extractors.noop', active: false, configJson: {} },
      operation: 'deactivate',
    });
    expect(status).toBe(200);
    expect(body).not.toHaveProperty('error');
  });
});

test.describe('/sources page — UI contract', () => {
  /**
   * SourcesPage renders a table of all sources fetched from ListSignalSources via BFF.
   * The credentials_ref field must never appear as a visible value anywhere on the page.
   */

  test('page loads and renders the Signal Sources heading', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto(SOURCES_PAGE);
    await expect(page.getByText('Signal Sources')).toBeVisible({ timeout: 8000 });
  });

  test('table shows the mock source slug', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto(SOURCES_PAGE);
    await expect(page.getByText('example_simple_email')).toBeVisible({ timeout: 8000 });
  });

  test('page does not render credentials_ref as a visible text value', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto(SOURCES_PAGE);
    await page.waitForLoadState('networkidle');
    const content = await page.textContent('body');
    expect(content).not.toMatch(/credentials_ref/);
  });
});
