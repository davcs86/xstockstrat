import { test, expect, type Page } from '@playwright/test';
import { addAuthCookie, addAdminCookie } from '../helpers/auth';
import { FORMULAS } from '../fixtures';

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

async function stubListFormulas(page: Page): Promise<void> {
  await page.route('**/xstockstrat.indicators.v1.IndicatorsService/ListFormulas', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ formulas: FORMULAS, totalCount: FORMULAS.length }),
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
      const res = await fetch('/insights/api/xstockstrat.analysis.v1.AnalysisService/GetStrategy', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ strategyId: 'strat-edit-001' }),
      });
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
    await expect(page.getByRole('button', { name: 'New Strategy' })).toBeVisible({
      timeout: 10000,
    });

    await addAuthCookie(page);
    await page.goto('/insights/strategies');
    await expect(page.getByRole('heading', { name: 'Strategies' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: 'New Strategy' })).toHaveCount(0);
  });

  test('wizard gates Next per step and only submits on Step 5 (ACs 1, 11, 12)', async ({
    page,
  }) => {
    await addAdminCookie(page);
    await stubListFormulas(page);
    await page.goto('/insights/strategies/new');

    // Step 1 — Identity. Next disabled until valid id + display name.
    await expect(page.getByText('Step 1 — Identity')).toBeVisible({ timeout: 10000 });
    const next = page.getByRole('button', { name: 'Next', exact: true });
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
    const next = page.getByRole('button', { name: 'Next', exact: true });
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
    await page.getByRole('button', { name: 'Next', exact: true }).click();

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

/**
 * Feature 069 — re-entry cooldown reachability through the wizard (AC-11).
 * Presence-honest semantics: blank → key OMITTED (server default 31 drives the gate);
 * "0" → cooldownDays: 0 (explicit no-cooldown); an unset strategy edited on an unrelated field
 * must NOT gain cooldown_days: 0. No "0 → 31" collapse is asserted anywhere.
 */
test.describe('Strategy authoring — re-entry cooldown (feature 069)', () => {
  // Capture the exact ManageStrategy payload the wizard submits (browser → BFF), then stub a success.
  async function captureManageStrategy(page: Page): Promise<() => Record<string, unknown> | null> {
    let captured: Record<string, unknown> | null = null;
    await page.route('**/xstockstrat.analysis.v1.AnalysisService/ManageStrategy', async (route) => {
      captured = JSON.parse(route.request().postData() ?? '{}');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ strategyId: 'cool_test' }),
      });
    });
    return () => captured;
  }

  async function fillToReview(
    page: Page,
    id: string,
    display: string,
    cooldown: string,
  ): Promise<void> {
    await expect(page.getByText('Step 1 — Identity')).toBeVisible({ timeout: 10000 });
    await page.getByPlaceholder('e.g. sma_crossover').fill(id);
    await page.getByPlaceholder('SMA Crossover').fill(display);
    if (cooldown !== '') await page.getByPlaceholder('31 (default)').fill(cooldown);
    const next = page.getByRole('button', { name: 'Next', exact: true });
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
    await expect(page.getByText('Step 5 — Review')).toBeVisible();
  }

  test('create with a blank cooldown omits cooldownDays from the payload', async ({ page }) => {
    await addAdminCookie(page);
    await stubListFormulas(page);
    const getCaptured = await captureManageStrategy(page);
    await page.goto('/insights/strategies/new');
    await fillToReview(page, 'cool_blank', 'Cool Blank', ''); // blank cooldown
    await page.getByRole('button', { name: 'Create Strategy' }).click();
    await expect.poll(getCaptured).not.toBeNull();
    const def = getCaptured()!.definition as Record<string, unknown>;
    expect(def.cooldownDays).toBeUndefined();
  });

  test('create with an explicit 0 sends cooldownDays: 0', async ({ page }) => {
    await addAdminCookie(page);
    await stubListFormulas(page);
    const getCaptured = await captureManageStrategy(page);
    await page.goto('/insights/strategies/new');
    await fillToReview(page, 'cool_zero', 'Cool Zero', '0'); // explicit no-cooldown
    await page.getByRole('button', { name: 'Create Strategy' }).click();
    await expect.poll(getCaptured).not.toBeNull();
    const def = getCaptured()!.definition as Record<string, unknown>;
    expect(def.cooldownDays).toBe(0);
  });

  test('a negative cooldown blocks advancing past Step 1', async ({ page }) => {
    await addAdminCookie(page);
    await stubListFormulas(page);
    await page.goto('/insights/strategies/new');
    await expect(page.getByText('Step 1 — Identity')).toBeVisible({ timeout: 10000 });
    await page.getByPlaceholder('e.g. sma_crossover').fill('cool_neg');
    await page.getByPlaceholder('SMA Crossover').fill('Cool Neg');
    await page.getByPlaceholder('31 (default)').fill('-5');
    await expect(page.getByText('cooldown days must be a non-negative integer')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
  });

  test('edit pre-populates a non-default cooldown (AC-11)', async ({ page }) => {
    await addAdminCookie(page);
    await stubListFormulas(page);
    await page.goto('/insights/strategies/strat-cooldown-14/edit');
    await expect(page.getByText('Step 1 — Identity')).toBeVisible({ timeout: 10000 });
    await expect(page.getByPlaceholder('31 (default)')).toHaveValue('14');
  });

  test('editing an unset strategy on an unrelated field does not write cooldownDays', async ({
    page,
  }) => {
    await addAdminCookie(page);
    await stubListFormulas(page);
    const getCaptured = await captureManageStrategy(page);
    await page.goto('/insights/strategies/strat_unset/edit'); // getStrategy leaves cooldown unset
    await expect(page.getByText('Step 1 — Identity')).toBeVisible({ timeout: 10000 });
    await expect(page.getByPlaceholder('31 (default)')).toHaveValue(''); // stays blank
    // Change an unrelated field (display name) and save.
    await page.getByPlaceholder('SMA Crossover').fill('Renamed Only');
    const next = page.getByRole('button', { name: 'Next', exact: true });
    await next.click(); // Step 2 (component pre-populated)
    await next.click(); // Step 3 (rules pre-populated)
    await next.click(); // Step 4
    await page.getByRole('button', { name: 'Skip' }).click();
    await page.getByRole('button', { name: 'Save Changes' }).click();
    await expect.poll(getCaptured).not.toBeNull();
    const def = getCaptured()!.definition as Record<string, unknown>;
    expect(def.cooldownDays).toBeUndefined();
  });
});
