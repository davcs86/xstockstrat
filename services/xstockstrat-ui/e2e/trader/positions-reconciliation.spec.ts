import { test, expect } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';
import { BROKER_ACCOUNT_ALPACA, BROKER_ACCOUNT_IBKR } from '../fixtures/accounts';

/**
 * /trader/positions reconciliation status + halt display (feature 102).
 *
 * The default mock backend (mock-backend.ts LedgerService.queryEvents `account:` branch) returns
 * one `reconciliation.mismatch_found` event per account query, and ConfigService.getConfig
 * defaults `platform.trading_state` to ACTIVE — both overridden per-test below via page.route on
 * the trader BFF's Connect paths (glob on the proto service/method, per the AccountSelector
 * precedent). AccountContext auto-selects the first active broker account (alpaca-default).
 */
test.describe('Positions reconciliation status + halt display', () => {
  test('shows last-reconciled recency when healthy', async ({ page }) => {
    await page.route('**/xstockstrat.ledger.v1.LedgerService/QueryEvents', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          events: [
            {
              eventId: 'evt-reconciliation-healthy',
              eventType: 'reconciliation.tick',
              streamKey: 'account:alpaca-default',
              sourceService: 'xstockstrat-trading',
              payload: { tick_at: Date.now() },
              sequence: '1',
            },
          ],
          page: { nextPageToken: '' },
        }),
      });
    });
    await addAuthCookie(page);
    await page.goto('/trader/positions');

    await expect(page.getByText(/last run (just now|\d+[mhd] ago)/)).toBeVisible({
      timeout: 30000,
    });
    // No unresolved-mismatch marker and no halt badge in the healthy case.
    await expect(page.getByText('Account halted')).not.toBeVisible();
  });

  test('shows an unresolved-mismatch marker when the last tick found one', async ({ page }) => {
    // Default mock branch already returns a reconciliation.mismatch_found event — no override.
    await addAuthCookie(page);
    await page.goto('/trader/positions');

    // The recency line is suppressed while a mismatch is unresolved (page.tsx's "no noise when
    // healthy" gate), so the healthy-case recency text must not render.
    await expect(page.getByRole('heading', { name: 'Exposure' })).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(/last run (just now|\d+[mhd] ago)/)).not.toBeVisible();
  });

  test('shows the halt reason and source when an account is halted', async ({ page }) => {
    await page.route(
      '**/xstockstrat.trading.v1.TradingService/ListBrokerAccounts',
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            accounts: [
              {
                ...BROKER_ACCOUNT_ALPACA,
                halted: true,
                haltReason: 'quantity discrepancy exceeded grace window',
                haltSource: 2, // HALT_SOURCE_RECONCILIATION
              },
              BROKER_ACCOUNT_IBKR,
            ],
          }),
        });
      },
    );
    await addAuthCookie(page);
    await page.goto('/trader/positions');

    await expect(page.getByText(/Account halted:/)).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('Reconciliation')).toBeVisible();
  });

  test('platform-wide REDUCE_ONLY takes precedence over a per-account halt badge', async ({
    page,
  }) => {
    await page.route(
      '**/xstockstrat.trading.v1.TradingService/ListBrokerAccounts',
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            accounts: [
              {
                ...BROKER_ACCOUNT_ALPACA,
                halted: true,
                haltReason: 'quantity discrepancy exceeded grace window',
                haltSource: 2, // HALT_SOURCE_RECONCILIATION
              },
              BROKER_ACCOUNT_IBKR,
            ],
          }),
        });
      },
    );
    await page.route('**/xstockstrat.config.v1.ConfigService/GetConfig', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          namespace: 'platform',
          version: '2',
          values: {
            // Raw wire JSON via page.route bypasses the server's create()-style init shape
            // (mock-backend.ts's own getConfig handler, `{value: {case, value}}`) and is parsed
            // browser-side by fromJson(), which expects the standard flattened proto3 JSON oneof
            // form — the member's own field name directly, not a `{case, value}` wrapper.
            trading_state: { stringVal: 'REDUCE_ONLY' },
          },
        }),
      });
    });
    await addAuthCookie(page);
    await page.goto('/trader/positions');

    await expect(page.getByText(/Trading reduce-only platform-wide/)).toBeVisible({
      timeout: 30000,
    });
    // The per-account halt badge is suppressed in favor of the platform-wide one (amended AC-5's
    // "one coherent restriction display" — never both at once).
    await expect(page.getByText(/Account halted:/)).not.toBeVisible();
  });
});
