import { test, expect, type Page } from '@playwright/test';
import { addAuthCookie, BASE_URL } from '../helpers/auth';

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

const LIST_SOURCES_BFF = '/config-ui/api/xstockstrat.ingest.v1.IngestService/ListSignalSources';
const MANAGE_SOURCE_BFF = '/config-ui/api/xstockstrat.ingest.v1.IngestService/ManageSignalSource';
const SOURCES_PAGE = `${BASE_URL}/config-ui/sources`;

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

test.describe('GET /api/sources — ListSignalSources data contract', () => {
  /**
   * SourcesPage fetches ListSignalSources on mount via the BFF.
   * Each source has: slug, displayName, sourceType, active, hasCredentials, configJson.
   * The route must never include credentialsRef in the response.
   */

  test('returns 200 with a sources array wrapper', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/auth/login');
    const { status, body } = await callBff(page, LIST_SOURCES_BFF, { includeInactive: true });
    expect(status).toBe(200);
    expect(body).toHaveProperty('sources');
    expect(Array.isArray(body.sources)).toBe(true);
  });

  test('include_inactive=true param returns 200', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/auth/login');
    const { status, body } = await callBff(page, LIST_SOURCES_BFF, { includeInactive: true });
    expect(status).toBe(200);
    expect(body).toHaveProperty('sources');
  });

  test('each source has required SignalSource fields', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/auth/login');
    const { body } = await callBff(page, LIST_SOURCES_BFF, { includeInactive: true });
    const sources = body.sources as Array<Record<string, unknown>>;
    expect(sources.length).toBeGreaterThan(0);
    for (const src of sources) {
      expect(src).toHaveProperty('slug');
      expect(src).toHaveProperty('displayName');
      expect(src).toHaveProperty('sourceType');
      expect(src).toHaveProperty('active');
      expect(src).toHaveProperty('hasCredentials'); // mock uses true so proto3 includes it
      expect(typeof src.active).toBe('boolean');
      expect(typeof src.hasCredentials).toBe('boolean');
    }
  });

  test('response never includes credentialsRef field', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/auth/login');
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
    await page.goto('/auth/login');
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
    await page.goto('/auth/login');
    const { status, body } = await callBff(page, MANAGE_SOURCE_BFF, {
      source: {
        slug: 'example_simple_email',
        displayName: 'Test',
        sourceType: 'simple_email',
        extractorModule: 'app.extractors.noop',
        active: false,
        configJson: {},
      },
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
    // Target the page heading specifically — the feature-083 Engine sub-nav also has a
    // "Signal sources" link, so a bare getByText would be ambiguous.
    await expect(page.getByRole('heading', { name: 'Signal Sources' })).toBeVisible({
      timeout: 8000,
    });
  });

  test('table shows the mock source slug', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto(SOURCES_PAGE);
    await expect(page.getByText('example_simple_email')).toBeVisible({ timeout: 8000 });
  });

  test('renders source health + fed count (feature 083)', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto(SOURCES_PAGE);
    await expect(page.getByText('example_simple_email')).toBeVisible({ timeout: 8000 });
    // health LIVE → "Live" badge; signals_fed 128 (in the Fed column cell — the stat row also
    // sums fed counts, so scope to the table cell).
    await expect(page.getByText('Live', { exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: '128', exact: true })).toBeVisible();
  });

  test('renders the health stat row (feature 083)', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto(SOURCES_PAGE);
    await expect(page.getByText('Sources live')).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('Needs attention')).toBeVisible();
    await expect(page.getByText('Signals fed')).toBeVisible();
    await expect(
      page.getByText('Inputs the strategies evaluate against', { exact: false }),
    ).toBeVisible();
  });

  test('page does not render credentials_ref as a visible text value', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto(SOURCES_PAGE);
    await page.waitForLoadState('networkidle');
    const content = await page.textContent('body');
    expect(content).not.toMatch(/credentials_ref/);
  });
});

test.describe('Feature 088 — honest signal-source verbs (form → mask)', () => {
  test('editing a source without a new secret sends a mask that omits credentials_ref', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await page.goto(SOURCES_PAGE);
    await expect(page.getByRole('heading', { name: 'Signal Sources' })).toBeVisible({
      timeout: 15000,
    });
    // Actions are consolidated behind a per-row kebab menu (FR-2).
    await page.getByRole('button', { name: 'Actions' }).first().click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    // Change the display name only; do NOT type a credential.
    const nameInput = page.getByPlaceholder('Display name');
    await nameInput.fill('Renamed Source');

    const reqPromise = page.waitForRequest(
      (r) => r.url().includes('/ManageSignalSource') && r.method() === 'POST',
    );
    await page.getByRole('button', { name: 'Save' }).click();
    const body = (await reqPromise).postData() ?? '';
    // update verb + a mask that carries display_name but never the secret.
    expect(body).toContain('update');
    expect(body.toLowerCase()).not.toContain('credentialsref');
    expect(body.toLowerCase()).not.toContain('credentials_ref');
    expect(body.toLowerCase()).toContain('displayname');
  });

  test('enabling an inactive source uses the reactivate verb', async ({ page }) => {
    await addAuthCookie(page);
    await page.route(`**${LIST_SOURCES_BFF}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sources: [
            {
              slug: 'example_simple_email',
              displayName: 'Example Simple Email',
              sourceType: 'simple_email',
              active: false,
              hasCredentials: true,
              configJson: { sender_patterns: ['x@y.com'], subject_patterns: ['S:'] },
              extractorModule: 'app.extractors.example_simple_email',
              health: 3,
              signalsFed: '0',
              lastError: '',
            },
          ],
        }),
      });
    });
    await page.goto(SOURCES_PAGE);
    const reqPromise = page.waitForRequest(
      (r) => r.url().includes('/ManageSignalSource') && r.method() === 'POST',
    );
    await page.getByRole('button', { name: 'Actions' }).first().click();
    await page.getByRole('menuitem', { name: 'Enable' }).click();
    const body = (await reqPromise).postData() ?? '';
    expect(body).toContain('reactivate');
  });
});
