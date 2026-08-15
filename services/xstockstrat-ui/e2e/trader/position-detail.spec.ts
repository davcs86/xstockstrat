import { test, expect } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';

/**
 * Single-Position page (feature 096) — the dedicated `/trader/positions/[symbol]` view built from
 * the enriched `Position` risk fields (GetPosition), the per-symbol Orders & fills (ListOrders w/
 * symbol filter), and the marketdata chart. Data comes from the shared mock backend
 * (e2e/fixtures/positions.ts): AAPL carries factor 'Tech', a resting stop (flag STOP_NEAR) and
 * unrealizedPnl 100.0 (parity with the Exposure list + Portfolio); MSFT carries no risk metadata.
 * The account context auto-selects the first active broker account, so GetPosition is issued
 * without any manual selection.
 */
test.describe('Single Position page', () => {
  test('renders the risk-framed header, stat grid, risk sidebar and orders table', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await page.goto('/trader/positions/AAPL');

    // Header + stat grid — AAPL, big Unrealized (parity value), risk framing. Generous first-hit
    // timeout: the first client RPC through the trader BFF compiles its route on a cold server.
    await expect(page.getByText('AAPL').first()).toBeVisible({ timeout: 30000 });
    // AC-3 valuation parity: the Position page shows AAPL unrealized P&L = +$100.00, the same
    // value the Exposure list and Portfolio report (one broker-authoritative source).
    await expect(page.getByText('+$100.00').first()).toBeVisible();
    await expect(page.getByText('Open R')).toBeVisible();

    // Risk & exit sidebar — factor, flag, exit rule from the enriched Position.
    await expect(page.getByText('Risk & exit')).toBeVisible();
    await expect(page.getByText('Tech', { exact: true })).toBeVisible();
    await expect(page.getByText('Stop near')).toBeVisible();

    // Bracket leg order IDs (feature 030) — AAPL carries a confirmed resting bracket.
    await expect(page.getByText('Stop order')).toBeVisible();
    await expect(page.getByText('ord-stop-778')).toBeVisible();
    await expect(page.getByText('Take-profit order')).toBeVisible();
    await expect(page.getByText('ord-tp-779')).toBeVisible();

    // Per-symbol Orders & fills table (ListOrders filtered to AAPL → the filled AAPL order).
    await expect(page.getByText('Orders & fills · AAPL')).toBeVisible();
  });

  test('a position with no resting stop renders the no-stop fallbacks (no fabricated values)', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await page.goto('/trader/positions/MSFT');

    await expect(page.getByText('MSFT').first()).toBeVisible({ timeout: 30000 });
    // MSFT carries no stopPrice → the risk sidebar shows "no stop set", never a fabricated 0.
    await expect(page.getByText('no stop set').first()).toBeVisible();
    // MSFT carries no bracket (feature 030) → both leg-order rows fall back to the em-dash.
    await expect(page.getByText('Stop order')).toBeVisible();
    await expect(page.getByText('Take-profit order')).toBeVisible();
  });

  test('is reachable from the Exposure list by clicking a position symbol (C-10(a))', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await page.goto('/trader/positions');

    // The Exposure table's AAPL symbol links to the dedicated page.
    await page.getByRole('link', { name: 'AAPL', exact: true }).click();
    await expect(page).toHaveURL(/\/trader\/positions\/AAPL/);
    await expect(page.getByText('Risk & exit')).toBeVisible({ timeout: 30000 });
  });

  test('an unheld symbol still renders the chart, orders and trade sections (feature 125)', async ({
    page,
  }) => {
    await addAuthCookie(page);
    // ZZZZ is absent from the position fixtures → GetPosition returns NotFound.
    await page.goto('/trader/positions/ZZZZ');

    // The not-found state is a compact inline notice, NOT a page takeover.
    await expect(page.getByText(/position in ZZZZ/).first()).toBeVisible({ timeout: 30000 });

    // The research sections render for the unheld symbol (hoisted independent of position):
    // price chart, per-symbol orders, and the inline trade widget.
    await expect(page.getByText('Price · ZZZZ')).toBeVisible();
    await expect(page.getByText('Orders & fills · ZZZZ')).toBeVisible();
    await expect(page.getByText('Trade ZZZZ')).toBeVisible();

    // The position-specific sidebar (Risk & exit) is absent for an unheld symbol.
    await expect(page.getByText('Risk & exit')).toHaveCount(0);
  });

  test('a NotFound position shows the notice, not the generic error paragraph (render-order fix)', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await page.goto('/trader/positions/ZZZZ');

    await expect(page.getByText(/position in ZZZZ/).first()).toBeVisible({ timeout: 30000 });
    // A NotFound is not an error — the "Failed to load position" paragraph must not appear.
    await expect(page.getByText(/Failed to load position/)).toHaveCount(0);
  });

  test('a watchlisted symbol renders the Opportunity + Readiness sections (FR-11 watchlisted branch)', async ({
    page,
  }) => {
    await addAuthCookie(page);
    // Seed AAPL into a watchlist (bound to a live strategy) so the FR-11 gate takes the
    // watchlisted branch (Opportunity + Readiness), not the Screening branch.
    await watchlist(page, 'AAPL');
    await page.goto('/trader/positions/AAPL');

    await expect(page.getByText('Opportunity').first()).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('Why this fired')).toBeVisible({ timeout: 10000 });
  });

  test('a non-watchlisted symbol hides the Opportunity + Readiness sections (FR-11 gate)', async ({
    page,
  }) => {
    await addAuthCookie(page);
    // Default mock returns no watchlists → AAPL is not watchlisted → the watchlisted branch's
    // Opportunity/Readiness must be absent (the Screening branch arrives in Step 16).
    await page.goto('/trader/positions/AAPL');

    // Wait for the page to render (the position header), then assert the gated sections are absent.
    await expect(page.getByText('Risk & exit')).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('Why this fired')).toHaveCount(0);
    await expect(page.getByText('Opportunity', { exact: true })).toHaveCount(0);
  });

  test('the Fundamentals section renders metrics for a watchlisted symbol with data (FR-7)', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await watchlist(page, 'AAPL'); // AAPL watchlisted → the fundamentals branch renders
    await page.goto('/trader/positions/AAPL');

    await expect(page.getByRole('heading', { name: 'Fundamentals' })).toBeVisible({
      timeout: 30000,
    });
    // Metric labels + a value from FUNDAMENTALS_AAPL (P/E 31.40).
    await expect(page.getByText('P/E')).toBeVisible();
    await expect(page.getByText('31.40')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('ROE')).toBeVisible();
  });

  test('the Fundamentals section shows an explicit no-data state when the provider has none', async ({
    page,
  }) => {
    await addAuthCookie(page);
    // MSFT is held (so the page loads) and watchlisted here, but the mock has no fundamentals for
    // it → the section shows the explicit no-data message, never fabricated zeros.
    await watchlist(page, 'MSFT');
    await page.goto('/trader/positions/MSFT');

    await expect(page.getByRole('heading', { name: 'Fundamentals' })).toBeVisible({
      timeout: 30000,
    });
    await expect(page.getByText(/No fundamentals data for MSFT/)).toBeVisible({ timeout: 10000 });
  });

  test('a non-watchlisted symbol runs the single-symbol Screening section (FR-8)', async ({
    page,
  }) => {
    await addAuthCookie(page);
    // Default mock returns no watchlists → AAPL is non-watchlisted → the Screening branch (not the
    // watchlisted Opportunity/Readiness/Fundamentals branch) renders.
    await page.goto('/trader/positions/AAPL');

    const screening = page.getByTestId('symbol-screening');
    await expect(screening).toBeVisible({ timeout: 30000 });

    // Run the default criterion against just this symbol.
    await screening.getByTestId('run-symbol-screen').click();

    // The result echoes the per-criterion raw reading + pass/fail from the mocked single-symbol
    // response (criterionRawValues/criterionPassed) — 42.50 raw, Pass.
    const results = screening.getByTestId('symbol-screen-results');
    await expect(results).toBeVisible({ timeout: 10000 });
    await expect(results.getByText('42.50')).toBeVisible();
    // Scope to the result row's Pass badge — "Pass" also appears as the column header.
    await expect(results.getByTestId('symbol-screen-row').getByText('Pass')).toBeVisible();

    // The universe-collapsed composite score must NEVER surface in this section (FR-8): no Score
    // column, no score readout anywhere in the section's DOM subtree.
    await expect(screening.getByText('Score', { exact: false })).toHaveCount(0);
  });

  test('the Backtests section lists the resolved strategy runs for this symbol, excluding others (FR-9)', async ({
    page,
  }) => {
    await addAuthCookie(page);
    // Bind AAPL to strat-history-001 (the mock's only strategy with backtest history). Its history
    // has one AAPL run (bt-hist-2) and one MSFT run (bt-hist-1) — only the AAPL row must survive the
    // client-side symbols filter.
    await watchlist(page, 'AAPL', 'strat-history-001');
    await page.goto('/trader/positions/AAPL');

    const table = page.getByTestId('backtests-table');
    await expect(table).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('backtest-row')).toHaveCount(1);
    await expect(table.getByText('15.00%')).toBeVisible(); // bt-hist-2 totalReturn 0.15
    // The MSFT-only run is filtered out (it never included this symbol).
    await expect(table.getByText('-3.00%')).toHaveCount(0);

    // Running a new backtest completes (mock) and refreshes the history without error.
    await page.getByTestId('run-backtest').click();
    await expect(page.getByTestId('backtests-table')).toBeVisible();
    await expect(page.getByText(/Running…/)).toHaveCount(0, { timeout: 10000 });
  });

  test('the Backtests section shows a no-strategy state for a symbol with no binding and no orders (FR-9)', async ({
    page,
  }) => {
    await addAuthCookie(page);
    // ZZZZ is unheld (no orders → no owning strategy) and non-watchlisted → no strategy resolves.
    await page.goto('/trader/positions/ZZZZ');
    // Backtests-specific phrasing (the Indicators section also shows a "No strategy resolves" note).
    await expect(
      page.getByText(/No strategy resolves for ZZZZ — add it to a watchlist/),
    ).toBeVisible({ timeout: 30000 });
  });

  test('the Backfill section shows the ingested date span for a symbol with coverage (FR-10)', async ({
    page,
  }) => {
    await addAuthCookie(page);
    // AAPL has one COMPLETED backfill job spanning 2024-01-01 → 2024-06-01 in the mock.
    await page.goto('/trader/positions/AAPL');

    const coverage = page.getByTestId('backfill-coverage');
    await expect(coverage).toBeVisible({ timeout: 30000 });
    await expect(coverage).toContainText('2024-01-01 → 2024-06-01');
  });

  test('the Backfill section shows a no-coverage state for a symbol with no ingested data (FR-10)', async ({
    page,
  }) => {
    await addAuthCookie(page);
    // ZZZZ has no backfill jobs in the mock → explicit no-coverage state, never a blank gap.
    await page.goto('/trader/positions/ZZZZ');
    await expect(page.getByTestId('no-backfill')).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('no-backfill')).toContainText(/No ingested coverage for ZZZZ/);
  });

  // ── Signal-detail readiness, relocated from the retired insights/market/[symbol] page (Step 25).
  // The SignalReadiness component (+ the ported MuteForStrategy control and the Opportunity
  // Conviction/Edge grammar) live in the watchlisted branch, so each test seeds a watchlist first.

  test('renders traced readiness conditions + Conviction/Edge for the threaded strategy (feature 083/125)', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await watchlist(page, 'AAPL', 'strat-live-001');
    await page.goto('/trader/positions/AAPL?strategy=strat-live-001');

    await expect(page.getByText('Why this fired')).toBeVisible({ timeout: 30000 });
    // Opportunity header grammar (relocated from the Signal-detail header): Conviction + Edge (BT).
    await expect(page.getByText('Conviction')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Edge (BT)')).toBeVisible();
    // Deterministic conviction as N/M conditions (never a fabricated %), from EvaluateReadiness.
    await expect(page.getByText('2/3 conditions')).toBeVisible();
    // Traced leaves from EvaluateReadiness.
    await expect(page.getByText('sma_fast', { exact: false })).toBeVisible();
    await expect(page.getByText('rsi', { exact: false })).toBeVisible();
    // The readiness picker reflects the threaded strategy (`.first()` scopes to it, above the Mute card).
    await expect(page.getByText('Live Test Strategy').first()).toBeVisible();
    // The opportunity's source survives in the meta line (non-exact — it's joined, not a Badge here).
    await expect(page.getByText(/unusual_whales/)).toBeVisible();

    // Strategy track-record block (GetStrategyAnalytics): signals 30d 42, hit rate 62%, expectancy 0.35.
    const record = page.getByTestId('strategy-track-record');
    await expect(record).toBeVisible();
    await expect(record).toContainText('42');
    await expect(record).toContainText('62%');
    await expect(record).toContainText('0.35');
  });

  test('prompts to pick a strategy when none is threaded (no fabricated binding, feature 083/125)', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await watchlist(page, 'AAPL', 'strat-live-001');
    await page.goto('/trader/positions/AAPL');
    await expect(page.getByText(/Select a strategy to evaluate/)).toBeVisible({ timeout: 30000 });
  });

  test('the readiness strategy picker excludes non-live strategies (feature 083/125)', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await watchlist(page, 'AAPL', 'strat-live-001');
    await page.goto('/trader/positions/AAPL');
    await expect(page.getByText(/Select a strategy to evaluate/)).toBeVisible({ timeout: 30000 });
    // Exact label — the readiness picker is "Strategy"; the Mute card's trigger is "Mute strategy".
    await page.getByLabel('Strategy', { exact: true }).click();
    await expect(page.getByRole('option', { name: 'Live Test Strategy' })).toBeVisible();
    // "Inactive Strategy" (liveEnabled: false) must not be a selectable readiness option.
    await expect(page.getByRole('option', { name: 'Inactive Strategy' })).toHaveCount(0);
  });

  test('feature 132: the mute control sends a masked denied_symbols update appending this symbol', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await watchlist(page, 'AMD', 'strat-live-001'); // watchlisted → the Mute card renders
    let captured: Record<string, unknown> | null = null;
    await page.route('**/xstockstrat.analysis.v1.AnalysisService/ManageStrategy', async (route) => {
      captured = JSON.parse(route.request().postData() ?? '{}');
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await page.goto('/trader/positions/AMD');
    const card = page.getByTestId('mute-for-strategy');
    await expect(card).toBeVisible({ timeout: 30000 });
    // strat-001 (Deny List Strategy) already denies TSLA — muting AMD appends to that list. The
    // control is now a shadcn Select: open the trigger, then pick the option.
    await card.getByTestId('mute-strategy-select').click();
    await page.getByRole('option', { name: /Deny List Strategy/ }).click();
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

  test('feature 138: a held (REDUCE/ADD) opportunity traces the EXIT rule, not entry', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await watchlist(page, 'MSFT', 'strat-001'); // watchlisted → SignalReadiness renders
    // MSFT is a held opportunity (ADD, provenance includes "position") under strat-001.
    await page.goto('/trader/positions/MSFT?strategy=strat-001');
    await expect(page.getByText('Why this fired')).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('readiness-exit-rule')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('exit_z', { exact: false })).toBeVisible();
    await expect(page.getByText('1/1 conditions')).toBeVisible();
    // The entry-rule leaves (symbolReadiness) must NOT appear — that was the mislabeled trace.
    await expect(page.getByText('sma_fast', { exact: false })).toHaveCount(0);
  });

  test('a stale ?strategy= (deleted strategy) shows a distinct message, not a generic error (feature 125)', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await watchlist(page, 'AAPL', 'strat-live-001');
    // strat-notfound-readiness-01 is a reserved sentinel the mock's evaluateReadiness aborts NOT_FOUND
    // for — a stale/bookmarkable ?strategy= threading a strategy the service no longer has.
    await page.goto('/trader/positions/AAPL?strategy=strat-notfound-readiness-01');
    await expect(page.getByText('Why this fired')).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('This strategy no longer exists — pick another.')).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText('Failed to evaluate readiness.')).toHaveCount(0);
  });

  test('the indicator overlay panels render one panel per component beneath the chart (FR-6)', async ({
    page,
  }) => {
    await addAuthCookie(page);
    // Watchlisted AAPL → boundStrategyId resolves; getStrategy returns a component so the series RPC
    // fires; the mock returns INDICATOR_SERIES_AAPL (a multi-series macd + a failed component).
    await watchlist(page, 'AAPL', 'strat-live-001');
    await page.goto('/trader/positions/AAPL');

    const panels = page.getByTestId('indicator-panels');
    await expect(panels).toBeVisible({ timeout: 30000 });
    // One chart panel (macd) + one error panel (brokenformula) — per-component fault isolation.
    await expect(page.getByTestId('indicator-panel')).toHaveCount(1);
    await expect(page.getByTestId('indicator-panel-error')).toHaveCount(1);
    await expect(panels.getByText('macd')).toBeVisible();
    // The failed component surfaces its error, never a chart.
    await expect(page.getByText(/sandbox timeout/)).toBeVisible();
    // All three named series of the macd component are drawn (value/signal/histogram) — no sub-series
    // dropped (FR-12/P-03). The warm-up-head gaps are unset IndicatorValues (mapped to recharts null
    // via `?? null`, connectNulls={false}), never a fabricated 0.0 — proven at the wire/handler layer
    // by the analysis unit test (test_analysis_servicer.py::…none_maps_to_unset…).
    await expect(page.getByTestId('indicator-panel').locator('.recharts-line')).toHaveCount(3);
  });

  test('the indicator panels show a no-data state (and skip the RPC) when no strategy resolves (FR-6)', async ({
    page,
  }) => {
    await addAuthCookie(page);
    // ZZZZ: unheld, non-watchlisted, no orders → no strategy resolves → explicit no-data state.
    await page.goto('/trader/positions/ZZZZ');
    const empty = page.getByTestId('indicator-panels-empty');
    await expect(empty).toBeVisible({ timeout: 30000 });
    await expect(empty).toContainText(/No strategy resolves for ZZZZ/);
    // No panels rendered (the RPC was never called with an empty strategy).
    await expect(page.getByTestId('indicator-panel')).toHaveCount(0);
  });
});

/** Route the browser's ListWatchlists to a single watchlist containing `symbol` (bound to
 *  `strategyId`), so the FR-11 gate takes the watchlisted branch and the resolved strategy is known. */
async function watchlist(
  page: import('@playwright/test').Page,
  symbol: string,
  strategyId = 'strat-live-001',
): Promise<void> {
  await page.route('**/xstockstrat.portfolio.v1.PortfolioService/ListWatchlists', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        watchlists: [
          {
            watchlistId: 'wl-1',
            name: 'My list',
            symbols: [symbol],
            bindings: [{ symbol, strategyId }],
          },
        ],
      }),
    });
  });
}
