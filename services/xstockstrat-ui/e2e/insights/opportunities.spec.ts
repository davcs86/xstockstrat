import { test, expect, type Page } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';
import { OPPORTUNITIES } from '../fixtures/opportunities';

/**
 * Decide → Opportunities queue (feature 083 + feature 097).
 * Exercises the real analysis.ListOpportunities call chain (browser analysisClient → insights
 * BFF → mock backend on 9092) against the OPPORTUNITIES fixture: ranked conviction cards, action
 * tags, the "N/M conditions" render, source-chip filtering, and the min-conviction slider.
 *
 * feature 097: snooze/dismiss are now server-persisted (SetOpportunityAction against the stable
 * opportunityKey). The persistence test intercepts ListOpportunities + SetOpportunityAction with
 * per-page `page.route()` state (the watchlistMock.ts pattern) — a per-test stateful mock the
 * shared backend can't provide under Playwright `fullyParallel` without cross-worker pollution.
 */

/**
 * Connect-JSON serialization of a fixture opportunity. The well-known `google.protobuf.Timestamp`
 * encodes as an RFC3339 **string** in Connect-JSON (not a `{seconds, nanos}` object) — sending the
 * object shape makes the browser client fail to parse the whole response.
 */
const toJson = (o: (typeof OPPORTUNITIES)[number]) => ({
  ...o,
  validUntil: new Date(Number(o.validUntil.seconds) * 1000).toISOString(),
});

/** Per-page stateful mock of ListOpportunities + SetOpportunityAction (isolated, survives reload). */
async function mockOpportunities(page: Page): Promise<void> {
  const hidden = new Set<string>();
  await page.route('**/xstockstrat.analysis.v1.AnalysisService/ListOpportunities', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        opportunities: OPPORTUNITIES.filter((o) => !hidden.has(o.opportunityKey)).map(toJson),
      }),
    }),
  );
  await page.route('**/xstockstrat.analysis.v1.AnalysisService/SetOpportunityAction', (route) => {
    const req = JSON.parse(route.request().postData() ?? '{}');
    // Connect-JSON encodes an enum field as its NAME string (not the number), so accept both
    // forms. SNOOZE / DISMISS hide the row on subsequent reads; TAKE leaves it visible.
    const a = req.action;
    const hides =
      a === 1 || a === 2 || a === 'OPPORTUNITY_ACTION_SNOOZE' || a === 'OPPORTUNITY_ACTION_DISMISS';
    if (hides) hidden.add(req.opportunityKey);
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

test.describe('Opportunities queue', () => {
  const card = (page: Page, sym: string) =>
    page.getByTestId('opportunity-card').filter({ hasText: sym });

  test.beforeEach(async ({ page }) => {
    await addAuthCookie(page);
    await mockOpportunities(page);
    await page.goto('/insights/opportunities');
    await expect(card(page, 'AAPL')).toBeVisible({ timeout: 8000 });
  });

  test('renders ranked cards with action tags, real readiness, and strategy', async ({ page }) => {
    for (const sym of ['AAPL', 'MSFT', 'TSLA', 'NVDA']) {
      await expect(card(page, sym)).toBeVisible();
    }
    // Action tags from the OpportunityActionTag render map — scoped to the visible desktop cards.
    await expect(card(page, 'AAPL').getByText('Enter', { exact: true })).toBeVisible();
    await expect(card(page, 'MSFT').getByText('Add', { exact: true })).toBeVisible();
    await expect(card(page, 'TSLA').getByText('Reduce', { exact: true })).toBeVisible();
    // feature 097: an attributed row carries REAL passing/total (4/5) and its strategyId — not 0/0.
    await expect(card(page, 'AAPL').getByText('4/5')).toBeVisible();
    await expect(card(page, 'AAPL').getByText('strat-001')).toBeVisible();
  });

  test('min-conviction slider filters low-conviction cards', async ({ page }) => {
    await page.getByLabel('Minimum conviction').fill('80');
    await expect(card(page, 'AAPL')).toBeVisible(); // 0.90
    await expect(card(page, 'NVDA')).toBeVisible(); // 0.85
    await expect(card(page, 'MSFT')).toBeHidden(); // 0.75 filtered
    await expect(card(page, 'TSLA')).toBeHidden(); // 0.60 filtered
  });

  test('source chip narrows the queue to one source', async ({ page }) => {
    await page.getByRole('button', { name: 'marketwatch' }).click();
    await expect(card(page, 'MSFT')).toBeVisible();
    await expect(card(page, 'AAPL')).toBeHidden();
  });

  test('Snooze persists server-side across a reload', async ({ page }) => {
    await expect(card(page, 'AAPL')).toBeVisible();
    await page.getByTestId('snooze-AAPL').click();
    await expect(card(page, 'AAPL')).toBeHidden(); // dropped after the invalidated refetch
    await expect(card(page, 'NVDA')).toBeVisible(); // other cards remain
    // The disposition is server-persisted (SetOpportunityAction), not transient client state:
    // a full reload re-fetches and AAPL is still gone.
    await page.reload();
    await expect(card(page, 'NVDA')).toBeVisible({ timeout: 8000 });
    await expect(card(page, 'AAPL')).toBeHidden();
  });

  test('Dismiss persists server-side across a reload', async ({ page }) => {
    await page.getByTestId('dismiss-MSFT').click();
    await expect(card(page, 'MSFT')).toBeHidden();
    await page.reload();
    await expect(card(page, 'AAPL')).toBeVisible({ timeout: 8000 });
    await expect(card(page, 'MSFT')).toBeHidden();
  });
});
