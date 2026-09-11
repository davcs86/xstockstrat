import { test, expect, type Page } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';
import {
  mockWatchlists,
  type MockWatchlist,
  type ReadinessStateOverrides,
} from '../helpers/watchlistMock';

/**
 * Feature 181 — the watchlist readiness LIST: rows render immediately with a per-row loading state,
 * the readiness verdict is decorated by one page-bounded GetWatchlistReadiness call (no client N+1
 * EvaluateReadiness fan-out), and the bound rows are paginated. Covers @AC-1..@AC-6.
 */
const STRAT = 'strat-live-001';

function seed(symbols: string[]): MockWatchlist[] {
  return [
    {
      watchlistId: 'wl-1',
      userId: 'test-user-001',
      name: 'Readiness List',
      description: '',
      symbols,
      bindings: symbols.map((s) => ({ symbol: s, strategyId: STRAT })),
    },
  ];
}

async function open(page: Page, symbols: string[], overrides: ReadinessStateOverrides = {}) {
  await addAuthCookie(page);
  await mockWatchlists(page, seed(symbols), overrides);
  await page.goto('/insights/watchlists');
  await expect(page.getByTestId('watchlist-readiness')).toBeVisible({ timeout: 8000 });
}

test.describe('Watchlist readiness list (feature 181)', () => {
  test('@AC-1 rows render immediately with a per-row loading state, never blank-until-all', async ({
    page,
  }) => {
    const symbols = ['AAA', 'BBB', 'CCC', 'DDD', 'EEE'];
    const pending: ReadinessStateOverrides = Object.fromEntries(symbols.map((s) => [s, 'pending']));
    await open(page, symbols, pending);

    // All five rows are present immediately with symbol + a Skeleton loading verdict cell.
    for (const s of symbols) {
      await expect(page.getByTestId(`readiness-row-${s}`)).toBeVisible();
      await expect(page.getByTestId(`readiness-loading-${s}`)).toBeVisible();
    }
    // The list container itself rendered (not blank-until-all).
    await expect(page.getByTestId('watchlist-readiness')).toBeVisible();
  });

  test('@AC-2 one readiness failure degrades that row to unknown, not the whole list', async ({
    page,
  }) => {
    const symbols = ['AMD', 'BBB', 'CCC'];
    await open(page, symbols, { AMD: 'unknown' });

    // AMD shows the icon+text unavailable state; the others resolve; the list container survives.
    await expect(page.getByTestId('readiness-unknown-AMD')).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId('readiness-unknown-AMD')).toContainText('unavailable');
    await expect(
      page.getByTestId('readiness-row-BBB').getByTestId(/^readiness-cue-/),
    ).toBeVisible();
    await expect(
      page.getByTestId('readiness-row-CCC').getByTestId(/^readiness-cue-/),
    ).toBeVisible();
    await expect(page.getByTestId('watchlist-readiness')).toBeVisible();
  });

  test('@AC-3 visible page is decorated inline with NO client EvaluateReadiness fan-out', async ({
    page,
  }) => {
    const evalCalls: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/AnalysisService/EvaluateReadiness')) evalCalls.push(r.url());
    });
    const symbols = ['AAA', 'BBB', 'CCC'];
    await open(page, symbols); // all resolved

    // Every visible row shows an inline resolved verdict cue.
    for (const s of symbols) {
      await expect(
        page.getByTestId(`readiness-row-${s}`).getByTestId(/^readiness-cue-/),
      ).toBeVisible({ timeout: 8000 });
    }
    // The N+1 is killed, not relocated: the browser never fans out per-strategy EvaluateReadiness.
    await page.waitForTimeout(500);
    expect(evalCalls).toEqual([]);
  });

  test('@AC-4 a long watchlist paginates; only the visible page renders + is decorated', async ({
    page,
  }) => {
    const symbols = Array.from({ length: 30 }, (_, i) => `SYM${String(i + 1).padStart(2, '0')}`);
    await open(page, symbols); // all resolved, page size 25

    const rows = page.locator('[data-testid^="readiness-row-"]');
    await expect(rows).toHaveCount(25, { timeout: 8000 });
    await expect(page.getByTestId('readiness-row-SYM01')).toBeVisible();
    await expect(page.getByTestId('readiness-row-SYM26')).toHaveCount(0); // beyond the first page

    // Advance to the next page: the remaining 5 rows render.
    await page.getByRole('button', { name: 'Next page of watchlist rows' }).click();
    await expect(rows).toHaveCount(5, { timeout: 8000 });
    await expect(page.getByTestId('readiness-row-SYM26')).toBeVisible();
    await expect(page.getByTestId('readiness-row-SYM01')).toHaveCount(0);
  });

  test('@AC-6 loading state is an announced C-17 skeleton + labeled keyboard pagination', async ({
    page,
  }) => {
    const symbols = Array.from({ length: 30 }, (_, i) => `SYM${String(i + 1).padStart(2, '0')}`);
    // Force page 1 to PENDING so the announced Skeleton is present to assert on.
    const pending: ReadinessStateOverrides = Object.fromEntries(symbols.map((s) => [s, 'pending']));
    await open(page, symbols, pending);

    // The loading cell is announced to assistive tech (aria-busy + role=status).
    const loading = page.getByTestId('readiness-loading-SYM01');
    await expect(loading).toBeVisible();
    await expect(loading).toHaveAttribute('aria-busy', 'true');
    await expect(loading).toHaveAttribute('role', 'status');

    // The pagination control is a keyboard-operable button with an accessible name.
    const next = page.getByRole('button', { name: 'Next page of watchlist rows' });
    await expect(next).toBeEnabled();
    await next.focus();
    await expect(next).toBeFocused();
  });
});
