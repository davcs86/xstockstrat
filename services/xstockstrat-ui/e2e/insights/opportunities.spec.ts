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

// feature 190 — Connect-JSON encodes an enum as its NAME string (or omits the 0 default); normalize.
const MARKERS = ['watchlist', 'position', 'denied'];
const ACTION_NAME_TO_NUM: Record<string, number> = {
  OPPORTUNITY_ACTION_TAG_ENTER: 1,
  OPPORTUNITY_ACTION_TAG_ADD: 2,
  OPPORTUNITY_ACTION_TAG_REDUCE: 3,
};
const actionNum = (v: unknown): number =>
  typeof v === 'number' ? v : (ACTION_NAME_TO_NUM[String(v)] ?? 0);
const isExpirySort = (v: unknown): boolean => v === 2 || v === 'OPPORTUNITY_SORT_EXPIRY';
const expirySec = (o: (typeof OPPORTUNITIES)[number]): number =>
  o.validUntil?.seconds ? Number(o.validUntil.seconds) : Infinity;

/** Per-page stateful mock of ListOpportunities + SetOpportunityAction (isolated, survives reload).
 * feature 190 — applies the server-side filters/sort + emits the facet (the client no longer filters). */
async function mockOpportunities(page: Page): Promise<void> {
  const hidden = new Set<string>();
  await page.route('**/xstockstrat.analysis.v1.AnalysisService/ListOpportunities', (route) => {
    const req = JSON.parse(route.request().postData() ?? '{}');
    const min = Number(req.minConviction ?? 0);
    const reqSources: string[] = req.sources ?? [];
    const action = actionNum(req.actionFilter);
    const expiry = isExpirySort(req.sort);
    const visible = OPPORTUNITIES.filter((o) => !hidden.has(o.opportunityKey));
    const rows = visible.filter(
      (o) =>
        // muted/unavailable exempt from the CONVICTION floor only; source/action apply to all.
        (o.muted || o.dataUnavailable || o.conviction >= min) &&
        (reqSources.length === 0 || reqSources.includes(o.source)) &&
        (action === 0 || o.action === action),
    );
    // symbol-grouped sort mirroring the server ORDER BY (group by best member; rows contiguous).
    const key = (sym: string) =>
      expiry
        ? Math.min(...rows.filter((o) => o.symbol === sym).map(expirySec))
        : -Math.max(...rows.filter((o) => o.symbol === sym).map((o) => o.conviction));
    const sorted = [...rows].sort(
      (a, b) =>
        key(a.symbol) - key(b.symbol) ||
        a.symbol.localeCompare(b.symbol) ||
        (expiry ? expirySec(a) - expirySec(b) : b.conviction - a.conviction),
    );
    // facet — distinct real sources over the non-hidden queue, marker/empty excluded, filter-independent.
    const availableSources = [
      ...new Set(visible.map((o) => o.source).filter((s) => s && !MARKERS.includes(s))),
    ].sort();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ opportunities: sorted.map(toJson), availableSources }),
    });
  });
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

// feature 190 — the source filter is a multi-select dropdown (was a ToggleGroup pill row).
async function selectSource(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'source filter' }).click();
  await page.getByRole('menuitemcheckbox', { name, exact: true }).click();
  await page.keyboard.press('Escape'); // checkbox items keep the menu open (multi-select)
}
async function clearSources(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'source filter' }).click();
  await page.getByRole('menuitem', { name: 'All sources' }).click(); // resets, closes the menu
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

  test('source dropdown narrows the queue to one source', async ({ page }) => {
    await selectSource(page, 'marketwatch');
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

  test('the source dropdown trigger reflects the selection count (FR-8)', async ({ page }) => {
    const trigger = page.getByRole('button', { name: 'source filter' });
    await expect(trigger).toHaveText(/All sources/);
    await selectSource(page, 'marketwatch');
    await expect(trigger).toHaveText(/1 source/);
    await clearSources(page);
    await expect(trigger).toHaveText(/All sources/);
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

  // feature 155/190 (FR-5) — the source filter reflects and applies the current selection.
  // Re-pointed off 'watchlist' (a structural marker excluded from the server facet) to a real source.
  test('selecting a source narrows the queue immediately (AC-11)', async ({ page }) => {
    await selectSource(page, 'dividendology');
    await expect(card(page, 'TSLA')).toBeVisible(); // TSLA is the dividendology-sourced symbol
    await expect(card(page, 'AAPL')).toBeHidden(); // unusual_whales — filtered out
  });

  // AC-12 — the effective-source intersection RED (design.md FIX D, ledger 074/080): the refetch is
  // driven IN PLACE by the Snooze mutation's ['opportunities'] invalidation, NEVER page.reload()
  // (a reload remounts and resets activeSources, so the stuck state could never form → vacuous green).
  test('a source that vanishes on an in-place refetch does not strand the queue (AC-12)', async ({
    page,
  }) => {
    // marketwatch has exactly one row (MSFT). Select it → only MSFT remains.
    await selectSource(page, 'marketwatch');
    await expect(card(page, 'MSFT')).toBeVisible();
    await expect(card(page, 'AAPL')).toBeHidden();
    // Snooze MSFT → the mutation invalidates ['opportunities'] and refetches IN PLACE (no reload);
    // MSFT is now hidden, so 'marketwatch' vanishes from the server facet while activeSources holds it.
    await page.getByTestId('snooze-MSFT').click();
    // The effectiveSources = activeSources ∩ availableSources intersection drops the orphaned source
    // → the request sends [] → the server returns the remaining rows (no strand, feature 190 @AC-12).
    await expect(card(page, 'AAPL')).toBeVisible({ timeout: 8000 });
    await expect(page.getByRole('button', { name: 'source filter' })).toHaveText(/All sources/);
    // 'marketwatch' is no longer offered in the dropdown (dropped from the server facet).
    await page.getByRole('button', { name: 'source filter' }).click();
    await expect(
      page.getByRole('menuitemcheckbox', { name: 'marketwatch', exact: true }),
    ).toHaveCount(0);
  });

  // feature 190 (@AC-6/@AC-7) — the action filter is applied server-side.
  test('the action filter narrows to a single action (AC-6/AC-7)', async ({ page }) => {
    await expect(card(page, 'AAPL')).toBeVisible(); // ENTER
    await expect(card(page, 'TSLA')).toBeVisible(); // REDUCE
    await page.getByLabel('action filter').click();
    await page.getByRole('option', { name: 'Reduce' }).click();
    await expect(card(page, 'TSLA')).toBeVisible();
    await expect(card(page, 'AAPL')).toBeHidden(); // ENTER filtered out server-side
  });

  // feature 190 (@AC-11) — the source facet is independent of the active filters, so the chip menu
  // stays complete even when a floor + source selection reduce the queue to nothing.
  test('the source facet stays complete under an active floor + source filter (AC-11)', async ({
    page,
  }) => {
    await page.getByLabel('Minimum conviction').fill('80');
    await selectSource(page, 'marketwatch'); // MSFT (0.75) is below the floor → empty result
    await page.getByRole('button', { name: 'source filter' }).click();
    // The facet lists every real source in the queue regardless of the active floor/source filter.
    for (const s of ['dividendology', 'marketwatch', 'unusual_whales']) {
      await expect(page.getByRole('menuitemcheckbox', { name: s, exact: true })).toBeVisible();
    }
  });

  // feature 190 (@AC-10) — conviction sort (the default) orders symbol groups by best conviction;
  // the client renders the server order directly (no client re-sort, @AC-15).
  test('conviction sort orders symbol groups by best conviction (AC-10/AC-15)', async ({
    page,
  }) => {
    const texts = await page.getByTestId('opportunity-card').allInnerTexts();
    const idx = (sym: string) => texts.findIndex((t) => t.includes(sym));
    expect(idx('AAPL')).toBeGreaterThanOrEqual(0); // 0.90
    expect(idx('AAPL')).toBeLessThan(idx('TSLA')); // 0.90 group precedes the 0.60 group
  });

  // feature 200 — symbol_score sort + group-header render.
  test('feature 200: symbol-score sort orders groups by server symbol_score and renders the header value (AC-8)', async ({
    page,
  }) => {
    // The symbol-score value is NOT shown under the default (conviction) sort.
    await expect(card(page, 'AAPL').getByTestId('symbol-score-AAPL')).toHaveCount(0);

    await page.getByLabel('sort').click();
    await page.getByRole('option', { name: 'Sort · Symbol score' }).click();

    // Server-returned order (symbol_score DESC NULLS LAST): AAPL (1.2) group precedes MSFT (1.0);
    // the client renders the server order and never re-sorts locally (@AC-8/@AC-15).
    const texts = await page.getByTestId('opportunity-card').allInnerTexts();
    const idx = (sym: string) => texts.findIndex((t) => t.includes(sym));
    expect(idx('AAPL')).toBeGreaterThanOrEqual(0);
    expect(idx('AAPL')).toBeLessThan(idx('MSFT'));

    // The group header shows the plain 3-decimal symbol_score only under this sort.
    await expect(card(page, 'AAPL').getByTestId('symbol-score-AAPL')).toHaveText('1.200');
    await expect(card(page, 'MSFT').getByTestId('symbol-score-MSFT')).toHaveText('1.000');
    // A symbol with no symbol_score renders the em-dash (NULLS-LAST group).
    await expect(card(page, 'TSLA').getByTestId('symbol-score-TSLA')).toHaveText('—');
  });

  // feature 095/188 — live-market enrichment on the queue card.
  test('the CAPR card shows live price, change%, previous day OHLC, and a condition chip', async ({
    page,
  }) => {
    const capr = card(page, 'CAPR');
    // AC-1 (f095) — live price from the enriched Opportunity.
    await expect(capr.getByTestId('opp-live-price-CAPR').first()).toHaveText('$12.34');
    await expect(capr.getByTestId('opp-change-CAPR').first()).toContainText('%');
    // AC-1 (f188) — OHLC text block with date and four price labels.
    const ohlc = capr.getByTestId('opp-ohlc-CAPR').first();
    await expect(ohlc).toBeVisible();
    await expect(ohlc).toContainText('O $');
    await expect(ohlc).toContainText('H $');
    await expect(ohlc).toContainText('L $');
    await expect(ohlc).toContainText('C $');
    // No sparkline bar chart (feature 188 — replaced by OHLC text).
    await expect(capr.locator('[aria-hidden] > span')).toHaveCount(0);
    // AC-5 (f095) — the blocking-condition chip.
    await expect(capr.getByTestId('opp-condition-CAPR')).toBeVisible();
  });

  test('a symbol with no live quote omits the price stat (AC-11)', async ({ page }) => {
    // AAPL carries no enrichment fields → the live-price stat is omitted, never fabricated.
    await expect(card(page, 'AAPL').getByTestId('opp-live-price-AAPL')).toHaveCount(0);
  });

  // feature 185 FR-2 (@AC-3) — a data-unavailable row renders an explicit "unavailable" cue via the
  // shared C-17 primitives, never a "quiet" 0/0 verdict.
  test('feature 185: a data-unavailable row shows an explicit unavailable cue, not a quiet 0/0', async ({
    page,
  }) => {
    await expect(card(page, 'PLTR')).toBeVisible();
    const cue = page.getByTestId('opportunity-unavailable-PLTR');
    await expect(cue).toBeVisible();
    await expect(cue).toContainText('unavailable');
    await expect(card(page, 'PLTR').getByText('no conditions')).toHaveCount(0); // not a quiet verdict
  });

  test('feature 185: a data-unavailable row survives the min-conviction floor', async ({
    page,
  }) => {
    await page.getByLabel('Minimum conviction').fill('80');
    await expect(card(page, 'MSFT')).toBeHidden(); // 0.75 — filtered out
    // PLTR is a data-unavailable, conviction-0 row — it must NOT vanish behind the floor.
    await expect(card(page, 'PLTR')).toBeVisible();
    await expect(page.getByTestId('opportunity-unavailable-PLTR')).toBeVisible();
  });

  // feature 199 — composite_score render on the queue card.
  test('feature 199: the composite cell renders the 0–1 ordinal in its scoreColor band (AC-8)', async ({
    page,
  }) => {
    const cell = card(page, 'AAPL').getByTestId('opp-composite-AAPL').first();
    await expect(cell).toHaveText('0.732');
    await expect(cell).toHaveClass(/text-paper/); // 0.732 → paper band (>=0.6, <0.8)
    const msft = card(page, 'MSFT').getByTestId('opp-composite-MSFT').first();
    await expect(msft).toHaveText('0.512');
    await expect(msft).toHaveClass(/text-destructive/); // 0.512 → destructive band (<0.6)
  });

  test('feature 199: server order is authoritative — the composite cell never re-sorts the queue (AC-8)', async ({
    page,
  }) => {
    // AAPL precedes MSFT on the server-returned order; rendering a composite must not re-sort.
    const texts = await page.getByTestId('opportunity-card').allInnerTexts();
    const idx = (sym: string) => texts.findIndex((t) => t.includes(sym));
    expect(idx('AAPL')).toBeLessThan(idx('MSFT'));
  });

  test('feature 199: a NULL/data-unavailable composite renders an em-dash, never 0.000 (AC-11)', async ({
    page,
  }) => {
    // PLTR is data-unavailable (no composite) and TSLA simply has none → em-dash on both.
    await expect(card(page, 'PLTR').getByTestId('opp-composite-PLTR').first()).toHaveText('—');
    await expect(card(page, 'TSLA').getByTestId('opp-composite-TSLA').first()).toHaveText('—');
    await expect(card(page, 'PLTR').getByText('0.000')).toHaveCount(0);
  });

  // feature 185 FR-4 — cold "computing", terminal "compute-failed", and the legitimately-empty
  // distinctness, driven by a per-test ListOpportunities response shape (LIFO route precedence).
  const routeList = (page: Page, body: object) =>
    page.route('**/xstockstrat.analysis.v1.AnalysisService/ListOpportunities', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }),
    );

  test('feature 185: a cold queue renders a computing state (FR-4 @AC-6)', async ({ page }) => {
    await routeList(page, { opportunities: [], computing: true });
    await page.reload();
    await expect(page.getByTestId('opportunities-computing-desktop')).toBeVisible({
      timeout: 8000,
    });
    await expect(page.getByTestId('empty-state')).toHaveCount(0); // not the plain empty state
  });

  test('feature 185: a persistently-failed compute renders a terminal error (FR-4 @AC-7)', async ({
    page,
  }) => {
    await routeList(page, { opportunities: [], computeFailed: true });
    await page.reload();
    await expect(page.getByTestId('opportunities-compute-failed-desktop')).toBeVisible({
      timeout: 8000,
    });
  });

  test('feature 185: a legitimately-empty universe shows the plain empty state, not computing (FR-4 distinctness)', async ({
    page,
  }) => {
    await routeList(page, { opportunities: [] });
    await page.reload();
    await expect(page.getByText('No opportunities match the filter').last()).toBeVisible({
      timeout: 8000,
    });
    await expect(page.getByTestId('opportunities-computing-desktop')).toHaveCount(0);
    await expect(page.getByTestId('opportunities-compute-failed-desktop')).toHaveCount(0);
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

  // feature 188 — previous-day OHLC visible in mobile card header, underneath the symbol name.
  test('feature 188: mobile card shows previous-day OHLC block', async ({ page }) => {
    const ohlc = page.getByTestId('mobile-ohlc-CAPR');
    await expect(ohlc).toBeVisible();
    await expect(ohlc).toContainText('O $');
    await expect(ohlc).toContainText('H $');
    await expect(ohlc).toContainText('L $');
    await expect(ohlc).toContainText('C $');
  });

  // feature 185 FR-2 — the mobile companion row also renders the explicit unavailable cue (not 0/0).
  test('feature 185: a data-unavailable row shows the mobile unavailable cue', async ({ page }) => {
    await expect(page.getByTestId('opportunity-unavailable-mobile-PLTR')).toBeVisible();
  });
});
