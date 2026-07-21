import { test, expect } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';

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
