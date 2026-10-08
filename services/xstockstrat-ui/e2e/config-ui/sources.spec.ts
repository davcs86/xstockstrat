import { test, expect, type Page } from '@playwright/test';
import { addAuthCookie, addAdminCookie, BASE_URL } from '../helpers/auth';
import {
  SIGNAL_SOURCE_WEIGHTED,
  TEST_USER_ID,
  USER_VIEW_PRIMARY,
  USER_VIEW_TRADER,
} from '../fixtures';

/**
 * E2E tests for the config-ui signal-sources BFF and the admin read-only Sources view.
 *
 * Connect-RPC BFF paths (called via page.evaluate to avoid undici quirks):
 *   POST /config-ui/api/xstockstrat.ingest.v1.IngestService/ListSignalSources
 *   POST /config-ui/api/xstockstrat.ingest.v1.IngestService/ManageSignalSource
 *
 * Feature 224 (FR-13): /config-ui/sources is an admin-only READ-ONLY view of one selected owner's
 * sources — users manage their own under /insights/signal-sources (signal-sources.spec.ts).
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

test.describe('/config-ui/sources — admin read-only view (feature 224)', () => {
  test('a non-admin sees the admin-only notice, not the table', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto(SOURCES_PAGE);
    await expect(page.getByText('Admin only')).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('combobox', { name: 'Owner' })).toHaveCount(0);
  });

  test('the owner selector drives ownerUserId and lists that owner’s sources read-only', async ({
    page,
  }) => {
    await addAdminCookie(page);
    await page.goto(SOURCES_PAGE);
    await expect(page.getByRole('heading', { name: 'Signal Sources (admin)' })).toBeVisible({
      timeout: 15000,
    });

    const listReq = page.waitForRequest(
      (r) => r.url().endsWith(LIST_SOURCES_BFF) && r.method() === 'POST',
    );
    await page.getByRole('combobox', { name: 'Owner' }).click();
    await page.getByRole('option', { name: USER_VIEW_PRIMARY.email }).click();
    expect((await listReq).postDataJSON()).toMatchObject({ ownerUserId: TEST_USER_ID });
    await expect(page.getByRole('cell', { name: SIGNAL_SOURCE_WEIGHTED.slug })).toBeVisible();

    // FR-13: no create / edit / deactivate / inline-weight control.
    await expect(page.getByRole('button', { name: 'Register New Source' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Actions/ })).toHaveCount(0);
    await expect(page.locator('[data-testid^="weight-"]')).toHaveCount(0);
    await expect(page.getByRole('menuitem')).toHaveCount(0);
  });

  test('selecting an owner without sources shows the empty state', async ({ page }) => {
    await addAdminCookie(page);
    await page.goto(SOURCES_PAGE);
    const listReq = page.waitForRequest(
      (r) => r.url().endsWith(LIST_SOURCES_BFF) && r.method() === 'POST',
    );
    await page.getByRole('combobox', { name: 'Owner' }).click({ timeout: 15000 });
    await page.getByRole('option', { name: USER_VIEW_TRADER.email }).click();
    expect((await listReq).postDataJSON()).toMatchObject({ ownerUserId: USER_VIEW_TRADER.userId });
    await expect(page.getByText('This user has no signal sources')).toBeVisible();
  });

  test('page does not render credentials_ref as a visible text value', async ({ page }) => {
    await addAdminCookie(page);
    await page.goto(SOURCES_PAGE);
    await page.getByRole('combobox', { name: 'Owner' }).click({ timeout: 15000 });
    await page.getByRole('option', { name: USER_VIEW_PRIMARY.email }).click();
    await expect(page.getByRole('cell', { name: SIGNAL_SOURCE_WEIGHTED.slug })).toBeVisible();
    expect(await page.textContent('body')).not.toMatch(/credentials_ref/);
  });
});
