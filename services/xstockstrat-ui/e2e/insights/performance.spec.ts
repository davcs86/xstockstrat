import { test, expect, type Page } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';
import {
  CLOSED_POSITION_ROWS,
  CLOSED_POSITION_POLL_ROW,
  closedPositionEventWire,
  type ClosedPositionRow,
} from '../fixtures/ledgerEvents';

/**
 * feature 031 — /insights/performance strategy-performance dashboard e2e.
 *
 * The default mock backend (e2e/mock-backend.ts) already serves the CLOSED_POSITION_ROWS fixture on
 * LedgerService.QueryEvents(event_type='portfolio.position.closed'), the ui.performance.* config on
 * ConfigService.GetConfig(namespace='ui'), and paper on TradingService.GetTradingEnvironment — so
 * most scenarios just navigate. AC-6 (60s poll) and AC-10 (live) override at the browser boundary
 * via page.route, reusing the SAME centralized fixture (C-12) — no inline domain literals here.
 *
 * Covers: AC-1, AC-4 (placeholder), AC-6, AC-7, AC-8, AC-9, AC-10.
 */

const QUERY_EVENTS = '**/xstockstrat.ledger.v1.LedgerService/QueryEvents';
const GET_TRADING_ENV = '**/xstockstrat.trading.v1.TradingService/GetTradingEnvironment';

function eventsBody(rows: ClosedPositionRow[]): string {
  return JSON.stringify({ events: rows.map(closedPositionEventWire), page: { nextPageToken: '' } });
}

/** The summary StatTile grid — scope $-value assertions here so a chart Y-axis tick can't match. */
function summary(page: Page) {
  return page.getByTestId('performance-summary');
}

async function gotoPerformance(page: Page): Promise<void> {
  await addAuthCookie(page);
  await page.goto('/insights/performance');
  await expect(page.getByTestId('performance-page')).toBeVisible({ timeout: 30000 });
}

test.describe('performance dashboard', () => {
  test('AC-1: renders the cumulative-realized-P&L equity curve summing every closed trade', async ({
    page,
  }) => {
    await gotoPerformance(page);
    // The equity curve renders from the 10 seeded closes.
    await expect(page.getByTestId('equity-curve-chart')).toBeVisible({ timeout: 15000 });
    // Total P&L stat = Σ realizedPnl of the full set ($850) — the equity curve's final value (AC-1).
    await expect(summary(page).getByText('$850', { exact: true })).toBeVisible();
  });

  test('AC-9: shows the "Paper Trading" label in a paper (staging) deployment', async ({ page }) => {
    // Mock default GetTradingEnvironment → paper.
    await gotoPerformance(page);
    await expect(page.getByTestId('paper-trading-label')).toBeVisible();
  });

  test('AC-10: hides the "Paper Trading" label in a live (production) deployment', async ({
    page,
  }) => {
    await page.route(GET_TRADING_ENV, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ tradingMode: 'TRADING_MODE_LIVE', applicationEnv: 'production' }),
      }),
    );
    await gotoPerformance(page);
    await expect(page.getByTestId('equity-curve-chart')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('paper-trading-label')).toHaveCount(0);
  });

  test('AC-8: the date-range picker recomputes every metric over the selected window', async ({
    page,
  }) => {
    await gotoPerformance(page);
    await expect(summary(page).getByText('$850', { exact: true })).toBeVisible();
    // Narrow to June: only the three June closes (-120, +300, +90) → $270 total.
    await page.getByTestId('perf-start').fill('2026-06-01');
    await page.getByTestId('perf-end').fill('2026-06-30');
    await expect(summary(page).getByText('$270', { exact: true })).toBeVisible();
    // The full-range total is no longer shown — the metrics genuinely recomputed.
    await expect(summary(page).getByText('$850', { exact: true })).toHaveCount(0);
  });

  test('AC-4: a zero-variance window shows the Sharpe not-available placeholder, never Infinity/NaN', async ({
    page,
  }) => {
    await gotoPerformance(page);
    // A single-trade window (July) yields < 2 returns → Sharpe null → placeholder.
    await page.getByTestId('perf-start').fill('2026-07-01');
    await page.getByTestId('perf-end').fill('2026-07-31');
    await expect(page.getByTestId('sharpe-na')).toBeVisible();
    await expect(page.getByTestId('sharpe-na')).not.toContainText('Infinity');
    await expect(page.getByTestId('sharpe-na')).not.toContainText('NaN');
  });

  test('AC-7: dragging the equity-curve brush zooms without leaving the page', async ({ page }) => {
    await gotoPerformance(page);
    await expect(page.getByTestId('equity-curve-chart')).toBeVisible({ timeout: 15000 });
    const traveller = page.locator('.recharts-brush-traveller').first();
    await expect(traveller).toBeVisible();
    const box = await traveller.boundingBox();
    expect(box).not.toBeNull();
    // Drag the left traveller rightward to narrow the brush window.
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + 120, box!.y + box!.height / 2, { steps: 8 });
    await page.mouse.up();
    // Still on the dashboard (the brush is in-page zoom, not navigation) and the chart survives.
    await expect(page).toHaveURL(/\/insights\/performance/);
    await expect(page.getByTestId('equity-curve-chart')).toBeVisible();
  });

  test('AC-6: the 60s poll refreshes metrics in place when a new close lands', async ({ page }) => {
    let rows = [...CLOSED_POSITION_ROWS];
    let calls = 0;
    await page.route(QUERY_EVENTS, (route) => {
      calls += 1;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: eventsBody(rows),
      });
    });
    await page.clock.install();
    await gotoPerformance(page);
    // Initial: 10 closes → $850.
    await expect(summary(page).getByText('$850', { exact: true })).toBeVisible({ timeout: 15000 });
    const initialCalls = calls;

    // A new close lands in the store; the next poll (not a reload) must pick it up.
    rows = [...CLOSED_POSITION_ROWS, CLOSED_POSITION_POLL_ROW];
    await page.clock.runFor(60_000); // POLL_INTERVAL_MS
    await expect.poll(() => calls, { timeout: 10000 }).toBeGreaterThan(initialCalls);

    // 850 + 150 = 1000, updated in place (the page never navigated away).
    await expect(summary(page).getByText('$1,000', { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/insights\/performance/);
  });
});
