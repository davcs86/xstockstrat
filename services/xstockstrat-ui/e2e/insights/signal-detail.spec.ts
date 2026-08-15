import { test, expect } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';

/**
 * Decide → Signal detail readiness (feature 083, FR-6). The strategy is an explicit input:
 * threaded from the opportunity row via ?strategy=, else picked. Exercises the real
 * EvaluateReadiness call chain (browser analysisClient → insights BFF → mock backend).
 */
test.describe('Signal detail readiness', () => {
  test('renders traced conditions for the threaded strategy', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/insights/market/AAPL?strategy=strat-live-001');
    await expect(page.getByText('Why this fired')).toBeVisible({ timeout: 8000 });
    // Signal-detail header enrichment: AAPL is in the ranked queue (action ENTER, conviction 0.9).
    // The header stats come from ListOpportunities (a separate query from readiness), so wait for
    // the queue fetch to resolve before asserting.
    await expect(page.getByRole('link', { name: /Queue/ })).toBeVisible();
    await expect(page.getByText('Conviction')).toBeVisible({ timeout: 10000 }); // CONVICTION stat
    await expect(page.getByText('Edge (BT)')).toBeVisible(); // EDGE (BT) stat from analytics
    // Deterministic conviction as N/M conditions (never a fabricated %).
    await expect(page.getByText('2/3 conditions')).toBeVisible();
    // Traced leaves from EvaluateReadiness.
    await expect(page.getByText('sma_fast', { exact: false })).toBeVisible();
    await expect(page.getByText('rsi', { exact: false })).toBeVisible();
    // The picker reflects the threaded strategy. `.first()` scopes to the readiness picker,
    // which renders above the feature-132 MuteForStrategy card (whose <select> also lists this
    // strategy's display name) — both carry "Live Test Strategy", so a bare getByText is ambiguous.
    await expect(page.getByText('Live Test Strategy').first()).toBeVisible();
    // The opportunity's source renders as a Badge (FR-7) — exact match to disambiguate from the
    // meta-info line below, which also joins in the same source string.
    await expect(page.getByText('unusual_whales', { exact: true })).toBeVisible();

    // Strategy track-record block (GetStrategyAnalytics): signals 30d 42, hit rate 62%, expectancy 0.35.
    const record = page.getByTestId('strategy-track-record');
    await expect(record).toBeVisible();
    await expect(record).toContainText('42'); // signals 30d
    await expect(record).toContainText('62%'); // hit rate
    await expect(record).toContainText('0.35'); // expectancy
  });

  test('prompts to pick a strategy when none is threaded (no fabricated binding)', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await page.goto('/insights/market/AAPL');
    await expect(page.getByText(/Select a strategy to evaluate/)).toBeVisible({ timeout: 8000 });
  });

  test('strategy picker excludes non-live strategies (disabled strategies must not be usable)', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await page.goto('/insights/market/AAPL');
    await expect(page.getByText(/Select a strategy to evaluate/)).toBeVisible({ timeout: 8000 });
    await page.getByLabel('Strategy').click();
    await expect(page.getByRole('option', { name: 'Live Test Strategy' })).toBeVisible();
    // "Inactive Strategy" (liveEnabled: false in the fixture) must not be a selectable option.
    await expect(page.getByRole('option', { name: 'Inactive Strategy' })).toHaveCount(0);
  });

  test('feature 132: the mute control sends a masked denied_symbols update appending this symbol', async ({
    page,
  }) => {
    await addAuthCookie(page);
    let captured: Record<string, unknown> | null = null;
    await page.route('**/xstockstrat.analysis.v1.AnalysisService/ManageStrategy', async (route) => {
      captured = JSON.parse(route.request().postData() ?? '{}');
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await page.goto('/insights/market/AMD');
    const card = page.getByTestId('mute-for-strategy');
    await expect(card).toBeVisible({ timeout: 8000 });
    // strat-001 (Deny List Strategy) already denies TSLA — muting AMD appends to that list.
    await card.getByTestId('mute-strategy-select').selectOption('strat-001');
    await card.getByTestId('mute-submit').click();

    await expect.poll(() => captured).not.toBeNull();
    const body = captured as unknown as {
      definition?: { strategyId?: string; deniedSymbols?: string[] };
      updateMask?: unknown;
    };
    expect(body.definition?.strategyId).toBe('strat-001');
    expect(body.definition?.deniedSymbols).toEqual(expect.arrayContaining(['TSLA', 'AMD']));
    // Connect-JSON serializes a FieldMask as a camelCase, comma-joined string (protobuf-es).
    expect(body.updateMask).toBe('deniedSymbols');
  });
});
