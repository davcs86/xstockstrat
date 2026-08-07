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
});
