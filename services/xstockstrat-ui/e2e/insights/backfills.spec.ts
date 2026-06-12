import { test, expect, type Page } from '@playwright/test';
import { SignJWT } from 'jose';

/**
 * E2E coverage for the Backfills management page (feature 057).
 *
 * The insights mock (port 9092) does not implement the Ingest/MarketData backfill RPCs, so —
 * like `e2e/insights/formulas.spec.ts` — the Connect endpoints are stubbed at the browser level
 * via `page.route()`, intercepting the browser → `/insights/api` calls. Admin vs. non-admin is
 * driven by the JWT `roles` claim (admin-only chrome is gated by `useIsAdmin()` → `/api/auth/me`).
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

  await page
    .context()
    .addCookies([
      { name: 'access_token', value: token, url: BASE_URL, httpOnly: true, sameSite: 'Lax' },
    ]);
}

const addAuthCookie = (page: Page) => addCookieWithRoles(page, []);
const addAdminCookie = (page: Page) => addCookieWithRoles(page, ['admin']);

const IngestPath = (m: string) => `**/xstockstrat.ingest.v1.IngestService/${m}`;
const MarketDataPath = (m: string) => `**/xstockstrat.marketdata.v1.MarketDataService/${m}`;

function runningJob(over: Record<string, unknown> = {}) {
  return {
    jobId: 'job-1',
    symbols: ['AAPL'],
    status: 'BACKFILL_STATUS_RUNNING',
    barsProcessed: '100',
    barsTotal: '500',
    chunksCompleted: 1,
    chunksTotal: 5,
    failedSymbols: [],
    error: '',
    timeframeEnum: 'TIMEFRAME_1DAY',
    ...over,
  };
}

async function fulfillJson(route: import('@playwright/test').Route, body: unknown) {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

// Stub ListBackfillJobs to return a fixed list (default: one RUNNING job).
async function stubList(page: Page, jobs: unknown[] = [runningJob()]) {
  await page.route(IngestPath('ListBackfillJobs'), (route) =>
    fulfillJson(route, { jobs, page: { nextPageToken: '', totalCount: jobs.length } }),
  );
}

test.describe('Backfills page — admin visibility (FR-7)', () => {
  test('admin sees the nav entry and the management surfaces', async ({ page }) => {
    await addAdminCookie(page);
    await stubList(page);

    await page.goto('/insights');
    // First test on a cold dev server — allow for on-demand route compilation + the
    // useIsAdmin() fetch before the admin-gated nav entry appears.
    await expect(page.getByRole('link', { name: 'Strategies' })).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('link', { name: 'Backfills' })).toBeVisible({ timeout: 20000 });

    await page.goto('/insights/backfills');
    await expect(page.getByRole('heading', { name: 'Backfills' })).toBeVisible({ timeout: 20000 });
    await expect(page.getByText('New backfill')).toBeVisible();
    await expect(page.getByText('Delete backfilled data')).toBeVisible();
  });

  test('non-admin sees neither the nav entry nor the admin-only panels', async ({ page }) => {
    await addAuthCookie(page);
    await stubList(page);

    await page.goto('/insights');
    // Positive control: the nav is rendered (Strategies present) but Backfills is gated out.
    await expect(page.getByRole('link', { name: 'Strategies' })).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('link', { name: 'Backfills' })).toHaveCount(0);

    await page.goto('/insights/backfills');
    await expect(page.getByRole('heading', { name: 'Backfills' })).toBeVisible({ timeout: 20000 });
    await expect(page.getByText('New backfill')).toHaveCount(0);
    await expect(page.getByText('Delete backfilled data')).toHaveCount(0);
  });
});

test.describe('Backfills page — list, create, cancel (AC-1/2/3)', () => {
  test('the job list renders status and truthful bars/chunks progress', async ({ page }) => {
    await addAdminCookie(page);
    await stubList(page);

    await page.goto('/insights/backfills');
    // `exact` so the status badge isn't confused with the "Running" filter <option>.
    await expect(page.getByText('running', { exact: true })).toBeVisible({ timeout: 20000 });
    await expect(page.getByText('bars 100 / 500')).toBeVisible();
    await expect(page.getByText('chunks 1 / 5')).toBeVisible();
  });

  test('creating a backfill posts the symbols and timeframe', async ({ page }) => {
    await addAdminCookie(page);
    await stubList(page, []);

    let triggered: { symbols?: string[] } | null = null;
    await page.route(IngestPath('TriggerBackfill'), async (route) => {
      triggered = route.request().postDataJSON() as { symbols?: string[] };
      await fulfillJson(route, { jobId: 'job-new', status: 'BACKFILL_STATUS_QUEUED' });
    });

    await page.goto('/insights/backfills');
    await page.getByPlaceholder('Symbols (AAPL, TSLA)').fill('aapl, tsla');
    await page.getByRole('button', { name: 'Start backfill' }).click();

    await expect.poll(() => triggered?.symbols).toEqual(['AAPL', 'TSLA']);
  });

  test('cancel transitions a running job to CANCELED', async ({ page }) => {
    await addAdminCookie(page);

    // Stateful list: RUNNING until CancelBackfill is hit, then CANCELED.
    let canceled = false;
    await page.route(IngestPath('ListBackfillJobs'), (route) =>
      fulfillJson(route, {
        jobs: [canceled ? runningJob({ status: 'BACKFILL_STATUS_CANCELED' }) : runningJob()],
        page: { nextPageToken: '', totalCount: 1 },
      }),
    );
    await page.route(IngestPath('CancelBackfill'), async (route) => {
      canceled = true;
      await fulfillJson(route, runningJob({ status: 'BACKFILL_STATUS_CANCELED' }));
    });

    page.on('dialog', (d) => d.accept());

    await page.goto('/insights/backfills');
    await expect(page.getByText('running', { exact: true })).toBeVisible({ timeout: 20000 });
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('canceled', { exact: true })).toBeVisible();
  });
});

test.describe('Backfills page — scoped delete (AC-4 / FR-5)', () => {
  test('delete requires typed symbol + second whole-symbol confirm and shows rowsDeleted', async ({
    page,
  }) => {
    await addAdminCookie(page);
    await stubList(page, []);

    let deletedSymbol: string | undefined;
    await page.route(MarketDataPath('DeleteBackfilledData'), async (route) => {
      deletedSymbol = (route.request().postDataJSON() as { symbol?: string }).symbol;
      await fulfillJson(route, { rowsDeleted: '42' });
    });

    await page.goto('/insights/backfills');

    await expect(page.getByText('Delete backfilled data')).toBeVisible({ timeout: 20000 });
    const deleteBtn = page.getByRole('button', { name: 'Delete data' });
    await expect(deleteBtn).toBeDisabled();

    // Type the symbol + the first typed confirmation (`exact` avoids the "Symbols"/"Filter" inputs).
    await page.getByPlaceholder('Symbol', { exact: true }).fill('AAPL');
    await page.getByPlaceholder(/to confirm/).fill('AAPL');
    // No range set → whole-symbol delete → still disabled until the second confirmation.
    await expect(deleteBtn).toBeDisabled();

    await page.getByPlaceholder(/DELETE ALL/).fill('DELETE ALL');
    await expect(deleteBtn).toBeEnabled();

    await deleteBtn.click();
    await expect(page.getByText('Deleted 42 rows.')).toBeVisible();
    expect(deletedSymbol).toBe('AAPL');
  });
});
