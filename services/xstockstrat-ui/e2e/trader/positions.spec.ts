import { test, expect } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';

/**
 * Book → Exposure risk reframe (feature 083, Step 25). The positions table gains
 * Factor / Stop-distance / Flag columns backed by the additive Position risk fields
 * (factor, stopPrice, stopDistancePct, flag → POSITION_RISK_FLAG). Data comes from the
 * shared mock backend (e2e/mock-backend.ts) — the AAPL row carries factor 'Tech',
 * stopDistancePct 0.062, and flag 3 (STOP_NEAR); MSFT carries none and renders the
 * unclassified / em-dash fallbacks. The account context auto-selects the first active
 * broker account so ListPositions is issued without any manual selection.
 *
 * Row role note (feature 135): the Exposure table's rows are onRowClick-enabled (DataTable
 * migration) — the composite sets role="button" on a clickable row for a11y, which overrides
 * the native <tr> row role, so these locators target 'button', not 'row'.
 */
test.describe('Positions — Exposure risk', () => {
  test('renders Factor, Stop-distance and risk Flag columns', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/trader/positions');

    const aapl = page.getByRole('button', { name: /AAPL/ });
    await expect(aapl).toBeVisible({ timeout: 10000 });
    // Additive risk fields on the AAPL row.
    await expect(aapl).toContainText('Tech'); // factor
    await expect(aapl).toContainText('6.20%'); // stop distance (0.062)
    await expect(aapl.getByText('Stop near')).toBeVisible(); // flag → POSITION_RISK_FLAG STOP_NEAR

    // MSFT has no risk metadata → unclassified factor, em-dash stop/flag fallbacks.
    const msft = page.getByRole('button', { name: /MSFT/ });
    await expect(msft).toContainText('Unclassified');
  });

  test('renders the risk-framed header, stat row and Open R / Risk-at-stop columns', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await page.goto('/trader/positions');

    // Risk framing (not "Positions"/P&L).
    await expect(page.getByRole('heading', { name: 'Exposure' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Total risk at stops')).toBeVisible();
    await expect(page.getByText('Largest factor')).toBeVisible();

    // AAPL: riskAtStop 118 → "-$118.00"; Open R = unrealizedPnl 100 / 118 ≈ +0.8R.
    const aapl = page.getByRole('button', { name: /AAPL/ });
    await expect(aapl).toContainText('-$118.00'); // risk at stop
    await expect(aapl).toContainText('+0.8R'); // open R
    // MSFT has no stop → Open R falls back to em-dash.
    await expect(page.getByRole('button', { name: /MSFT/ })).toContainText('—');
  });

  test('opens the risk-framed single-position detail sheet on row click', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/trader/positions');

    const aapl = page.getByRole('button', { name: /AAPL/ });
    await expect(aapl).toBeVisible({ timeout: 10000 });
    // Click an inert cell to open the quick-peek Sheet. The symbol cell links to the dedicated
    // full-page Position view (feature 096) and the Trade button stops propagation, so target the
    // Side cell, whose click bubbles to the row's Sheet handler.
    await aapl.getByText('Long', { exact: true }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // Risk-framed header + stat grammar (feature 083 — single position mirrors Exposure).
    await expect(dialog.getByText('Stop near').first()).toBeVisible(); // flag (badge + risk row)
    await expect(dialog.getByText('Open R')).toBeVisible();
    await expect(dialog.getByText('Risk at stop')).toBeVisible();
    await expect(dialog).toContainText('-$118.00'); // risk at stop value
    await expect(dialog.getByText('Position risk')).toBeVisible(); // risk section
    await expect(dialog).toContainText('Stop @ $178.00'); // exit rule
    await expect(dialog.getByText('Reported by broker')).toBeVisible(); // broker mirror section
  });

  // New coverage (Step 30): keyboard row-activation is an intentional accessibility improvement
  // added by the DataTable migration — mouse-click was the only way to open the detail Sheet
  // pre-migration. Demonstrates the new capability, not a regression fixture.
  test('opens the detail sheet via keyboard Enter on the row (new accessibility capability)', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await page.goto('/trader/positions');

    const aapl = page.getByRole('button', { name: /AAPL/ });
    await expect(aapl).toBeVisible({ timeout: 10000 });
    await aapl.focus();
    await page.keyboard.press('Enter');

    await expect(page.getByRole('dialog')).toBeVisible();
  });

  // Row-2 instance of the same class of bug Step 25/26 fixed for LiveStrategiesPanel: the
  // composite's isInteractiveTarget guard must cover keydown, not just click, so a keyboard
  // Enter on the Symbol link or Trade button fires only its own action, never also the row's
  // onRowClick (which would open the Sheet on top of/instead of the link navigation or Trade nav).
  test('keyboard Enter on the Symbol link or Trade button does not also open the detail sheet', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await page.goto('/trader/positions');

    const aapl = page.getByRole('button', { name: /AAPL/ });
    await expect(aapl).toBeVisible({ timeout: 10000 });

    const tradeButton = aapl.getByRole('link', { name: 'Trade' });
    await tradeButton.focus();
    await page.keyboard.press('Enter');
    await page.waitForURL(/\/trader\?symbol=AAPL/);

    // The Trade link's own navigation fired; the row's onRowClick must not also have opened
    // the Sheet (which would render as a <dialog> on top of the destination page).
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});

// Step 32: bespoke Sheet-interaction overflow test for the fill-lineage table (row 3, design
// exception). mobile-overflow.spec.ts's generic sweep never clicks anything, so it structurally
// cannot open the position-detail Sheet this table lives inside — this test lives here instead.
// No existing spec asserted the fill-lineage table's content before this (new coverage).
test.describe('Positions — fill-lineage table overflow at 390px (FR-4c, design exception)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the fill-lineage table does not overflow the Sheet, even with a long order id', async ({
    page,
  }) => {
    // Stress the 3-column table with a long order_id — the default mock fixture's short
    // 'mock-order-001' would pass vacuously even if the stacked-layout question were answered
    // wrong. Only intercepts the lineage query (no streamKey) — the reconciliation query (which
    // sets streamKey: 'account:...') passes through to the default mock-backend handler
    // unchanged, so the rest of the page renders normally.
    await page.route('**/xstockstrat.ledger.v1.LedgerService/QueryEvents', async (route) => {
      const body = route.request().postDataJSON() as { streamKey?: string };
      if (body.streamKey) {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          events: [
            {
              eventId: 'evt-lineage-long-001',
              eventType: 'order.filled',
              streamKey: 'order:mock-order-with-a-very-long-broker-generated-identifier-001',
              sourceService: 'trading',
              payload: {
                order_id: 'mock-order-with-a-very-long-broker-generated-identifier-0000001',
                symbol: 'AAPL',
                qty: 10,
                fill_price: 180.0,
                account_id: 'alpaca-default',
                trading_mode: 'TRADING_MODE_PAPER',
                user_id: 'test-user-001',
              },
              sequence: '1',
            },
          ],
          page: { nextPageToken: '' },
        }),
      });
    });

    await addAuthCookie(page);
    await page.goto('/trader/positions');

    const aapl = page.getByRole('button', { name: /AAPL/ });
    await expect(aapl).toBeVisible({ timeout: 10000 });
    await aapl.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Fill lineage')).toBeVisible();
    await expect(
      dialog.getByText('mock-order-with-a-very-long-broker-generated-identifier'),
    ).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(
      overflow,
      `page body scrolls horizontally by ${overflow}px with the Sheet open`,
    ).toBeLessThanOrEqual(1);
  });
});
