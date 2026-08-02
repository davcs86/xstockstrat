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
 */
test.describe('Positions — Exposure risk', () => {
  test('renders Factor, Stop-distance and risk Flag columns', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/trader/positions');

    const aapl = page.getByRole('row', { name: /AAPL/ });
    await expect(aapl).toBeVisible({ timeout: 10000 });
    // Additive risk fields on the AAPL row.
    await expect(aapl).toContainText('Tech'); // factor
    await expect(aapl).toContainText('6.20%'); // stop distance (0.062)
    await expect(aapl.getByText('Stop near')).toBeVisible(); // flag → POSITION_RISK_FLAG STOP_NEAR

    // MSFT has no risk metadata → unclassified factor, em-dash stop/flag fallbacks.
    const msft = page.getByRole('row', { name: /MSFT/ });
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
    const aapl = page.getByRole('row', { name: /AAPL/ });
    await expect(aapl).toContainText('-$118.00'); // risk at stop
    await expect(aapl).toContainText('+0.8R'); // open R
    // MSFT has no stop → Open R falls back to em-dash.
    await expect(page.getByRole('row', { name: /MSFT/ })).toContainText('—');
  });

  test('opens the risk-framed single-position detail sheet on row click', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/trader/positions');

    const aapl = page.getByRole('row', { name: /AAPL/ });
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
});
