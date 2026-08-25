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

  test('feature 132: a muted row renders muted, has no Snooze/Dismiss, and links to the deny editor', async ({
    page,
  }) => {
    const amd = card(page, 'AMD');
    await expect(amd).toBeVisible();
    await expect(amd).toHaveAttribute('data-muted', 'true');
    await expect(page.getByTestId('muted-badge-AMD')).toBeVisible();
    // Action buttons are suppressed; only a "Manage deny list" link remains.
    await expect(page.getByTestId('snooze-AMD')).toHaveCount(0);
    await expect(page.getByTestId('dismiss-AMD')).toHaveCount(0);
    await expect(page.getByTestId('manage-deny-AMD')).toBeVisible();
  });

  test('feature 132: a muted 0/0 row survives the min-conviction filter', async ({ page }) => {
    await page.getByLabel('Minimum conviction').fill('80');
    await expect(card(page, 'MSFT')).toBeHidden(); // 0.75 — filtered out
    // GME is a muted, conviction-0 placeholder — it must NOT vanish behind the floor.
    await expect(card(page, 'GME')).toBeVisible();
    await expect(page.getByTestId('muted-badge-GME')).toBeVisible();
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

  test('each card shows its source as a Badge (FR-7)', async ({ page }) => {
    await expect(card(page, 'MSFT').getByText('marketwatch')).toBeVisible();
  });

  test('"All sources" exposes aria-pressed and folds into the ToggleGroup styling (FR-8)', async ({
    page,
  }) => {
    const allSources = page.getByRole('button', { name: 'All sources' });
    await expect(allSources).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'marketwatch' }).click();
    await expect(allSources).toHaveAttribute('aria-pressed', 'false');
    await allSources.click();
    await expect(allSources).toHaveAttribute('aria-pressed', 'true');
  });

  // feature 155 (FR-1, AC-3) — every listed opportunity is in the ranked queue, so its card carries
  // the shared in-queue cue (icon + info color + text) — the same IN_QUEUE_CUE the Watchlists panel
  // renders (Step 4 asserts the watchlists half).
  test('an in-queue card shows the shared in-queue cue icon (AC-3)', async ({ page }) => {
    const badge = card(page, 'CAPR').getByTestId('opportunity-in-queue');
    await expect(badge).toBeVisible();
    await expect(badge).toContainText('in queue');
    await expect(badge.getByRole('img', { name: 'in queue' })).toBeVisible();
  });
});

// feature 155 (FR-4) — mobile Opportunities parity: signals grouped by symbol like the desktop, and
// the strategy/source/expiry tags the flat mobile row used to omit. Runs on a phone viewport so the
// `sm:hidden` mobile SectionRenderer tree is active (the desktop grid is hidden).
test.describe('Opportunities mobile parity (feature 155)', () => {
  test.use({ viewport: { width: 375, height: 800 } });

  test.beforeEach(async ({ page }) => {
    await addAuthCookie(page);
    await mockOpportunities(page);
    await page.goto('/insights/opportunities');
    await expect(page.getByTestId('mobile-sections')).toBeVisible({ timeout: 8000 });
  });

  test('AC-9: groups a multi-strategy symbol into one mobile card', async ({ page }) => {
    const group = page.getByTestId('mobile-group-CAPR');
    await expect(group).toBeVisible();
    // Both CAPR signals live inside the ONE grouped card — not two separate top-level rows.
    await expect(group).toContainText('2 signals');
    // Exact match — the caption "Momentum building" also contains "momentum".
    await expect(group.getByText('quality-dip-buy', { exact: true })).toBeVisible();
    await expect(group.getByText('momentum', { exact: true })).toBeVisible();
  });

  test('AC-10: mobile signal shows strategy id, source chip, and expiry', async ({ page }) => {
    const group = page.getByTestId('mobile-group-CAPR');
    const capr = OPPORTUNITIES.find((o) => o.symbol === 'CAPR')!;
    const expiry = new Date(Number(capr.validUntil.seconds) * 1000).toTimeString().slice(0, 5);
    await expect(group.getByText('quality-dip-buy', { exact: true })).toBeVisible(); // strategy id tag
    await expect(group.getByText('watchlist', { exact: true }).first()).toBeVisible(); // source chip
    await expect(group.getByText(`exp ${expiry}`).first()).toBeVisible(); // expiry tag
  });
});
