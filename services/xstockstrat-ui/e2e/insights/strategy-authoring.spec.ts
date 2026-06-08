import { test, expect, type Page } from '@playwright/test';
import { SignJWT } from 'jose';

/**
 * E2E coverage for the strategy creation flow (feature 050).
 *
 * Two layers, mirroring the established patterns:
 *  - BFF-level (`page.evaluate(fetch …)` against `/insights/api`, like
 *    `e2e/trader/live-strategies.spec.ts`) — verifies the new insights-BFF proxy
 *    methods and the admin-scope gate added in Step 1.
 *  - UI-level (page rendering, like `e2e/insights/formulas.spec.ts`) — verifies the
 *    list "New Strategy" gating and the wizard's step-gate logic.
 *
 * Strategy RPCs are mocked on port 9092 (mock-backend.ts). ListFormulas (IndicatorsService
 * is not mocked on 9092) is stubbed at the browser level via page.route(), as in
 * formulas.spec.ts.
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

  await page.context().addCookies([
    { name: 'access_token', value: token, url: BASE_URL, httpOnly: true, sameSite: 'Lax' },
  ]);
}

const addAuthCookie = (page: Page) => addCookieWithRoles(page, []);
const addAdminCookie = (page: Page) => addCookieWithRoles(page, ['admin']);

const MOCK_FORMULAS = [
  { formulaId: 'f-rsi', name: 'RSI Divergence', author: 'test-user-001', isPublic: true },
  { formulaId: 'f-macd', name: 'MACD Cross', author: 'test-user-001', isPublic: false },
];

async function stubListFormulas(page: Page): Promise<void> {
  await page.route('**/xstockstrat.indicators.v1.IndicatorsService/ListFormulas', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ formulas: MOCK_FORMULAS, totalCount: MOCK_FORMULAS.length }),
    });
  });
}

test.describe('Strategy authoring — insights BFF', () => {
  test('manageStrategy register is denied for non-admin', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/insights/strategies');
    const result = await page.evaluate(async () => {
      const res = await fetch(
        '/insights/api/xstockstrat.analysis.v1.AnalysisService/ManageStrategy',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            operation: 'STRATEGY_OPERATION_REGISTER',
            definition: { strategyId: 'demo', displayName: 'Demo' },
          }),
        },
      );
      return { status: res.status, body: await res.text() };
    });
    expect(result.status).not.toBe(200);
    expect(result.body.toLowerCase()).toContain('permission');
  });

  test('manageStrategy register succeeds for admin', async ({ page }) => {
    await addAdminCookie(page);
    await page.goto('/insights/strategies');
    const result = await page.evaluate(async () => {
      const res = await fetch(
        '/insights/api/xstockstrat.analysis.v1.AnalysisService/ManageStrategy',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            operation: 'STRATEGY_OPERATION_REGISTER',
            definition: { strategyId: 'demo', displayName: 'Demo' },
          }),
        },
      );
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    });
    expect(result.status).toBe(200);
    expect(result.body.strategyId).toBe('demo');
  });

  test('manageStrategy deactivate is denied for non-admin', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/insights/strategies');
    const result = await page.evaluate(async () => {
      const res = await fetch(
        '/insights/api/xstockstrat.analysis.v1.AnalysisService/ManageStrategy',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            operation: 'STRATEGY_OPERATION_DEACTIVATE',
            definition: { strategyId: 'demo' },
          }),
        },
      );
      return { status: res.status, body: await res.text() };
    });
    expect(result.status).not.toBe(200);
    expect(result.body.toLowerCase()).toContain('permission');
  });

  test('getStrategy is readable (no admin required)', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/insights/strategies');
    const result = await page.evaluate(async () => {
      const res = await fetch(
        '/insights/api/xstockstrat.analysis.v1.AnalysisService/GetStrategy',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ strategyId: 'strat-edit-001' }),
        },
      );
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    });
    expect(result.status).toBe(200);
    expect(result.body.strategyId).toBe('strat-edit-001');
  });

  test('listSignalSources is proxied through the insights BFF', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/insights/strategies');
    const result = await page.evaluate(async () => {
      const res = await fetch(
        '/insights/api/xstockstrat.ingest.v1.IngestService/ListSignalSources',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ includeInactive: false }),
        },
      );
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    });
    expect(result.status).toBe(200);
    expect(Array.isArray(result.body.sources)).toBe(true);
  });
});

test.describe('Strategy authoring — UI', () => {
  test('admin sees the New Strategy button; read-only user does not (AC-5)', async ({ page }) => {
    await addAdminCookie(page);
    await page.goto('/insights/strategies');
    await expect(page.getByRole('button', { name: 'New Strategy' })).toBeVisible({ timeout: 10000 });

    await addAuthCookie(page);
    await page.goto('/insights/strategies');
    await expect(page.getByRole('heading', { name: 'Strategies' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: 'New Strategy' })).toHaveCount(0);
  });

  test('wizard gates Next per step and only submits on Step 5 (ACs 1, 11, 12)', async ({ page }) => {
    await addAdminCookie(page);
    await stubListFormulas(page);
    await page.goto('/insights/strategies/new');

    // Step 1 — Identity. Next disabled until valid id + display name.
    await expect(page.getByText('Step 1 — Identity')).toBeVisible({ timeout: 10000 });
    const next = page.getByRole('button', { name: 'Next' });
    await expect(next).toBeDisabled();
    await page.getByPlaceholder('e.g. sma_crossover').fill('sma_crossover');
    await page.getByPlaceholder('SMA Crossover').fill('SMA Crossover');
    await expect(next).toBeEnabled();
    await next.click();

    // Step 2 — Components. Next disabled until ≥1 component (AC-11).
    await expect(page.getByText('Step 2 — Components')).toBeVisible();
    await expect(next).toBeDisabled();
    await page.getByRole('button', { name: 'Add component' }).click();
    await expect(next).toBeEnabled();
    await next.click();

    // Step 3 — Rules. Next disabled until both rules non-empty (AC-11).
    await expect(page.getByText('Step 3 — Rules')).toBeVisible();
    await expect(next).toBeDisabled();

    // Switch both rule editors to JSON mode and type values (AC-9: JSON toggle).
    const jsonButtons = page.getByRole('button', { name: 'JSON' });
    await jsonButtons.nth(0).click();
    await page.getByLabel('Entry rule JSON').fill('{"op":"and","conditions":[]}');
    await jsonButtons.nth(1).click();
    await page.getByLabel('Exit rule JSON').fill('{"op":"or","conditions":[]}');
    await expect(next).toBeEnabled();
    await next.click();

    // Step 4 — Signal Params is skippable (AC-12).
    await expect(page.getByText('Step 4 — Signal Params')).toBeVisible();
    await page.getByRole('button', { name: 'Skip' }).click();

    // Step 5 — Review. Submit button appears (no submit happened before now, AC-1).
    await expect(page.getByText('Step 5 — Review')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create Strategy' })).toBeVisible();
  });

  test('server validation error shows inline with a Go to Step link (AC-13)', async ({ page }) => {
    await addAdminCookie(page);
    await stubListFormulas(page);
    await page.goto('/insights/strategies/new');

    await expect(page.getByText('Step 1 — Identity')).toBeVisible({ timeout: 10000 });
    await page.getByPlaceholder('e.g. sma_crossover').fill('invalid_ref'); // sentinel → mock errors
    await page.getByPlaceholder('SMA Crossover').fill('Invalid Ref Strategy');
    const next = page.getByRole('button', { name: 'Next' });
    await next.click();

    await page.getByRole('button', { name: 'Add component' }).click();
    await next.click();

    const jsonButtons = page.getByRole('button', { name: 'JSON' });
    await jsonButtons.nth(0).click();
    await page.getByLabel('Entry rule JSON').fill('{"op":"and","conditions":[]}');
    await jsonButtons.nth(1).click();
    await page.getByLabel('Exit rule JSON').fill('{"op":"or","conditions":[]}');
    await next.click();

    await page.getByRole('button', { name: 'Skip' }).click();
    await page.getByRole('button', { name: 'Create Strategy' }).click();

    // The mock returns an InvalidArgument with a ref message → inline error + step link.
    await expect(page.getByText(/ref_name/)).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: /Go to Step/ })).toBeVisible();
  });

  test('edit page pre-populates and strategy_id is read-only (ACs 2, 8)', async ({ page }) => {
    await addAdminCookie(page);
    await stubListFormulas(page);
    await page.goto('/insights/strategies/strat-edit-001/edit');

    await expect(page.getByText('Step 1 — Identity')).toBeVisible({ timeout: 10000 });
    const idInput = page.getByPlaceholder('e.g. sma_crossover');
    await expect(idInput).toHaveValue('strat-edit-001');
    await expect(idInput).toBeDisabled();
  });

  test('formula picker filters by substring (AC-7)', async ({ page }) => {
    await addAdminCookie(page);
    await stubListFormulas(page);
    await page.goto('/insights/strategies/new');

    await expect(page.getByText('Step 1 — Identity')).toBeVisible({ timeout: 10000 });
    await page.getByPlaceholder('e.g. sma_crossover').fill('with_formula');
    await page.getByPlaceholder('SMA Crossover').fill('With Formula');
    await page.getByRole('button', { name: 'Next' }).click();

    await page.getByRole('button', { name: 'Add component' }).click();
    // Switch the component kind to Custom formula to reveal the picker.
    await page.getByLabel('component kind').click();
    await page.getByRole('option', { name: 'Custom formula' }).click();

    // Open the type-ahead formula combobox; both formulas listed.
    await page.getByLabel('formula', { exact: true }).click();
    await expect(page.getByText('RSI Divergence')).toBeVisible();
    await expect(page.getByText('MACD Cross')).toBeVisible();
    // Typing filters the list by substring.
    await page.getByLabel('formula', { exact: true }).fill('RSI');
    await expect(page.getByText('RSI Divergence')).toBeVisible();
    await expect(page.getByText('MACD Cross')).toHaveCount(0);
  });
});
