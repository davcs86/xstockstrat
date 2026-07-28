import { test, expect } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';

/**
 * Epoch millis from a `google.protobuf.Timestamp` as it appears **on the wire**.
 *
 * In TypeScript the message is `{seconds: bigint, nanos: number}` (UI `CLAUDE.md` § Constitution),
 * but Connect's JSON codec renders it as an RFC3339 string — so `postData()` carries
 * `"2024-01-01T00:00:00Z"`, and reading `.seconds` off it yields `undefined`. Both shapes are
 * accepted here so the helper reports a real mismatch rather than silently coercing to 0.
 */
function tsMillis(v: unknown): number {
  if (typeof v === 'string') return Date.parse(v);
  if (v && typeof v === 'object' && 'seconds' in v) {
    return Number((v as { seconds: string | number }).seconds) * 1000;
  }
  return NaN;
}

/**
 * E2E for feature 053 (backfill-backtest-coverage), AC-4.
 *
 * The insights mock backend returns a BACKTEST_STATUS_INSUFFICIENT_DATA result with a
 * coverage gap; the strategy detail page must render the gap panel instead of metrics,
 * and the "Backfill this range" action must call TriggerBackfill and surface the job id.
 */
test.describe('Backtest data coverage', () => {
  test('insufficient data renders gap panel + working backfill action', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/insights/strategies/strat-high-001');

    // Run a backtest — the mock returns INSUFFICIENT_DATA.
    await page.getByRole('button', { name: 'Run Backtest' }).click();

    const panel = page.getByTestId('insufficient-data');
    await expect(panel).toBeVisible({ timeout: 10000 });
    // Missing-range detail: bars have (3) and bars need (52).
    await expect(panel).toContainText('3');
    await expect(panel).toContainText('52');

    // Trigger the gap fill and assert the returned job id is confirmed.
    await page.getByTestId('backfill-action').click();
    await expect(page.getByTestId('backfill-confirmation')).toContainText('job-e2e-1', {
      timeout: 10000,
    });
  });

  // feature 071 — a windowed run's shortfall is in the PRE-window warm-up span, so the
  // backfill action must fill `gap` (earlier than the requested start), not `requestedRange`.
  // The two are equal on an unwindowed run, which is exactly why echoing the request back
  // would have looked correct until now; the mock now returns a disjoint pre-window gap.
  test('backfill action fills the pre-window warm-up gap, not the requested window', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await page.goto('/insights/strategies/strat-high-001');

    // Capture the window the browser asks for, then the range it offers to backfill.
    const backtestReq = page.waitForRequest(
      (r) => r.url().includes('/RunBacktest') && r.method() === 'POST',
    );
    await page.getByRole('button', { name: 'Run Backtest' }).click();
    const requestedStart = tsMillis(
      JSON.parse((await backtestReq).postData() ?? '{}').range?.start,
    );
    expect(requestedStart).not.toBeNaN(); // the form always sends an explicit window

    await expect(page.getByTestId('insufficient-data')).toBeVisible({ timeout: 10000 });

    const backfillReq = page.waitForRequest(
      (r) => r.url().includes('/TriggerBackfill') && r.method() === 'POST',
    );
    await page.getByTestId('backfill-action').click();
    const range = JSON.parse((await backfillReq).postData() ?? '{}').range ?? {};

    // The backfilled span ends where the requested window begins and reaches back before it.
    expect(tsMillis(range.end)).toBe(requestedStart);
    expect(tsMillis(range.start)).toBeLessThan(requestedStart);
  });

  // feature 064 — an OK backtest renders the day-by-day debug diagnostics table + no-trade reason.
  test('OK backtest renders day-by-day debug diagnostics', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/insights/strategies/strat-diag-001');

    await page.getByRole('button', { name: 'Run Backtest' }).click();

    await expect(page.getByTestId('diagnostics-table')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('no-trade-reason')).toContainText(
      'entry condition was never satisfied',
    );
  });

  // feature 067 — a custom-formula that fails to execute renders a distinct FORMULA_ERROR
  // no-trade banner. The diagnostic carries bars:[] (bars-independent banner), proving the
  // shared NO_TRADE_MESSAGE map key is reachable (C-10 renderer parity).
  test('formula-error backtest renders the FORMULA_ERROR no-trade banner', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/insights/strategies/strat-formula-error-001');

    await page.getByRole('button', { name: 'Run Backtest' }).click();

    await expect(page.getByTestId('no-trade-reason')).toContainText(
      'custom-formula component failed',
      { timeout: 10000 },
    );
  });

  // feature 065: the derived "Strategy Grade" card and the per-run "Run score" column are BOTH
  // labelled (OQ-5 — closes the C-10(b) two-read-paths trap with distinct copy), the evidence
  // caption renders, and the legacy run (no range) shows the Range placeholder.
  test('derived grade + per-run score render with distinct labels and evidence', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await page.goto('/insights/strategies/strat-history-001');

    // Both labels visible — the derived grade card AND the per-run score column header.
    await expect(page.getByText('Strategy Grade')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Run score')).toBeVisible();
    // Evidence caption behind the derived grade (N symbols · X symbol-years).
    await expect(page.getByText(/symbols ·/)).toBeVisible();

    // Past Runs history table lists both persisted runs, newest first.
    const pastRuns = page.getByTestId('past-runs');
    await expect(pastRuns).toBeVisible();
    await expect(pastRuns).toContainText('AAPL');
    await expect(pastRuns).toContainText('MSFT');
    await expect(pastRuns).toContainText('15.00%');
    // The ranged run shows its window; the legacy run (no range) shows the em-dash placeholder.
    await expect(pastRuns).toContainText('2024-01-01–2024-06-01');
    await expect(pastRuns).toContainText('—');
  });

  // feature 065: agent/UI parity — the browser sends strategyIdRef == strategyId so the run
  // executes the registered definition and earns fingerprinted evidence.
  test('run backtest sends strategyIdRef equal to strategyId', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/insights/strategies/strat-history-001');

    const reqPromise = page.waitForRequest(
      (r) => r.url().includes('/RunBacktest') && r.method() === 'POST',
    );
    await page.getByRole('button', { name: 'Run Backtest' }).click();
    const body = (await reqPromise).postData() ?? '';
    expect(body).toContain('"strategyIdRef":"strat-history-001"');
    expect(body).toContain('"strategyId":"strat-history-001"');
  });

  // feature 068: opening a past run renders its persisted detail — metrics parity with the
  // Past Runs row (AC-4 surface parity), the time-axis equity curve, and trade markers with
  // a tooltip carrying the trade payload (FR-4, AC-2).
  test('opening a past run renders persisted metrics, time-axis curve, and trade markers', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await page.goto('/insights/strategies/strat-history-001');

    const rows = page.getByTestId('past-run-row');
    await expect(rows).toHaveCount(2, { timeout: 10000 });
    await rows.first().click(); // newest first → bt-hist-2 (has detail)

    // Metrics grid renders the persisted values — equal to the Past Runs row's (15.00%).
    await expect(page.getByText('Backtest Results')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('15.00%').first()).toBeVisible();
    await expect(page.getByTestId('past-runs')).toContainText('15.00%');
    // Time-axis equity curve with trade markers (2 trades → 4 markers).
    await expect(page.getByTestId('equity-curve-chart')).toBeVisible();
    const markers = page.getByTestId('trade-marker');
    await expect(markers).toHaveCount(4);
    // Marker tooltip carries the trade payload: symbol/side/qty/entry/exit/P&L.
    await markers.first().hover({ force: true });
    const tooltip = page.getByTestId('marker-tooltip');
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText('AAPL');
    await expect(tooltip).toContainText('long');
    await expect(tooltip).toContainText('Qty 100');
    await expect(tooltip).toContainText('$185.50');
    await expect(tooltip).toContainText('$192.30');
    await expect(tooltip).toContainText('P&L $680.00');
    // The persisted per-bar diagnostics render through the same component (AC-5).
    await expect(page.getByTestId('diagnostics-table')).toBeVisible();
  });

  // feature 068: a legacy run without persisted detail renders the explicit empty state
  // while its summary row stays in the table (AC-3, FR-6).
  test('legacy run without detail renders the no-detail empty state', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/insights/strategies/strat-history-001');

    const rows = page.getByTestId('past-run-row');
    await expect(rows).toHaveCount(2, { timeout: 10000 });
    await rows.nth(1).click(); // bt-hist-1 → NOT_FOUND

    await expect(page.getByTestId('run-detail-empty')).toBeVisible({ timeout: 10000 });
    // The row's summary metrics remain visible in the table.
    await expect(page.getByTestId('past-runs')).toContainText('MSFT');
    await expect(page.getByTestId('past-runs')).toContainText('-3.00%');
  });

  // feature 068: running a fresh backtest clears an open historical selection so the fresh
  // result is never shadowed by a stale run (design.md seam-clear).
  test('fresh run clears an open historical selection', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/insights/strategies/strat-history-001');

    const rows = page.getByTestId('past-run-row');
    await expect(rows).toHaveCount(2, { timeout: 10000 });
    await rows.first().click();
    await expect(page.getByText('Backtest Results')).toBeVisible({ timeout: 10000 });
    await expect(rows.first()).toHaveAttribute('aria-selected', 'true');

    // The mock returns INSUFFICIENT_DATA for strat-history-001 runs — the fresh result's
    // gap panel must replace the historical run's metrics surface.
    await page.getByRole('button', { name: 'Run Backtest' }).click();
    await expect(page.getByTestId('insufficient-data')).toBeVisible({ timeout: 10000 });
    await expect(rows.first()).toHaveAttribute('aria-selected', 'false');
  });

  // feature 065: a strategy whose grade is NOT_FOUND renders the cleared-grade empty state while
  // keeping the backtest form (and Past Runs, when present) rendered.
  test('cleared grade renders empty state without hiding the backtest form', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/insights/strategies/strat-notfound-001');

    await expect(page.getByText('Strategy Grade')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Not scored yet — run a backtest to earn evidence.')).toBeVisible();
    // The backtest runner stays available so the user can earn evidence.
    await expect(page.getByRole('button', { name: 'Run Backtest' })).toBeVisible();
  });
});
